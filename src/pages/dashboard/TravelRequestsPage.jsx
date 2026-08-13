import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listMyTravelRequests, listTenantTravelRequests, createTravelRequest,
  updateTravelRequestStatus, deleteTravelRequest, TRAVEL_MODES,
} from '@/services/travelService';
import { fmt, fullName, todayStr } from '@/lib/helpers';

const STATUS_BADGE = { Pending: 'badge-warning', Approved: 'badge-success', Rejected: 'badge-danger' };

function blankLeg() { return { from_city: '', to_city: '', travel_date: todayStr(), mode: 'Flight' }; }

export default function TravelRequestsPage() {
  const { profile, tenant } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'superadmin';
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ purpose: '', from_date: todayStr(), to_date: todayStr(), estimated_cost: '' });
  const [legs, setLegs] = useState([blankLeg()]);

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    try {
      const { data } = canManage ? await listTenantTravelRequests(tenant.id) : await listMyTravelRequests(profile.id);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [profile, tenant, canManage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateLeg = (i, field, val) => setLegs((p) => { const n = [...p]; n[i] = { ...n[i], [field]: val }; return n; });
  const addLeg = () => setLegs((p) => [...p, blankLeg()]);
  const removeLeg = (i) => setLegs((p) => p.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!form.purpose.trim()) return showToast('Purpose is required', 'error');
    const { error } = await createTravelRequest(tenant.id, profile.id, form, legs.filter((l) => l.from_city && l.to_city));
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Travel request submitted', 'success');
    setShowModal(false);
    setForm({ purpose: '', from_date: todayStr(), to_date: todayStr(), estimated_cost: '' });
    setLegs([blankLeg()]);
    fetchData();
  };

  const setStatus = async (id, status) => {
    const { error } = await updateTravelRequestStatus(id, status, profile.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    fetchData();
  };

  return (
    <>
      <Header title="Travel Requests" breadcrumb="Pre-trip approval with cost estimate and itinerary" />
      <div className="page-content">
        <div className="filter-bar">
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><i className="fas fa-plus" /> New Request</button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr>{canManage && <th>Employee</th>}<th>Purpose</th><th>Dates</th><th>Legs</th><th>Est. Cost</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={canManage ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No travel requests yet</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}>
                      {canManage && <td>{fullName(r.profile)}</td>}
                      <td>{r.purpose}</td>
                      <td>{fmt.date(r.from_date)} – {fmt.date(r.to_date)}</td>
                      <td style={{ fontSize: 12 }}>{(r.legs || []).map((l) => `${l.from_city}→${l.to_city}`).join(', ') || '—'}</td>
                      <td>{fmt(r.estimated_cost)}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                      <td>
                        {canManage && r.status === 'Pending' && <>
                          <button className="btn btn-outline btn-sm" onClick={() => setStatus(r.id, 'Approved')}>Approve</button>{' '}
                          <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setStatus(r.id, 'Rejected')}>Reject</button>
                        </>}
                        {!canManage && r.status === 'Pending' && (
                          <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => { await deleteTravelRequest(r.id); fetchData(); }}>Withdraw</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="New Travel Request" width="560px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>Submit</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Purpose *</label>
          <input className="form-input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From</label>
            <input className="form-input" type="date" value={form.from_date} onChange={(e) => setForm({ ...form, from_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">To</label>
            <input className="form-input" type="date" value={form.to_date} onChange={(e) => setForm({ ...form, to_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Estimated Cost (₹)</label>
          <input className="form-input" type="number" value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Itinerary Legs</label>
          {legs.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input className="form-input" placeholder="From city" value={l.from_city} onChange={(e) => updateLeg(i, 'from_city', e.target.value)} />
              <input className="form-input" placeholder="To city" value={l.to_city} onChange={(e) => updateLeg(i, 'to_city', e.target.value)} />
              <input className="form-input" type="date" value={l.travel_date} onChange={(e) => updateLeg(i, 'travel_date', e.target.value)} style={{ maxWidth: 150 }} />
              <select className="form-select" value={l.mode} onChange={(e) => updateLeg(i, 'mode', e.target.value)} style={{ maxWidth: 110 }}>
                {TRAVEL_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
              <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeLeg(i)}><i className="fas fa-trash" /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={addLeg}><i className="fas fa-plus" /> Add Leg</button>
        </div>
      </Modal>
    </>
  );
}
