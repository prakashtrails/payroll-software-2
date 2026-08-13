import { useEffect, useState, useCallback, useMemo } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listKras, createKra, updateKra, updateKraProgress, deleteKra, addKpi, deleteKpi,
  listKraCheckins, addKraCheckin,
} from '@/services/kraService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, timeAgo } from '@/lib/helpers';

const EMPTY_FORM = {
  profile_id: '', title: '', description: '', scope: 'individual',
  weight: '', period_start: '', period_end: '',
};

const EMPTY_KPI_FORM = { kraId: null, title: '', target: '', achieved: '', target_value: '', current_value: '', unit: '' };

function ProgressBar({ value, height = 8 }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div style={{ background: 'var(--border)', borderRadius: 6, height, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--success)' : 'var(--primary)', transition: 'width .2s' }} />
    </div>
  );
}

// ── Derived status (Keka-style: computed from progress vs. elapsed time in the
// period, not a manually picked field — this app only stores Active/Completed/
// Archived, so "on track / at risk / needs attention" are read, not stored). ──
const STATUS_META = {
  not_started:     { label: 'Not Started',     color: 'var(--text-muted)' },
  on_track:        { label: 'On Track',        color: 'var(--success)' },
  needs_attention: { label: 'Needs Attention', color: 'var(--warning)' },
  at_risk:         { label: 'At Risk',         color: 'var(--danger)' },
  closed:          { label: 'Closed',          color: 'var(--primary)' },
};

function deriveKraStatus(k) {
  if (k.status === 'Completed' || k.status === 'Archived') return 'closed';
  const pct = k.progress_percent || 0;
  if (pct === 0) return 'not_started';
  if (pct >= 100) return 'closed';
  if (k.period_start && k.period_end) {
    const start = new Date(k.period_start), end = new Date(k.period_end), today = new Date();
    const totalDays = (end - start) / 86400000;
    if (totalDays > 0) {
      const expectedPct = Math.min(100, Math.max(0, ((today - start) / 86400000 / totalDays) * 100));
      const gap = expectedPct - pct;
      if (today > end) return 'at_risk';
      if (gap > 25) return 'at_risk';
      if (gap > 10) return 'needs_attention';
    }
  }
  return 'on_track';
}

// Synthetic timeframe grouping — this schema has no separate "timeframe"
// entity, just free period_start/period_end dates per KRA, so the label is
// derived from the span shape (~1yr → "FY", ~1 quarter → "Qn-YYYY", else a
// month range). KRAs with no dates fall into "No Timeframe".
function timeframeLabel(k) {
  if (!k.period_start && !k.period_end) return 'No Timeframe';
  const shortMonth = (d) => d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  if (k.period_start && k.period_end) {
    const start = new Date(k.period_start), end = new Date(k.period_end);
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (months >= 10 && months <= 13) {
      return start.getFullYear() === end.getFullYear() ? `FY ${start.getFullYear()}` : `FY ${start.getFullYear()}-${end.getFullYear()}`;
    }
    if (months >= 2 && months <= 4) return `Q${Math.floor(start.getMonth() / 3) + 1}-${start.getFullYear()}`;
    return `${shortMonth(start)} – ${shortMonth(end)}`;
  }
  return shortMonth(new Date(k.period_start || k.period_end));
}

