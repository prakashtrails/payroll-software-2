import { supabase } from '@/lib/supabase';

/** All advances for a tenant (ordered newest first). */
export async function listAdvances(tenantId) {
  const { data, error } = await supabase
    .from('advances')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Active advances for a tenant — used during payroll processing. */
export async function listActiveAdvances(tenantId) {
  const { data, error } = await supabase
    .from('advances')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'Active');
  return { data: data || [], error };
}

/** Outstanding advance balance for one employee (self-service dashboard). */
export async function fetchMyAdvanceBalance(profileId) {
  const { data, error } = await supabase
    .from('advances')
    .select('balance')
    .eq('profile_id', profileId)
    .eq('status', 'Active');
  const total = (data || []).reduce((sum, a) => sum + (a.balance || 0), 0);
  return { total, error };
}

export async function createAdvance({ tenantId, profile_id, type, amount, emi, remarks }) {
  const { error } = await supabase.from('advances').insert([{
    tenant_id: tenantId,
    profile_id,
    type,
    amount:  parseFloat(amount),
    emi:     parseFloat(emi),
    paid:    0,
    balance: parseFloat(amount),
    status:  'Active',
    remarks: remarks || '',
  }]);
  return { error };
}

export async function updateAdvance(id, { profile_id, type, amount, emi, paid, remarks }) {
  const { error } = await supabase.from('advances').update({
    profile_id,
    type,
    amount:  parseFloat(amount),
    emi:     parseFloat(emi),
    balance: parseFloat(amount) - (paid || 0),
    remarks: remarks || '',
  }).eq('id', id);
  return { error };
}

export async function deleteAdvance(id) {
  const { error } = await supabase.from('advances').delete().eq('id', id);
  return { error };
}
