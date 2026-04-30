import React, { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyLeaveRequests, requestLeave } from '@/services/leaveService';
import { fmt, todayStr } from '@/lib/helpers';

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

  useEffect(() => {
    fetchRequests();
  }, [profile]);

  const fetchRequests = async () => {
    if (!profile) return;
    setLoading(true);
    const { data, error } = await listMyLeaveRequests(profile.id);
    if (error) showToast(error.message, 'error');
    else setRequests(data);
    setLoading(false);
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
      
      const payload = {
        ...form,
        profile_id: profile.id,
        tenant_id: tenant.id,
        status: 'Pending',
      };
      const { error } = await requestLeave(payload);

      if (error) {
        showToast(error.message || 'Failed to submit leave request', 'error');
      } else {
        // Optimistic update — add to local list immediately, no waiting for re-fetch
        setRequests(prev => [{
          ...payload,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        }, ...prev]);
        showToast('Leave request submitted', 'success');
        setShowModal(false);
        setForm(EMPTY_REQUEST);
        // Background refresh to get server-assigned id/timestamps
        fetchRequests();
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

      <div className="card" style={{ marginTop: 24 }}>
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
            <option>Casual Leave</option>
            <option>Sick Leave</option>
            <option>Paid Leave</option>
            <option>Maternity/Paternity Leave</option>
            <option>Loss of Pay</option>
          </select>
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