export function KRAsContent() {
  const { tenant, profile } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'superadmin';

  const [kras, setKras] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [kpiForm, setKpiForm] = useState(EMPTY_KPI_FORM);

  // HR-side view controls (My / Department / Company KRAs, status + search filters, collapsible timeframe groups)
  const [viewTab, setViewTab] = useState('mine');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Live value while a progress slider is being dragged, keyed by kra id — kept
  // separate from `kras` so dragging only re-renders the bar itself, not a
  // network call + full-list reload on every pixel (that was the flicker).
  const [dragProgress, setDragProgress] = useState({});

  // Progress-history (check-ins), lazy-loaded per KRA the first time it's expanded.
  const [checkinsByKra, setCheckinsByKra] = useState({});
  const [checkinNoteByKra, setCheckinNoteByKra] = useState({});
  const [checkinSaving, setCheckinSaving] = useState(null);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data, error } = await listKras(tenant.id, { profileId: canManage ? null : profile.id });
      if (error) showToast(error.message || 'Failed to load KRAs', 'error');
      setKras(data || []);
      if (canManage) {
        const { data: empData } = await listActiveEmployees(tenant.id);
        setEmployees(empData || []);
      }
    } finally {
      setLoading(false);
    }
  }, [tenant, canManage, profile]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (id) => {
    const wasExpanded = expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    if (!wasExpanded && !checkinsByKra[id]) {
      listKraCheckins(id).then(({ data }) => setCheckinsByKra((prev) => ({ ...prev, [id]: data })));
    }
  };

  const saveCheckin = async (kra) => {
    const note = (checkinNoteByKra[kra.id] || '').trim();
    if (!note) return showToast('Write a note first', 'error');
    const value = dragProgress[kra.id] ?? kra.progress_percent ?? 0;
    setCheckinSaving(kra.id);
    try {
      const { error } = await addKraCheckin(kra.id, profile.id, note, value);
      if (error) return showToast('Failed: ' + error.message, 'error');
      setCheckinNoteByKra((prev) => ({ ...prev, [kra.id]: '' }));
      setKras((prev) => prev.map((k) => (k.id === kra.id ? { ...k, progress_percent: value } : k)));
      const { data } = await listKraCheckins(kra.id);
      setCheckinsByKra((prev) => ({ ...prev, [kra.id]: data }));
    } finally {
      setCheckinSaving(null);
    }
  };

  const openModal = (prefill) => {
    setForm({ ...EMPTY_FORM, ...(prefill || {}) });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) return showToast('Title is required', 'error');
    if (form.scope === 'individual' && !form.profile_id) return showToast('Select an employee', 'error');
    setSaving(true);
    try {
      const { error } = await createKra({
        tenantId: tenant.id,
        profileId: form.scope === 'company' ? null : form.profile_id,
        title: form.title.trim(),
        description: form.description.trim(),
        scope: form.scope,
        weight: parseFloat(form.weight) || 0,
        periodStart: form.period_start || null,
        periodEnd: form.period_end || null,
        createdBy: profile.id,
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('KRA created', 'success');
      setShowModal(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this KRA?')) return;
    const { error } = await deleteKra(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Deleted', 'success');
    fetchData();
  };

  // Called once, on release — not on every drag tick.
  const commitProgress = async (kra, value) => {
    setDragProgress((prev) => { const next = { ...prev }; delete next[kra.id]; return next; });
    if (value === (kra.progress_percent || 0)) return; // unchanged — skip the round trip
    const { error } = await updateKraProgress(kra.id, value);
    if (error) return showToast('Failed to update progress', 'error');
    setKras((prev) => prev.map((k) => (k.id === kra.id ? { ...k, progress_percent: value } : k)));
  };

  const handleStatusToggle = async (kra) => {
    const next = kra.status === 'Completed' ? 'Active' : 'Completed';
    const { error } = await updateKra(kra.id, { status: next, progress_percent: next === 'Completed' ? 100 : kra.progress_percent });
    if (error) return showToast('Failed to update status', 'error');
    fetchData();
  };

  const openKpiForm = (kraId) => setKpiForm({ ...EMPTY_KPI_FORM, kraId });

  const saveKpi = async () => {
    if (!kpiForm.title.trim()) return showToast('KPI title is required', 'error');
    const { error } = await addKpi(kpiForm.kraId, kpiForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    setKpiForm(EMPTY_KPI_FORM);
    fetchData();
  };

  const handleDeleteKpi = async (id) => {
    const { error } = await deleteKpi(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    fetchData();
  };

  // Shared card renderer — used by both the plain employee list and the
  // HR-side grouped-by-timeframe layout below, so KPI/check-in behavior never diverges.
  const renderKraCard = (k) => (
    <div className="card" key={k.id} style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{k.title}</h3>
            <span className={`badge ${k.scope === 'company' ? 'badge-info' : 'badge-secondary'}`}>
              {k.scope === 'company' ? 'Company-wide' : (k.profile ? fullName(k.profile) : 'Individual')}
            </span>
            {canManage && k.profile?.department && k.scope !== 'company' && (
              <span className="badge">{k.profile.department}</span>
            )}
            {k.status === 'Completed' && <span className="badge badge-success">Completed</span>}
          </div>
          {k.description && <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>{k.description}</p>}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            {k.weight ? `Weight: ${k.weight}% · ` : ''}
            {k.period_start && k.period_end ? `${k.period_start} → ${k.period_end}` : ''}
          </div>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-outline btn-icon btn-sm" onClick={() => handleStatusToggle(k)} title={k.status === 'Completed' ? 'Mark Active' : 'Mark Completed'}>
              <i className={`fas ${k.status === 'Completed' ? 'fa-undo' : 'fa-check'}`} />
            </button>
            <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(k.id)}>
              <i className="fas fa-trash" />
            </button>
          </div>
        )}
      </div>

      {(() => {
        const liveValue = dragProgress[k.id] ?? k.progress_percent ?? 0;
        return (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}><ProgressBar value={liveValue} /></div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>{liveValue}%</span>
            {(!canManage || k.profile_id === profile.id) && k.status !== 'Completed' && (
              <input
                type="range" min="0" max="100" value={liveValue}
                onChange={(e) => setDragProgress((prev) => ({ ...prev, [k.id]: parseInt(e.target.value, 10) }))}
                onMouseUp={(e) => commitProgress(k, parseInt(e.target.value, 10))}
                onTouchEnd={(e) => commitProgress(k, parseInt(e.target.value, 10))}
                onKeyUp={(e) => commitProgress(k, parseInt(e.target.value, 10))}
                style={{ width: 100 }}
              />
            )}
          </div>
        );
      })()}

      <button
        className="btn btn-outline btn-sm"
        style={{ marginTop: 12 }}
        onClick={() => toggleExpand(k.id)}
      >
        <i className={`fas ${expanded.has(k.id) ? 'fa-chevron-up' : 'fa-chevron-down'}`} /> KPIs ({(k.kra_kpis || []).length})
      </button>

      {expanded.has(k.id) && (
        <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
          {(k.kra_kpis || []).map((kpi) => {
            const hasNumeric = kpi.target_value != null && kpi.target_value !== 0;
            const kpiPct = hasNumeric ? Math.min(100, Math.round(((kpi.current_value || 0) / kpi.target_value) * 100)) : null;
            return (
              <div key={kpi.id} style={{ padding: '6px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{kpi.title}</strong>
                    {hasNumeric ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {kpi.current_value ?? 0}{kpi.unit} of {kpi.target_value}{kpi.unit} ({kpiPct}%)
                      </div>
                    ) : (kpi.target || kpi.achieved) ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Target: {kpi.target || '—'} · Achieved: {kpi.achieved || '—'}
                      </div>
                    ) : null}
                  </div>
                  {canManage && (
                    <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteKpi(kpi.id)}>
                      <i className="fas fa-times" />
                    </button>
                  )}
                </div>
                {hasNumeric && <div style={{ marginTop: 4 }}><ProgressBar value={kpiPct} /></div>}
              </div>
            );
          })}
          {canManage && (
            kpiForm.kraId === k.id ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input className="form-input" style={{ flex: 1, minWidth: 120 }} placeholder="KPI title"
                    value={kpiForm.title} onChange={(e) => setKpiForm({ ...kpiForm, title: e.target.value })} />
                  <input className="form-input" style={{ width: 100 }} placeholder="Target (text)"
                    value={kpiForm.target} onChange={(e) => setKpiForm({ ...kpiForm, target: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <input className="form-input" type="number" style={{ width: 100 }} placeholder="Current value"
                    value={kpiForm.current_value} onChange={(e) => setKpiForm({ ...kpiForm, current_value: e.target.value })} />
                  <input className="form-input" type="number" style={{ width: 100 }} placeholder="Target value"
                    value={kpiForm.target_value} onChange={(e) => setKpiForm({ ...kpiForm, target_value: e.target.value })} />
                  <input className="form-input" style={{ width: 80 }} placeholder="Unit (e.g. %, $)"
                    value={kpiForm.unit} onChange={(e) => setKpiForm({ ...kpiForm, unit: e.target.value })} />
                  <div className="form-hint" style={{ width: '100%', margin: 0 }}>Fill Current/Target value for a numeric KPI with an auto-computed progress bar — leave blank to use a plain text target instead.</div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={saveKpi}>Add</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setKpiForm(EMPTY_KPI_FORM)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => openKpiForm(k.id)}>
                <i className="fas fa-plus" /> Add KPI
              </button>
            )
          )}

          <h4 style={{ marginTop: 20, marginBottom: 8, fontSize: 13 }}>Progress History</h4>
          {(checkinsByKra[k.id] || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No updates logged yet.</p>
          ) : (
            (checkinsByKra[k.id] || []).map((c) => (
              <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {c.author ? fullName(c.author) : 'Someone'} · {timeAgo(c.created_at)} · moved to {c.progress_percent}%
                </div>
                <div style={{ fontSize: 13 }}>{c.note}</div>
              </div>
            ))
          )}
          {(!canManage ? k.profile_id === profile.id : true) && k.status !== 'Completed' && (
            <div style={{ marginTop: 8 }}>
              <textarea
                className="form-input" rows={2} placeholder="Log a progress update…"
                value={checkinNoteByKra[k.id] || ''}
                onChange={(e) => setCheckinNoteByKra((prev) => ({ ...prev, [k.id]: e.target.value }))}
              />
              <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }} disabled={checkinSaving === k.id} onClick={() => saveCheckin(k)}>
                {checkinSaving === k.id ? 'Saving…' : 'Log Update'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── HR-side view: My / Department / Company tabs, status + search filters,
  // average-progress + status-breakdown summary, KRAs grouped into collapsible
  // timeframe sections. Regular employees keep the simple flat list below. ──
  const tabFiltered = useMemo(() => {
    if (!canManage) return kras;
    if (viewTab === 'mine') return kras.filter((k) => k.profile_id === profile?.id);
    if (viewTab === 'company') return kras.filter((k) => k.scope === 'company');
    // department: everyone (including self) who shares the viewer's department
    return kras.filter((k) => k.scope !== 'company' && k.profile?.department && k.profile.department === profile?.department);
  }, [kras, canManage, viewTab, profile]);

  const visible = useMemo(() => {
    let list = tabFiltered;
    if (statusFilter) list = list.filter((k) => deriveKraStatus(k) === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((k) => k.title.toLowerCase().includes(q) || (k.description || '').toLowerCase().includes(q));
    }
    return list;
  }, [tabFiltered, statusFilter, search]);

  const avgProgress = tabFiltered.length
    ? Math.round(tabFiltered.reduce((s, k) => s + (k.progress_percent || 0), 0) / tabFiltered.length)
    : 0;

  const statusCounts = useMemo(() => {
    const counts = { not_started: 0, on_track: 0, needs_attention: 0, at_risk: 0, closed: 0 };
    tabFiltered.forEach((k) => { counts[deriveKraStatus(k)]++; });
    return counts;
  }, [tabFiltered]);

  const groups = useMemo(() => {
    const byLabel = {};
    visible.forEach((k) => {
      const label = timeframeLabel(k);
      if (!byLabel[label]) byLabel[label] = { label, kras: [], sortKey: k.period_start || k.period_end || '' };
      byLabel[label].kras.push(k);
    });
    // Always offer an actionable "This Year" bucket, even empty — mirrors Keka
    // always showing the current fiscal year as a place to add KRAs into.
    const now = new Date();
    const thisYearLabel = `FY ${now.getFullYear()}`;
    if (!byLabel[thisYearLabel]) {
      byLabel[thisYearLabel] = { label: thisYearLabel, kras: [], sortKey: `${now.getFullYear()}-01-01`, synthetic: true };
    }
    return Object.values(byLabel).sort((a, b) => {
      if (a.label === 'No Timeframe') return 1;
      if (b.label === 'No Timeframe') return -1;
      return (b.sortKey || '').localeCompare(a.sortKey || '');
    });
  }, [visible]);

  useEffect(() => {
    // Default: expand only the first (most recent) group when the tab/filters change.
    if (groups.length) setExpandedGroups(new Set([groups[0].label]));
  }, [viewTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (label) => setExpandedGroups((prev) => {
    const next = new Set(prev);
    next.has(label) ? next.delete(label) : next.add(label);
    return next;
  });

  const openModalForYear = () => {
    const now = new Date();
    openModal({ period_start: `${now.getFullYear()}-01-01`, period_end: `${now.getFullYear()}-12-31` });
  };

  return (
    <>
      <div className="page-content">
        {canManage ? (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { id: 'mine', label: 'My KRAs', icon: 'fa-user' },
                { id: 'department', label: 'Department KRAs', icon: 'fa-users' },
                { id: 'company', label: 'Company KRAs', icon: 'fa-building' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setViewTab(t.id)}
                  className={`btn btn-sm ${viewTab === t.id ? 'btn-primary' : 'btn-outline'}`}
                >
                  <i className={`fas ${t.icon}`} /> {t.label}
                </button>
              ))}
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openModal()}>
                <i className="fas fa-plus" /> Add KRA
              </button>
            </div>

            {/* Filters */}
            <div className="filter-bar" style={{ marginBottom: 16 }}>
              <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Status</option>
                {Object.entries(STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
              </select>
              <input
                className="form-input" placeholder="🔍 Search KRAs…"
                value={search} onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 220 }}
              />
            </div>

            {/* Summary */}
            <div className="grid-2" style={{ marginBottom: 20 }}>
              <div className="card" style={{ padding: 18 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>Average progress</div>
                <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 10 }}>{avgProgress}%</div>
                <ProgressBar value={avgProgress} />
              </div>
              <div className="card" style={{ padding: 18 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>KRA by status ( {tabFiltered.length} kras )</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {Object.entries(STATUS_META).map(([key, m]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                      {m.label} ({statusCounts[key]})
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Timeframe groups */}
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {groups.map((g) => {
                  const groupAvg = g.kras.length
                    ? Math.round(g.kras.reduce((s, k) => s + (k.progress_percent || 0), 0) / g.kras.length)
                    : 0;
                  const isOpen = expandedGroups.has(g.label);
                  return (
                    <div key={g.label}>
                      <div
                        onClick={() => toggleGroup(g.label)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '8px 0' }}
                      >
                        <i className={`fas ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'}`} style={{ color: 'var(--text-muted)', fontSize: 12 }} />
                        <strong style={{ fontSize: 14 }}>{g.label}</strong>
                        <div style={{ width: 120 }}><ProgressBar value={groupAvg} height={5} /></div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{groupAvg}%</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{g.kras.length} KRA{g.kras.length !== 1 ? 's' : ''}</span>
                      </div>
                      {isOpen && (
                        g.kras.length === 0 ? (
                          <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                              <i className="fas fa-bullseye" style={{ marginRight: 8 }} />There are no KRAs added in this timeframe.
                            </span>
                            <button className="btn btn-outline btn-sm" onClick={openModalForYear}>
                              <i className="fas fa-plus" /> Add KRAs
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {g.kras.map(renderKraCard)}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : kras.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No KRAs defined yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {kras.map(renderKraCard)}
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="Add KRA" width="560px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <i className="fas fa-check" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Scope *</label>
          <select className="form-select" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, profile_id: '' })}>
            <option value="individual">Individual</option>
            <option value="company">Company-wide</option>
          </select>
        </div>
        {form.scope === 'individual' && (
          <div className="form-group">
            <label className="form-label">Employee *</label>
            <select className="form-select" value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}>
              <option value="">Select</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
            </select>
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Weight (%)</label>
            <input className="form-input" type="number" min="0" max="100" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Period Start</label>
            <input className="form-input" type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Period End</label>
            <input className="form-input" type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function KRAsPage() {
  return (
    <>
      <Header title="KRAs & Goals" breadcrumb="Key Result Areas — track progress, log updates, and get rated at review time" />
      <KRAsContent />
    </>
  );
}
