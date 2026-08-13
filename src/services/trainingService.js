import { supabase } from '@/lib/supabase';

// ── Skills ───────────────────────────────────────────────────────────────
export async function listSkills(tenantId) {
  const { data, error } = await supabase.from('skills').select('*').eq('tenant_id', tenantId).order('name');
  return { data: data || [], error };
}
export async function createSkill(tenantId, name, category = 'General') {
  const { error } = await supabase.from('skills').insert([{ tenant_id: tenantId, name: name.trim(), category }]);
  return { error };
}
export async function deleteSkill(id) {
  const { error } = await supabase.from('skills').delete().eq('id', id);
  return { error };
}

export async function fetchMySkillMap(profileId) {
  const { data, error } = await supabase
    .from('employee_skills')
    .select('*, skill:skills(name, category)')
    .eq('profile_id', profileId);
  return { data: data || [], error };
}

export async function upsertEmployeeSkill(tenantId, profileId, skillId, level, assessedBy) {
  const { error } = await supabase.from('employee_skills').upsert([{
    tenant_id: tenantId, profile_id: profileId, skill_id: skillId, level, assessed_by: assessedBy,
  }], { onConflict: 'profile_id,skill_id' });
  return { error };
}

// ── Training programs / events / enrollments ───────────────────────────────
export async function listTrainingPrograms(tenantId) {
  const { data, error } = await supabase.from('training_programs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
  return { data: data || [], error };
}
export async function createTrainingProgram(tenantId, payload) {
  const { error } = await supabase.from('training_programs').insert([{ tenant_id: tenantId, title: payload.title.trim(), description: payload.description || '' }]);
  return { error };
}
export async function deleteTrainingProgram(id) {
  const { error } = await supabase.from('training_programs').delete().eq('id', id);
  return { error };
}

export async function listTrainingEvents(tenantId) {
  const { data, error } = await supabase
    .from('training_events')
    .select('*, program:training_programs(title), enrollments:training_enrollments(id, profile_id, status)')
    .eq('tenant_id', tenantId)
    .order('event_date', { ascending: false });
  return { data: data || [], error };
}
export async function createTrainingEvent(tenantId, payload) {
  const { error } = await supabase.from('training_events').insert([{
    tenant_id: tenantId, program_id: payload.program_id, event_date: payload.event_date,
    trainer: payload.trainer || '', location: payload.location || '', capacity: payload.capacity ? parseInt(payload.capacity) : null,
  }]);
  return { error };
}

/** An employee's own enrollments, across every event. */
export async function listMyEnrollments(profileId) {
  const { data, error } = await supabase
    .from('training_enrollments')
    .select('*, event:training_events(event_date, program:training_programs(title))')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function enrollInEvent(tenantId, eventId, profileId) {
  const { error } = await supabase.from('training_enrollments').insert([{ tenant_id: tenantId, event_id: eventId, profile_id: profileId }]);
  return { error };
}

export async function updateEnrollmentStatus(id, status) {
  const { error } = await supabase.from('training_enrollments').update({ status }).eq('id', id);
  return { error };
}

export async function submitTrainingFeedback(id, rating, notes) {
  const { error } = await supabase.from('training_enrollments').update({ feedback_rating: rating, feedback_notes: notes || '' }).eq('id', id);
  return { error };
}
