import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listPips, getMyActivePip, createPip, updatePipStatus,
  addPipGoal, listPipCheckins, addPipCheckin,
} from '@/services/pipService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName } from '@/lib/helpers';

const EMPTY_FORM = { profile_id: '', manager_id: '', reason: '', start_date: '', end_date: '' };

function PipCard({ pip, canManage, onOpenDetail }) {
  return (
    <div className="card" style={{ padding: 20, cursor: canManage ? 'pointer' : 'default' }} onClick={canManage ? () => onOpenDetail(pip) : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>{fullName(pip.employee)}</h3>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {pip.start_date} → {pip.end_date} · Manager: {pip.manager ? fullName(pip.manager) : '—'}
          </div>
        </div>
        <span className={`badge ${pip.status === 'Completed' ? (pip.outcome === 'Passed' ? 'badge-success' : 'badge-warning') : 'badge-info'}`}>
          {pip.status === 'Completed' ? pip.outcome || 'Completed' : 'In Process'}
        </span>
      </div>
      <p style={{ marginTop: 12, fontSize: 14 }}>{pip.reason}</p>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Goals: {(pip.pip_goals || []).length}</div>
    </div>
  );
}

export function PIPContent() {
  const { tenant, profile } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'superadmin';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin';

  const [tab, setTab] = useState('In Process');
  const [pips, setPips] = useState([]);
  const [myPip, setMyPip] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [detailPip, setDetailPip] = useState(null);
  const [checkins, setCheckins] = useState([]);
  const [goalForm, setGoalForm] = useState({ title: '', description: '', target_date: '' });
  const [checkinNote, setCheckinNote] = useState('');
  const [outcomeForm, setOutcomeForm] = useState({ outcome: 'Passed', outcome_notes: '' });

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    setLoading(true);
    try {
      if (canManage) {
        const { data, error } = await listPips(tenant.id);
        if (error) showToast(error.message || 'Failed to load PIPs', 'error');
        setPips(data || []);
        const { data: empData } = await listActiveEmployees(tenant.id);
        setEmployees((empData || []).filter((e) => e.id !== profile.id));
      } else {
        const { data } = await getMyActivePip(tenant.id, profile.id);
        setMyPip(data);
      }
    } finally {
      setLoading(false);
    }
  }, [tenant, profile, canManage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const save = async () => {
    if (!form.profile_id) return showToast('Select an employee', 'error');
    if (!form.reason.trim()) return showToast('Reason is required', 'error');
    if (!form.start_date || !form.end_date) return showToast('Start and end dates are required', 'error');
    setSaving(true);
    try {
      const { error } = await createPip({
        tenantId: tenant.id,
        profileId: form.profile_id,
        managerId: form.manager_id || null,
        createdBy: profile.id,
        reason: form.reason.trim(),
        startDate: form.start_date,
        endDate: form.end_date,
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('PIP started', 'success');
      setShowModal(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (pip) => {
    setDetailPip(pip);
    setGoalForm({ title: '', description: '', target_date: '' });
    setCheckinNote('');
    setOutcomeForm({ outcome: 'Passed', outcome_notes: '' });
    const { data } = await listPipCheckins(pip.id);
    setCheckins(data || []);
  };

  const refreshDetail = async () => {
    const { data } = await listPips(tenant.id);
    setPips(data || []);
    const fresh = (data || []).find((p) => p.id === detailPip.id);
    if (fresh) setDetailPip(fresh);
    const { data: ci } = await listPipCheckins(detailPip.id);
    setCheckins(ci || []);
  };

  const saveGoal = async () => {
    if (!goalForm.title.trim()) return showToast('Goal title is required', 'error');
    const { error } = await addPipGoal(detailPip.id, goalForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    setGoalForm({ title: '', description: '', target_date: '' });
    refreshDetail();
  };

  const saveCheckin = async () => {
    if (!checkinNote.trim()) return showToast('Write a note first', 'error');
    const { error } = await addPipCheckin(detailPip.id, profile.id, checkinNote.trim());
    if (error) return showToast('Failed: ' + error.message, 'error');
    setCheckinNote('');
    refreshDetail();
  };

  const completePip = async () => {
    if (!confirm('Mark this PIP as completed?')) return;
    const { error } = await updatePipStatus(detailPip.id, {
      status: 'Completed', outcome: outcomeForm.outcome, outcomeNotes: outcomeForm.outcome_notes,
    });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('PIP marked completed', 'success');
    setDetailPip(null);
    fetchData();
  };

  const filteredPips = pips.filter((p) => p.status === tab);

  return (
    <>
      <div className="page-content">
        {canManage ? (
          <>
            <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              {['In Process', 'Completed'].map((t) => (
                <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`} style={{ borderRadius: '6px 6px 0 0' }} onClick={() => setTab(t)}>{t}</button>
              ))}
            </div>
            <div className="filter-bar">
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn btn-primary" onClick={openModal}>
                  <i className="fas fa-plus" /> Start PIP
                </button>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
              </div>
            ) : filteredPips.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No {tab.toLowerCase()} PIPs</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {filteredPips.map((p) => <PipCard key={p.id} pip={p} canManage={canManage} onOpenDetail={openDetail} />)}
              </div>
            )}
          </>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : !myPip ? (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <i className="fas fa-check-circle" style={{ fontSize: 32, color: 'var(--success)' }} />
            <h3 style={{ marginTop: 12 }}>You're on track</h3>
            <p style={{ color: 'var(--text-muted)' }}>No Performance Improvement Plan required. Keep up the great work!</p>
          </div>
        ) : (
          <PipCard pip={myPip} canManage={false} onOpenDetail={() => {}} />
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="Start PIP" width="520px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <i className="fas fa-check" /> {saving ? 'Starting…' : 'Start PIP'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Employee *</label>
          <select className="form-select" value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}>
            <option value="">Select</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Overseeing Manager</label>
          <select className="form-select" value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
            <option value="">None</option>
            {employees.filter((e) => e.role === 'manager' || e.role === 'admin').map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-input" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date *</label>
            <input className="form-input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">End Date *</label>
            <input className="form-input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal show={!!detailPip} onClose={() => setDetailPip(null)} title={detailPip ? `PIP: ${fullName(detailPip.employee)}` : ''} width="640px">
        {detailPip && (
          <>
            <p style={{ fontSize: 14 }}>{detailPip.reason}</p>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{detailPip.start_date} → {detailPip.end_date}</div>

            <h4>Goals</h4>
            {(detailPip.pip_goals || []).map((g) => (
              <div key={g.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
                <strong>{g.title}</strong> <span className="badge badge-secondary" style={{ marginLeft: 8 }}>{g.status}</span>
                {g.description && <p style={{ margin: '6px 0 0', fontSize: 13 }}>{g.description}</p>}
              </div>
            ))}
            {detailPip.status !== 'Completed' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <input className="form-input" style={{ flex: 1, minWidth: 140 }} placeholder="Goal title"
                  value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })} />
                <input className="form-input" type="date" style={{ width: 150 }}
                  value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} />
                <button className="btn btn-primary btn-sm" onClick={saveGoal}>Add</button>
              </div>
            )}

            <h4 style={{ marginTop: 20 }}>Check-ins</h4>
            {checkins.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No check-ins yet</p>
            ) : (
              checkins.map((c) => (
                <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.author ? fullName(c.author) : ''} · {new Date(c.created_at).toLocaleString()}</div>
                  <div style={{ fontSize: 14 }}>{c.note}</div>
                </div>
              ))
            )}
            {detailPip.status !== 'Completed' && (
              <div style={{ marginTop: 8 }}>
                <textarea className="form-input" rows={2} placeholder="Add a check-in note…" value={checkinNote} onChange={(e) => setCheckinNote(e.target.value)} />
                <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={saveCheckin}>Add Check-in</button>
              </div>
            )}

            {detailPip.status !== 'Completed' && isAdmin && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <h4>Close PIP</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Outcome</label>
                    <select className="form-select" value={outcomeForm.outcome} onChange={(e) => setOutcomeForm({ ...outcomeForm, outcome: e.target.value })}>
                      <option value="Passed">Passed</option>
                      <option value="Extended">Extended</option>
                      <option value="Exited">Exited</option>
                    </select>
                  </div>
                </div>
                <textarea className="form-input" rows={2} placeholder="Outcome notes"
                  value={outcomeForm.outcome_notes} onChange={(e) => setOutcomeForm({ ...outcomeForm, outcome_notes: e.target.value })} />
                <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={completePip}>Mark Completed</button>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

export default function PIPPage() {
  return (
    <>
      <Header title="Performance Improvement Plan" breadcrumb="Track and support employees on a PIP" />
      <PIPContent />
    </>
  );
}
