import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { fullName, fmt, timeAgo } from '@/lib/helpers';
import {
  TASK_STATUSES, OPEN_STATUSES, REPEAT_RULES,
  listTaskActivity, addTaskComment, updateTask, reviewTask, createTask,
  canManageTask, canReviewTask,
} from '@/services/taskService';
import { STATUS_BADGE, PRIORITY_BADGE, FIELD_LABELS, ReviewBadge, DueCell, LateBadge } from './taskUi';

const STAGES = ['To Do', 'In Progress', 'In review', 'Approved'];
const stageIndex = (t) => {
  if (t.status === 'Done') return t.review_status === 'Pending' ? 2 : 3;
  if (t.status === 'In Progress' || t.status === 'Blocked') return 1;
  return 0;
};

const Prop = ({ label, children }) => (
  <div><div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{children}</div></div>
);

/**
 * Full task view: stage tracker, properties, sub-tasks, dependencies,
 * deliverables, review panel, activity, field change log and comments.
 */
export default function TaskDrawer({
  task, tasks, profile, teamIds, today, tenantId, nameOf, kpiById,
  onClose, onRequestStatus, onEdit, onDelete, onChanged,
}) {
  const [tab, setTab] = useState('overview');
  const [activity, setActivity] = useState([]);
  const [comment, setComment] = useState('');
  const [newLink, setNewLink] = useState({ label: '', url: '' });
  const [reviewNote, setReviewNote] = useState('');
  const [sub, setSub] = useState({ title: '', due_date: '' });
  const [busy, setBusy] = useState(false);

  const taskId = task?.id;
  const loadActivity = useCallback(async () => {
    if (!taskId) return;
    const { data } = await listTaskActivity(taskId);
    setActivity(data);
  }, [taskId]);

  useEffect(() => {
    setTab('overview'); setComment(''); setReviewNote(''); setNewLink({ label: '', url: '' }); setSub({ title: '', due_date: '' });
    if (taskId) loadActivity(); else setActivity([]);
  }, [taskId, loadActivity]);

  // Refresh history when the task row changes (status, review, edits).
  useEffect(() => { if (taskId) loadActivity(); }, [task?.updated_at, taskId, loadActivity]);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const subtasks = useMemo(() => (task ? tasks.filter((t) => t.parent_task_id === task.id) : []), [tasks, task]);

  if (!task) return <Modal show={false} onClose={onClose} title="" />;

  const manage = canManageTask(task, profile, teamIds);
  const isOwner = task.assigned_to === profile.id;
  const canStatus = isOwner || manage;
  const canReview = canReviewTask(task, profile, teamIds);
  const approvedLocked = task.status === 'Done' && task.review_status === 'Approved' && !manage;
  const statusChoices = TASK_STATUSES.filter((s) => s !== 'Cancelled' || manage || task.status === 'Cancelled');
  const parent = task.parent_task_id ? byId.get(task.parent_task_id) : null;
  const kpi = task.kpi_id ? kpiById.get(task.kpi_id) : null;
  const comments = activity.filter((a) => a.kind === 'comment');
  const changes = activity.filter((a) => a.kind === 'field');
  const history = activity.filter((a) => !['comment', 'field'].includes(a.kind));

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) { showToast(error.message, 'error'); return false; }
      if (okMsg) showToast(okMsg, 'success');
      await onChanged();
      loadActivity();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const addLink = async () => {
    const url = newLink.url.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return showToast('Links must start with http:// or https://', 'error');
    const next = [...(task.deliverables || []), { label: newLink.label.trim() || 'Deliverable', url }];
    if (await run(() => updateTask(task.id, { deliverables: next }), 'Link added')) setNewLink({ label: '', url: '' });
  };
  const removeLink = (i) => run(() => updateTask(task.id, { deliverables: (task.deliverables || []).filter((_, j) => j !== i) }));

  const review = async (action) => {
    if (action === 'send_back' && !reviewNote.trim()) return showToast('Say what still needs doing', 'error');
    if (await run(() => reviewTask(task.id, action, reviewNote), action === 'approve' ? 'Task approved' : 'Sent back to the owner')) setReviewNote('');
  };

  const addSubtask = async () => {
    if (!sub.title.trim()) return showToast('Sub-task title is required', 'error');
    const ok = await run(() => createTask(tenantId, {
      title: sub.title, due_date: sub.due_date || null, parent_task_id: task.id,
      assigned_to: task.assigned_to, priority: task.priority,
    }), 'Sub-task added');
    if (ok) setSub({ title: '', due_date: '' });
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    if (await run(() => addTaskComment(tenantId, task.id, profile.id, comment))) setComment('');
  };

  const historyLine = (a) => {
    switch (a.kind) {
      case 'created': return 'created this task';
      case 'status': return <>moved it from <b>{a.from_value}</b> to <b>{a.to_value}</b></>;
      case 'assigned': return <>gave it to <b>{nameOf(a.to_value)}</b></>;
      case 'due_date': return <>set the due date to <b>{a.to_value ? fmt.date(a.to_value) : 'none'}</b></>;
      case 'review': return a.to_value === 'Approved' ? <><b>approved</b> it</> : <><b>sent it back</b></>;
      default: return null;
    }
  };

  const changeValue = (field, v) => {
    if (v == null || v === '') return '—';
    if (field === 'reviewer') return nameOf(v);
    if (field === 'kpi') return kpiById.get(v)?.title || 'a KPI';
    if (field === 'project') return v === task.project_id && task.project ? task.project.name : 'another project';
    if (field === 'parent_task') return byId.get(v)?.title || 'a task';
    if (/date/.test(field)) return fmt.date(v);
    if (field === 'repeat') return REPEAT_RULES.find((r) => r.value === v)?.label || v;
    if (field === 'deliverables' || field === 'waiting_on') return `${v} item${v === '1' ? '' : 's'}`;
    return v;
  };

  const stage = stageIndex(task);
  const TABS = [
    ['overview', 'Overview'], ['subtasks', `Sub-tasks${subtasks.length ? ` (${subtasks.length})` : ''}`],
    ['activity', 'Activity'], ['changes', 'Changes'], ['comments', `Comments${comments.length ? ` (${comments.length})` : ''}`],
  ];

  return (
    <Modal show onClose={onClose} title={task.title} width="760px"
      footer={<>
        {manage && (
          <>
            <button className="btn btn-outline" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={() => onDelete(task)}><i className="fas fa-trash" style={{ marginRight: 6 }} />Delete</button>
            <button className="btn btn-outline" onClick={() => onEdit(task)}><i className="fas fa-pen" style={{ marginRight: 6 }} />Edit</button>
          </>
        )}
        <button className="btn btn-primary" onClick={onClose}>Close</button>
      </>}
    >
      {/* Status row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {canStatus && !approvedLocked ? (
          <select className="form-select" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} value={task.status}
            onChange={(e) => onRequestStatus(task, e.target.value)}>
            {statusChoices.map((s) => <option key={s}>{s}</option>)}
          </select>
        ) : <span className={`badge ${STATUS_BADGE[task.status]}`}>{task.status}</span>}
        <ReviewBadge task={task} />
        <span className={`badge ${PRIORITY_BADGE[task.priority]}`}>{task.priority} priority</span>
        <LateBadge task={task} today={today} />
        {task.repeat_rule !== 'none' && <span className="badge badge-secondary"><i className="fas fa-repeat" style={{ marginRight: 4 }} />{REPEAT_RULES.find((r) => r.value === task.repeat_rule)?.label}</span>}
        {task.project && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><i className="fas fa-diagram-project" style={{ marginRight: 4 }} />{task.project.name}</span>}
      </div>

      {/* Stage tracker */}
      {task.status !== 'Cancelled' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, fontSize: 11 }}>
          {STAGES.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: i < STAGES.length - 1 ? 1 : 'none' }}>
              <span style={{
                padding: '3px 8px', borderRadius: 12, whiteSpace: 'nowrap',
                background: i < stage ? 'var(--success-light, #e6f6ec)' : i === stage ? 'var(--primary)' : 'var(--bg)',
                color: i === stage ? '#fff' : i < stage ? 'var(--success)' : 'var(--text-muted)', fontWeight: i === stage ? 600 : 400,
              }}>
                {i < stage && <i className="fas fa-check" style={{ marginRight: 4 }} />}
                {s === 'In Progress' && task.status === 'Blocked' ? 'Blocked' : s}
              </span>
              {i < STAGES.length - 1 && <span style={{ flex: 1, height: 2, background: i < stage ? 'var(--success)' : 'var(--border)' }} />}
            </div>
          ))}
        </div>
      )}

      {task.status_note && (
        <div className="card" style={{ padding: 10, marginBottom: 12, fontSize: 12, borderLeft: `3px solid var(--${task.status === 'Blocked' || task.review_status === 'Sent back' ? 'danger' : 'warning'})` }}>
          <b>{task.status === 'Blocked' ? 'Blocked: ' : task.review_status === 'Sent back' ? 'Sent back: ' : 'Note: '}</b>{task.status_note}
        </div>
      )}

      {canReview && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: 'var(--bg)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}><i className="fas fa-clipboard-check" style={{ marginRight: 6 }} />Waiting for your review</div>
          <textarea className="form-input" rows={2} maxLength={500} placeholder="Note (required to send back)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => review('send_back')}><i className="fas fa-rotate-left" style={{ marginRight: 6 }} />Send back</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => review('approve')}><i className="fas fa-check" style={{ marginRight: 6 }} />Approve</button>
          </div>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 12 }}>
        {TABS.map(([k, label]) => <button key={k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {tab === 'overview' && (
        <>
          {task.description && <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: '0 0 14px', color: 'var(--text-secondary)' }}>{task.description}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Prop label="Owner">{task.assignee ? fullName(task.assignee) : 'Unassigned'}</Prop>
            <Prop label="Reviewer">{task.reviewer ? fullName(task.reviewer) : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Assigner / manager</span>}</Prop>
            <Prop label="Assigned by">{task.creator ? fullName(task.creator) : '—'}</Prop>
            <Prop label="Start date">{task.start_date ? fmt.date(task.start_date) : '—'}</Prop>
            <Prop label="Due date">{task.due_date ? fmt.date(task.due_date) : '—'}{task.started_at && task.due_date && <i className="fas fa-lock" title="Locked once work started" style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }} />}</Prop>
            <Prop label="Revised due">{task.revised_due_date ? <DueCell task={task} today={today} /> : '—'}</Prop>
            {task.completed_at && <Prop label="Completed">{fmt.date(task.completed_at)}</Prop>}
            {task.reviewed_at && task.review_status === 'Approved' && <Prop label="Approved">{fmt.date(task.reviewed_at)}{task.reviewed_by ? ` · ${nameOf(task.reviewed_by)}` : ''}</Prop>}
            {parent && <Prop label="Part of">{parent.title}</Prop>}
            <Prop label="Created">{fmt.date(task.created_at)}</Prop>
          </div>

          <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>Linked KPI</h4>
          <p style={{ fontSize: 12, margin: '0 0 14px', color: kpi ? undefined : 'var(--text-muted)' }}>
            {kpi ? <><i className="fas fa-bullseye" style={{ marginRight: 6, color: 'var(--primary)' }} />{kpi.title} <span style={{ color: 'var(--text-muted)' }}>· {kpi.owner_label}</span></> : task.kpi_id ? 'A KPI you cannot view' : 'Not linked — link the number this work moves from Edit.'}
          </p>

          <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>Waiting on</h4>
          {task.waiting_on?.length ? (
            <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 12 }}>
              {task.waiting_on.map((id) => {
                const w = byId.get(id);
                return <li key={id}>{w ? <>{w.title} <span className={`badge ${STATUS_BADGE[w.status]}`} style={{ marginLeft: 4 }}>{w.status}</span></> : 'A task you cannot view'}</li>;
              })}
            </ul>
          ) : <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>Nothing blocking this task.</p>}

          <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>Deliverables</h4>
          {(task.deliverables || []).length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>No links yet — a task going to review needs its document link.</p>}
          <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12 }}>
            {(task.deliverables || []).map((d, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <a href={d.url} target="_blank" rel="noopener noreferrer">{d.label || d.url}</a>
                {canStatus && !approvedLocked && <button className="btn btn-sm" style={{ marginLeft: 6, padding: '0 6px', color: 'var(--danger)' }} title="Remove" onClick={() => removeLink(i)}><i className="fas fa-xmark" /></button>}
              </li>
            ))}
          </ul>
          {canStatus && !approvedLocked && (task.deliverables || []).length < 10 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="form-input" style={{ maxWidth: 160 }} placeholder="Label" value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} />
              <input className="form-input" placeholder="https://…" value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
              <button className="btn btn-outline btn-sm" disabled={busy || !newLink.url.trim()} onClick={addLink}>Add</button>
            </div>
          )}
        </>
      )}

      {tab === 'subtasks' && (
        <>
          {subtasks.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No sub-tasks. The task can't be marked Done while a sub-task is open.</p>}
          {subtasks.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-light)', fontSize: 12 }}>
              <i className={`fas ${OPEN_STATUSES.includes(s.status) ? 'fa-circle' : 'fa-circle-check'}`} style={{ color: OPEN_STATUSES.includes(s.status) ? 'var(--text-muted)' : 'var(--success)' }} />
              <span style={{ flex: 1 }}>{s.title}</span>
              <span>{s.assignee ? fullName(s.assignee) : ''}</span>
              <DueCell task={s} today={today} />
              <span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status}</span>
            </div>
          ))}
          {!parent && (canStatus) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <input className="form-input" placeholder="New sub-task" maxLength={200} value={sub.title} onChange={(e) => setSub({ ...sub, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') addSubtask(); }} />
              <input className="form-input" type="date" style={{ maxWidth: 160 }} value={sub.due_date} onChange={(e) => setSub({ ...sub, due_date: e.target.value })} />
              <button className="btn btn-outline btn-sm" disabled={busy} onClick={addSubtask}>Add</button>
            </div>
          )}
        </>
      )}

      {tab === 'activity' && (
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {history.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No activity yet.</p>}
          {history.map((a) => (
            <div key={a.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
              <b>{a.actor ? fullName(a.actor) : 'System'}</b> <span style={{ color: 'var(--text-secondary)' }}>{historyLine(a)}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{timeAgo(a.created_at)}</span>
              {a.body && <div style={{ marginTop: 3, color: 'var(--text-secondary)' }}>“{a.body}”</div>}
            </div>
          ))}
        </div>
      )}

      {tab === 'changes' && (
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {changes.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No field edits yet. Every edit from now on is recorded here — before, after, who and when.</p>}
          {changes.map((a) => (
            <div key={a.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
              <b>{a.actor ? fullName(a.actor) : 'System'}</b> changed <b>{FIELD_LABELS[a.body] || a.body}</b>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{timeAgo(a.created_at)}</span>
              <div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>
                <s>{changeValue(a.body, a.from_value)}</s> → {changeValue(a.body, a.to_value)}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'comments' && (
        <>
          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 10 }}>
            {comments.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comments yet.</p>}
            {comments.map((a) => (
              <div key={a.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
                <b>{a.actor ? fullName(a.actor) : 'Someone'}</b><span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{timeAgo(a.created_at)}</span>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 3 }}>{a.body}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea className="form-input" rows={2} maxLength={2000} placeholder="Add a comment or update… (Ctrl+Enter to post)" value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(); }} />
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} onClick={postComment} disabled={busy || !comment.trim()}>Post</button>
          </div>
        </>
      )}
    </Modal>
  );
}
