import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listAssets, createAsset, deleteAsset,
  listAssignments, assignAsset, returnAsset,
} from '@/services/assetService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, fmt } from '@/lib/helpers';

const STATUS_BADGE = { Available: 'badge-success', Assigned: 'badge-info', Retired: 'badge-danger' };

export default function AssetsPage() {
  const { tenant, profile } = useAuth();
  const [tab, setTab] = useState('inventory');
  const [assets, setAssets] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetForm, setAssetForm] = useState({ name: '', category: 'General', serial_number: '', purchase_date: '' });

  const [assignTarget, setAssignTarget] = useState(null); // asset being assigned
  const [assignProfileId, setAssignProfileId] = useState('');

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [assetsRes, assignRes, empRes] = await Promise.all([
        listAssets(tenant.id), listAssignments(tenant.id), listActiveEmployees(tenant.id),
      ]);
      setAssets(assetsRes.data);
      setAssignments(assignRes.data);
      setEmployees(empRes.data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateAsset = async () => {
    if (!assetForm.name.trim()) return showToast('Name is required', 'error');
    const { error } = await createAsset(tenant.id, assetForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Asset added', 'success');
    setShowAssetModal(false);
    setAssetForm({ name: '', category: 'General', serial_number: '', purchase_date: '' });
    fetchData();
  };

  const handleAssign = async () => {
    if (!assignProfileId) return showToast('Select an employee', 'error');
    const { error } = await assignAsset(tenant.id, assignTarget.id, assignProfileId, profile.id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Asset assigned', 'success');
    setAssignTarget(null);
    setAssignProfileId('');
    fetchData();
  };

  const handleReturn = async (assignment) => {
    const { error } = await returnAsset(tenant.id, assignment.id, assignment.asset_id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Asset marked returned', 'success');
    fetchData();
  };

  return (
    <>
      <Header title="Assets" breadcrumb="Company equipment inventory and assignments"
        actions={<button className="btn btn-primary" onClick={() => setShowAssetModal(true)}><i className="fas fa-plus" style={{ marginRight: 6 }} />Add Asset</button>}
      />
      <div className="page-content">
        <div className="filter-bar">
          <button className={`btn btn-sm ${tab === 'inventory' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('inventory')}>Inventory</button>
          <button className={`btn btn-sm ${tab === 'assignments' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('assignments')}>Assignments</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : tab === 'inventory' ? (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Category</th><th>Serial No.</th><th>Purchased</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {assets.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No assets on file yet.</td></tr>
                  ) : assets.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.category}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{a.serial_number || '—'}</td>
                      <td style={{ fontSize: 12 }}>{fmt.date(a.purchase_date)}</td>
                      <td><span className={`badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        {a.status === 'Available' && (
                          <button className="btn btn-outline btn-sm" onClick={() => setAssignTarget(a)}>Assign</button>
                        )}
                        {a.status !== 'Retired' && (
                          <button className="btn btn-outline btn-sm" onClick={async () => { await deleteAsset(a.id); fetchData(); }} style={{ color: 'var(--danger)' }}>
                            <i className="fas fa-trash" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Asset</th><th>Employee</th><th>Assigned On</th><th>Returned On</th><th>Actions</th></tr></thead>
                <tbody>
                  {assignments.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No assignments yet.</td></tr>
                  ) : assignments.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontSize: 13 }}>{a.asset?.name}</td>
                      <td style={{ fontSize: 13 }}>{fullName(a.profile)}</td>
                      <td style={{ fontSize: 12 }}>{fmt.date(a.assigned_at)}</td>
                      <td style={{ fontSize: 12 }}>{a.returned_at ? fmt.date(a.returned_at) : <span className="badge badge-info">Active</span>}</td>
                      <td>
                        {!a.returned_at && <button className="btn btn-outline btn-sm" onClick={() => handleReturn(a)}>Mark Returned</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showAssetModal} onClose={() => setShowAssetModal(false)} title="Add Asset" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowAssetModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreateAsset}>Save</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input className="form-input" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category</label>
            <input className="form-input" value={assetForm.category} onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Serial Number</label>
            <input className="form-input" value={assetForm.serial_number} onChange={(e) => setAssetForm({ ...assetForm, serial_number: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Purchase Date</label>
          <input className="form-input" type="date" value={assetForm.purchase_date} onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })} />
        </div>
      </Modal>

      <Modal show={!!assignTarget} onClose={() => setAssignTarget(null)} title={assignTarget ? `Assign — ${assignTarget.name}` : ''} width="400px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setAssignTarget(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAssign}>Assign</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Employee *</label>
          <select className="form-select" value={assignProfileId} onChange={(e) => setAssignProfileId(e.target.value)}>
            <option value="">Select employee</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
      </Modal>
    </>
  );
}
