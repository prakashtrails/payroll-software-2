import { supabase } from '@/lib/supabase';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount, incrementManagerCount } from './requestQuotaService';

/**
 * Fetch special requests for a tenant.
 * Pass forRole='manager' to restrict to manager-routed requests only.
 */
export async function listAllSpecialRequests(tenantId, forRole = null) {
  let query = supabase
    .from('special_requests')
    .select(`
      *,
      profile:profiles!special_requests_profile_id_fkey(first_name, last_name, department, ctc),
      approver:profiles!special_requests_approved_by_fkey(first_name, last_name)
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

  const { error } = await supabase.from('special_requests').insert([finalPayload]);
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

  const { error } = await supabase
    .from('special_requests')
    .update({ status, approved_by: approverId })
    .eq('id', id);

  if (!error && status === 'Approved' && approverRole === 'manager' && req?.tenant_id) {
    await incrementManagerCount(req.tenant_id, req.profile_id);
  }

  return { error };
}
