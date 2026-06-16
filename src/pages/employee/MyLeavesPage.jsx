import React, { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyLeaveRequests, requestLeave, checkProbationStatus } from '@/services/leaveService';
import { fetchMyQuota } from '@/services/requestQuotaService';
import { fmt, todayStr, HIGH_SALARY_THRESHOLD } from '@/lib/helpers';

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
      borderRadius: 8, padding: '10px 16px', marginTop: 16,
      fontSize: 13, color,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <i className={`fas ${icon}`} />
      {msg}
    </div>
  );
}

const EMPTY_REQUEST = {
  leave_type: 'Casual Leave',
  start_date: todayStr(),
  end_date: todayStr(),
  reason: '',
};

export default function MyLeavesPage() {
  const { profile, tenant } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_REQUEST);
  const [saving, setSaving] = useState(false);
  const [quota, setQuota] = useState(null);
  const [probation, setProbation] = useState(null);

  useEffect(() => {
    fetchRequests();
    loadQuota();
    loadProbation();
  }, [profile]);

  const loadQuota = async () => {
    if (!profile || !tenant) return;
    const q = await fetchMyQuota(tenant.id, profile.id);
    setQuota(q);
  };

  const loadProbation = async () => {
    if (!profile) return;
    const p = await checkProbationStatus(profile.id);
    setProbation(p);
  };

  const fetchRequests = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const { data, error } = await listMyLeaveRequests(profile.id);
      if (error) showToast(error.message, 'error');
      else setRequests(data);
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async (e) => {
    e.preventDefault();
    if (!form.reason.trim()) return showToast('Please provide a reason', 'error');
    if (!form.start_date || !form.end_date) return showToast('Please select start and end dates', 'error');
    if (form.end_date < form.start_date) return showToast('End date cannot be before start date', 'error');

    setSaving(true);
    try {
      if (!tenant) {
        throw new Error('You do not belong to any workspace. Please contact your administrator.');
      }

      // Block leave during probation unless they have earned leaves and it's a probation-earned type
      if (probation?.inProbation && form.leave_type !== 'Earned (Probation)') {
        setSaving(false);
        return showToast(`You are in probation until ${new Date(probation.endsOn + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Only earned probation leaves can be used.`, 'error');
      }
      if (probation?.inProbation && form.leave_type === 'Earned (Probation)' && (probation.earnedLeaves || 0) <= 0) {
        setSaving(false);
        return showToast('You have no earned probation leaves yet. Work all days in a month to earn one.', 'error');
      }

      const payload = {
        ...form,
        profile_id: profile.id,
        tenant_id: tenant.id,
        status: 'Pending',
      };
      const { error, tier } = await requestLeave(payload);

      if (error) {
        showToast(error.message || 'Failed to submit leave request', 'error');
      } else {
        const msg = tier === 'self'
          ? 'Auto-approved! (self-approval used)'
          : tier === 'manager'
          ? 'Request sent to Manager for approval'
          : 'Request escalated to HR for approval';
        showToast(msg, tier === 'self' ? 'success' : 'info');
        setShowModal(false);
        setForm(EMPTY_REQUEST);
        fetchRequests();
        loadQuota();
      }
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <Header 
        title="My Leaves" 
        breadcrumb="My Space / Leaves"
        actions={
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <i className="fas fa-plus" /> New Request
          </button>
        }
      />

      {probation?.inProbation && (
        <div style={{
          background: 'var(--warning-light, #fffbeb)',
          border: '1px solid var(--warning)',
          borderRadius: 8, padding: '10px 16px', marginTop: 16,
          fontSize: 13, color: 'var(--warning-dark, #92400e)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <i className="fas fa-hourglass-half" />
          <span>
            <strong>Probation period</strong> — ends{' '}
            {new Date(probation.endsOn + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.
            {' '}Regular leaves are blocked. You have <strong>{probation.earnedLeaves}</strong> earned leave{probation.earnedLeaves !== 1 ? 's' : ''} available
            (earned by working every day in a month during probation).
          </span>
        </div>
      )}

      {quota && <QuotaBanner quota={quota} />}

      {(profile?.ctc || 0) >= HIGH_SALARY_THRESHOLD && (profile?.comp_off_balance || 0) > 0 && (
        <div style={{
          background: 'var(--primary-light, #eff6ff)',
          border: '1px solid var(--primary)',
          borderRadius: 8, padding: '10px 16px', marginTop: 16,
          fontSize: 13, color: 'var(--primary)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <i className="fas fa-gift" />
          You have <strong>{profile.comp_off_balance}</strong> Comp Off{profile.comp_off_balance > 1 ? 's' : ''} available.
          Select <em>Comp Off</em> as the leave type to use them.
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Applied On</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No leave requests found.</td></tr>
              ) : requests.map(req => {
                const start = new Date(req.start_date);
                const end = new Date(req.end_date);
                const diffTime = Math.abs(end - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                
                return (
                  <tr key={req.id}>
                    <td><span className="badge badge-info">{req.leave_type}</span></td>
                    <td>{fmt.date(req.start_date)} - {fmt.date(req.end_date)}</td>
                    <td>{diffDays}</td>
                    <td style={{ maxWidth: 250, fontSize: 13 }}>{req.reason}</td>
                    <td>
                      <span className={`badge ${
                        req.status === 'Approved' ? 'badge-success' : 
                        req.status === 'Rejected' ? 'badge-danger' : 'badge-warning'
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td>{fmt.date(req.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        show={showModal}
        onClose={() => setShowModal(false)}
        title="Request Leave"
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleRequest} disabled={saving}>
              {saving ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        }
      >
        <div className="form-group">
          <label className="form-label">Leave Type</label>
          <select className="form-select" value={form.leave_type} onChange={e => setForm({...form, leave_type: e.target.value})}>
            {probation?.inProbation ? (
              <option value="Earned (Probation)">Earned Leave (Probation) — {probation.earnedLeaves} available</option>
            ) : (
              <>
                <option>Casual Leave</option>
                <option>Sick Leave</option>
                <option>Paid Leave</option>
                <option>Maternity/Paternity Leave</option>
                <option>Loss of Pay</option>
                {(profile?.ctc || 0) >= HIGH_SALARY_THRESHOLD && (
                  <option value="Comp Off">Comp Off (Weekly Off Compensation)</option>
                )}
              </>
            )}
          </select>
          {form.leave_type === 'Comp Off' && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--primary)' }}>
              <i className="fas fa-info-circle" style={{ marginRight: 4 }} />
              Balance: <strong>{profile?.comp_off_balance || 0}</strong> comp off{(profile?.comp_off_balance || 0) !== 1 ? 's' : ''} available.
            </div>
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input type="date" className="form-input" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} />
          </div>
          <div className="form-group">
            <label className="form-label">End Date</label>
            <input type="date" className="form-input" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason</label>
          <textarea 
            className="form-input" 
            rows="3" 
            placeholder="Please provide a brief reason for your leave..."
            value={form.reason}
            onChange={e => setForm({...form, reason: e.target.value})}
          />
        </div>
      </Modal>
    </div>
  );
}
