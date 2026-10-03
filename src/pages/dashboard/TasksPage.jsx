import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  TASK_STATUSES, OPEN_STATUSES, TASK_PRIORITIES,
  listVisibleTasks, listAssignablePeople, createTask, updateTask, deleteTask,
  listTaskActivity, addTaskComment, canManageTask, isOverdue,
} from '@/services/taskService';
import { fullName, fmt, timeAgo, todayStr } from '@/lib/helpers';

const STATUS_BADGE = { 'To Do': 'badge-secondary', 'In Progress': 'badge-info', Blocked: 'badge-warning', Done: 'badge-success', Cancelled: 'badge-danger' };
const PRIORITY_BADGE = { Low: 'badge-secondary', Medium: 'badge-info', High: 'badge-warning', Urgent: 'badge-danger' };
const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const BOARD_COLUMNS = ['To Do', 'In Progress', 'Blocked', 'Done'];
const EMPTY_FORM = { title: '', description: '', assigned_to: '', priority: 'Medium', due_date: '' };

// Open first, then earliest due date (no due date last), then highest priority.
const byUrgency = (a, b) =>
  (OPEN_STATUSES.includes(a.status) ? 0 : 1) - (OPEN_STATUSES.includes(b.status) ? 0 : 1)
  || (a.due_date || '9999').localeCompare(b.due_date || '9999')
  || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

