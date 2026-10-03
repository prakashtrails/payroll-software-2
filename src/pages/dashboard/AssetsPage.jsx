import { useEffect, useState, useCallback, useMemo } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import {
  listAssets, createAsset, deleteAsset,
  listAssignments, assignAsset, returnAsset,
  listAssetPresets, bulkCreateAssetPresets, deleteAssetPreset,
} from '@/services/assetService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, fmt, scopedToOutlet } from '@/lib/helpers';

const STATUS_BADGE = { Available: 'badge-success', Assigned: 'badge-info', Retired: 'badge-danger' };

export default function AssetsPage() {
  const { tenant, profile } = useAuth();
  const { outlets, selectedOutletId, selectOutlet, outletProfileIds } = useOutletView();
  const [tab, setTab] = useState('inventory');
  const [assets, setAssets] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetForm, setAssetForm] = useState({ name: '', category: 'General', serial_number: '', purchase_date: '', outlet_id: '' });

  const [assignTarget, setAssignTarget] = useState(null); // asset being assigned
  const [assignProfileId, setAssignProfileId] = useState('');
  const [assigning, setAssigning] = useState(false);

  const [showPresetsModal, setShowPresetsModal] = useState(false);
  const [presetBulkText, setPresetBulkText] = useState('');
  const [savingPresets, setSavingPresets] = useState(false);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [assetsRes, assignRes, empRes, presetsRes] = await Promise.all([
        listAssets(tenant.id), listAssignments(tenant.id), listActiveEmployees(tenant.id), listAssetPresets(tenant.id),
      ]);
      setAssets(assetsRes.data);
      setAssignments(assignRes.data);
      setEmployees(empRes.data);
      setPresets(presetsRes.data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Outlet-wise filtering, same convention as every other admin list page:
  // an asset with no outlet_id set (shared/head-office equipment, or added
  // before outlets existed) stays visible under every outlet so it's never
  // silently hidden; assignments are scoped by the employee's own outlet.
  const filteredAssets = useMemo(
    () => (selectedOutletId ? assets.filter((a) => !a.outlet_id || a.outlet_id === selectedOutletId) : assets),
    [assets, selectedOutletId],
  );
  const filteredAssignments = useMemo(
    () => scopedToOutlet(assignments, outletProfileIds, 'profile_id'),
    [assignments, outletProfileIds],
  );

  const handleCreateAsset = async () => {
    if (!assetForm.name.trim()) return showToast('Name is required', 'error');
    const { error } = await createAsset(tenant.id, assetForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Asset added', 'success');
    setShowAssetModal(false);
    setAssetForm({ name: '', category: 'General', serial_number: '', purchase_date: '', outlet_id: '' });
    fetchData();
  };

  // Auto-fills category when the typed name exactly matches a preset —
  // pure convenience, doesn't stop a name that isn't in the catalog yet.
  const handleAssetNameChange = (name) => {
    const preset = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    setAssetForm((prev) => ({ ...prev, name, category: preset ? preset.category : prev.category }));
  };

  const handleAssign = async () => {
    if (!assignProfileId) return showToast('Select an employee', 'error');
    setAssigning(true);
    try {
      const { error } = await assignAsset(tenant.id, assignTarget.id, assignProfileId, profile.id);
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Asset assigned', 'success');
      setAssignTarget(null);
      setAssignProfileId('');
      fetchData();
    } finally {
      setAssigning(false);
    }
  };

  const handleReturn = async (assignment) => {
    const { error } = await returnAsset(tenant.id, assignment.id, assignment.asset_id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Asset marked returned', 'success');
    fetchData();
  };

  const handleBulkAddPresets = async () => {
    if (!presetBulkText.trim()) return showToast('Nothing to add', 'error');
    setSavingPresets(true);
    try {
      const { count, error } = await bulkCreateAssetPresets(tenant.id, profile.id, presetBulkText);
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast(`Added ${count} preset${count === 1 ? '' : 's'}`, 'success');
      setPresetBulkText('');
      fetchData();
    } finally {
      setSavingPresets(false);
    }
  };

  const handleDeletePreset = async (id) => {
    const { error } = await deleteAssetPreset(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <>
      <Header title="Assets" breadcrumb="Company equipment inventory and assignments"
        actions={<>
          <button className="btn btn-outline" onClick={() => setShowPresetsModal(true)}><i className="fas fa-list" style={{ marginRight: 6 }} />Manage Presets</button>
          <button className="btn btn-primary" onClick={() => setShowAssetModal(true)}><i className="fas fa-plus" style={{ marginRight: 6 }} />Add Asset</button>
        </>}
      />
      <div className="page-content">
        <div className="filter-bar">
          <button className={`btn btn-sm ${tab === 'inventory' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('inventory')}>Inventory</button>
          <button className={`btn btn-sm ${tab === 'assignments' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('assignments')}>Assignments</button>
          {outlets.length > 0 && (
            <select
              className="form-select"
              style={{ marginLeft: 'auto', maxWidth: 220 }}
              value={selectedOutletId || ''}
              onChange={(e) => selectOutlet(e.target.value || null)}
              title="Location (Outlet)"
            >
              <option value="">All Outlets (Combined)</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : tab === 'inventory' ? (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Category</th><th>Serial No.</th><th>Outlet</th><th>Purchased</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredAssets.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No assets on file yet.</td></tr>
                  ) : filteredAssets.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.category}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{a.serial_number || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.outlet?.name || '—'}</td>
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
                  {filteredAssignments.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No assignments yet.</td></tr>
                  ) : filteredAssignments.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontSize: 13 }}>{a.asset?.name}</td>
                      <td style={{ fontSize: 13 }}>
                        {fullName(a.profile)}
                        {a.profile?.department && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.profile.department}</div>}
                      </td>
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
          <input className="form-input" list="asset-preset-list" value={assetForm.name} onChange={(e) => handleAssetNameChange(e.target.value)} />
          <datalist id="asset-preset-list">
            {presets.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
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
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Purchase Date</label>
            <input className="form-input" type="date" value={assetForm.purchase_date} onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Outlet</label>
            <select className="form-select" value={assetForm.outlet_id} onChange={(e) => setAssetForm({ ...assetForm, outlet_id: e.target.value })}>
              <option value="">Unassigned / Shared</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <Modal show={!!assignTarget} onClose={() => setAssignTarget(null)} title={assignTarget ? `Assign — ${assignTarget.name}` : ''} width="400px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setAssignTarget(null)} disabled={assigning}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAssign} disabled={assigning}>{assigning ? 'Assigning…' : 'Assign'}</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Employee *</label>
          <select className="form-select" value={assignProfileId} onChange={(e) => setAssignProfileId(e.target.value)}>
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{fullName(e)}{e.department ? ` — ${e.department}` : ''}</option>
            ))}
          </select>
        </div>
      </Modal>

      <Modal show={showPresetsModal} onClose={() => setShowPresetsModal(false)} title="Manage Asset Presets" width="480px"
        footer={<button className="btn btn-outline" onClick={() => setShowPresetsModal(false)}>Close</button>}
      >
        <div className="form-group">
          <label className="form-label">Bulk add (one per line — "Name" or "Name, Category")</label>
          <textarea
            className="form-input"
            rows={4}
            placeholder={'Dell Laptop, Electronics\nOffice Chair, Furniture\nID Card'}
            value={presetBulkText}
            onChange={(e) => setPresetBulkText(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={handleBulkAddPresets} disabled={savingPresets}>
            {savingPresets ? 'Adding…' : 'Add'}
          </button>
        </div>

        {presets.length > 0 && (
          <div style={{ marginTop: 16, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {presets.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{p.category}</span>
                </div>
                <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDeletePreset(p.id)}>
                  <i className="fas fa-trash" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
