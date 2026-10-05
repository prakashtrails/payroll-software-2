import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  TASK_STATUSES, OPEN_STATUSES, TASK_PRIORITIES, REPEAT_RULES,
  listVisibleTasks, listAssignablePeople, listTenantPeople, listLinkableKpis,
  createTask, updateTask, deleteTask, canManageTask, canReviewTask, isOverdue, effectiveDue,
} from '@/services/taskService';
import { fullName, todayStr } from '@/lib/helpers';
import {
  STATUS_BADGE, PRIORITY_BADGE, PRIORITY_RANK, ReviewBadge, DueCell, LateBadge,
  statusNeeds, needsInput, dueBucket, DUE_BUCKETS,
} from '@/components/tasks/taskUi';
import StatusChangeModal from '@/components/tasks/StatusChangeModal';
import PasteTasksModal from '@/components/tasks/PasteTasksModal';
import TaskDrawer from '@/components/tasks/TaskDrawer';

// Board lanes: Done is split into "In review" (waiting on the approver) and "Done" (approved).
const BOARD_COLUMNS = [
  { key: 'To Do', label: 'To Do', match: (t) => t.status === 'To Do', drop: 'To Do' },
  { key: 'In Progress', label: 'In Progress', match: (t) => t.status === 'In Progress', drop: 'In Progress' },
  { key: 'Blocked', label: 'Blocked', match: (t) => t.status === 'Blocked', drop: 'Blocked' },
  { key: 'review', label: 'In review', match: (t) => t.status === 'Done' && t.review_status === 'Pending', drop: 'Done' },
  { key: 'Done', label: 'Done', match: (t) => t.status === 'Done' && t.review_status !== 'Pending', drop: 'Done' },
];
const GROUPS = [['', 'No grouping'], ['due', 'Due date'], ['status', 'Status'], ['project', 'Project'], ['owner', 'Owner']];
const EMPTY_FORM = {
  title: '', description: '', assigned_to: '', reviewer_id: '', priority: 'Medium', start_date: '',
  due_date: '', revised_due_date: '', repeat_rule: 'none', kpi_id: '', waiting_on: [],
};
const DEFAULT_FILTERS = { tab: 'mine', view: 'list', statusFilter: 'open', priorityFilter: '', assigneeFilter: '', groupBy: '', search: '' };

// Open first, then earliest due date (no due date last), then highest priority.
const byUrgency = (a, b) =>
  (OPEN_STATUSES.includes(a.status) ? 0 : 1) - (OPEN_STATUSES.includes(b.status) ? 0 : 1)
  || (effectiveDue(a) || '9999').localeCompare(effectiveDue(b) || '9999')
  || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

// Saved views live in this browser only (per company + person) — no DB rows.
const viewsKey = (tenantId, profileId) => `crewcore.taskViews.${tenantId}.${profileId}`;
const readViews = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
const writeViews = (key, views) => { try { localStorage.setItem(key, JSON.stringify(views)); } catch { /* storage blocked */ } };

