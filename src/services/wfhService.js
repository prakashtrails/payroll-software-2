import { supabase } from '@/lib/supabase';

const SELECT = `
  *,
  profile:profiles!wfh_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation),
  reviewer:profiles!wfh_requests_reviewed_by_fkey(first_name, middle_name, last_name, role)
`;

/** Admin/Manager: all WFH requests for a tenant, newest first. */
export async function listAllWfhRequests(tenantId) {
  const { data, error } = await supabase
    .from('wfh_requests')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Employee: their own WFH requests, newest first. */
export async function listMyWfhRequests(profileId) {
  const { data, error } = await supabase
    .from('wfh_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function submitWfhRequest({ tenantId, profileId, fromDate, toDate, reason }) {
  const { data, error } = await supabase
    .from('wfh_requests')
    .insert([{
      tenant_id: tenantId,
      profile_id: profileId,
      from_date: fromDate,
      to_date: toDate,
      reason,
    }])
    .select()
    .single();
  return { data, error };
}

export async function approveWfhRequest(id, reviewerId) {
  const reviewedAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('wfh_requests')
    .update({ status: 'Approved', reviewed_by: reviewerId, reviewed_at: reviewedAt })
    .eq('id', id)
    .eq('status', 'Pending')
    .select('id');
  if (!error && updated?.length === 0) {
    return { error: new Error('This request has already been reviewed.') };
  }
  return { error };
}

export async function rejectWfhRequest(id, reviewerId) {
  const reviewedAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('wfh_requests')
    .update({ status: 'Rejected', reviewed_by: reviewerId, reviewed_at: reviewedAt })
    .eq('id', id)
    .eq('status', 'Pending')
    .select('id');
  if (!error && updated?.length === 0) {
    return { error: new Error('This request has already been reviewed.') };
  }
  return { error };
}

export async function cancelWfhRequest(id) {
  const { error } = await supabase.from('wfh_requests').delete().eq('id', id).eq('status', 'Pending');
  return { error };
}

/** Is this employee on an Approved WFH range covering `dateStr` (YYYY-MM-DD)? Used to bypass geofencing. */
export async function getApprovedWfhForDate(profileId, dateStr) {
  const { data, error } = await supabase
    .from('wfh_requests')
    .select('id, from_date, to_date')
    .eq('profile_id', profileId)
    .eq('status', 'Approved')
    .lte('from_date', dateStr)
    .gte('to_date', dateStr)
    .maybeSingle();
  return { data, error };
}
