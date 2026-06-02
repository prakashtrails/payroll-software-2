import { supabase } from '@/lib/supabase';

/** Fetch all special requests for a tenant (admin/manager view). */
export async function listAllSpecialRequests(tenantId) {
  const { data, error } = await supabase
    .from('special_requests')
    .select(`
      *,
      profile:profiles!special_requests_profile_id_fkey(first_name, last_name, department, comp_off_balance),
      approver:profiles!special_requests_approved_by_fkey(first_name, last_name)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Fetch special requests for the current employee. */
export async function listMySpecialRequests(profileId) {
  const { data, error } = await supabase
    .from('special_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Submit a new special request (employee). */
export async function submitSpecialRequest(payload) {
  const { error } = await supabase.from('special_requests').insert([payload]);
  return { error };
}

/** Fetch the comp-off balance for an employee. */
export async function getCompOffBalance(profileId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('comp_off_balance')
    .eq('id', profileId)
    .single();
  return { balance: data?.comp_off_balance ?? 0, error };
}

/**
 * Approve or reject a special request (admin/manager).
 * Side-effects on approval:
 *   Overtime  → comp_off_balance + 1
 *   Comp Off  → comp_off_balance - 1 (sets used_comp_off = true)
 */
export async function updateSpecialRequestStatus(id, status, adminId) {
  const { data: req, error: fetchErr } = await supabase
    .from('special_requests')
    .select('request_type, profile_id, status')
    .eq('id', id)
    .single();
  if (fetchErr) return { error: fetchErr };

  const updatePayload = { status, approved_by: adminId };

  const { error } = await supabase
    .from('special_requests')
    .update(updatePayload)
    .eq('id', id);
  if (error) return { error };

  if (status === 'Approved') {
    if (req.request_type === 'Overtime') {
      // Credit one comp-off day to the employee
      const { data: prof } = await supabase
        .from('profiles')
        .select('comp_off_balance')
        .eq('id', req.profile_id)
        .single();
      const newBalance = (prof?.comp_off_balance ?? 0) + 1;
      await supabase.from('profiles').update({ comp_off_balance: newBalance }).eq('id', req.profile_id);
    } else if (req.request_type === 'Comp Off') {
      // Deduct one comp-off day and mark it as used
      const { data: prof } = await supabase
        .from('profiles')
        .select('comp_off_balance')
        .eq('id', req.profile_id)
        .single();
      const newBalance = Math.max(0, (prof?.comp_off_balance ?? 0) - 1);
      await supabase.from('profiles').update({ comp_off_balance: newBalance }).eq('id', req.profile_id);
      await supabase.from('special_requests').update({ used_comp_off: true }).eq('id', id);
    }
  }

  return { error: null };
}
