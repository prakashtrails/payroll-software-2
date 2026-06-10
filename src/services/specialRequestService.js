import { supabase } from '@/lib/supabase';

/** Fetch all special requests for a tenant (admin/manager view). */
export async function listAllSpecialRequests(tenantId) {
  const { data, error } = await supabase
    .from('special_requests')
    .select(`
      *,
      profile:profiles!special_requests_profile_id_fkey(first_name, last_name, department, ctc),
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

/** Approve or reject a special request (admin/manager). */
export async function updateSpecialRequestStatus(id, status, adminId) {
  const { error } = await supabase
    .from('special_requests')
    .update({ status, approved_by: adminId })
    .eq('id', id);
  return { error };
}
