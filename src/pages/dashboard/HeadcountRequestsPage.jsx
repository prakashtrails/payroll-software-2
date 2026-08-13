import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listHeadcountRequests, createHeadcountRequest, updateHeadcountRequestStatus } from '@/services/hiringService';
import { fmt, fullName } from '@/lib/helpers';

const STATUS_BADGE = { Pending: 'badge-warning', Approved: 'badge-success', Rejected: 'badge-danger' };

export default function HeadcountRequestsPage() {
  const { tenant, profile } = useAuth();
  const canApprove = profile?.role === 'admin' || profile?.role === 'superadmin';
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState({ designation: '', count: 1, justification: '', budget_amount: '' });

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data } = await listHeadcountRequests(tenant.id);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!form.designation.trim()) return showToast('Designation is required', 'error');
    const { error } = await createHeadcountRequest(tenant.id, profile.id, form);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Headcount request submitted', 'success');
    setShowModal(false);
    setForm({ designation: '', count: 1, justification: '', budget_amount: '' });
    fetchData();
  };

  const setStatus = async (id, status) => {
    const { error } = await updateHeadcountRequestStatus(id, status, profile.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast(`Request ${status.toLowerCase()}`, 'success');
    fetchData();
  };

  return (
    <>
      <Header title="Headcount Requests" breadcrumb="Propose new roles against budget before opening a job posting" />
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
                <thead><tr><th>Designation</th><th>Count</th><th>Budget</th><th>Requested By</th><th>Justification</th><th>Status</th>{canApprove && <th>Actions</th>}</tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={canApprove ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No headcount requests yet</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.designation}</strong></td>
                      <td>{r.count}</td>
                      <td>{fmt(r.budget_amount)}</td>
                      <td>{fullName(r.requester)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 240 }}>{r.justification || '—'}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                      {canApprove && (
                        <td>
                          {r.status === 'Pending' && <>
                            <button className="btn btn-outline btn-sm" onClick={() => setStatus(r.id, 'Approved')}>Approve</button>{' '}
                            <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setStatus(r.id, 'Rejected')}>Reject</button>
                          </>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="New Headcount Request" width="460px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate}>Submit</button>
        </>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Designation *</label>
            <input className="form-input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Count</label>
            <input className="form-input" type="number" min="1" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Budget (₹/month, total)</label>
          <input className="form-input" type="number" value={form.budget_amount} onChange={(e) => setForm({ ...form, budget_amount: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Justification</label>
          <textarea className="form-input" rows={3} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
