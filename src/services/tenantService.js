import { supabase } from '@/lib/supabase';

export async function updateTenant(tenantId, payload) {
  const { error } = await supabase.from('tenants').update(payload).eq('id', tenantId);
  return { error };
}

export async function listDepartments(tenantId) {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  return { data: data || [], error };
}

export async function addDepartment(tenantId, name) {
  const { error } = await supabase
    .from('departments')
    .insert([{ tenant_id: tenantId, name: name.trim() }]);
  return { error };
}

export async function removeDepartment(id) {
  const { error } = await supabase.from('departments').delete().eq('id', id);
  return { error };
}

/** Aggregate dashboard stats — all queries run in parallel. */
export async function fetchDashboardStats(tenantId) {
  const [empsRes, payrollRes, advRes] = await Promise.all([
    supabase.from('profiles').select('ctc').eq('tenant_id', tenantId).eq('role', 'employee').eq('status', 'Active'),
    supabase.from('payrolls').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'Processed'),
    supabase.from('advances').select('balance').eq('tenant_id', tenantId).eq('status', 'Active'),
  ]);

  const activeEmployees     = empsRes.data?.length || 0;
  const totalCTC            = empsRes.data?.reduce((s, e) => s + (e.ctc || 0), 0) || 0;
  const processedPayrolls   = payrollRes.count || 0;
  const outstandingAdvances = advRes.data?.reduce((s, a) => s + (a.balance || 0), 0) || 0;
  const error               = empsRes.error || payrollRes.error || advRes.error;

  return { activeEmployees, totalCTC, processedPayrolls, outstandingAdvances, error };
}

/** All tenants — superadmin only. */
export async function listAllTenants() {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Returns the company name for a given org code, or null if not found.
 * Callable before login (anon) — used for the join-company preview.
 */
export async function lookupOrgCode(orgCode) {
  if (!orgCode || orgCode.trim().length < 4) return { companyName: null, error: null };
  const { data, error } = await supabase.rpc('lookup_org', { p_org_code: orgCode.trim() });
  return { companyName: data || null, error };
}

/**
 * Called after supabase.auth.signUp() during employee self-signup.
 * Finds the tenant by org code and creates the employee profile.
 */
export async function employeeJoinWorkspace(orgCode, firstName, lastName, userId) {
  const { data, error } = await supabase.rpc('employee_join_workspace', {
    p_org_code:   orgCode.trim().toUpperCase(),
    p_first_name: firstName.trim(),
    p_last_name:  lastName.trim(),
    p_user_id:    userId || null,
  });
  if (error) throw error;
  return data; // 'ok'
}
