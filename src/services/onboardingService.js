import { supabase } from '@/lib/supabase';
import { notifyProfiles } from './notificationService';

// ── Checklist library ───────────────────────────────────────────────────────
export async function listChecklistItems(tenantId) {
  const { data, error } = await supabase.from('onboarding_checklist_items').select('*').eq('tenant_id', tenantId).order('sort_order').order('created_at');
  return { data: data || [], error };
}
export async function createChecklistItem(tenantId, payload) {
  const { error } = await supabase.from('onboarding_checklist_items').insert([{
    tenant_id: tenantId, title: payload.title.trim(), description: payload.description || '', category: payload.category || 'General',
  }]);
  return { error };
}
export async function deleteChecklistItem(id) {
  const { error } = await supabase.from('onboarding_checklist_items').delete().eq('id', id);
  return { error };
}

// ── Processes ────────────────────────────────────────────────────────────
export async function listProcesses(tenantId) {
  const { data, error } = await supabase
    .from('onboarding_processes')
    .select('*, profile:profiles!onboarding_processes_profile_id_fkey(first_name, middle_name, last_name, department), tasks:onboarding_process_tasks(id, title, category, status)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** An employee's own onboarding process (most recent), with its tasks. */
export async function fetchMyProcess(profileId) {
  const { data, error } = await supabase
    .from('onboarding_processes')
    .select('*, tasks:onboarding_process_tasks(*)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data || null, error };
}

/** Starts a new onboarding process for a hire, copying the current checklist library into editable tasks. */
export async function startProcess(tenantId, profileId, payload, createdBy) {
  const { data: process, error } = await supabase.from('onboarding_processes').insert([{
    tenant_id: tenantId, profile_id: profileId, target_date: payload.target_date || null, notes: payload.notes || '',
    referral_id: payload.referral_id || null, created_by: createdBy,
  }]).select('id').single();
  if (error) return { error };

  const { data: items } = await listChecklistItems(tenantId);
  if (items.length > 0) {
    const rows = items.map((item) => ({
      tenant_id: tenantId, process_id: process.id, title: item.title, description: item.description,
      category: item.category, sort_order: item.sort_order, assigned_to: profileId,
    }));
    const { error: tasksError } = await supabase.from('onboarding_process_tasks').insert(rows);
    if (tasksError) return { error: tasksError };
  }

  await notifyProfiles(tenantId, [profileId], {
    type: 'onboarding_started',
    title: 'Onboarding checklist started',
    body: 'Your onboarding checklist is ready — take a look at your tasks.',
    linkKey: 'my-onboarding',
    relatedId: process.id,
  });

  return { error: null };
}

export async function updateProcess(id, payload) {
  const req = payload.status
    ? (await supabase.from('onboarding_processes').select('tenant_id, profile_id').eq('id', id).single()).data
    : null;

  const { error } = await supabase.from('onboarding_processes').update(payload).eq('id', id);

  if (!error && req?.tenant_id && req?.profile_id) {
    await notifyProfiles(req.tenant_id, [req.profile_id], {
      type: `onboarding_${payload.status.toLowerCase().replace(/\s+/g, '_')}`,
      title: `Onboarding ${payload.status}`,
      body: `Your onboarding status was updated to ${payload.status}.`,
      linkKey: 'my-onboarding',
      relatedId: id,
    });
  }
  return { error };
}

export async function updateTaskStatus(id, status) {
  const { error } = await supabase.from('onboarding_process_tasks').update({
    status, completed_at: status === 'Done' ? new Date().toISOString() : null,
  }).eq('id', id);
  return { error };
}

// ── Buddy assignment & KRA handover (SOP steps 10-11, 15) ──────────────────

/**
 * Assigns a buddy for the new joiner's first 15 days. The end date is
 * computed here, at assignment time, from the process's existing
 * start_date — not baked in when the process is created — since a buddy
 * may be assigned days after the employee actually joined.
 */
export async function assignBuddy(processId, buddyId) {
  const { data: process } = await supabase.from('onboarding_processes').select('start_date').eq('id', processId).single();
  if (!process) return { error: new Error('Onboarding process not found') };

  const endsOn = new Date(process.start_date);
  endsOn.setDate(endsOn.getDate() + 15);

  const { error } = await supabase.from('onboarding_processes').update({
    buddy_id: buddyId, buddy_ends_on: endsOn.toISOString().slice(0, 10),
  }).eq('id', processId);
  return { error };
}

/** Recruiter asks a Hiring Manager/HOD for the new joiner's KRAs — no dedicated role exists, so any profile can be the target. */
export async function requestKra(processId, tenantId, targetProfileId, actorId) {
  const { error } = await supabase.from('onboarding_processes').update({ kra_requested_at: new Date().toISOString() }).eq('id', processId);
  if (!error) {
    await notifyProfiles(tenantId, [targetProfileId], {
      type: 'kra_requested',
      title: 'KRAs requested for a new joiner',
      body: 'Please share the KRAs and role expectations for a new hire before their joining date.',
      linkKey: 'onboarding',
      actorId,
      relatedId: processId,
    });
  }
  return { error };
}

export async function markKraReceived(processId) {
  const { error } = await supabase.from('onboarding_processes').update({ kra_received_at: new Date().toISOString() }).eq('id', processId);
  return { error };
}

// ── Recruitment checklist seed ──────────────────────────────────────────────

const RECRUITMENT_CHECKLIST_DEFAULTS = [
  { title: 'Laptop/Desktop assigned', description: "IT allocates the joiner's laptop or desktop.", category: 'IT Setup', sort_order: 10 },
  { title: 'Company email created', description: 'Official email ID created for the new joiner.', category: 'IT Setup', sort_order: 20 },
  { title: 'Phone/extension provisioned', description: 'Mobile phone or extension allocated, if applicable.', category: 'IT Setup', sort_order: 30 },
  { title: 'Required software installed', description: 'Required software installed and system access granted.', category: 'IT Setup', sort_order: 40 },
  { title: 'Desk/workstation assigned', description: 'Workstation/seating arrangement confirmed.', category: 'Admin Setup', sort_order: 10 },
  { title: 'Stationery kit issued', description: 'Stationery requirements fulfilled.', category: 'Admin Setup', sort_order: 20 },
  { title: 'Access card/biometric enrolled', description: 'Department-specific access requirements set up.', category: 'Admin Setup', sort_order: 30 },
  { title: 'Joining Form signed', description: 'Joining Form signed and filed.', category: 'Documents', sort_order: 10 },
  { title: 'Offer Letter signed', description: 'Offer Letter signed and filed.', category: 'Documents', sort_order: 20 },
  { title: 'Appointment Letter signed', description: 'Appointment Letter signed and filed.', category: 'Documents', sort_order: 30 },
  { title: 'NDA signed', description: 'Non-Disclosure Agreement signed and filed.', category: 'Documents', sort_order: 40 },
  { title: 'PF Form submitted', description: 'PF Form completed, if applicable.', category: 'Documents', sort_order: 50 },
  { title: 'ESIC Form submitted', description: 'ESIC Form completed, if applicable.', category: 'Documents', sort_order: 60 },
  { title: 'Induction PPT delivered', description: 'Company induction presentation walked through.', category: 'Induction', sort_order: 10 },
  { title: 'Company policies shared', description: 'Policies, code of conduct, org structure and culture covered.', category: 'Induction', sort_order: 20 },
  { title: 'Employee handbook shared', description: 'Employee Handbook and Policy Manual shared.', category: 'Induction', sort_order: 30 },
  { title: 'KRA handed over', description: 'Approved KRAs handed over to the new joiner.', category: 'Induction', sort_order: 40 },
  { title: 'Buddy introduced', description: 'Buddy assigned and introduced for the first 15 days.', category: 'Buddy', sort_order: 10 },
  { title: 'First-week check-in completed', description: 'Buddy check-in during the first week of joining.', category: 'Buddy', sort_order: 20 },
  { title: 'Factory visit scheduled', description: 'Factory HR schedules a factory walkthrough for applicable joiners.', category: 'Factory Visit', sort_order: 10 },
  { title: 'Production orientation completed', description: 'Manufacturing process, safety guidelines, and quality standards covered.', category: 'Factory Visit', sort_order: 20 },
];

/**
 * Seeds a tenant's onboarding checklist library with joining-formality
 * items straight out of Raniwala's recruitment SOP (steps 9, 12-16). Same
 * upsert-with-ignoreDuplicates shape as tenantService.initializeMajorHolidays,
 * relying on the (tenant_id, title) unique constraint added alongside this
 * feature — safe to call on a tenant that already has some/all of these.
 */
export async function seedRecruitmentChecklist(tenantId) {
  const rows = RECRUITMENT_CHECKLIST_DEFAULTS.map((item) => ({ tenant_id: tenantId, ...item }));
  const { error } = await supabase
    .from('onboarding_checklist_items')
    .upsert(rows, { onConflict: 'tenant_id,title', ignoreDuplicates: true });
  return { error };
}
