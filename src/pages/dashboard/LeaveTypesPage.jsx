import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listLeaveTypes, saveLeaveType, deleteLeaveType, seedDefaultLeaveTypesIfEmpty } from '@/services/leaveLedgerService';

function blankForm() {
  return {
    name: '', is_paid: true, carry_forward: false, max_carry_forward_days: '',
    accrual_frequency: 'none', accrual_days: '', annual_quota: '', encashable: false,
    max_continuous_days: '', is_active: true,
  };
}

export default function LeaveTypesPage() {
  const { tenant } = useAuth();
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow]     = useState(null);
  const [form, setForm]           = useState(blankForm());

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { seeded } = await seedDefaultLeaveTypesIfEmpty(tenant.id);
      const { data } = await listLeaveTypes(tenant.id);
      setRows(data);
      if (seeded) showToast('Seeded default leave categories (Planned/Emergency/Unplanned)', 'info');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (row = null) => {
    setEditRow(row);
    setForm(row ? {
      name: row.name, is_paid: row.is_paid, carry_forward: row.carry_forward,
      max_carry_forward_days: row.max_carry_forward_days, accrual_frequency: row.accrual_frequency,
      accrual_days: row.accrual_days, annual_quota: row.annual_quota, encashable: row.encashable,
      max_continuous_days: row.max_continuous_days ?? '', is_active: row.is_active,
    } : blankForm());
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return showToast('Name is required', 'error');
    const { error } = await saveLeaveType(tenant.id, form, editRow?.id);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast(editRow ? 'Leave type updated' : 'Leave type added', 'success');
    setShowModal(false);
    fetchData();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this leave type? Existing ledger history is kept but new requests can no longer use it.')) return;
    const { error } = await deleteLeaveType(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Deleted', 'success');
    fetchData();
  };

  return (
    <>
      <Header title="Leave Types" breadcrumb="Configure accrual, carry-forward and encashment rules — must match the leave names employees pick when requesting leave" />
      <div className="page-content">
        <div className="filter-bar">
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => openModal()}>
              <i className="fas fa-plus" /> New Leave Type
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Paid</th><th>Accrual</th><th>Carry Forward</th><th>Encashable</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                      No leave types configured — add "Casual Leave", "Sick Leave" etc. to match what employees select when requesting leave.
                    </td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong></td>
                      <td><span className={`badge ${r.is_paid ? 'badge-success' : 'badge-secondary'}`}>{r.is_paid ? 'Paid' : 'Unpaid'}</span></td>
                      <td>{r.accrual_frequency === 'none' ? '—' : `${r.accrual_days}/${r.accrual_frequency === 'monthly' ? 'mo' : 'yr'}`}</td>
                      <td>{r.carry_forward ? `Up to ${r.max_carry_forward_days} days` : '—'}</td>
                      <td>{r.encashable ? <i className="fas fa-check" style={{ color: 'var(--success)' }} /> : '—'}</td>
                      <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-secondary'}`}>{r.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td>
                        <button className="btn btn-outline btn-icon btn-sm" onClick={() => openModal(r)}><i className="fas fa-edit" /></button>{' '}
                        <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(r.id)}><i className="fas fa-trash" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title={editRow ? 'Edit Leave Type' : 'New Leave Type'} width="480px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}><i className="fas fa-check" /> Save</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Name * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(must match the value shown when requesting leave, e.g. "Casual Leave")</span></label>
          <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={form.is_paid} onChange={(e) => setForm({ ...form, is_paid: e.target.checked })} /> Paid leave
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={form.encashable} onChange={(e) => setForm({ ...form, encashable: e.target.checked })} /> Encashable
          </label>
        </div>
        <div className="form-group">
          <label className="form-label">Accrual</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="form-select" value={form.accrual_frequency} onChange={(e) => setForm({ ...form, accrual_frequency: e.target.value })} style={{ maxWidth: 140 }}>
              <option value="none">No accrual</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            {form.accrual_frequency !== 'none' && (
              <input className="form-input" type="number" step="0.5" placeholder="Days per period" value={form.accrual_days} onChange={(e) => setForm({ ...form, accrual_days: e.target.value })} />
            )}
          </div>
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={form.carry_forward} onChange={(e) => setForm({ ...form, carry_forward: e.target.checked })} /> Allow carry-forward to next year
          </label>
          {form.carry_forward && (
            <input className="form-input" type="number" placeholder="Max days carried forward" value={form.max_carry_forward_days} onChange={(e) => setForm({ ...form, max_carry_forward_days: e.target.value })} />
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Annual Quota (reference only)</label>
            <input className="form-input" type="number" value={form.annual_quota} onChange={(e) => setForm({ ...form, annual_quota: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Max Continuous Days</label>
            <input className="form-input" type="number" value={form.max_continuous_days} onChange={(e) => setForm({ ...form, max_continuous_days: e.target.value })} />
          </div>
        </div>
      </Modal>
    </>
  );
}
