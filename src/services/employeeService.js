import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// Admin client uses service-role key — can create auth users without sending emails
const supabaseAdmin = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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
    .in('role', ['employee', 'admin', 'manager'])
    .order('first_name');
  return { data: data || [], error };
}

export async function updateEmployee(id, payload) {
  const { error } = await supabase.from('profiles').update(payload).eq('id', id);
  return { error };
}

export async function updateEmployeeAdmin(id, payload) {
  const { error } = await supabaseAdmin.from('profiles').update(payload).eq('id', id);
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
const ALREADY_EXISTS_RE = /already.{0,15}registered|already in use|already exists|user already/i;

export async function createEmployee(tenantId, profileData) {
  const tempPassword = 'Pay@' + Math.random().toString(36).slice(2, 8).toUpperCase();
  let newUserId = null;

  // Primary path: admin client creates the auth user directly — no confirmation email, no rate limit.
  const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
    email: profileData.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { first_name: profileData.first_name, last_name: profileData.last_name },
  });

  if (adminError) {
    if (!ALREADY_EXISTS_RE.test(adminError.message || '')) throw adminError;

    // Auth user exists — find their ID and reuse it for the profile
    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (listError) throw listError;
    const existing = listData?.users?.find(u => u.email?.toLowerCase() === profileData.email.toLowerCase());
    if (!existing) throw new Error(`User with email ${profileData.email} already exists but could not be located.`);

    // Check if a profile already exists for this user IN THIS tenant
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', existing.id)
      .maybeSingle();

    if (existingProfile) {
      if (existingProfile.tenant_id === tenantId) {
        // Genuinely already in this company
        throw new Error(`Employee with email ${profileData.email} already exists in your company.`);
      }
      // Profile exists but for a different/null tenant — reassign it to this tenant
      await supabaseAdmin.from('profiles').update({
        tenant_id: tenantId,
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        phone: profileData.phone || '',
        department: profileData.department || '',
        designation: profileData.designation || '',
        ctc: profileData.ctc || 0,
        join_date: profileData.join_date || null,
        bank_acc: profileData.bank_acc || '',
        pan: profileData.pan || '',
        aadhar: profileData.aadhar || '',
        weekly_holiday: profileData.weekly_holiday || 'Sunday',
        leave_allocation: profileData.leave_allocation || 0,
        temp_password: tempPassword,
        status: 'Active',
        must_change_password: true,
      }).eq('id', existing.id);

      await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password: tempPassword,
        email_confirm: true,
      });

      return { tempPassword };
    }

    // No profile at all — confirm auth user and create profile below
    await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      password: tempPassword,
      email_confirm: true,
    });

    newUserId = existing.id;
  } else {
    newUserId = adminData.user.id;
  }

  // Upsert profile via admin client (bypasses RLS).
  // Using upsert so that if Supabase's handle_new_user trigger already created
  // a skeleton {id, email} row, we overwrite it with the full employee data.
  const { error: insertError } = await supabaseAdmin.from('profiles').upsert({
    id:                  newUserId,
    tenant_id:           tenantId,
    first_name:          profileData.first_name,
    last_name:           profileData.last_name,
    email:               profileData.email,
    phone:               profileData.phone        || '',
    department:          profileData.department   || '',
    designation:         profileData.designation  || '',
    ctc:                 profileData.ctc          || 0,
    join_date:           profileData.join_date    || null,
    bank_acc:            profileData.bank_acc     || '',
    pan:                 profileData.pan          || '',
    aadhar:              profileData.aadhar       || '',
    weekly_holiday:      profileData.weekly_holiday || 'Sunday',
    leave_allocation:    profileData.leave_allocation || 0,
    shift_id:            profileData.shift_id     || null,
    temp_password:       tempPassword,
    role:                profileData.role         || 'employee',
    status:              profileData.status || 'Active',
    must_change_password: true,
  }, { onConflict: 'id' });

  if (insertError) throw insertError;

  return { tempPassword };
}

/** Clears the must_change_password flag after employee sets their own password.
 *  Uses a SECURITY DEFINER RPC because employees have no UPDATE policy on profiles. */
export async function clearMustChangePassword() {
  const { error } = await supabase.rpc('clear_must_change_password');
  return { error };
}
