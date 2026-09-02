import { supabase } from '@/lib/supabase';

/**
 * Flat list of a tenant's active employees, enough to assemble a
 * reporting tree client-side via manager_id — one round trip, no
 * per-node queries (matches listActiveEmployees's pattern).
 */
export async function getOrgTree(tenantId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, middle_name, last_name, role, department, designation, manager_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'Active')
    .order('first_name');
  return { data: data || [], error };
}

/**
 * Reassigns an employee's direct manager via the set_direct_manager
 * RPC, which atomically updates reporting_relationships and
 * profiles.manager_id together (see 20260826_1_org_hierarchy_rpc.sql).
 * Pass managerId = null to remove the employee's manager (make them a root).
 */
export async function setDirectManager(profileId, managerId) {
  const { error } = await supabase.rpc('set_direct_manager', {
    p_profile_id: profileId,
    p_manager_id: managerId,
  });
  return { error };
}

/**
 * Tenant-defined hierarchy level names (e.g. HOD / Manager / Employee),
 * used to label tree nodes. Falls back to role/designation text in the
 * UI if a tenant has none beyond the default 4 seeded at backfill time.
 */
export async function listHierarchyLevels(tenantId) {
  const { data, error } = await supabase
    .from('hierarchy_levels')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('rank');
  return { data: data || [], error };
}
