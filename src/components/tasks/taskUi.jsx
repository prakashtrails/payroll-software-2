import { fmt } from '@/lib/helpers';
import { OPEN_STATUSES, effectiveDue, isOverdue, daysLate, needsReview } from '@/services/taskService';

export const STATUS_BADGE = { 'To Do': 'badge-secondary', 'In Progress': 'badge-info', Blocked: 'badge-warning', Done: 'badge-success', Cancelled: 'badge-danger' };
export const PRIORITY_BADGE = { Low: 'badge-secondary', Medium: 'badge-info', High: 'badge-warning', Urgent: 'badge-danger' };
export const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
export const REVIEW_BADGE = { Pending: ['badge-warning', 'In review'], Approved: ['badge-success', 'Approved'], 'Sent back': ['badge-danger', 'Sent back'] };

export const FIELD_LABELS = {
  title: 'Title', description: 'Brief', priority: 'Priority', reviewer: 'Reviewer', start_date: 'Start date',
  revised_due_date: 'Revised due', project: 'Project', parent_task: 'Parent task', waiting_on: 'Waiting on',
  repeat: 'Repeat', kpi: 'Linked KPI', deliverables: 'Deliverables',
};

/** What a move to `status` needs before the DB will accept it. */
export function statusNeeds(task, status, profile, today) {
  const done = status === 'Done';
  return {
    due: ['In Progress', 'Blocked', 'Done'].includes(status) && !task.due_date,
    reason: status === 'Blocked' || (done && !!effectiveDue(task) && effectiveDue(task) < today),
    proof: done && needsReview(task, profile) && !(task.deliverables || []).length,
  };
}
export const needsInput = (n) => n.due || n.reason || n.proof;

export function ReviewBadge({ task }) {
  if (task.status !== 'Done' || !REVIEW_BADGE[task.review_status]) {
    return task.review_status === 'Sent back' && task.status === 'In Progress'
      ? <span className="badge badge-danger">Sent back</span> : null;
  }
  const [cls, label] = REVIEW_BADGE[task.review_status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** Original due struck through when a revised one exists; red when overdue. */
export function DueCell({ task, today }) {
  const due = effectiveDue(task);
  if (!due) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const overdue = isOverdue(task, today);
  const dueToday = due === today && OPEN_STATUSES.includes(task.status);
  return (
    <span style={{ color: overdue ? 'var(--danger)' : dueToday ? 'var(--warning)' : undefined, fontWeight: overdue || dueToday ? 600 : 400, whiteSpace: 'nowrap' }}>
      {task.revised_due_date && task.due_date && (
        <s style={{ color: 'var(--text-muted)', fontWeight: 400, marginRight: 6 }}>{fmt.date(task.due_date)}</s>
      )}
      {overdue && <i className="fas fa-circle-exclamation" style={{ marginRight: 4 }} />}
      {dueToday ? 'Today' : fmt.date(due)}
    </span>
  );
}

export function LateBadge({ task, today }) {
  const n = daysLate(task, today);
  if (!n) return null;
  return <span className="badge badge-danger" title="Days past the due date">{n}d late</span>;
}

/** Due-date buckets for "My work" grouping. */
export function dueBucket(task, today) {
  const due = effectiveDue(task);
  if (!OPEN_STATUSES.includes(task.status)) return 'Closed';
  if (!due) return 'No date';
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  const d = new Date(today);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  const endOfWeek = new Date(d.getTime() + (6 - dow) * 86400000).toISOString().slice(0, 10);
  const endOfNext = new Date(d.getTime() + (13 - dow) * 86400000).toISOString().slice(0, 10);
  if (due <= endOfWeek) return 'This week';
  if (due <= endOfNext) return 'Next week';
  return 'Later';
}
export const DUE_BUCKETS = ['Overdue', 'Today', 'This week', 'Next week', 'Later', 'No date', 'Closed'];
