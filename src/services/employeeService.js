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
export async function createEmployee(tenantId, profileData) {
  const tempPassword = 'Pay@' + Math.random().toString(36).slice(2, 8).toUpperCase();
  let newUserId = null;
  let authUserCreated = false;

  // Prefer server-side user creation via custom edge function to avoid built-in email send limits.
  try {
    const { data: createData, error: createError } = await supabase.functions.invoke('create-employee-user', {
      body: {
        email: profileData.email,
        password: tempPassword,
        first_name: profileData.first_name,
        last_name: profileData.last_name,
      },
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
    });

    if (createError) throw createError;
    if (createData?.user_id) {
      newUserId = createData.user_id;
      authUserCreated = true;
    }
  } catch (err) {
    console.warn('create-employee-user edge function failed, falling back to client signUp:', err.message || err);
  }

  if (!newUserId) {
    const { data: { session: adminSession } } = await supabase.auth.getSession();
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: profileData.email,
      password: tempPassword,
    });
    if (authError) throw authError;

    let newUser = authData?.user || authData?.session?.user;
    if (!newUser) {
      const { data: currentUserData, error: currentUserError } = await supabase.auth.getUser();
      if (currentUserError) throw currentUserError;
      newUser = currentUserData?.user;
    }

    if (!newUser?.id) throw new Error('Failed to create login account.');
    newUserId = newUser.id;

    if (adminSession) {
      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }
  }

  const rpcPayload = {
    p_user_id:       newUserId,
    p_tenant_id:     tenantId,
    p_first_name:    profileData.first_name,
    p_last_name:     profileData.last_name,
    p_email:         profileData.email,
    p_phone:         profileData.phone       || '',
    p_department:    profileData.department  || '',
    p_designation:   profileData.designation || '',
    p_ctc:           profileData.ctc         || 0,
    p_join_date:     profileData.join_date   || null,
    p_bank_acc:      profileData.bank_acc    || '',
    p_pan:           profileData.pan         || '',
    p_aadhar:        profileData.aadhar      || '',
    p_temp_password: tempPassword,
    p_leave_allocation: profileData.leave_allocation || 0,
  };

  let rpcResult = await supabase.rpc('insert_employee_profile', rpcPayload);

  if (rpcResult.error && tenantId) {
    const fallbackPayload = { ...rpcPayload };
    delete fallbackPayload.p_tenant_id;
    delete fallbackPayload.p_leave_allocation;
    const fallbackResult = await supabase.rpc('insert_employee_profile', fallbackPayload);
    if (!fallbackResult.error) rpcResult = fallbackResult;
  }

  if (rpcResult.error) {
    const message = rpcResult.error.message || '';
    if (/Could not find the function|schema cache/i.test(message)) {
      const { error: directInsertError } = await supabase.from('profiles').insert([{
        id: newUserId,
        tenant_id: tenantId,
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        email: profileData.email,
        phone: profileData.phone || '',
        department: profileData.department || '',
        designation: profileData.designation || '',
        ctc: profileData.ctc || 0,
        join_date: profileData.join_date || null,
        bank_acc: profileData.bank_acc || '',
        pan: profileData.pan || '',
        aadhar: profileData.aadhar || '',
        temp_password: tempPassword,
        leave_allocation: profileData.leave_allocation || 0,
        role: 'employee',
        status: 'Active',
        must_change_password: true,
      }]);

      if (!directInsertError) {
        rpcResult = { error: null };
      } else {
        rpcResult.error = directInsertError;
      }
    }
  }

  if (rpcResult.error) throw rpcResult.error;

  if (profileData.weekly_holiday || profileData.shift_id) {
    await supabase.from('profiles').update({
      weekly_holiday: profileData.weekly_holiday,
      shift_id:       profileData.shift_id,
      leave_allocation: profileData.leave_allocation || 0,
    }).eq('id', newUserId);
  }

  return { tempPassword };
}

/** Clears the must_change_password flag after employee sets their own password.
 *  Uses a SECURITY DEFINER RPC because employees have no UPDATE policy on profiles. */
export async function clearMustChangePassword() {
  const { error } = await supabase.rpc('clear_must_change_password');
  return { error };
}
