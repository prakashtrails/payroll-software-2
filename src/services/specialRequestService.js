import { supabase } from '@/lib/supabase';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount, incrementManagerCount } from './requestQuotaService';
import { notifyProfiles, notifyRoles, withHrRole, getRequesterLabel } from './notificationService';

/**
 * Fetch special requests for a tenant.
 * Pass forRole='manager' to restrict to manager-routed requests only.
 */
export async function listAllSpecialRequests(tenantId, forRole = null) {
  let query = supabase
    .from('special_requests')
    .select(`
      *,
      profile:profiles!special_requests_profile_id_fkey(first_name, middle_name, last_name, department, ctc),
      approver:profiles!special_requests_approved_by_fkey(first_name, middle_name, last_name)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (forRole === 'manager') {
    query = query.eq('required_approver_role', 'manager');
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/** Fetch special requests for the current employee. */
export async function listMySpecialRequests(profileId) {
  const { data, error } = await supabase
    .from('special_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Submit a special request with tiered quota routing.
 * Returns { error, tier } where tier is 'self' | 'manager' | 'admin'.
 */
export async function submitSpecialRequest(payload) {
  const { tenant_id, profile_id } = payload;

  const quota = await getOrCreateQuota(tenant_id, profile_id);
  const tier  = determineApproverRole(quota);

  const finalPayload = {
    ...payload,
    status:                 tier === 'self' ? 'Approved' : 'Pending',
    required_approver_role: tier,
    approval_level:         tier === 'self' ? 'self' : null,
  };

  if (tier === 'self') {
    await incrementSelfCount(tenant_id, profile_id);
  }

  const { data: inserted, error } = await supabase.from('special_requests').insert([finalPayload]).select('id').single();

  if (!error && inserted?.id) {
    const requester = await getRequesterLabel(profile_id);
    if (tier === 'self') {
      await notifyProfiles(tenant_id, [profile_id], {
        type: 'special_request_auto_approved',
        title: 'Special request auto-approved',
        body: `Your ${payload.request_type || ''} request was automatically approved.`,
        linkKey: 'special_requests',
        relatedId: inserted.id,
      });
      await notifyRoles(tenant_id, ['admin'], {
        type: 'special_request_auto_approved',
        title: 'Special request auto-approved',
        body: `${requester} submitted a ${payload.request_type || ''} request — auto-approved, no action needed.`,
        linkKey: 'special_requests',
        actorId: profile_id,
        relatedId: inserted.id,
      }, profile_id);
    } else {
      await notifyRoles(tenant_id, withHrRole([tier]), {
        type: 'special_request_submitted',
        title: 'New special request',
        body: `${requester} submitted a new ${payload.request_type || ''} request — needs your review.`,
        linkKey: 'special_requests',
        actorId: profile_id,
        relatedId: inserted.id,
      }, profile_id);
    }
  }

  return { error, tier };
}

/**
 * Approve or reject a special request.
 * approverRole: 'manager' | 'admin' | 'superadmin'
 * When manager approves, increments that employee's manager quota.
 */
export async function updateSpecialRequestStatus(id, status, approverId, approverRole = 'admin') {
  const { data: req } = await supabase
    .from('special_requests')
    .select('profile_id, tenant_id')
    .eq('id', id)
    .single();

  // Only transition a request that's still Pending — prevents a double-clicked Approve
  // from crediting the manager quota (or, for Salary Overtime, payroll) twice.
  const { data: updated, error } = await supabase
    .from('special_requests')
    .update({ status, approved_by: approverId })
    .eq('id', id)
    .eq('status', 'Pending')
    .select('id');

  if (!error && updated?.length === 0) {
    return { error: new Error('This request has already been reviewed.') };
  }

  if (!error && status === 'Approved' && approverRole === 'manager' && req?.tenant_id) {
    await incrementManagerCount(req.tenant_id, req.profile_id);
  }

  if (!error && req?.tenant_id && req?.profile_id) {
    await notifyProfiles(req.tenant_id, [req.profile_id], {
      type: `special_request_${status.toLowerCase()}`,
      title: `Special request ${status}`,
      body: `Your special request was ${status.toLowerCase()}.`,
      linkKey: 'special_requests',
      actorId: approverId,
      relatedId: id,
    });
  }

  return { error };
}
