import { supabase } from '@/lib/supabase';
import { notifyProfiles } from './notificationService';

// ── Checklist library ───────────────────────────────────────────────────────
export async function listChecklistItems(tenantId) {
  const { data, error } = await supabase.from('offboarding_checklist_items').select('*').eq('tenant_id', tenantId).order('sort_order').order('created_at');
  return { data: data || [], error };
}
export async function createChecklistItem(tenantId, payload) {
  const { error } = await supabase.from('offboarding_checklist_items').insert([{
    tenant_id: tenantId, title: payload.title.trim(), description: payload.description || '', category: payload.category || 'General',
  }]);
  return { error };
}
export async function deleteChecklistItem(id) {
  const { error } = await supabase.from('offboarding_checklist_items').delete().eq('id', id);
  return { error };
}

// ── Processes ────────────────────────────────────────────────────────────
export async function listProcesses(tenantId) {
  const { data, error } = await supabase
    .from('offboarding_processes')
    .select('*, profile:profiles!offboarding_processes_profile_id_fkey(first_name, middle_name, last_name, department), tasks:offboarding_process_tasks(id, title, category, status)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** An employee's own offboarding process (most recent), with its tasks. */
export async function fetchMyProcess(profileId) {
  const { data, error } = await supabase
    .from('offboarding_processes')
    .select('*, tasks:offboarding_process_tasks(*)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data || null, error };
}

/** Starts a new offboarding process for an exiting employee, copying the current checklist library into editable tasks. */
export async function startProcess(tenantId, profileId, payload, createdBy) {
  const { data: process, error } = await supabase.from('offboarding_processes').insert([{
    tenant_id: tenantId, profile_id: profileId, reason: payload.reason || '',
    exit_date: payload.exit_date || new Date().toISOString().slice(0, 10),
    last_working_day: payload.last_working_day || null, notes: payload.notes || '', created_by: createdBy,
  }]).select('id').single();
  if (error) return { error };

  const { data: items } = await listChecklistItems(tenantId);
  if (items.length > 0) {
    const rows = items.map((item) => ({
      tenant_id: tenantId, process_id: process.id, title: item.title, description: item.description,
      category: item.category, sort_order: item.sort_order, assigned_to: profileId,
    }));
    const { error: tasksError } = await supabase.from('offboarding_process_tasks').insert(rows);
    if (tasksError) return { error: tasksError };
  }

  await notifyProfiles(tenantId, [profileId], {
    type: 'offboarding_started',
    title: 'Offboarding checklist started',
    body: 'Your exit checklist is ready — take a look at your remaining tasks.',
    linkKey: 'my-offboarding',
    relatedId: process.id,
  });

  return { error: null };
}

export async function updateProcess(id, payload) {
  const req = payload.status
    ? (await supabase.from('offboarding_processes').select('tenant_id, profile_id').eq('id', id).single()).data
    : null;

  const { error } = await supabase.from('offboarding_processes').update(payload).eq('id', id);

  if (!error && req?.tenant_id && req?.profile_id) {
    await notifyProfiles(req.tenant_id, [req.profile_id], {
      type: `offboarding_${payload.status.toLowerCase().replace(/\s+/g, '_')}`,
      title: `Offboarding ${payload.status}`,
      body: `Your offboarding status was updated to ${payload.status}.`,
      linkKey: 'my-offboarding',
      relatedId: id,
    });
  }
  return { error };
}

export async function updateTaskStatus(id, status) {
  const { error } = await supabase.from('offboarding_process_tasks').update({
    status, completed_at: status === 'Done' ? new Date().toISOString() : null,
  }).eq('id', id);
  return { error };
}
