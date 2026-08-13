import { supabase } from '@/lib/supabase';

export const EMPLOYEE_PAGE_SIZE = 25;

/**
 * supabase.functions.invoke() reports any non-2xx response as a generic
 * FunctionsHttpError without surfacing the JSON body — pull the real
 * `{ error }` message out of the response so callers can inspect it
 * (e.g. "already exists" / rate-limit detection during bulk import).
 */
async function invokeMessage(error) {
  if (!error?.context?.json) return error?.message || 'Request failed';
  try {
    const body = await error.context.json();
    return body?.error || error.message;
  } catch {
    return error.message;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// This project's Supabase auth server fleet is inconsistently synced on a
// rotated JWT signing key — some replicas verify a valid session token fine,
// others intermittently reject it with this exact message. It's transient
// (confirmed: back-to-back identical calls alternate pass/fail), so a couple
// of quick retries clears it without the caller ever seeing it.
const isTransientAuthError = (msg) => /invalid jwt|signature is invalid|unable to (parse|verify) signature/i.test(msg || '');

async function invokeWithRetry(fnName, body, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.functions.invoke(fnName, { body });
    const msg = error ? await invokeMessage(error) : data?.error;
    if (!msg) return data;
    lastErr = new Error(msg);
    if (attempt < maxRetries && isTransientAuthError(msg)) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

/**
 * Paginated, server-side-filtered employee list.
 * Returns { data, count, error } — count is the total matching rows.
 */
export async function listEmployees(tenantId, { page = 1, search = '', department = '', status = '', branch = '', outletId = '' } = {}) {
  let q = supabase
    .from('profiles')
    .select('*, outlets(name)', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .neq('role', 'superadmin')
    .order('first_name');

  if (department) q = q.eq('department', department);
  if (status)     q = q.eq('status', status);
  if (branch)     q = q.eq('outlet_location', branch);
  if (outletId)   q = q.eq('outlet_id', outletId);
  if (search) {
    q = q.or(
      `first_name.ilike.%${search}%,middle_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,department.ilike.%${search}%`
    );
  }

  const from = (page - 1) * EMPLOYEE_PAGE_SIZE;
  q = q.range(from, from + EMPLOYEE_PAGE_SIZE - 1);

  const { data, error, count } = await q;
  return { data: data || [], error, count: count || 0 };
}

/** Distinct non-empty branch names for the current tenant. */
export async function listBranches(tenantId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('outlet_location')
    .eq('tenant_id', tenantId)
    .neq('outlet_location', '')
    .not('outlet_location', 'is', null);
  const branches = [...new Set((data || []).map(r => r.outlet_location))].sort();
  return { data: branches, error };
}

/** Lightweight list for dropdowns (id + name only). */
export async function listActiveEmployees(tenantId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, middle_name, last_name, department, designation, ctc, role, country, join_date, pf_enabled, pf_amount, esic_enabled, esic_amount, leave_allocation, employee_id, outlet_location, is_withheld, withheld_reason, bank_acc, bank_name, ifsc_code, manager_id')
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
  try {
    await invokeWithRetry('update-employee-admin', { id, payload });
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Corrects an employee's login email via the update-employee-email edge
 * function, which updates both the Supabase Auth account (what they actually
 * sign in with) and the profiles row — without touching their password, so
 * an existing temp/self-set password keeps working.
 */
export async function updateEmployeeEmail(id, email) {
  try {
    await invokeWithRetry('update-employee-email', { id, email });
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

export async function setEmployeeStatus(id, status) {
  const { error } = await supabase.from('profiles').update({ status }).eq('id', id);
  return { error };
}

/** Withhold/release an employee's salary — processPayroll skips withheld employees entirely. */
export async function setEmployeeWithholding(id, isWithheld, reason = '') {
  const { error } = await supabase.from('profiles').update({
    is_withheld: isWithheld,
    withheld_reason: isWithheld ? reason : '',
  }).eq('id', id);
  return { error };
}

export async function removeEmployee(id) {
  const { error } = await supabase.from('profiles').delete().eq('id', id);
  return { error };
}

/**
 * Creates a Supabase Auth user and profile via the create-employee-user edge
 * function, which runs with the service-role key server-side and verifies
 * the caller is an admin/manager of the target tenant before doing anything.
 * Returns { tempPassword } on success, throws on failure.
 */
export async function createEmployee(tenantId, profileData) {
  const data = await invokeWithRetry('create-employee-user', { tenantId, profileData });
  return { tempPassword: data.tempPassword, userId: data.userId };
}

/** Clears the must_change_password flag after employee sets their own password.
 *  Uses a SECURITY DEFINER RPC because employees have no UPDATE policy on profiles. */
export async function clearMustChangePassword() {
  const { error } = await supabase.rpc('clear_must_change_password');
  return { error };
}

/**
 * Records the employee's current password in employee_current_passwords, a
 * table only superadmin can read (see 20260810_employee_current_password.sql).
 * Called right after an employee sets their own password for the first time,
 * since profiles.temp_password is left stale at that point on purpose.
 */
export async function recordCurrentPassword(password) {
  const { error } = await supabase.rpc('set_current_password', { p_password: password });
  return { error };
}
