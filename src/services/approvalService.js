import { supabase } from '@/lib/supabase';

export const ENTITY_TYPES = ['leave_requests', 'wfh_requests', 'special_requests', 'expense_claims', 'travel_requests'];

export async function listApprovalChains(tenantId) {
  const { data, error } = await supabase.from('approval_chains').select('*').eq('tenant_id', tenantId);
  return { data: data || [], error };
}

export async function saveApprovalChain(tenantId, entityType, steps, editId = null) {
  const row = { tenant_id: tenantId, entity_type: entityType, steps, is_active: true };
  if (editId) {
    const { error } = await supabase.from('approval_chains').update(row).eq('id', editId);
    return { error };
  }
  const { error } = await supabase.from('approval_chains').insert([row]);
  return { error };
}

export async function deleteApprovalChain(id) {
  const { error } = await supabase.from('approval_chains').delete().eq('id', id);
  return { error };
}

/**
 * The first-step role for an entity type if the tenant has an active
 * configured chain, or null if not (meaning: fall back to the entity's own
 * default routing — e.g. leave_requests' self/manager/admin quota tiers).
 * Only a first-step lookup is needed today since nothing yet acts on
 * subsequent steps — extend here if multi-step routing is needed later.
 */
export async function getFirstApproverRole(tenantId, entityType) {
  const { data } = await supabase
    .from('approval_chains')
    .select('steps')
    .eq('tenant_id', tenantId)
    .eq('entity_type', entityType)
    .eq('is_active', true)
    .maybeSingle();
  const steps = data?.steps || [];
  if (!steps.length) return null;
  return [...steps].sort((a, b) => a.order - b.order)[0]?.role || null;
}
