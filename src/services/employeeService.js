import { supabase } from '@/lib/supabase';

export const EMPLOYEE_PAGE_SIZE = 25;

/**
 * Paginated, server-side-filtered employee list.
 * Returns { data, count, error } — count is the total matching rows.
 */
export async function listEmployees(tenantId, { page = 1, search = '', department = '', status = '' } = {}) {
  let q = supabase
    .from('profiles')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .neq('role', 'superadmin')
    .order('first_name');

  if (department) q = q.eq('department', department);
  if (status)     q = q.eq('status', status);
  if (search) {
    q = q.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,department.ilike.%${search}%`
    );
  }

  const from = (page - 1) * EMPLOYEE_PAGE_SIZE;
  q = q.range(from, from + EMPLOYEE_PAGE_SIZE - 1);

  const { data, error, count } = await q;
  return { data: data || [], error, count: count || 0 };
}

/** Lightweight list for dropdowns (id + name only). */
export async function listActiveEmployees(tenantId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, department, designation, ctc, role')
    .eq('tenant_id', tenantId)
    .eq('status', 'Active')
    .in('role', ['employee', 'manager'])
    .order('first_name');
  return { data: data || [], error };
}

export async function updateEmployee(id, payload) {
  const { error } = await supabase.from('profiles').update(payload).eq('id', id);
  return { error };
}

export async function setEmployeeStatus(id, status) {
  const { error } = await supabase.from('profiles').update({ status }).eq('id', id);
  return { error };
}

export async function removeEmployee(id) {
  const { error } = await supabase.from('profiles').delete().eq('id', id);
  return { error };
}

/**
 * Creates a Supabase Auth user then calls the insert_employee_profile RPC
 * to create the profile under the calling manager's tenant.
 * Returns { tempPassword } on success, throws on failure.
 */
export async function createEmployee(profileData) {
  const tempPassword = 'Pay@' + Math.random().toString(36).slice(2, 8).toUpperCase();

  // Save admin session — supabase.auth.signUp() auto-signs-in the new user
  // when email confirmation is disabled, which would log out the current admin.
  const { data: { session: adminSession } } = await supabase.auth.getSession();

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: profileData.email,
    password: tempPassword,
  });
  if (authError) throw authError;
  if (!authData?.user) throw new Error('Failed to create login account.');

  // Restore admin session immediately so the RPC runs as admin, not the new employee.
  if (adminSession) {
    await supabase.auth.setSession({
      access_token:  adminSession.access_token,
      refresh_token: adminSession.refresh_token,
    });
  }

  const { error: rpcError } = await supabase.rpc('insert_employee_profile', {
    p_user_id:     authData.user.id,
    p_first_name:  profileData.first_name,
    p_last_name:   profileData.last_name,
    p_email:       profileData.email,
    p_phone:       profileData.phone       || '',
    p_department:  profileData.department  || '',
    p_designation: profileData.designation || '',
    p_ctc:         profileData.ctc         || 0,
    p_join_date:   profileData.join_date   || null,
    p_bank_acc:    profileData.bank_acc    || '',
    p_pan:         profileData.pan         || '',
    p_aadhar:      profileData.aadhar      || '',
  });
  if (rpcError) throw rpcError;

  return { tempPassword };
}

/** Clears the must_change_password flag after employee sets their own password. */
export async function clearMustChangePassword(userId) {
  const { error } = await supabase
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', userId);
  return { error };
}
