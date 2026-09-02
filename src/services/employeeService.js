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
  // employee_current_passwords is RLS-scoped to superadmin, or an admin
  // reading their own tenant (see 20260901_1_hr_current_password_read.sql) —
  // it comes back empty for any other caller, so it's safe to always embed.
  let q = supabase
    .from('profiles')
    .select('*, outlets(name), employee_current_passwords(password, updated_at)', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .neq('role', 'superadmin')
    .order('first_name');

  if (department) q = q.eq('department', department);
  if (status)     q = q.eq('status', status);
  if (branch)     q = q.eq('outlet_location', branch);
  if (outletId)   q = q.eq('outlet_id', outletId);
  if (search) {
    // A single-word query matches any one field directly. A multi-word query
    // (e.g. "Suraj Yadav") can't match any single column that way — no column
    // holds the full name — so each word is required to match *some* field
    // independently (chained .or() calls AND together in PostgREST), which
    // finds the row via first_name="Suraj" AND last_name="Yadav" without
    // needing a concatenated-name column.
    search.trim().split(/\s+/).filter(Boolean).forEach((word) => {
      q = q.or(
        `first_name.ilike.%${word}%,middle_name.ilike.%${word}%,last_name.ilike.%${word}%,email.ilike.%${word}%,department.ilike.%${word}%`
      );
    });
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
    .select('id, first_name, middle_name, last_name, department, designation, ctc, role, country, join_date, pf_enabled, pf_amount, esic_enabled, esic_amount, leave_allocation, employee_id, essl_employee_code, outlet_location, is_withheld, withheld_reason, bank_acc, bank_name, ifsc_code, manager_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'Active')
    .in('role', ['employee', 'admin', 'manager'])
    .order('first_name');
  return { data: data || [], error };
}

// NOTE: when payload.manager_id changes, this writes profiles.manager_id
// directly and does NOT touch reporting_relationships (the org-hierarchy
// source of truth used by src/services/orgHierarchyService.js's
// set_direct_manager RPC). That means a manager reassigned here can leave
// reporting_relationships stale relative to it — accepted gap for now; a
// follow-up should add a sync trigger so either write path stays consistent.
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

/**
 * Corrects an employee's phone number via the update-employee-phone edge
 * function. If they have no real login email (i.e. they sign in with a
 * phone-derived placeholder — see phoneToPlaceholderEmail), this also moves
 * their Auth account to the new placeholder so login keeps matching the
 * number they type. Password is left untouched either way.
 */
export async function updateEmployeePhone(id, phone) {
  try {
    await invokeWithRetry('update-employee-phone', { id, phone });
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

/**
 * Admin-triggered password reset for an existing employee via the
 * reset-employee-password edge function: generates a fresh temporary
 * password, sets it on their Auth account, and forces a change on next
 * login. Returns { tempPassword } on success, throws on failure.
 */
export async function resetEmployeePassword(id) {
  const data = await invokeWithRetry('reset-employee-password', { id });
  return { tempPassword: data.tempPassword };
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
