import { supabase } from '@/lib/supabase';

export const SELF_LIMIT = 3;
export const MANAGER_LIMIT = 5;

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export async function getOrCreateQuota(tenantId, profileId) {
  const { month, year } = currentMonthYear();

  const { data: existing } = await supabase
    .from('request_quotas')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('request_quotas')
    .upsert([{ tenant_id: tenantId, profile_id: profileId, month, year }], {
      onConflict: 'tenant_id,profile_id,month,year',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Returns 'self' | 'manager' | 'admin' based on how many approvals used this month.
 * `selfLimit` defaults to the global SELF_LIMIT (regularize/special requests always use
 * this); leave requests instead pass the tenant's configured leave_auto_approval_limit
 * (0 when a tenant has turned auto-approval off entirely) — see leaveService.requestLeave.
 */
export function determineApproverRole(quota, selfLimit = SELF_LIMIT) {
  if (selfLimit > 0 && quota.self_approved_count < selfLimit) return 'self';
  if (quota.manager_approved_count < MANAGER_LIMIT) return 'manager';
  return 'admin';
}

export async function incrementSelfCount(tenantId, profileId) {
  const { error } = await supabase.rpc('increment_request_quota', {
    p_tenant_id: tenantId,
    p_profile_id: profileId,
    p_field: 'self_approved_count',
  });
  if (error) throw error;
}

export async function incrementManagerCount(tenantId, profileId) {
  const { error } = await supabase.rpc('increment_request_quota', {
    p_tenant_id: tenantId,
    p_profile_id: profileId,
    p_field: 'manager_approved_count',
  });
  if (error) throw error;
}

/**
 * Fetch current month's quota for display on employee pages.
 * `selfLimitOverride` lets the leave page show the tenant's configured
 * leave_auto_approval_limit instead of the global SELF_LIMIT that regularize/
 * special requests use — pass null/undefined to keep the global default.
 */
export async function fetchMyQuota(tenantId, profileId, selfLimitOverride = null) {
  const { month, year } = currentMonthYear();
  const { data } = await supabase
    .from('request_quotas')
    .select('self_approved_count, manager_approved_count')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  return {
    selfUsed:     data?.self_approved_count    || 0,
    selfLimit:    selfLimitOverride ?? SELF_LIMIT,
    managerUsed:  data?.manager_approved_count || 0,
    managerLimit: MANAGER_LIMIT,
  };
}
