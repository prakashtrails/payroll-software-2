import { supabase } from '@/lib/supabase';

/** Own grievances (employee) — admin/superadmin also see everything via the same RLS-scoped query. */
export async function listMyGrievances(profileId) {
  const { data, error } = await supabase
    .from('grievances')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** All grievances for a tenant — RLS already restricts this to admin/superadmin callers. */
export async function listTenantGrievances(tenantId) {
  const { data, error } = await supabase
    .from('grievances')
    .select('*, profile:profiles!grievances_profile_id_fkey(first_name, middle_name, last_name, department)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function fileGrievance(tenantId, profileId, payload) {
  const { error } = await supabase.from('grievances').insert([{
    tenant_id: tenantId, profile_id: profileId, type: payload.type, description: payload.description,
  }]);
  return { error };
}

export async function updateGrievance(id, payload) {
  const { error } = await supabase.from('grievances').update(payload).eq('id', id);
  return { error };
}