export default function TasksPage() {
  const { tenant, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayStr();

  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [tenantPeople, setTenantPeople] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOldClosed, setShowOldClosed] = useState(false);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const { tab, view, statusFilter, priorityFilter, assigneeFilter, groupBy, search } = filters;
  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const storageKey = tenant && profile ? viewsKey(tenant.id, profile.id) : null;
  const [savedViews, setSavedViews] = useState([]);
  useEffect(() => { if (storageKey) setSavedViews(readViews(storageKey)); }, [storageKey]);

  const [showForm, setShowForm] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [statusReq, setStatusReq] = useState(null);
  const [dragId, setDragId] = useState(null);

  const activeId = searchParams.get('task');
  const activeTask = tasks.find((t) => t.id === activeId) || null;

  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin';
  const teamIds = useMemo(() => new Set(people.filter((p) => p.is_team).map((p) => p.id)), [people]);
  const nameById = useMemo(() => new Map([...tenantPeople, ...people].map((p) => [p.id, fullName(p)])), [people, tenantPeople]);
  const nameOf = useCallback((id) => nameById.get(id) || 'someone', [nameById]);
  const kpiById = useMemo(() => new Map(kpis.map((k) => [k.id, k])), [kpis]);

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
  useEffect(() => {
    if (!tenant) return;
    listAssignablePeople().then(({ data }) => setPeople(data));
    listTenantPeople(tenant.id).then(({ data }) => setTenantPeople(data));
    listLinkableKpis().then(({ data }) => setKpis(data));
  }, [tenant]);

  const openTask = (id) => setSearchParams(id ? { task: id } : {});

  const TABS = [
    { key: 'mine', label: 'My Tasks', match: (t) => t.assigned_to === profile.id },
    { key: 'assigned', label: 'Assigned by Me', match: (t) => t.created_by === profile.id && t.assigned_to !== profile.id },
    ...(teamIds.size > 0 ? [{ key: 'team', label: 'My Team', match: (t) => teamIds.has(t.assigned_to) }] : []),
    { key: 'review', label: 'To Review', match: (t) => canReviewTask(t, profile, teamIds) },
    { key: 'all', label: isAdmin ? 'All Tasks' : 'All Visible', match: () => true },
  ];
  const currentTab = TABS.find((t) => t.key === tab) || TABS[0];
  const toReviewCount = useMemo(() => tasks.filter((t) => canReviewTask(t, profile, teamIds)).length, [tasks, profile, teamIds]);

  const tabTasks = useMemo(() => tasks.filter(currentTab.match), [tasks, currentTab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tabTasks.filter((t) => {
      if (view === 'list' && tab !== 'review') {
        if (statusFilter === 'open' && !OPEN_STATUSES.includes(t.status)) return false;
        if (statusFilter === 'overdue' && !isOverdue(t, today)) return false;
        if (statusFilter === 'today' && !(effectiveDue(t) === today && OPEN_STATUSES.includes(t.status))) return false;
        if (statusFilter === 'review' && !(t.status === 'Done' && t.review_status === 'Pending')) return false;
        if (TASK_STATUSES.includes(statusFilter) && t.status !== statusFilter) return false;
      }
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (assigneeFilter && t.assigned_to !== assigneeFilter) return false;
      if (q && !`${t.title} ${t.description} ${t.project?.name || ''} ${fullName(t.assignee)}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort(byUrgency);
  }, [tabTasks, view, tab, statusFilter, priorityFilter, assigneeFilter, search, today]);

  const groups = useMemo(() => {
    if (!groupBy || view !== 'list') return [['', filtered]];
    const keyOf = {
      due: (t) => dueBucket(t, today),
      status: (t) => (t.status === 'Done' && t.review_status === 'Pending' ? 'In review' : t.status),
      project: (t) => t.project?.name || 'No project',
      owner: (t) => (t.assignee ? fullName(t.assignee) : 'Unassigned'),
    }[groupBy];
    const map = new Map();
    filtered.forEach((t) => { const k = keyOf(t); if (!map.has(k)) map.set(k, []); map.get(k).push(t); });
    const order = groupBy === 'due' ? DUE_BUCKETS : groupBy === 'status' ? ['To Do', 'In Progress', 'Blocked', 'In review', 'Done', 'Cancelled'] : [...map.keys()].sort();
    return order.filter((k) => map.has(k)).map((k) => [k, map.get(k)]);
  }, [filtered, groupBy, view, today]);

  const stats = useMemo(() => ({
    open: tabTasks.filter((t) => OPEN_STATUSES.includes(t.status)).length,
    today: tabTasks.filter((t) => effectiveDue(t) === today && OPEN_STATUSES.includes(t.status)).length,
    overdue: tabTasks.filter((t) => isOverdue(t, today)).length,
    blocked: tabTasks.filter((t) => t.status === 'Blocked').length,
    inReview: tabTasks.filter((t) => t.status === 'Done' && t.review_status === 'Pending').length,
  }), [tabTasks, today]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    tabTasks.forEach((t) => { if (t.assignee) seen.set(t.assigned_to, fullName(t.assignee)); });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tabTasks]);

  const canChangeStatus = (t) => (t.assigned_to === profile.id || canManageTask(t, profile, teamIds))
    && !(t.status === 'Done' && t.review_status === 'Approved' && !canManageTask(t, profile, teamIds));
  const statusChoices = (t) => (canManageTask(t, profile, teamIds) || t.status === 'Cancelled'
    ? TASK_STATUSES
    : TASK_STATUSES.filter((s) => s !== 'Cancelled'));

  // ── Saved views ──────────────────────────────────────────────────────────
  const saveView = () => {
    const name = window.prompt('Name this view (saved in this browser):');
    if (!name?.trim()) return;
    const next = [...savedViews.filter((v) => v.name !== name.trim()), { name: name.trim(), filters }].slice(-12);
    setSavedViews(next);
    writeViews(storageKey, next);
    showToast('View saved', 'success');
  };
  const removeView = (name) => {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    writeViews(storageKey, next);
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, assigned_to: profile.id });
    setShowForm(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({
      title: t.title, description: t.description || '', assigned_to: t.assigned_to || '', reviewer_id: t.reviewer_id || '',
      priority: t.priority, start_date: t.start_date || '', due_date: t.due_date || '', revised_due_date: t.revised_due_date || '',
      repeat_rule: t.repeat_rule || 'none', kpi_id: t.kpi_id || '', waiting_on: t.waiting_on || [],
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return showToast('Task title is required', 'error');
    if (form.title.trim().length > 200) return showToast('Keep the title under 200 characters', 'error');
    const owner = editing?.project_id ? editing.assigned_to : (form.assigned_to || profile.id);
    if (form.reviewer_id && form.reviewer_id === owner) return showToast('The reviewer must be someone other than the owner', 'error');
    setSaving(true);
    try {
      let error;
      if (editing) {
        const patch = {
          title: form.title.trim(), description: form.description.trim(), priority: form.priority,
          reviewer_id: form.reviewer_id || null, start_date: form.start_date || null,
          repeat_rule: form.repeat_rule, kpi_id: form.kpi_id || null, waiting_on: form.waiting_on,
        };
        if (editing.started_at) patch.revised_due_date = form.revised_due_date || null;
        else patch.due_date = form.due_date || null;
        if (!editing.project_id) patch.assigned_to = owner;
        ({ error } = await updateTask(editing.id, patch));
      } else {
        ({ error } = await createTask(tenant.id, { ...form, assigned_to: owner }));
      }
      if (error) return showToast(error.message, 'error');
      showToast(editing ? 'Task updated' : 'Task created', 'success');
      setShowForm(false);
      await fetchTasks();
    } finally {
      setSaving(false);
    }
  };

  const applyStatus = async (t, patch) => {
    const { error } = await updateTask(t.id, patch);
    if (error) return showToast(error.message, 'error');
    setStatusReq(null);
    await fetchTasks();
  };

  // Ask for whatever the register rules need (due date, reason, proof) first.
  const requestStatus = (t, status) => {
    if (status === t.status) return;
    const needs = statusNeeds(t, status, profile, today);
    if (needsInput(needs) || status === 'Cancelled') setStatusReq({ task: t, status, needs });
    else applyStatus(t, { status, status_note: null });
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete "${t.title}"? This also removes its sub-tasks, comments and history.`)) return;
    const { error } = await deleteTask(t.id);
    if (error) return showToast(error.message, 'error');
    showToast('Task deleted', 'success');
    openTask(null);
    setTasks((prev) => prev.filter((x) => x.id !== t.id && x.parent_task_id !== t.id));
  };

  const handleDrop = (status) => {
    const t = tasks.find((x) => x.id === dragId);
    setDragId(null);
    if (t && canChangeStatus(t)) requestStatus(t, status);
  };

  // ── Rendering helpers ────────────────────────────────────────────────────
  const statusControl = (t) => (canChangeStatus(t) ? (
    <select className="form-select" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} value={t.status}
      onClick={(e) => e.stopPropagation()} onChange={(e) => requestStatus(t, e.target.value)}>
      {statusChoices(t).map((s) => <option key={s}>{s}</option>)}
    </select>
  ) : <span className={`badge ${STATUS_BADGE[t.status]}`}>{t.status}</span>);

  const subCount = useMemo(() => {
    const m = new Map();
    tasks.forEach((t) => { if (t.parent_task_id) m.set(t.parent_task_id, (m.get(t.parent_task_id) || 0) + 1); });
    return m;
  }, [tasks]);
  const titleById = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);

  const taskMeta = (t) => (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
      {t.parent_task_id && <span><i className="fas fa-turn-up fa-rotate-90" style={{ marginRight: 3 }} />{titleById.get(t.parent_task_id) || 'sub-task'}</span>}
      {t.project && <span><i className="fas fa-diagram-project" style={{ marginRight: 3 }} />{t.project.name}</span>}
      {t.kpi_id && <span title={kpiById.get(t.kpi_id)?.title || 'Linked KPI'}><i className="fas fa-bullseye" style={{ marginRight: 3 }} />KPI</span>}
      {subCount.get(t.id) > 0 && <span><i className="fas fa-list-ul" style={{ marginRight: 3 }} />{subCount.get(t.id)} sub-task{subCount.get(t.id) > 1 ? 's' : ''}</span>}
      {t.repeat_rule && t.repeat_rule !== 'none' && <span><i className="fas fa-repeat" style={{ marginRight: 3 }} />{t.repeat_rule}</span>}
      {t.creator && t.created_by !== t.assigned_to && <span>by {fullName(t.creator)}</span>}
      {t.status === 'Blocked' && t.status_note && <span style={{ color: 'var(--warning)' }}><i className="fas fa-ban" style={{ marginRight: 3 }} />{t.status_note.slice(0, 60)}</span>}
    </div>
  );

  const emptyText = tab === 'mine' ? 'No tasks assigned to you.' : tab === 'review' ? 'Nothing is waiting for your review.' : 'No tasks match these filters.';
  const startedEditing = !!editing?.started_at;
  const waitingChoices = tasks.filter((t) => t.id !== editing?.id && t.parent_task_id !== editing?.id && OPEN_STATUSES.includes(t.status));
  const tile = (key, patch) => ({ onClick: () => setFilter({ view: 'list', ...patch }), style: { cursor: 'pointer', outline: statusFilter === key && view === 'list' ? '2px solid var(--primary)' : undefined, borderRadius: 12 } });

  return (
    <>
      <Header title="Tasks" breadcrumb="Plan, assign, review and track work across your team"
        actions={<>
          <button className="btn btn-outline" onClick={() => setShowPaste(true)} style={{ marginRight: 8 }}><i className="fas fa-paste" style={{ marginRight: 6 }} />Paste tasks</button>
          <button className="btn btn-primary" onClick={openCreate}><i className="fas fa-plus" style={{ marginRight: 6 }} />New Task</button>
        </>}
      />

      <div className="tab-bar-wrap">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setFilter({ tab: t.key, assigneeFilter: '' })}>
              {t.label}{t.key === 'review' && toReviewCount > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{toReviewCount}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
        <div className="stats-row">
          <div {...tile('open', { statusFilter: 'open' })}><StatCard icon="fa-list-check" iconColor="blue" value={stats.open} label="Open" /></div>
          <div {...tile('today', { statusFilter: 'today' })}><StatCard icon="fa-calendar-day" iconColor="purple" value={stats.today} label="Due today" /></div>
          <div {...tile('overdue', { statusFilter: 'overdue' })}><StatCard icon="fa-circle-exclamation" iconColor="red" value={stats.overdue} label="Overdue" /></div>
          <div {...tile('Blocked', { statusFilter: 'Blocked' })}><StatCard icon="fa-ban" iconColor="orange" value={stats.blocked} label="Blocked" /></div>
          <div {...tile('review', { statusFilter: 'review' })}><StatCard icon="fa-clipboard-check" iconColor="green" value={stats.inReview} label="In review" /></div>
        </div>

        <div className="filter-bar">
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter({ view: 'list' })} title="List view"><i className="fas fa-list" /></button>
            <button className={`btn btn-sm ${view === 'board' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter({ view: 'board' })} title="Board view"><i className="fas fa-table-columns" /></button>
          </div>
          <input className="form-input" placeholder="Search tasks…" value={search} onChange={(e) => setFilter({ search: e.target.value })} />
          {view === 'list' && tab !== 'review' && (
            <select className="form-select" value={statusFilter} onChange={(e) => setFilter({ statusFilter: e.target.value })}>
              <option value="open">Open tasks</option>
              <option value="today">Due today</option>
              <option value="overdue">Overdue</option>
              <option value="review">In review</option>
              <option value="">All statuses</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select className="form-select" value={priorityFilter} onChange={(e) => setFilter({ priorityFilter: e.target.value })}>
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
          {tab !== 'mine' && assigneeOptions.length > 1 && (
            <select className="form-select" value={assigneeFilter} onChange={(e) => setFilter({ assigneeFilter: e.target.value })}>
              <option value="">All owners</option>
              {assigneeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          {view === 'list' && (
            <select className="form-select" value={groupBy} onChange={(e) => setFilter({ groupBy: e.target.value })} title="Group rows">
              {GROUPS.map(([v, l]) => <option key={v} value={v}>{v ? `Group: ${l}` : l}</option>)}
            </select>
          )}
          <select className="form-select" value="" onChange={(e) => {
            const v = savedViews.find((x) => x.name === e.target.value);
            if (v) setFilters({ ...DEFAULT_FILTERS, ...v.filters });
          }} title="Saved views">
            <option value="">{savedViews.length ? 'Saved views…' : 'No saved views'}</option>
            {savedViews.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <button className="btn btn-outline btn-sm" onClick={saveView} title="Save these filters as a view"><i className="fas fa-bookmark" /></button>
          {savedViews.length > 0 && (
            <button className="btn btn-outline btn-sm" title="Delete a saved view" onClick={() => {
              const name = window.prompt(`Delete which view?\n${savedViews.map((v) => v.name).join('\n')}`);
              if (name) removeView(name.trim());
            }}><i className="fas fa-trash" /></button>
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
                <thead><tr><th>Task</th><th>Owner</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>{emptyText}</td></tr>
                  ) : groups.map(([label, rows]) => [
                    label && (
                      <tr key={`g-${label}`}><td colSpan={5} style={{ background: 'var(--bg)', fontSize: 12, fontWeight: 600, color: label === 'Overdue' ? 'var(--danger)' : undefined }}>{label} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {rows.length}</span></td></tr>
                    ),
                    ...rows.map((t) => (
                      <tr key={t.id} onClick={() => openTask(t.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ maxWidth: 380 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                          {taskMeta(t)}
                        </td>
                        <td style={{ fontSize: 12 }}>{t.assignee ? fullName(t.assignee) : '—'}</td>
                        <td><span className={`badge ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span></td>
                        <td style={{ fontSize: 12 }}><DueCell task={t} today={today} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {statusControl(t)}<ReviewBadge task={t} /><LateBadge task={t} today={today} />
                          </div>
                        </td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(220px, 1fr))`, gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
            {BOARD_COLUMNS.map((col) => {
              const colTasks = filtered.filter(col.match);
              return (
                <div key={col.key} onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop(col.drop)}
                  style={{ background: 'var(--bg)', borderRadius: 10, padding: 10, minHeight: 200 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className={`badge ${col.key === 'review' ? 'badge-warning' : STATUS_BADGE[col.key]}`}>{col.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{colTasks.length}</span>
                  </div>
                  {colTasks.map((t) => (
                    <div key={t.id} className="card" draggable={canChangeStatus(t)} onDragStart={() => setDragId(t.id)}
                      onClick={() => openTask(t.id)}
                      style={{ padding: 10, marginBottom: 8, cursor: 'pointer', borderLeft: `3px solid var(--${isOverdue(t, today) ? 'danger' : 'border'})` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t.title}</div>
                      {taskMeta(t)}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, gap: 6, marginTop: 6 }}>
                        <span className={`badge ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>
                        <DueCell task={t} today={today} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, marginTop: 6 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{tab !== 'mine' && t.assignee ? <><i className="fas fa-user" style={{ marginRight: 4 }} />{fullName(t.assignee)}</> : null}</span>
                        <LateBadge task={t} today={today} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail first so the edit / status dialogs it opens stack on top. */}
      {activeTask && (
        <TaskDrawer task={activeTask} tasks={tasks} profile={profile} teamIds={teamIds} today={today} tenantId={tenant.id}
          nameOf={nameOf} kpiById={kpiById}
          onClose={() => openTask(null)} onRequestStatus={requestStatus} onEdit={openEdit} onDelete={handleDelete} onChanged={fetchTasks} />
      )}

      {/* Create / edit */}
      <Modal show={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Task' : 'New Task'} width="620px"
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
          <label className="form-label">Brief</label>
          <textarea className="form-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this task is for and what done looks like" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Owner</label>
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
                  <option value={form.assigned_to}>{fullName(editing.assignee) || 'Current owner'}</option>
                )}
              </select>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Reviewer</label>
            <select className="form-select" value={form.reviewer_id} onChange={(e) => setForm({ ...form, reviewer_id: e.target.value })}>
              <option value="">Assigner / manager (default)</option>
              {tenantPeople.map((p) => <option key={p.id} value={p.id}>{fullName(p)}{p.department ? ` · ${p.department}` : ''}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Repeat</label>
            <select className="form-select" value={form.repeat_rule} onChange={(e) => setForm({ ...form, repeat_rule: e.target.value })}>
              {REPEAT_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start date</label>
            <input className="form-input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Due date{startedEditing && <i className="fas fa-lock" style={{ marginLeft: 6, fontSize: 10 }} />}</label>
            <input className="form-input" type="date" value={form.due_date} disabled={startedEditing} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {startedEditing ? 'Locked once work started — use the revised due date.' : 'Needed before work starts; locked after that.'}
            </div>
          </div>
          {startedEditing && (
            <div className="form-group">
              <label className="form-label">Revised due</label>
              <input className="form-input" type="date" value={form.revised_due_date} onChange={(e) => setForm({ ...form, revised_due_date: e.target.value })} />
            </div>
          )}
        </div>
        {kpis.length > 0 && (
          <div className="form-group">
            <label className="form-label">Linked KPI</label>
            <select className="form-select" value={form.kpi_id} onChange={(e) => setForm({ ...form, kpi_id: e.target.value })}>
              <option value="">Not linked</option>
              {kpis.map((k) => <option key={k.id} value={k.id}>{k.title} · {k.owner_label} (FY {k.fy})</option>)}
              {form.kpi_id && !kpiById.has(form.kpi_id) && <option value={form.kpi_id}>Current KPI</option>}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>The goal or KPI from Performance this work moves.</div>
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Waiting on</label>
          <select className="form-select" multiple size={Math.min(5, Math.max(2, waitingChoices.length))} value={form.waiting_on}
            onChange={(e) => setForm({ ...form, waiting_on: [...e.target.selectedOptions].map((o) => o.value).slice(0, 20) })}>
            {waitingChoices.map((t) => <option key={t.id} value={t.id}>{t.title}{t.assignee ? ` — ${fullName(t.assignee)}` : ''}</option>)}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Tasks that must finish first (Ctrl/Cmd-click to pick several). This task can't be marked Done until they are.</div>
        </div>
      </Modal>

      <StatusChangeModal request={statusReq} onClose={() => setStatusReq(null)} onConfirm={applyStatus} />

      <PasteTasksModal show={showPaste} onClose={() => setShowPaste(false)} tenantId={tenant?.id} profile={profile} people={people}
        onCreated={() => { setShowPaste(false); fetchTasks(); }} />

    </>
  );
}
