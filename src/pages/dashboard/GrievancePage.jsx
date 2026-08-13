import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyGrievances, listTenantGrievances, fileGrievance, updateGrievance } from '@/services/grievanceService';
import { fmt, fullName } from '@/lib/helpers';

const TYPES = ['Harassment', 'Discrimination', 'Workplace Safety', 'Policy Violation', 'Compensation', 'Other'];
const STATUS_BADGE = { Open: 'badge-warning', 'Under Review': 'badge-info', Resolved: 'badge-success', Dismissed: 'badge-secondary' };

export default function GrievancePage() {
  const { profile, tenant } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'superadmin';
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState({ type: 'Other', description: '' });
  const [resolveFor, setResolveFor] = useState(null);
  const [resolveNotes, setResolveNotes] = useState('');

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    try {
      const { data } = canManage ? await listTenantGrievances(tenant.id) : await listMyGrievances(profile.id);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [profile, tenant, canManage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFile = async () => {
    if (!form.description.trim()) return showToast('Describe the issue', 'error');
    const { error } = await fileGrievance(tenant.id, profile.id, form);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Submitted confidentially to HR', 'success');
    setShowModal(false);
    setForm({ type: 'Other', description: '' });
    fetchData();
  };

  const setStatus = async (id, status) => {
    const { error } = await updateGrievance(id, { status });
    if (error) return showToast('Failed: ' + error.message, 'error');
    fetchData();
  };

  const saveResolution = async () => {
    const { error } = await updateGrievance(resolveFor.id, { status: 'Resolved', resolution_notes: resolveNotes });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Marked resolved', 'success');
    setResolveFor(null);
    setResolveNotes('');
    fetchData();
  };

  return (
    <>
      <Header title="Grievances" breadcrumb={canManage ? 'Confidential — visible only to HR admins, not managers' : 'File a confidential issue directly with HR'} />
      <div className="page-content">
        <div className="filter-bar">
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><i className="fas fa-plus" /> File a Grievance</button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr>{canManage && <th>Employee</th>}<th>Type</th><th>Description</th><th>Status</th><th>Filed</th>{canManage && <th>Actions</th>}</tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={canManage ? 6 : 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No grievances on file</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}>
                      {canManage && <td>{fullName(r.profile)}</td>}
                      <td><span className="badge badge-info">{r.type}</span></td>
                      <td style={{ maxWidth: 320, fontSize: 13 }}>{r.description}{r.resolution_notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}><strong>Resolution:</strong> {r.resolution_notes}</div>}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                      <td>{fmt.date(r.created_at)}</td>
                      {canManage && (
                        <td>
                          {r.status === 'Open' && <button className="btn btn-outline btn-sm" onClick={() => setStatus(r.id, 'Under Review')}>Review</button>}
                          {r.status !== 'Resolved' && r.status !== 'Dismissed' && (
                            <button className="btn btn-outline btn-sm" style={{ marginLeft: 4 }} onClick={() => setResolveFor(r)}>Resolve</button>
                          )}
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

      <Modal show={showModal} onClose={() => setShowModal(false)} title="File a Grievance" width="480px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleFile}>Submit</button>
        </>}
      >
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Only HR admins can see this — your manager is not notified.
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Description *</label>
          <textarea className="form-input" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>

      <Modal show={!!resolveFor} onClose={() => setResolveFor(null)} title="Resolve Grievance" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setResolveFor(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveResolution}>Mark Resolved</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Resolution Notes</label>
          <textarea className="form-input" rows={4} value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
