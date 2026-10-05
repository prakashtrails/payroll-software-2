import { supabase } from '@/lib/supabase';

// Tasks live in project_tasks (project_id NULL = standalone task). Who may
// see/assign/edit is enforced in the DB (RLS + trg_project_tasks_guard, see
// migrations 20261003_1_task_management.sql and 20261005_2_task_register_rules.sql),
// and the DB also writes the activity log and the app_notifications — so
// nothing here notifies. The register rules (due date to start, frozen due,
// reasons, proof for review) are enforced there too; the UI only asks for the
// inputs up front so people rarely see the DB error.

export const TASK_STATUSES = ['To Do', 'In Progress', 'Blocked', 'Done', 'Cancelled'];
export const OPEN_STATUSES = ['To Do', 'In Progress', 'Blocked'];
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const REPEAT_RULES = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const PERSON = 'id, first_name, middle_name, last_name';
const TASK_SELECT = `*,
  assignee:profile_directory!project_tasks_assigned_to_fkey(${PERSON}, department),
  creator:profile_directory!project_tasks_created_by_fkey(${PERSON}),
  reviewer:profile_directory!project_tasks_reviewer_id_fkey(${PERSON}),
  project:projects(id, name)`;

/**
 * Every task the caller can see (RLS decides which) — all open tasks, tasks
 * waiting for review, plus anything closed in the last 30 days, unless
 * includeOldClosed. One request.
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
    query = query.or(`status.in.("To Do","In Progress","Blocked"),review_status.eq.Pending,updated_at.gte.${since}`);
  }
  const { data, error } = await query;
  return { data: data || [], error };
}

/** People the caller may assign a task to (self + reporting tree; everyone for HR). */
export async function listAssignablePeople() {
  const { data, error } = await supabase.rpc('task_assignable_people');
  return { data: data || [], error };
}

/** Active colleagues who can be named as a task's reviewer (any active member). */
export async function listTenantPeople(tenantId) {
  const { data, error } = await supabase
    .from('profile_directory')
    .select(`${PERSON}, department`)
    .eq('tenant_id', tenantId)
    .eq('status', 'Active')
    .order('first_name');
  return { data: data || [], error };
}

/** PMS KPIs a task can be linked to (empty when the company doesn't use PMS). */
export async function listLinkableKpis() {
  const { data, error } = await supabase.rpc('task_linkable_kpis');
  return { data: data || [], error };
}

const taskRow = (tenantId, payload) => ({
  tenant_id: tenantId,
  title: payload.title.trim(),
  description: payload.description?.trim() || '',
  assigned_to: payload.assigned_to || null,
  priority: payload.priority || 'Medium',
  due_date: payload.due_date || null,
  start_date: payload.start_date || null,
  reviewer_id: payload.reviewer_id || null,
  repeat_rule: payload.repeat_rule || 'none',
  kpi_id: payload.kpi_id || null,
  waiting_on: payload.waiting_on || [],
  parent_task_id: payload.parent_task_id || null,
  source: 'web',
});

export async function createTask(tenantId, payload) {
  const { error } = await supabase.from('project_tasks').insert([taskRow(tenantId, payload)]);
  return { error };
}

/** Paste-from-Excel: one insert for every row (each still passes the DB rules). */
export async function createTasks(tenantId, rows) {
  const { error } = await supabase.from('project_tasks').insert(rows.map((r) => taskRow(tenantId, r)));
  return { error };
}

export async function updateTask(id, patch) {
  const { error } = await supabase.from('project_tasks').update(patch).eq('id', id);
  return { error };
}

/** Approve, or send back to In Progress with a reason (task_review RPC). */
export async function reviewTask(id, action, reason) {
  const { error } = await supabase.rpc('task_review', { p_task: id, p_action: action, p_reason: reason || null });
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

/** Mirrors task_can_review(): reviewer or task manager, never the owner. */
export function canReviewTask(task, profile, teamIds) {
  if (!task || !profile || task.status !== 'Done' || task.review_status !== 'Pending') return false;
  if (task.assigned_to === profile.id) return false;
  return task.reviewer_id === profile.id || canManageTask(task, profile, teamIds);
}

/** Mirrors task_default_approver(): will marking this Done by the owner go to review? */
export function needsReview(task, profile) {
  if (!task || !profile || task.assigned_to !== profile.id) return false;
  return !!(task.reviewer_id || (task.created_by && task.created_by !== task.assigned_to) || profile.manager_id);
}

/** The date work is actually due by: the revised date once one is set. */
export const effectiveDue = (task) => task.revised_due_date || task.due_date || null;

export const isOverdue = (task, today) => {
  const due = effectiveDue(task);
  return !!due && OPEN_STATUSES.includes(task.status) && due < today;
};

/** Whole days past the effective due date (0 when not late). */
export const daysLate = (task, today) => {
  const due = effectiveDue(task);
  if (!due || task.status === 'Cancelled') return 0;
  const end = task.status === 'Done' && task.completed_at ? task.completed_at.slice(0, 10) : today;
  return Math.max(0, Math.round((new Date(end) - new Date(due)) / 86400000));
};
