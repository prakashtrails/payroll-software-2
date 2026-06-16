import { supabase } from '@/lib/supabase';
import { updateTenant } from './tenantService';

function makeGroupCode() {
  const rand = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${rand()}-${rand()}`;
}

export async function fetchGroupDashboard(groupCode) {
  const { data, error } = await supabase.rpc('fetch_group_dashboard', { p_group_code: groupCode });
  return { data: data || null, error };
}

export async function createGroup(tenantId, groupName) {
  const code = makeGroupCode();
  const { error } = await updateTenant(tenantId, {
    group_code: code,
    group_name: (groupName || 'My Group').trim(),
  });
  return { code: error ? null : code, error };
}

export async function linkToGroup(tenantId, groupCode) {
  const { error } = await updateTenant(tenantId, {
    group_code: groupCode.trim().toUpperCase(),
  });
  return { error };
}

export async function leaveGroup(tenantId) {
  const { error } = await updateTenant(tenantId, { group_code: null, group_name: null });
  return { error };
}

/** All employees across every tenant in the group. */
export async function fetchGroupEmployees(groupCode) {
  const { data, error } = await supabase.rpc('fetch_group_employees', { p_group_code: groupCode });
  return { data: Array.isArray(data) ? data : [], error };
}

/** Transfer an employee to another branch within the same group. */
export async function transferEmployee({ profileId, fromTenantId, toTenantId, newEmployeeId, outletLocation, notes }) {
  const { data, error } = await supabase.rpc('transfer_employee', {
    p_profile_id:      profileId,
    p_from_tenant_id:  fromTenantId,
    p_to_tenant_id:    toTenantId,
    p_new_employee_id: newEmployeeId || '',
    p_outlet_location: outletLocation || '',
    p_notes:           notes || null,
  });
  return { data, error };
}

/** Full transfer history for a single employee. */
export async function fetchTransferHistory(profileId) {
  const { data, error } = await supabase.rpc('fetch_employee_transfer_history', {
    p_profile_id: profileId,
  });
  return { data: Array.isArray(data) ? data : [], error };
}
