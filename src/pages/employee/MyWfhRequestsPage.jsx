import React, { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyWfhRequests, submitWfhRequest, cancelWfhRequest } from '@/services/wfhService';
import { fmt, todayStr } from '@/lib/helpers';

const EMPTY_FORM = { from_date: todayStr(), to_date: todayStr(), reason: '' };

export function WfhContent() {
  const { profile, tenant } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('Pending');

  const fetchRequests = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const { data, error } = await listMyWfhRequests(profile.id);
      if (error) showToast(error.message, 'error');
      else setRequests(data);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!form.from_date || !form.to_date) return showToast('Select a date range', 'error');
    if (form.to_date < form.from_date) return showToast('End date must be on or after the start date', 'error');
    if (!form.reason.trim()) return showToast('Please provide a reason', 'error');
    if (!tenant) return showToast('You do not belong to any workspace. Please contact your administrator.', 'error');

    setSaving(true);
    try {
      const { error } = await submitWfhRequest({
        tenantId: tenant.id,
        profileId: profile.id,
        fromDate: form.from_date,
        toDate: form.to_date,
        reason: form.reason.trim(),
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('WFH request submitted — pending manager/HR approval', 'success');
      setShowModal(false);
      fetchRequests();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id) => {
    if (!confirm('Cancel this pending WFH request?')) return;
    const { error } = await cancelWfhRequest(id);
    if (error) return showToast('Cancel failed: ' + error.message, 'error');
    showToast('Request cancelled', 'info');
    fetchRequests();
  };

  const filtered = filter === 'All' ? requests : requests.filter((r) => r.status === filter);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0 4px' }}>
        <button className="btn btn-primary" onClick={openModal}>
          <i className="fas fa-plus" /> Request WFH
        </button>
      </div>

      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>My Requests</h3>
          <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
            {['Pending', 'Approved', 'Rejected', 'All'].map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date Range</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Applied On</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No requests found.</td></tr>
              ) : filtered.map((req) => (
                <tr key={req.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt.date(req.from_date)} → {fmt.date(req.to_date)}</td>
                  <td style={{ maxWidth: 260, fontSize: 12 }}>{req.reason}</td>
                  <td>
                    <span className={`badge ${
                      req.status === 'Approved' ? 'badge-success'
                      : req.status === 'Rejected' ? 'badge-danger'
                      : 'badge-warning'
                    }`}>
                      {req.status}
                    </span>
                  </td>
                  <td>{fmt.date(req.created_at)}</td>
                  <td>
                    {req.status === 'Pending' && (
                      <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleCancel(req.id)} title="Cancel">
                        <i className="fas fa-times" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        show={showModal}
        onClose={() => setShowModal(false)}
        title="Request Work From Home"
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From *</label>
            <input type="date" className="form-input" min={todayStr()} value={form.from_date}
              onChange={(e) => setForm({ ...form, from_date: e.target.value, to_date: form.to_date < e.target.value ? e.target.value : form.to_date })} />
          </div>
          <div className="form-group">
            <label className="form-label">To *</label>
            <input type="date" className="form-input" min={form.from_date || todayStr()} value={form.to_date}
              onChange={(e) => setForm({ ...form, to_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-input" rows={3}
            placeholder="Why are you working from home for these dates?"
            value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)',
        }}>
          <i className="fas fa-info-circle" style={{ marginRight: 6 }} />
          Once approved, geofencing is disabled for these dates so you can clock in from anywhere.
        </div>
      </Modal>
    </div>
  );
}

export default function MyWfhRequestsPage() {
  return (
    <>
      <Header title="Work From Home" breadcrumb="My Space / Work From Home" />
      <WfhContent />
    </>
  );
}
