import { supabase } from '@/lib/supabase';

// ── Projects ─────────────────────────────────────────────────────────────
export async function listProjects(tenantId) {
  const { data, error } = await supabase
    .from('projects')
    .select('*, members:project_members(id, profile_id), tasks:project_tasks(id, status)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}
export async function createProject(tenantId, payload, createdBy) {
  const { error } = await supabase.from('projects').insert([{
    tenant_id: tenantId, name: payload.name.trim(), description: payload.description || '',
    start_date: payload.start_date || null, end_date: payload.end_date || null, created_by: createdBy,
  }]);
  return { error };
}
export async function updateProject(id, payload) {
  const { error } = await supabase.from('projects').update(payload).eq('id', id);
  return { error };
}

// ── Members ──────────────────────────────────────────────────────────────
export async function listProjectMembers(projectId) {
  const { data, error } = await supabase
    .from('project_members')
    .select('*, profile:profile_directory!project_members_profile_id_fkey(first_name, middle_name, last_name, department)')
    .eq('project_id', projectId);
  return { data: data || [], error };
}
export async function addProjectMember(tenantId, projectId, profileId, roleOnProject = 'Member') {
  const { error } = await supabase.from('project_members').insert([{
    tenant_id: tenantId, project_id: projectId, profile_id: profileId, role_on_project: roleOnProject,
  }]);
  return { error };
}
export async function removeProjectMember(id) {
  const { error } = await supabase.from('project_members').delete().eq('id', id);
  return { error };
}

// ── Tasks ────────────────────────────────────────────────────────────────
export async function listProjectTasks(projectId) {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('*, assignee:profile_directory!project_tasks_assigned_to_fkey(first_name, middle_name, last_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** A single employee's tasks across every project in the tenant (standalone tasks live on /tasks). */
export async function listMyTasks(profileId) {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('*, project:projects(name, status)')
    .eq('assigned_to', profileId)
    .not('project_id', 'is', null)
    .order('due_date', { ascending: true, nullsFirst: false });
  return { data: data || [], error };
}

// The assignee's notification is sent by the DB trigger (trg_project_tasks_after).
export async function createProjectTask(tenantId, projectId, payload) {
  const { error } = await supabase.from('project_tasks').insert([{
    tenant_id: tenantId, project_id: projectId, title: payload.title.trim(), description: payload.description || '',
    assigned_to: payload.assigned_to || null, due_date: payload.due_date || null, source: 'web',
  }]);
  return { error };
}

// Status changes go through taskService.updateTask (StatusChangeModal collects what the rules need).