export default function TasksPage() {
  const { tenant, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayStr();

  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOldClosed, setShowOldClosed] = useState(false);

  const [tab, setTab] = useState('mine');
  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [activity, setActivity] = useState([]);
  const [comment, setComment] = useState('');
  const [dragId, setDragId] = useState(null);

  const activeId = searchParams.get('task');
  const activeTask = tasks.find((t) => t.id === activeId) || null;

  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin';
  const teamIds = useMemo(() => new Set(people.filter((p) => p.is_team).map((p) => p.id)), [people]);
  const nameById = useMemo(() => new Map(people.map((p) => [p.id, fullName(p)])), [people]);

  const fetchTasks = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data, error } = await listVisibleTasks(tenant.id, { includeOldClosed: showOldClosed });
      if (error) showToast('Could not load tasks: ' + error.message, 'error');
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [tenant, showOldClosed]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { listAssignablePeople().then(({ data }) => setPeople(data)); }, []);

  const loadActivity = useCallback(async (taskId) => {
    const { data } = await listTaskActivity(taskId);
    setActivity(data);
  }, []);

  useEffect(() => {
    setComment('');
    if (activeId) loadActivity(activeId); else setActivity([]);
  }, [activeId, loadActivity]);

  const openTask = (id) => setSearchParams(id ? { task: id } : {});

  const TABS = [
    { key: 'mine', label: 'My Tasks', match: (t) => t.assigned_to === profile.id },
    { key: 'assigned', label: 'Assigned by Me', match: (t) => t.created_by === profile.id && t.assigned_to !== profile.id },
    ...(teamIds.size > 0 ? [{ key: 'team', label: 'My Team', match: (t) => teamIds.has(t.assigned_to) }] : []),
    { key: 'all', label: isAdmin ? 'All Tasks' : 'All Visible', match: () => true },
  ];
  const currentTab = TABS.find((t) => t.key === tab) || TABS[0];

  const tabTasks = useMemo(() => tasks.filter(currentTab.match), [tasks, currentTab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tabTasks.filter((t) => {
      if (view === 'list') {
        if (statusFilter === 'open' && !OPEN_STATUSES.includes(t.status)) return false;
        if (statusFilter === 'overdue' && !isOverdue(t, today)) return false;
        if (TASK_STATUSES.includes(statusFilter) && t.status !== statusFilter) return false;
      }
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (assigneeFilter && t.assigned_to !== assigneeFilter) return false;
      if (q && !`${t.title} ${t.description} ${t.project?.name || ''} ${fullName(t.assignee)}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort(byUrgency);
  }, [tabTasks, view, statusFilter, priorityFilter, assigneeFilter, search, today]);

  const stats = useMemo(() => ({
    open: tabTasks.filter((t) => OPEN_STATUSES.includes(t.status)).length,
    inProgress: tabTasks.filter((t) => t.status === 'In Progress').length,
    overdue: tabTasks.filter((t) => isOverdue(t, today)).length,
    done: tabTasks.filter((t) => t.status === 'Done').length,
  }), [tabTasks, today]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    tabTasks.forEach((t) => { if (t.assignee) seen.set(t.assigned_to, fullName(t.assignee)); });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tabTasks]);

  const canChangeStatus = (t) => t.assigned_to === profile.id || canManageTask(t, profile, teamIds);
  const statusChoices = (t) => (canManageTask(t, profile, teamIds) || t.status === 'Cancelled'
    ? TASK_STATUSES
    : TASK_STATUSES.filter((s) => s !== 'Cancelled'));

  // ── Actions ──────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, assigned_to: profile.id });
    setShowForm(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({ title: t.title, description: t.description || '', assigned_to: t.assigned_to || '', priority: t.priority, due_date: t.due_date || '' });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return showToast('Task title is required', 'error');
    if (form.title.trim().length > 200) return showToast('Keep the title under 200 characters', 'error');
    setSaving(true);
    try {
      let error;
      if (editing) {
        const patch = { title: form.title.trim(), description: form.description.trim(), priority: form.priority, due_date: form.due_date || null };
        if (!editing.project_id) patch.assigned_to = form.assigned_to || profile.id;
        ({ error } = await updateTask(editing.id, patch));
      } else {
        ({ error } = await createTask(tenant.id, form));
      }
      if (error) return showToast(error.message, 'error');
      showToast(editing ? 'Task updated' : 'Task created', 'success');
      setShowForm(false);
      await fetchTasks();
      if (editing) loadActivity(editing.id);
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (t, status) => {
    if (status === t.status) return;
    const { error } = await updateTask(t.id, { status });
    if (error) return showToast(error.message, 'error');
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status, completed_at: status === 'Done' ? new Date().toISOString() : null } : x)));
    if (t.id === activeId) loadActivity(t.id);
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete "${t.title}"? This also removes its comments and history.`)) return;
    const { error } = await deleteTask(t.id);
    if (error) return showToast(error.message, 'error');
    showToast('Task deleted', 'success');
    openTask(null);
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
  };

  const handleComment = async () => {
    if (!comment.trim() || !activeTask) return;
    const { error } = await addTaskComment(tenant.id, activeTask.id, profile.id, comment);
    if (error) return showToast(error.message, 'error');
    setComment('');
    loadActivity(activeTask.id);
  };

  const handleDrop = (status) => {
    const t = tasks.find((x) => x.id === dragId);
    setDragId(null);
    if (t && canChangeStatus(t)) handleStatus(t, status);
  };

  // ── Rendering helpers ────────────────────────────────────────────────────
  const dueCell = (t) => {
    if (!t.due_date) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    const overdue = isOverdue(t, today);
    const dueToday = t.due_date === today && OPEN_STATUSES.includes(t.status);
    return (
      <span style={{ color: overdue ? 'var(--danger)' : dueToday ? 'var(--warning)' : undefined, fontWeight: overdue || dueToday ? 600 : 400 }}>
        {overdue && <i className="fas fa-circle-exclamation" style={{ marginRight: 4 }} />}
        {dueToday ? 'Today' : fmt.date(t.due_date)}
      </span>
    );
  };

  const statusControl = (t) => (canChangeStatus(t) ? (
    <select className="form-select" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} value={t.status}
      onClick={(e) => e.stopPropagation()} onChange={(e) => handleStatus(t, e.target.value)}>
      {statusChoices(t).map((s) => <option key={s}>{s}</option>)}
    </select>
  ) : <span className={`badge ${STATUS_BADGE[t.status]}`}>{t.status}</span>);

  const activityLine = (a) => {
    switch (a.kind) {
      case 'created': return 'created this task';
      case 'status': return <>changed status from <b>{a.from_value}</b> to <b>{a.to_value}</b></>;
      case 'assigned': return <>reassigned it to <b>{nameById.get(a.to_value) || (a.to_value === activeTask?.assigned_to && fullName(activeTask.assignee)) || 'someone'}</b></>;
      case 'due_date': return <>changed the due date to <b>{a.to_value ? fmt.date(a.to_value) : 'none'}</b></>;
      default: return null;
    }
  };

  const emptyText = tab === 'mine' ? 'No tasks assigned to you.' : 'No tasks match these filters.';

  return (
    <>
      <Header title="Tasks" breadcrumb="Create, assign and track work across your team"
        actions={<button className="btn btn-primary" onClick={openCreate}><i className="fas fa-plus" style={{ marginRight: 6 }} />New Task</button>}
      />

      <div className="tab-bar-wrap">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab-btn ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); setAssigneeFilter(''); }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
        <div className="stats-row">
          <StatCard icon="fa-list-check" iconColor="blue" value={stats.open} label="Open" />
          <StatCard icon="fa-spinner" iconColor="purple" value={stats.inProgress} label="In Progress" />
          <StatCard icon="fa-circle-exclamation" iconColor="red" value={stats.overdue} label="Overdue" />
          <StatCard icon="fa-circle-check" iconColor="green" value={stats.done} label={showOldClosed ? 'Completed' : 'Completed (30 days)'} />
        </div>

        <div className="filter-bar">
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('list')} title="List view"><i className="fas fa-list" /></button>
            <button className={`btn btn-sm ${view === 'board' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('board')} title="Board view"><i className="fas fa-table-columns" /></button>
          </div>
          <input className="form-input" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {view === 'list' && (
            <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="open">Open tasks</option>
              <option value="overdue">Overdue</option>
              <option value="">All statuses</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select className="form-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
          {tab !== 'mine' && assigneeOptions.length > 1 && (
            <select className="form-select" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="">All assignees</option>
              {assigneeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showOldClosed} onChange={(e) => setShowOldClosed(e.target.checked)} />
            Include tasks closed over 30 days ago
          </label>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : view === 'list' ? (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>{emptyText}</td></tr>
                  ) : filtered.map((t) => (
                    <tr key={t.id} onClick={() => openTask(t.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ maxWidth: 360 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                          {t.project && <span><i className="fas fa-diagram-project" style={{ marginRight: 3 }} />{t.project.name}</span>}
                          {t.creator && t.created_by !== t.assigned_to && <span>by {fullName(t.creator)}</span>}
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{t.assignee ? fullName(t.assignee) : '—'}</td>
                      <td><span className={`badge ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span></td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{dueCell(t)}</td>
                      <td>{statusControl(t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(220px, 1fr))`, gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
            {BOARD_COLUMNS.map((col) => {
              const colTasks = filtered.filter((t) => t.status === col);
              return (
                <div key={col} onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop(col)}
                  style={{ background: 'var(--bg)', borderRadius: 10, padding: 10, minHeight: 200 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className={`badge ${STATUS_BADGE[col]}`}>{col}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{colTasks.length}</span>
                  </div>
                  {colTasks.map((t) => (
                    <div key={t.id} className="card" draggable={canChangeStatus(t)} onDragStart={() => setDragId(t.id)}
                      onClick={() => openTask(t.id)}
                      style={{ padding: 10, marginBottom: 8, cursor: 'pointer', borderLeft: `3px solid var(--${isOverdue(t, today) ? 'danger' : 'border'})` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t.title}</div>
                      {t.project && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}><i className="fas fa-diagram-project" style={{ marginRight: 3 }} />{t.project.name}</div>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, gap: 6 }}>
                        <span className={`badge ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>
                        <span>{dueCell(t)}</span>
                      </div>
                      {tab !== 'mine' && t.assignee && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}><i className="fas fa-user" style={{ marginRight: 4 }} />{fullName(t.assignee)}</div>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / edit */}
      <Modal show={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Task' : 'New Task'} width="520px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Create Task'}</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What needs to be done?" />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Assign to</label>
          {editing?.project_id ? (
            <>
              <input className="form-input" disabled value={editing.assignee ? fullName(editing.assignee) : 'Unassigned'} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Project tasks are reassigned from the Projects page.</div>
            </>
          ) : (
            <select className="form-select" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === profile.id ? `Myself (${fullName(p)})` : fullName(p)}{p.department ? ` · ${p.department}` : ''}
                </option>
              ))}
              {editing && form.assigned_to && !people.some((p) => p.id === form.assigned_to) && (
                <option value={form.assigned_to}>{fullName(editing.assignee) || 'Current assignee'}</option>
              )}
            </select>
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="form-input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* Detail */}
      <Modal show={!!activeTask} onClose={() => openTask(null)} title={activeTask?.title || ''} width="640px"
        footer={activeTask && <>
          {canManageTask(activeTask, profile, teamIds) && (
            <>
              <button className="btn btn-outline" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={() => handleDelete(activeTask)}><i className="fas fa-trash" style={{ marginRight: 6 }} />Delete</button>
              <button className="btn btn-outline" onClick={() => openEdit(activeTask)}><i className="fas fa-pen" style={{ marginRight: 6 }} />Edit</button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => openTask(null)}>Close</button>
        </>}
      >
        {activeTask && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              {statusControl(activeTask)}
              <span className={`badge ${PRIORITY_BADGE[activeTask.priority]}`}>{activeTask.priority} priority</span>
              {isOverdue(activeTask, today) && <span className="badge badge-danger">Overdue</span>}
            </div>

            {activeTask.description && (
              <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: '0 0 14px', color: 'var(--text-secondary)' }}>{activeTask.description}</p>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, fontSize: 12, marginBottom: 18 }}>
              <div><div style={{ color: 'var(--text-muted)' }}>Assignee</div><b>{activeTask.assignee ? fullName(activeTask.assignee) : 'Unassigned'}</b></div>
              <div><div style={{ color: 'var(--text-muted)' }}>Assigned by</div><b>{activeTask.creator ? fullName(activeTask.creator) : '—'}</b></div>
              <div><div style={{ color: 'var(--text-muted)' }}>Due</div><b>{dueCell(activeTask)}</b></div>
              {activeTask.project && <div><div style={{ color: 'var(--text-muted)' }}>Project</div><b>{activeTask.project.name}</b></div>}
              <div><div style={{ color: 'var(--text-muted)' }}>Created</div><b>{fmt.date(activeTask.created_at)}</b></div>
              {activeTask.completed_at && <div><div style={{ color: 'var(--text-muted)' }}>Completed</div><b>{fmt.date(activeTask.completed_at)}</b></div>}
            </div>

            <h4 style={{ fontSize: 13, margin: '0 0 10px' }}>Activity</h4>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
              {activity.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No activity yet.</p>}
              {activity.map((a) => (
                <div key={a.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <b>{a.actor ? fullName(a.actor) : 'System'}</b>{' '}
                  {a.kind === 'comment' ? null : <span style={{ color: 'var(--text-secondary)' }}>{activityLine(a)}</span>}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{timeAgo(a.created_at)}</span>
                  {a.kind === 'comment' && <div style={{ whiteSpace: 'pre-wrap', marginTop: 3 }}>{a.body}</div>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea className="form-input" rows={2} maxLength={2000} placeholder="Add a comment or update…" value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleComment(); }} />
              <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} onClick={handleComment} disabled={!comment.trim()}>Post</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
