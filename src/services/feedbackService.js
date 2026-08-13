import { supabase } from '@/lib/supabase';

const SELECT = `
  *,
  from_profile:profiles!feedback_from_profile_id_fkey(first_name, middle_name, last_name),
  to_profile:profiles!feedback_to_profile_id_fkey(first_name, middle_name, last_name),
  requested_from_profile:profiles!feedback_requested_from_fkey(first_name, middle_name, last_name)
`;

/** Feedback received about me (completed, not pending requests). */
export async function listReceivedFeedback(tenantId, profileId) {
  const { data, error } = await supabase
    .from('feedback')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('to_profile_id', profileId)
    .eq('status', 'Completed')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Feedback I've given to others. */
export async function listGivenFeedback(tenantId, profileId) {
  const { data, error } = await supabase
    .from('feedback')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('from_profile_id', profileId)
    .eq('status', 'Completed')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Pending feedback requests directed at me, awaiting my response. */
export async function listPendingRequests(tenantId, profileId) {
  const { data, error } = await supabase
    .from('feedback')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('requested_from', profileId)
    .eq('status', 'Pending')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Give direct praise or feedback to someone. */
export async function giveFeedback({ tenantId, fromProfileId, toProfileId, type, message, visibility }) {
  const { error } = await supabase
    .from('feedback')
    .insert([{
      tenant_id: tenantId,
      created_by: fromProfileId,
      from_profile_id: fromProfileId,
      to_profile_id: toProfileId,
      type: type || 'feedback',
      message,
      visibility: visibility || 'private',
      status: 'Completed',
    }]);
  return { error };
}

/** Request feedback about `toProfileId` from `requestedFrom`. */
export async function requestFeedback({ tenantId, createdBy, toProfileId, requestedFrom }) {
  const { error } = await supabase
    .from('feedback')
    .insert([{
      tenant_id: tenantId,
      created_by: createdBy,
      to_profile_id: toProfileId,
      requested_from: requestedFrom,
      type: 'request',
      status: 'Pending',
    }]);
  return { error };
}

/** Fulfill a pending feedback request. */
export async function respondToFeedbackRequest(id, { fromProfileId, message }) {
  const { error } = await supabase
    .from('feedback')
    .update({ from_profile_id: fromProfileId, message, status: 'Completed' })
    .eq('id', id)
    .eq('status', 'Pending');
  return { error };
}
