import { supabase } from '@/lib/supabase';

/** Fetch all leave requests for a tenant (admin view). */
export async function listAllLeaveRequests(tenantId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(`
      *,
      profile:profiles!leave_requests_profile_id_fkey(first_name, last_name, department),
      approver:profiles!leave_requests_approved_by_fkey(first_name, last_name)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Fetch leave requests for a specific employee. */
export async function listMyLeaveRequests(profileId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('start_date', { ascending: false });
  return { data: data || [], error };
}

/** Submit a new leave request. */
export async function requestLeave(payload) {
  const { error } = await supabase
    .from('leave_requests')
    .insert([payload]);
  return { error };
}

/** Approve or Reject a leave request. */
export async function updateLeaveStatus(id, status, adminId) {
  const { error } = await supabase
    .from('leave_requests')
    .update({ status, approved_by: adminId })
    .eq('id', id);
  return { error };
}
