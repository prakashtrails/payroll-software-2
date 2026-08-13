import { supabase } from '@/lib/supabase';

/** All one-off/recurring pay items for a tenant (arrears, incentives, retention bonus, encashment, gratuity payout, ...). */
export async function listSalaryAdditions(tenantId) {
  const { data, error } = await supabase
    .from('salary_additions')
    .select('*, profile:profiles!salary_additions_profile_id_fkey(first_name, middle_name, last_name, department)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Pending (unpaid) items due in a specific payroll month/year — this is what
 * processPayroll folds into each employee's earnings/deductions, same way it
 * already folds `advances`.
 */
export async function fetchPendingSalaryAdditions(tenantId, month, year) {
  const { data, error } = await supabase
    .from('salary_additions')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('status', ['Pending', 'Approved'])
    .eq('effective_month', month)
    .eq('effective_year', year);
  return { data: data || [], error };
}

export async function createSalaryAddition(tenantId, createdBy, payload) {
  const { error } = await supabase.from('salary_additions').insert([{
    tenant_id: tenantId,
    profile_id: payload.profile_id,
    component_name: payload.component_name.trim(),
    category: payload.category,
    amount: parseFloat(payload.amount) || 0,
    is_recurring: !!payload.is_recurring,
    effective_month: parseInt(payload.effective_month),
    effective_year: parseInt(payload.effective_year),
    reason: payload.reason || '',
    status: 'Approved',
    created_by: createdBy,
  }]);
  return { error };
}

export async function updateSalaryAdditionStatus(id, status) {
  const { error } = await supabase.from('salary_additions').update({ status }).eq('id', id);
  return { error };
}

export async function deleteSalaryAddition(id) {
  const { error } = await supabase.from('salary_additions').delete().eq('id', id);
  return { error };
}
