import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listApprovalChains, saveApprovalChain, deleteApprovalChain, ENTITY_TYPES } from '@/services/approvalService';

const ROLES = ['manager', 'admin'];
const ENTITY_LABELS = {
  leave_requests: 'Leave Requests', wfh_requests: 'WFH Requests', special_requests: 'Special Requests',
  expense_claims: 'Expense Claims', travel_requests: 'Travel Requests',
};

export default function ApprovalChainsPage() {
  const { tenant } = useAuth();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId]   = useState(null);
  const [entityType, setEntityType] = useState('leave_requests');
  const [steps, setSteps]     = useState([{ role: 'manager', order: 1 }]);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data } = await listApprovalChains(tenant.id);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (row = null) => {
    setEntityType(row?.entity_type || 'leave_requests');
    setSteps(row?.steps?.length ? row.steps : [{ role: 'manager', order: 1 }]);
    setEditId(row?.id || null);
    setShowModal(true);
  };

  const updateStep = (i, val) => setSteps((p) => { const n = [...p]; n[i] = { ...n[i], role: val }; return n; });
  const addStep = () => setSteps((p) => [...p, { role: 'admin', order: p.length + 1 }]);
  const removeStep = (i) => setSteps((p) => p.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })));

  const handleSave = async () => {
    const { error } = await saveApprovalChain(tenant.id, entityType, steps, editId);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Approval chain saved', 'success');
    setShowModal(false);
    fetchData();
  };

  return (
    <>
      <Header title="Approval Chains" breadcrumb="Optional — override the default self/manager/admin auto-approval tiers with an explicit chain per request type" />
      <div className="page-content">
        <div className="filter-bar">
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => openModal()}><i className="fas fa-plus" /> New Chain</button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Request Type</th><th>Chain</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                      No overrides configured — leave requests currently use the default self/manager/admin quota tiers.
                    </td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{ENTITY_LABELS[r.entity_type] || r.entity_type}</strong></td>
                      <td>{[...r.steps].sort((a, b) => a.order - b.order).map((s) => s.role).join(' → ')}</td>
                      <td>
                        <button className="btn btn-outline btn-icon btn-sm" onClick={() => openModal(r)}><i className="fas fa-edit" /></button>{' '}
                        <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={async () => { await deleteApprovalChain(r.id); fetchData(); }}><i className="fas fa-trash" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
              Only Leave Requests currently consult a configured chain (via <code>requestLeave</code>) — the same lookup is ready to wire into WFH/Special/Expense/Travel as needed.
            </div>
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="Approval Chain" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Request Type</label>
          <select className="form-select" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Steps (in order)</label>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 20 }}>{s.order}.</span>
              <select className="form-select" value={s.role} onChange={(e) => updateStep(i, e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeStep(i)}><i className="fas fa-trash" /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={addStep}><i className="fas fa-plus" /> Add Step</button>
        </div>
      </Modal>
    </>
  );
}
