import { supabase } from '@/lib/supabase';

// App / web punches held for manager approval (see
// supabase/migrations/20260928_5_app_punch_manager_approval.sql). Both RPCs
// scope to the caller server-side: approver, manager, HOD, or HR.

/** status: 'pending' | 'approved' | 'rejected' | 'all' */
export async function listPunchApprovals(status = 'pending', since = null) {
  const { data, error } = await supabase.rpc('list_punch_approvals', { p_status: status, p_since: since });
  return { data: data || [], error };
}

export async function reviewPunches(punchIds, approve) {
  const { data, error } = await supabase.rpc('review_punches', { p_punch_ids: punchIds, p_approve: approve });
  return { count: data || 0, error };
}
