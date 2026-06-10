import { supabase } from '@/lib/supabase';

/** Fetch all leave requests for a tenant (admin view). */
export async function listAllLeaveRequests(tenantId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(`
      *,
      profile:profiles!leave_requests_profile_id_fkey(first_name, last_name, department),
      approver:profiles!leave_requests_approved_by_fkey(first_name, last_name)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Fetch leave requests for a specific employee. */
export async function listMyLeaveRequests(profileId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('start_date', { ascending: false });
  return { data: data || [], error };
}

/** Submit a new leave request. */
export async function requestLeave(payload) {
  const { error } = await supabase
    .from('leave_requests')
    .insert([payload]);
  return { error };
}

/** Approve or Reject a leave request.
 *  When approving a 'Comp Off' leave, the employee's comp_off_balance is decremented. */
export async function updateLeaveStatus(id, status, adminId) {
  const { data: leave } = await supabase
    .from('leave_requests')
    .select('leave_type, start_date, end_date, profile_id')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('leave_requests')
    .update({ status, approved_by: adminId })
    .eq('id', id);

  if (!error && status === 'Approved' && leave?.leave_type === 'Comp Off') {
    const [sy, sm, sd] = leave.start_date.split('-').map(Number);
    const [ey, em, ed] = leave.end_date.split('-').map(Number);
    let days = 0;
    for (let d = new Date(sy, sm - 1, sd); d <= new Date(ey, em - 1, ed); d.setDate(d.getDate() + 1)) days++;

    const { data: prof } = await supabase
      .from('profiles').select('comp_off_balance').eq('id', leave.profile_id).single();
    await supabase
      .from('profiles')
      .update({ comp_off_balance: Math.max(0, (prof?.comp_off_balance || 0) - days) })
      .eq('id', leave.profile_id);
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
