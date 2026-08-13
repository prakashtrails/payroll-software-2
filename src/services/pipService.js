import { supabase } from '@/lib/supabase';

const SELECT = `
  *,
  employee:profiles!pips_profile_id_fkey(first_name, middle_name, last_name),
  manager:profiles!pips_manager_id_fkey(first_name, middle_name, last_name),
  pip_goals(*)
`;

/** PIPs visible to the caller: own, managed, or (admin) all in tenant. */
export async function listPips(tenantId, { status } = {}) {
  let q = supabase
    .from('pips')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  return { data: data || [], error };
}

/** The current user's own PIP status (for the employee self-view). */
export async function getMyActivePip(tenantId, profileId) {
  const { data, error } = await supabase
    .from('pips')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .eq('status', 'In Process')
    .maybeSingle();
  return { data, error };
}

export async function createPip({ tenantId, profileId, managerId, createdBy, reason, startDate, endDate }) {
  const { data, error } = await supabase
    .from('pips')
    .insert([{
      tenant_id: tenantId,
      profile_id: profileId,
      manager_id: managerId || null,
      created_by: createdBy,
      reason,
      start_date: startDate,
      end_date: endDate,
    }])
    .select()
    .single();
  return { data, error };
}

export async function updatePipStatus(id, { status, outcome, outcomeNotes }) {
  const payload = { status };
  if (outcome !== undefined) payload.outcome = outcome;
  if (outcomeNotes !== undefined) payload.outcome_notes = outcomeNotes;
  const { error } = await supabase.from('pips').update(payload).eq('id', id);
  return { error };
}

export async function addPipGoal(pipId, { title, description, targetDate }) {
  const { error } = await supabase.from('pip_goals').insert([{ pip_id: pipId, title, description: description || '', target_date: targetDate || null }]);
  return { error };
}

export async function updatePipGoal(id, payload) {
  const { error } = await supabase.from('pip_goals').update(payload).eq('id', id);
  return { error };
}

export async function listPipCheckins(pipId) {
  const { data, error } = await supabase
    .from('pip_checkins')
    .select('*, author:profiles!pip_checkins_author_id_fkey(first_name, middle_name, last_name)')
    .eq('pip_id', pipId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function addPipCheckin(pipId, authorId, note) {
  const { error } = await supabase.from('pip_checkins').insert([{ pip_id: pipId, author_id: authorId, note }]);
  return { error };
}
