import { supabase } from '@/lib/supabase';

/** List KRAs visible to the caller: their own, company-wide, or (for admin/manager) everyone's. */
export async function listKras(tenantId, { profileId = null } = {}) {
  let q = supabase
    .from('kras')
    .select('*, profile:profiles!kras_profile_id_fkey(first_name, middle_name, last_name, department), kra_kpis(*)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (profileId) q = q.or(`profile_id.eq.${profileId},profile_id.is.null`);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function createKra({ tenantId, profileId, title, description, scope, weight, periodStart, periodEnd, createdBy }) {
  const { data, error } = await supabase
    .from('kras')
    .insert([{
      tenant_id: tenantId,
      profile_id: profileId || null,
      title,
      description: description || '',
      scope: scope || 'individual',
      weight: weight || 0,
      period_start: periodStart || null,
      period_end: periodEnd || null,
      created_by: createdBy,
    }])
    .select()
    .single();
  return { data, error };
}

export async function updateKra(id, payload) {
  const { error } = await supabase.from('kras').update(payload).eq('id', id);
  return { error };
}

export async function updateKraProgress(id, progressPercent) {
  const { error } = await supabase.from('kras').update({ progress_percent: progressPercent }).eq('id', id);
  return { error };
}

export async function deleteKra(id) {
  const { error } = await supabase.from('kras').delete().eq('id', id);
  return { error };
}

export async function addKpi(kraId, { title, target, achieved, target_value, current_value, unit }) {
  const { error } = await supabase.from('kra_kpis').insert([{
    kra_id: kraId,
    title,
    target: target || '',
    achieved: achieved || '',
    target_value: target_value === '' || target_value == null ? null : Number(target_value),
    current_value: current_value === '' || current_value == null ? null : Number(current_value),
    unit: unit || '',
  }]);
  return { error };
}

export async function updateKpi(id, payload) {
  const { error } = await supabase.from('kra_kpis').update(payload).eq('id', id);
  return { error };
}

export async function deleteKpi(id) {
  const { error } = await supabase.from('kra_kpis').delete().eq('id', id);
  return { error };
}

/** Progress-history log for a KRA, newest first. */
export async function listKraCheckins(kraId) {
  const { data, error } = await supabase
    .from('kra_checkins')
    .select('*, author:profiles!kra_checkins_author_id_fkey(first_name, middle_name, last_name)')
    .eq('kra_id', kraId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Logs a progress update with a note, and moves the KRA's progress_percent to match. */
export async function addKraCheckin(kraId, authorId, note, progressPercent) {
  const { error: checkinError } = await supabase
    .from('kra_checkins')
    .insert([{ kra_id: kraId, author_id: authorId, note, progress_percent: progressPercent }]);
  if (checkinError) return { error: checkinError };
  return updateKraProgress(kraId, progressPercent);
}
