import { supabase } from '@/lib/supabase';

// Tasks live in project_tasks (project_id NULL = standalone task). Who may
// see/assign/edit is enforced in the DB (RLS + trg_project_tasks_guard, see
// migration 20261003_1_task_management.sql), and the DB also writes the
// activity log and the app_notifications — so nothing here notifies.

export const TASK_STATUSES = ['To Do', 'In Progress', 'Blocked', 'Done', 'Cancelled'];
export const OPEN_STATUSES = ['To Do', 'In Progress', 'Blocked'];
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const TASK_SELECT = `*,
  assignee:profile_directory!project_tasks_assigned_to_fkey(id, first_name, middle_name, last_name, department),
  creator:profile_directory!project_tasks_created_by_fkey(id, first_name, middle_name, last_name),
  project:projects(id, name)`;

/**
 * Every task the caller can see (RLS decides which) — all open tasks plus
 * anything closed in the last 30 days, unless includeOldClosed. One request.
 */
export async function listVisibleTasks(tenantId, { includeOldClosed = false } = {}) {
  let query = supabase
    .from('project_tasks')
    .select(TASK_SELECT)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (!includeOldClosed) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    query = query.or(`status.in.("To Do","In Progress","Blocked"),updated_at.gte.${since}`);
  }
  const { data, error } = await query;
  return { data: data || [], error };
}

/** People the caller may assign a task to (self + reporting tree; everyone for HR). */
export async function listAssignablePeople() {
  const { data, error } = await supabase.rpc('task_assignable_people');
  return { data: data || [], error };
}

export async function createTask(tenantId, payload) {
  const { error } = await supabase.from('project_tasks').insert([{
    tenant_id: tenantId,
    title: payload.title.trim(),
    description: payload.description?.trim() || '',
    assigned_to: payload.assigned_to || null,
    priority: payload.priority || 'Medium',
    due_date: payload.due_date || null,
    source: 'web',
  }]);
  return { error };
}

export async function updateTask(id, patch) {
  const { error } = await supabase.from('project_tasks').update(patch).eq('id', id);
  return { error };
}

export async function deleteTask(id) {
  const { error } = await supabase.from('project_tasks').delete().eq('id', id);
  return { error };
}

/** Comments + status/assignment/due-date history for one task, oldest first. */
export async function listTaskActivity(taskId) {
  const { data, error } = await supabase
    .from('task_activity')
    .select('*, actor:profile_directory!task_activity_actor_id_fkey(first_name, middle_name, last_name)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

export async function addTaskComment(tenantId, taskId, actorId, body) {
  const { error } = await supabase.from('task_activity').insert([{
    tenant_id: tenantId, task_id: taskId, actor_id: actorId, kind: 'comment', body: body.trim(),
  }]);
  return { error };
}

/** Mirrors task_can_manage() so the UI only offers edits the DB will accept. */
export function canManageTask(task, profile, teamIds) {
  if (!task || !profile) return false;
  if (profile.role === 'admin' || profile.role === 'superadmin') return true;
  if (task.created_by === profile.id) return true;
  if (task.project_id && profile.role === 'manager') return true;
  return !!task.assigned_to && task.assigned_to !== profile.id && teamIds.has(task.assigned_to);
}

export const isOverdue = (task, today) =>
  !!task.due_date && OPEN_STATUSES.includes(task.status) && task.due_date < today;
