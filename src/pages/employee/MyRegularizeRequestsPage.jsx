import React, { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { submitRegularizeRequest, listMyRegularizeRequests } from '@/services/attendanceService';
import { fetchMyQuota } from '@/services/requestQuotaService';
import { todayStr, fmtTime12 } from '@/lib/helpers';

function QuotaBanner({ quota }) {
  const { selfUsed, selfLimit, managerUsed, managerLimit } = quota;
  const selfLeft    = selfLimit    - selfUsed;
  const managerLeft = managerLimit - managerUsed;

  let color, icon, msg;
  if (selfLeft > 0) {
    color = 'var(--success)'; icon = 'fa-shield-alt';
    msg = `${selfLeft} self-approval${selfLeft !== 1 ? 's' : ''} remaining this month — your next request auto-approves instantly.`;
  } else if (managerLeft > 0) {
    color = 'var(--warning-dark, #92400e)'; icon = 'fa-user-check';
    msg = `Self-approvals used (${selfUsed}/${selfLimit}). Next request goes to Manager · ${managerLeft} manager approval${managerLeft !== 1 ? 's' : ''} available.`;
  } else {
    color = 'var(--danger)'; icon = 'fa-exclamation-circle';
    msg = `All quotas used this month (${selfUsed}/${selfLimit} self · ${managerUsed}/${managerLimit} manager). Next request goes to HR.`;
  }

  return (
    <div style={{
      background: selfLeft > 0 ? 'var(--success-light, #d1fae5)' : managerLeft > 0 ? 'var(--warning-light, #fffbeb)' : 'var(--danger-light, #fee2e2)',
      border: `1px solid ${color}`,
      borderRadius: 8, padding: '10px 16px', marginBottom: 12,
      fontSize: 13, color,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <i className={`fas ${icon}`} />
      {msg}
    </div>
  );
}

const STATUS_BADGE = {
  Pending:  'badge-warning',
  Approved: 'badge-success',
  Rejected: 'badge-danger',
};

export function RegularizeContent() {
  const { profile, tenant } = useAuth();
  const [requests,  setRequests]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('Pending');
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quota, setQuota] = useState(null);
  const [form, setForm] = useState({
    date: todayStr(), clockInTime: '', clockOutTime: '', reason: '',
  });

  const fetchRequests = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const { data, error } = await listMyRegularizeRequests(profile.id);
      if (error) showToast(error.message, 'error');
      else setRequests(data);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  const loadQuota = useCallback(async () => {
    if (!profile || !tenant) return;
    const q = await fetchMyQuota(tenant.id, profile.id);
    setQuota(q);
  }, [profile, tenant]);

  useEffect(() => { fetchRequests(); loadQuota(); }, [fetchRequests, loadQuota]);

  const openModal = () => {
    setForm({
      date: todayStr(),
      clockInTime:  tenant?.shift_start || '',
      clockOutTime: tenant?.shift_end   || '',
      reason: '',
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!form.date) return showToast('Please select the date', 'error');
    if (form.date > todayStr()) return showToast('Cannot request regularization for a future date', 'error');
    if (!form.clockInTime) return showToast('Clock-in time is required', 'error');
    if (!form.clockOutTime) return showToast('Clock-out time is required', 'error');
    if (form.clockInTime >= form.clockOutTime) return showToast('Clock-out must be after clock-in', 'error');
    if (!form.reason.trim()) return showToast('Reason is required', 'error');

    setSubmitting(true);
    try {
      const { error, tier } = await submitRegularizeRequest(tenant.id, profile.id, {
        date:         form.date,
        clockInTime:  form.clockInTime,
        clockOutTime: form.clockOutTime,
        reason:       form.reason.trim(),
      });
      if (error) throw error;
      const msg = tier === 'self'
        ? 'Auto-approved! Attendance updated instantly.'
        : tier === 'manager'
        ? 'Request sent to Manager for approval'
        : 'Request escalated to HR for approval';
      showToast(msg, tier === 'self' ? 'success' : 'info');
      setShowModal(false);
      fetchRequests();
      loadQuota();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = filter === 'All' ? requests : requests.filter(r => r.status === filter);

  return (
    <>
      <div className="page-content">

        {quota && <QuotaBanner quota={quota} />}

      <div className="filter-bar">
          {['Pending', 'Approved', 'Rejected', 'All'].map(s => (
            <button
              key={s}
              className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilter(s)}
            >
              {s}
            </button>
          ))}
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={openModal}>
            <i className="fas fa-plus" /> New Request
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                <i className="fas fa-calendar-check empty-icon" />
                <h3>No requests yet</h3>
                <p>
                  {requests.length === 0
                    ? 'Click "New Request" to ask your manager to correct your attendance for a missed punch.'
                    : `No ${filter.toLowerCase()} requests found.`}
                </p>
                {requests.length === 0 && (
                  <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openModal}>
                    <i className="fas fa-plus" /> New Request
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Requested Time</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(req => (
                    <tr key={req.id}>
                      <td>
                        <strong>
                          {new Date(req.date + 'T00:00:00').toLocaleDateString('en-IN', {
                            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
                          })}
                        </strong>
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>
                          <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                            <i className="fas fa-sign-in-alt" style={{ marginRight: 4, fontSize: 11 }} />
                            {fmtTime12(req.clock_in_time)}
                          </span>
                          <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>→</span>
                          <span style={{ color: 'var(--danger)', fontWeight: 500 }}>
                            <i className="fas fa-sign-out-alt" style={{ marginRight: 4, fontSize: 11 }} />
                            {fmtTime12(req.clock_out_time)}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 260 }}>
                        {req.reason}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[req.status] || 'badge-secondary'}`}>
                          {req.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(req.created_at).toLocaleDateString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal
        show={showModal}
        onClose={() => setShowModal(false)}
        title="Request Attendance Regularization"
        width="460px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setShowModal(false)} disabled={submitting}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Submitting…</>
                : <><i className="fas fa-paper-plane" /> Submit Request</>}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Date *</label>
          <input type="date" className="form-input" max={todayStr()} value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })} />
          <div className="form-hint">Select the date you need to correct attendance for.</div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Correct Clock-In *</label>
            <input type="time" className="form-input" value={form.clockInTime}
              onChange={e => setForm({ ...form, clockInTime: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Correct Clock-Out *</label>
            <input type="time" className="form-input" value={form.clockOutTime}
              onChange={e => setForm({ ...form, clockOutTime: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea
            className="form-input"
            rows={3}
            style={{ resize: 'none', fontSize: 13 }}
            placeholder="e.g. Forgot to clock in, device issue, worked from client site…"
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
          />
        </div>
      </Modal>
    </>
  );
}

export default function MyRegularizeRequestsPage() {
  return (
    <>
      <Header title="Regularize Attendance" breadcrumb="Request attendance corrections" />
      <RegularizeContent />
    </>
  );
}
