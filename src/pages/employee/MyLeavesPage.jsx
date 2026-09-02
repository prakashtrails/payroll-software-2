import React, { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import CircularProgress from '@/components/CircularProgress';
import QuotaRings from '@/components/QuotaRings';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyLeaveRequests, requestLeave, checkProbationStatus } from '@/services/leaveService';
import { fetchMyQuota, SELF_LIMIT } from '@/services/requestQuotaService';
import { fetchMyLeaveBalances, listLeaveTypes } from '@/services/leaveLedgerService';
import { fmt, todayStr, HIGH_SALARY_THRESHOLD } from '@/lib/helpers';

const EMPTY_REQUEST = {
  leave_type: '',
  start_date: todayStr(),
  end_date: todayStr(),
  reason: '',
};

export function LeaveContent() {
  const { profile, tenant } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_REQUEST);
  const [saving, setSaving] = useState(false);
  const [quota, setQuota] = useState(null);
  const [probation, setProbation] = useState(null);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [filter, setFilter] = useState('Pending');

  useEffect(() => {
    fetchRequests();
    loadQuota();
    loadProbation();
    loadLeaveBalances();
    loadLeaveTypes();
  }, [profile]);

  const loadLeaveBalances = async () => {
    if (!profile) return;
    const { data } = await fetchMyLeaveBalances(profile.id);
    setLeaveBalances(data); // show every configured type, including a fresh 0 balance — not just the ones with activity
  };

  const loadLeaveTypes = async () => {
    if (!tenant) return;
    const { data } = await listLeaveTypes(tenant.id);
    const active = data.filter((t) => t.is_active);
    setLeaveTypes(active);
    setForm((f) => (f.leave_type ? f : { ...f, leave_type: active[0]?.name || '' }));
  };

  const autoApprovalEnabled = tenant?.leave_auto_approval_enabled !== false;
  const autoApprovalLimit   = tenant?.leave_auto_approval_limit ?? SELF_LIMIT;

  const loadQuota = async () => {
    if (!profile || !tenant) return;
    const q = await fetchMyQuota(tenant.id, profile.id, autoApprovalEnabled ? autoApprovalLimit : 0);
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
      const { error, tier } = await requestLeave(payload, { autoApprovalEnabled, autoApprovalLimit });

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

  const filteredRequests = requests.filter(r => filter === 'All' || r.status === filter);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <i className="fas fa-plus" /> New Request
        </button>
      </div>

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

      {quota && <QuotaRings quota={quota} autoApprovalEnabled={autoApprovalEnabled} title="Leave Approval Quota" actionLabel="leave request" />}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Leave History</h3>
          <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
            {['Pending', 'Approved', 'Rejected', 'All'].map(s => (
              <button
                key={s}
                className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
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
              ) : filteredRequests.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {requests.length === 0 ? 'No leave requests found.' : `No ${filter.toLowerCase()} requests found.`}
                </td></tr>
              ) : filteredRequests.map(req => {
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

      {leaveBalances.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><h3 style={{ margin: 0 }}>My Leave Balance</h3></div>
          <div style={{ padding: 16, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {leaveBalances.map((b) => (
              <CircularProgress
                key={b.leave_type_id}
                used={b.used || 0}
                total={b.allocated || 0}
                unlimited={!!b.leave_type?.is_unlimited}
                size={110}
                strokeWidth={10}
                label={b.leave_type?.name || 'Leave'}
                emptyText="not allocated"
              />
            ))}
          </div>
        </div>
      )}

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
                {leaveTypes.map((lt) => {
                  const bal = leaveBalances.find((b) => b.leave_type_id === lt.id);
                  const suffix = lt.is_unlimited ? ' — Unlimited' : bal ? ` — ${bal.balance} available` : '';
                  return <option key={lt.id} value={lt.name}>{lt.name}{suffix}</option>;
                })}
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

export default function MyLeavesPage() {
  return (
    <>
      <Header title="My Leaves" breadcrumb="My Space / Leaves" />
      <LeaveContent />
    </>
  );
}
