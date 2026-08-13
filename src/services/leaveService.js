import { supabase } from '@/lib/supabase';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount, incrementManagerCount } from './requestQuotaService';
import { getFirstApproverRole } from './approvalService';

/**
 * Fetch leave requests for a tenant.
 * @param {string} tenantId
 * @param {'manager'|null} forRole - pass 'manager' to show only manager-routed requests; null = all
 */
export async function listAllLeaveRequests(tenantId, forRole = null) {
  let query = supabase
    .from('leave_requests')
    .select(`
      *,
      profile:profiles!leave_requests_profile_id_fkey(first_name, middle_name, last_name, department),
      approver:profiles!leave_requests_approved_by_fkey(first_name, middle_name, last_name)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (forRole === 'manager') {
    query = query.eq('required_approver_role', 'manager');
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/** Fetch leave requests for a specific employee. */
export async function listMyLeaveRequests(profileId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Check if an employee is still in their probation period. Returns { inProbation, endsOn }. */
export async function checkProbationStatus(profileId) {
  const { data: prof } = await supabase
    .from('profiles')
    .select('join_date, probation_months, probation_earned_leaves')
    .eq('id', profileId)
    .single();

  if (!prof || !prof.probation_months || !prof.join_date) {
    return { inProbation: false, endsOn: null, earnedLeaves: 0 };
  }

  const [y, m, d] = prof.join_date.split('-').map(Number);
  const joinDate  = new Date(y, m - 1, d);
  const endsOn    = new Date(joinDate);
  endsOn.setMonth(endsOn.getMonth() + prof.probation_months);
  const inProbation = new Date() < endsOn;

  return {
    inProbation,
    endsOn:       endsOn.toISOString().split('T')[0],
    earnedLeaves: prof.probation_earned_leaves || 0,
  };
}

/**
 * Submit a leave request with tiered quota routing.
 * Returns { error, tier } where tier is 'self' | 'manager' | 'admin'.
 * When tier === 'self' the request is auto-approved immediately (no HR needed).
 */
export async function requestLeave(payload) {
  const { tenant_id, profile_id } = payload;

  // Optional per-tenant override: if an admin has configured an approval
  // chain for leave_requests, its first step wins over the self/manager/admin
  // quota tiers below — most tenants have no chain configured, so this is a
  // no-op for them and the existing quota-based routing is unaffected.
  const chainRole = await getFirstApproverRole(tenant_id, 'leave_requests');

  const quota = await getOrCreateQuota(tenant_id, profile_id);
  const tier  = chainRole || determineApproverRole(quota);

  const finalPayload = {
    ...payload,
    status:                 tier === 'self' ? 'Approved' : 'Pending',
    required_approver_role: tier,
    approval_level:         tier === 'self' ? 'self' : null,
  };

  if (tier === 'self') {
    await incrementSelfCount(tenant_id, profile_id);
  }

  const { data: inserted, error } = await supabase.from('leave_requests').insert([finalPayload]).select('id').single();

  // Self-approved requests skip updateLeaveStatus entirely, so ledger the
  // deduction here instead — record_leave_deduction is idempotent and a
  // silent no-op for leave types with no matching leave_types config yet.
  if (!error && tier === 'self' && inserted?.id) {
    const { error: ledgerErr } = await supabase.rpc('record_leave_deduction', { p_leave_request_id: inserted.id });
    if (ledgerErr) console.error('record_leave_deduction failed:', ledgerErr); // non-fatal — the leave request itself already succeeded
  }

  return { error, tier };
}

/**
 * Approve or Reject a leave request.
 * approverRole: 'manager' | 'admin' | 'superadmin'
 * When manager approves, increments that employee's manager quota for the month.
 * When approving a Comp Off leave, decrements comp_off_balance.
 */
export async function updateLeaveStatus(id, status, approverId, approverRole = 'admin') {
  const { data: leave } = await supabase
    .from('leave_requests')
    .select('leave_type, start_date, end_date, profile_id, tenant_id')
    .eq('id', id)
    .single();

  // Only transition a request that's still Pending — without this guard a double-clicked
  // Approve (or a click after someone else already actioned it) re-runs the balance
  // deduction / quota increment below a second time for the same request.
  const { data: updated, error } = await supabase
    .from('leave_requests')
    .update({ status, approved_by: approverId })
    .eq('id', id)
    .eq('status', 'Pending')
    .select('id');

  if (!error && updated?.length === 0) {
    return { error: new Error('This request has already been reviewed.') };
  }

  if (!error && status === 'Approved') {
    if (leave?.leave_type === 'Comp Off') {
      const [sy, sm, sd] = leave.start_date.split('-').map(Number);
      const [ey, em, ed] = leave.end_date.split('-').map(Number);
      let days = 0;
      for (let d = new Date(sy, sm - 1, sd); d <= new Date(ey, em - 1, ed); d.setDate(d.getDate() + 1)) days++;
      // Atomic — avoids the lost-update race from a read-then-write on comp_off_balance.
      await supabase.rpc('adjust_comp_off_balance', { p_profile_id: leave.profile_id, p_delta: -days });
    }

    if (approverRole === 'manager' && leave?.tenant_id && leave?.profile_id) {
      await incrementManagerCount(leave.tenant_id, leave.profile_id);
    }

    const { error: ledgerErr } = await supabase.rpc('record_leave_deduction', { p_leave_request_id: id });
    if (ledgerErr) console.error('record_leave_deduction failed:', ledgerErr); // non-fatal — approval itself already succeeded
  }

  return { error };
}

/** Returns a map of profileId → approved Comp Off leave days for a given month (0-indexed). */
export async function fetchApprovedCompOffLeavesForMonth(tenantId, month, year) {
  const m = month + 1;
  const startDate = `${year}-${String(m).padStart(2, '0')}-01`;
  const endDate   = new Date(year, month + 1, 0).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('leave_requests')
    .select('profile_id, start_date, end_date')
    .eq('tenant_id', tenantId)
    .eq('leave_type', 'Comp Off')
    .eq('status', 'Approved')
    .lte('start_date', endDate)
    .gte('end_date', startDate);

  const [msy, msm, msd] = startDate.split('-').map(Number);
  const [mey, mem, med] = endDate.split('-').map(Number);
  const monthStart = new Date(msy, msm - 1, msd);
  const monthEnd   = new Date(mey, mem - 1, med);

  const byEmployee = {};
  (data || []).forEach(leave => {
    const [lsy, lsm, lsd] = leave.start_date.split('-').map(Number);
    const [ley, lem, led] = leave.end_date.split('-').map(Number);
    const s = new Date(Math.max(new Date(lsy, lsm - 1, lsd), monthStart));
    const e = new Date(Math.min(new Date(ley, lem - 1, led), monthEnd));
    let days = 0;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) days++;
    byEmployee[leave.profile_id] = (byEmployee[leave.profile_id] || 0) + days;
  });

  return { data: byEmployee, error };
}
