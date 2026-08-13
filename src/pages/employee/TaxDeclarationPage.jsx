import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listMyDeclarations, saveDeclaration, deleteDeclaration } from '@/services/taxService';
import { fmt, currentFinancialYear } from '@/lib/helpers';

const CATEGORIES = ['80C', '80D', 'HRA', 'Home Loan Interest', 'Other'];
const EMPTY = { category: '80C', sub_category: '', declared_amount: '', proof_url: '' };

const STATUS_BADGE = {
  Declared: 'badge-warning',
  'Proof Submitted': 'badge-info',
  Verified: 'badge-success',
  Rejected: 'badge-danger',
};

export default function TaxDeclarationPage() {
  const { profile, tenant } = useAuth();
  const fy = currentFinancialYear();
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState(EMPTY);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const { data } = await listMyDeclarations(profile.id, fy);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [profile, fy]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!form.declared_amount) return showToast('Enter a declared amount', 'error');
    const { error } = await saveDeclaration(tenant.id, profile.id, { ...form, financial_year: fy });
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast('Declaration submitted', 'success');
    setShowModal(false);
    setForm(EMPTY);
    fetchData();
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this declaration?')) return;
    const { error } = await deleteDeclaration(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Removed', 'success');
    fetchData();
  };

  const total = rows.reduce((sum, r) => sum + (Number(r.declared_amount) || 0), 0);

  return (
    <>
      <Header title="Tax Declaration" breadcrumb={`Investment declarations for FY ${fy} — reduces your monthly TDS`} />
      <div className="page-content">
        <div className="filter-bar">
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Total declared: <strong style={{ color: 'var(--text)' }}>{fmt(total)}</strong>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <i className="fas fa-plus" /> Add Declaration
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Details</th><th>Declared Amount</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No declarations yet for FY {fy}</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}>
                      <td><span className="badge badge-info">{r.category}</span></td>
                      <td>{r.sub_category || '—'}</td>
                      <td>{fmt(r.declared_amount)}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                      <td>
                        {r.status === 'Declared' && (
                          <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(r.id)}><i className="fas fa-trash" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="Add Tax Declaration" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}><i className="fas fa-check" /> Submit</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Details</label>
          <input className="form-input" placeholder="e.g. LIC premium, PPF" value={form.sub_category} onChange={(e) => setForm({ ...form, sub_category: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Declared Amount (₹) *</label>
          <input className="form-input" type="number" value={form.declared_amount} onChange={(e) => setForm({ ...form, declared_amount: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Proof URL (optional)</label>
          <input className="form-input" placeholder="Link to uploaded proof document" value={form.proof_url} onChange={(e) => setForm({ ...form, proof_url: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
