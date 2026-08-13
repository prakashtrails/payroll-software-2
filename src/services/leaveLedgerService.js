import { supabase } from '@/lib/supabase';

/** Configured leave types for a tenant (admin-managed). */
export async function listLeaveTypes(tenantId) {
  const { data, error } = await supabase
    .from('leave_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  return { data: data || [], error };
}

/**
 * Keka-style default categories, seeded for any tenant that has none yet —
 * covers tenants created after 20260813_8_keka_leave_categories.sql (which
 * only backfilled tenants that existed at migration time). Safe to call
 * repeatedly; a no-op once any leave type exists for the tenant.
 */
const DEFAULT_LEAVE_TYPES = [
  { name: 'Planned Leave', is_paid: true, carry_forward: true, max_carry_forward_days: 5, accrual_frequency: 'yearly', accrual_days: 12, annual_quota: 12, encashable: true, max_continuous_days: null },
  { name: 'Emergency Leave', is_paid: true, carry_forward: false, max_carry_forward_days: 0, accrual_frequency: 'yearly', accrual_days: 5, annual_quota: 5, encashable: false, max_continuous_days: 3 },
  { name: 'Unplanned Leave', is_paid: false, carry_forward: false, max_carry_forward_days: 0, accrual_frequency: 'none', accrual_days: 0, annual_quota: 6, encashable: false, max_continuous_days: null },
];

export async function seedDefaultLeaveTypesIfEmpty(tenantId) {
  const { data: existing } = await listLeaveTypes(tenantId);
  if (existing.length > 0) return { seeded: false };
  for (const t of DEFAULT_LEAVE_TYPES) {
    await supabase.from('leave_types').insert([{ tenant_id: tenantId, ...t, is_active: true }]);
  }
  return { seeded: true };
}

export async function saveLeaveType(tenantId, payload, editId = null) {
  const row = {
    tenant_id: tenantId,
    name: payload.name.trim(),
    is_paid: !!payload.is_paid,
    carry_forward: !!payload.carry_forward,
    max_carry_forward_days: parseFloat(payload.max_carry_forward_days) || 0,
    accrual_frequency: payload.accrual_frequency,
    accrual_days: parseFloat(payload.accrual_days) || 0,
    annual_quota: parseFloat(payload.annual_quota) || 0,
    encashable: !!payload.encashable,
    max_continuous_days: payload.max_continuous_days ? parseFloat(payload.max_continuous_days) : null,
    is_active: payload.is_active !== false,
  };
  if (editId) {
    const { error } = await supabase.from('leave_types').update(row).eq('id', editId);
    return { error };
  }
  const { error } = await supabase.from('leave_types').insert([row]);
  return { error };
}

export async function deleteLeaveType(id) {
  const { error } = await supabase.from('leave_types').delete().eq('id', id);
  return { error };
}

/** One employee's ledger-derived balances across every configured leave type. */
export async function fetchMyLeaveBalances(profileId) {
  const { data, error } = await supabase
    .from('leave_balances')
    .select('*, leave_type:leave_types(name, encashable)')
    .eq('profile_id', profileId);
  return { data: data || [], error };
}

/** Every employee's balances for a tenant (admin view). */
export async function fetchTenantLeaveBalances(tenantId) {
  const { data, error } = await supabase
    .from('leave_balances')
    .select('*, leave_type:leave_types(name, encashable), profile:profiles!leave_balances_profile_id_fkey(first_name, middle_name, last_name, department)')
    .eq('tenant_id', tenantId);
  return { data: data || [], error };
}

/** Full ledger history for one employee/leave type — audit trail behind the balance number. */
export async function fetchLeaveLedgerHistory(profileId, leaveTypeId) {
  const { data, error } = await supabase
    .from('leave_ledger')
    .select('*')
    .eq('profile_id', profileId)
    .eq('leave_type_id', leaveTypeId)
    .order('effective_date', { ascending: false });
  return { data: data || [], error };
}

/** Admin manual allocation/adjustment. */
export async function allocateLeave(profileId, leaveTypeId, days, note = '') {
  const { error } = await supabase.rpc('allocate_leave', {
    p_profile_id: profileId, p_leave_type_id: leaveTypeId, p_days: days, p_entry_type: 'Allocation', p_note: note,
  });
  return { error };
}

/** Ledger the deduction for an approved (non-Comp-Off) leave request — safe to call more than once (idempotent). */
export async function recordLeaveDeduction(leaveRequestId) {
  const { error } = await supabase.rpc('record_leave_deduction', { p_leave_request_id: leaveRequestId });
  return { error };
}

/** Encash `days` of balance for `amount` ₹, applied to the given payroll month via a salary_additions row. */
export async function recordLeaveEncashment(profileId, leaveTypeId, days, amount, month, year) {
  const { error } = await supabase.rpc('record_leave_encashment', {
    p_profile_id: profileId, p_leave_type_id: leaveTypeId, p_days: days, p_amount: amount, p_month: month, p_year: year,
  });
  return { error };
}
