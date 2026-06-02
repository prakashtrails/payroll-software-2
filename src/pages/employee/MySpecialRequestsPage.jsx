import React, { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMySpecialRequests, submitSpecialRequest, getCompOffBalance } from '@/services/specialRequestService';
import { listHolidays } from '@/services/tenantService';
import { fmt, todayStr } from '@/lib/helpers';

const EMPTY_FORM = {
  request_type: 'Overtime',
  request_date: todayStr(),
  reason: '',
  late_hours: '0-10 min',
  overtime_hours: 4,
};

const TYPE_BADGE = {
  Overtime: 'badge-info',
  'Late Arrival': 'badge-warning',
  'Comp Off': 'badge-success',
};

export default function MySpecialRequestsPage() {
  const { profile, tenant } = useAuth();
  const [requests, setRequests] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [compOffBalance, setCompOffBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('All');

  const fetchRequests = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const { data, error } = await listMySpecialRequests(profile.id);
    if (error) showToast(error.message, 'error');
    else setRequests(data);
    setLoading(false);
  }, [profile]);

  const fetchBalance = useCallback(async () => {
    if (!profile) return;
    const { balance } = await getCompOffBalance(profile.id);
    setCompOffBalance(balance);
  }, [profile]);

  const fetchHolidayList = useCallback(async () => {
    if (!tenant) return;
    const { data } = await listHolidays(tenant.id);
    setHolidays((data || []).filter(h => (h.status === 'Approved' || !h.status)));
  }, [tenant]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchBalance(); }, [fetchBalance]);
  useEffect(() => { fetchHolidayList(); }, [fetchHolidayList]);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.reason.trim()) return showToast('Please provide a reason', 'error');
    if (!form.request_date) return showToast('Please select a date', 'error');
    if (form.request_type === 'Comp Off' && compOffBalance <= 0) {
      return showToast('You have no comp-off days available', 'error');
    }

    setSaving(true);
    try {
      if (!tenant) throw new Error('You do not belong to any workspace. Please contact your administrator.');

      const payload = {
        ...form,
        profile_id: profile.id,
        tenant_id: tenant.id,
        status: 'Pending',
        late_hours: form.request_type === 'Late Arrival' ? Number(form.late_hours) : null,
        overtime_hours: form.request_type === 'Overtime' ? Number(form.overtime_hours) : null,
      };

      const { error } = await submitSpecialRequest(payload);
      if (error) {
        showToast(error.message || 'Failed to submit request', 'error');
      } else {
        showToast('Request submitted successfully', 'success');
        setShowModal(false);
        setForm(EMPTY_FORM);
        fetchRequests();
      }
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'error');
    } finally {
      setSaving(false);
    }
  };

  const filtered = filter === 'All'
    ? requests
    : requests.filter(r => r.request_type === filter || r.status === filter);

  return (
    <div className="page-container">
      <Header
        title="Special Requests"
        breadcrumb="My Space / Special Requests"
        actions={
          <div className="flex gap-2" style={{ alignItems: 'center' }}>
            {compOffBalance > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'var(--success-light, #d1fae5)',
                color: 'var(--success)',
                border: '1px solid var(--success)',
                borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}>
                <i className="fas fa-umbrella-beach" />
                {compOffBalance} Comp Off day{compOffBalance !== 1 ? 's' : ''} available
              </span>
            )}
            <button className="btn btn-primary" onClick={openModal}>
              <i className="fas fa-plus" /> New Request
            </button>
          </div>
        }
      />

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>My Requests</h3>
          <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
            {['All', 'Pending', 'Approved', 'Rejected', 'Overtime', 'Late Arrival', 'Comp Off'].map(f => (
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

        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Date</th>
                <th>Details</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Applied On</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No requests found.</td></tr>
              ) : filtered.map(req => (
                <tr key={req.id}>
                  <td>
                    <span className={`badge ${TYPE_BADGE[req.request_type] || 'badge-info'}`}>
                      {req.request_type}
                    </span>
                  </td>
                  <td>{fmt.date(req.request_date)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {req.request_type === 'Late Arrival'
                      ? req.late_hours
                      : req.request_type === 'Overtime'
                        ? `${req.overtime_hours}h overtime`
                        : 'Comp off day'}
                  </td>
                  <td style={{ maxWidth: 220, fontSize: 12 }}>{req.reason}</td>
                  <td>
                    <span className={`badge ${
                      req.status === 'Approved' ? 'badge-success'
                      : req.status === 'Rejected' ? 'badge-danger'
                      : 'badge-warning'
                    }`}>
                      {req.status}
                    </span>
                    {req.status === 'Approved' && req.request_type !== 'Comp Off' && (
                      <div style={{ fontSize: 10, color: 'var(--success)', marginTop: 2 }}>
                        Full day — no deduction
                      </div>
                    )}
                    {req.status === 'Approved' && req.request_type === 'Comp Off' && (
                      <div style={{ fontSize: 10, color: 'var(--success)', marginTop: 2 }}>
                        Comp off used
                      </div>
                    )}
                    {req.status === 'Approved' && req.request_type === 'Overtime' && (
                      <div style={{ fontSize: 10, color: 'var(--primary)', marginTop: 2 }}>
                        +1 comp off credited
                      </div>
                    )}
                  </td>
                  <td>{fmt.date(req.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        show={showModal}
        onClose={() => setShowModal(false)}
        title="New Special Request"
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        }
      >
        <div className="form-group">
          <label className="form-label">Request Type</label>
          <select
            className="form-select"
            value={form.request_type}
            onChange={e => setForm({ ...form, request_type: e.target.value })}
          >
            <option value="Overtime">Overtime on Holiday</option>
            <option value="Late Arrival">Late Arrival</option>
            <option value="Comp Off" disabled={compOffBalance <= 0}>
              Comp Off{compOffBalance > 0 ? ` (${compOffBalance} available)` : ' (no balance)'}
            </option>
          </select>
        </div>

        {form.request_type === 'Overtime' && (
          <>
            <div className="form-group">
              <label className="form-label">Holiday Date</label>
              {holidays.length > 0 ? (
                <select
                  className="form-select"
                  value={form.request_date}
                  onChange={e => setForm({ ...form, request_date: e.target.value })}
                >
                  <option value="">— Select a holiday —</option>
                  {holidays.map(h => (
                    <option key={h.id} value={h.holiday_date || h.date}>
                      {fmt.date(h.holiday_date || h.date)} — {h.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="date"
                  className="form-input"
                  value={form.request_date}
                  onChange={e => setForm({ ...form, request_date: e.target.value })}
                />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Expected Overtime Hours</label>
              <select
                className="form-select"
                value={form.overtime_hours}
                onChange={e => setForm({ ...form, overtime_hours: e.target.value })}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map(h => (
                  <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}>
              <i className="fas fa-info-circle" style={{ marginRight: 6 }} />
              If approved, you will earn 1 comp-off day.
            </div>
          </>
        )}

        {form.request_type === 'Late Arrival' && (
          <>
            <div className="form-group">
              <label className="form-label">Date of Late Arrival</label>
              <input
                type="date"
                className="form-input"
                value={form.request_date}
                onChange={e => setForm({ ...form, request_date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">How Late?</label>
              <select
                className="form-select"
                value={form.late_hours}
                onChange={e => setForm({ ...form, late_hours: e.target.value })}
              >
                <option value="0-10 min">0 – 10 minutes</option>
                <option value="10-30 min">10 – 30 minutes</option>
                <option value="30min-1hr">30 minutes – 1 hour</option>
                <option value="1+ hour">More than 1 hour</option>
              </select>
            </div>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}>
              <i className="fas fa-info-circle" style={{ marginRight: 6 }} />
              If approved, you will be paid for the full day with no deduction.
            </div>
          </>
        )}

        {form.request_type === 'Comp Off' && (
          <>
            <div className="form-group">
              <label className="form-label">Date to Take Off</label>
              <input
                type="date"
                className="form-input"
                value={form.request_date}
                onChange={e => setForm({ ...form, request_date: e.target.value })}
              />
            </div>
            <div style={{
              background: 'var(--success-light, #d1fae5)',
              border: '1px solid var(--success)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--success)',
            }}>
              <i className="fas fa-umbrella-beach" style={{ marginRight: 6 }} />
              You have <strong>{compOffBalance}</strong> comp-off day{compOffBalance !== 1 ? 's' : ''} available.
              If approved, 1 day will be deducted from your balance.
            </div>
          </>
        )}

        <div className="form-group" style={{ marginTop: 12 }}>
          <label className="form-label">Reason</label>
          <textarea
            className="form-input"
            rows="3"
            placeholder="Please provide a brief reason for your request..."
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
