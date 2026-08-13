import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listTaxSlabs, saveTaxSlab, deleteTaxSlab } from '@/services/taxService';
import { fmt, calcSlabTax, currentFinancialYear, DEFAULT_INDIA_NEW_REGIME_SLABS } from '@/lib/helpers';

const emptySlabRow = () => ({ from: 0, to: '', rate: 0 });

export default function TaxSlabsPage() {
  const { tenant } = useAuth();
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow]     = useState(null);
  const [form, setForm]           = useState(blankForm());

  function blankForm() {
    return {
      regime: 'New',
      financial_year: currentFinancialYear(),
      standard_deduction: 75000,
      rebate_threshold: 1200000,
      cess_percent: 4,
      slabs: DEFAULT_INDIA_NEW_REGIME_SLABS.map((s) => ({ from: s.from, to: s.to ?? '', rate: s.rate })),
      is_active: true,
    };
  }

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data } = await listTaxSlabs(tenant.id);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (row = null) => {
    setEditRow(row);
    setForm(row ? {
      regime: row.regime,
      financial_year: row.financial_year,
      standard_deduction: row.standard_deduction,
      rebate_threshold: row.rebate_threshold,
      cess_percent: row.cess_percent,
      slabs: (row.slabs || []).map((s) => ({ from: s.from, to: s.to ?? '', rate: s.rate })),
      is_active: row.is_active,
    } : blankForm());
    setShowModal(true);
  };

  const updateSlabRow = (i, field, value) => {
    setForm((p) => {
      const slabs = [...p.slabs];
      slabs[i] = { ...slabs[i], [field]: value };
      return { ...p, slabs };
    });
  };
  const addSlabRow    = () => setForm((p) => ({ ...p, slabs: [...p.slabs, emptySlabRow()] }));
  const removeSlabRow = (i) => setForm((p) => ({ ...p, slabs: p.slabs.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    if (!form.financial_year.trim()) return showToast('Financial year is required', 'error');
    const payload = {
      ...form,
      slabs: form.slabs.map((s) => ({
        from: parseFloat(s.from) || 0,
        to:   s.to === '' || s.to == null ? null : parseFloat(s.to),
        rate: parseFloat(s.rate) || 0,
      })),
    };
    const { error } = await saveTaxSlab(tenant.id, payload, editRow?.id);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast(editRow ? 'Slab config updated' : 'Slab config added', 'success');
    setShowModal(false);
    fetchData();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this tax slab configuration?')) return;
    const { error } = await deleteTaxSlab(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Deleted', 'success');
    fetchData();
  };

  const previewTax = calcSlabTax(1800000, form.slabs.map((s) => ({ from: parseFloat(s.from) || 0, to: s.to === '' ? null : parseFloat(s.to), rate: parseFloat(s.rate) || 0 })), form.cess_percent);

  return (
    <>
      <Header title="Income Tax Slabs" breadcrumb="Configure TDS slabs per financial year — feeds automatically into payroll processing" />
      <div className="page-content">
        <div className="filter-bar">
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => openModal()}>
              <i className="fas fa-plus" /> New Slab Config
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Financial Year</th><th>Regime</th><th>Standard Deduction</th><th>Rebate Threshold</th><th>Cess</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                      No slab config yet — one is seeded automatically the first time payroll runs, or add one now.
                    </td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.financial_year}</strong></td>
                      <td><span className="badge badge-info">{r.regime}</span></td>
                      <td>{fmt(r.standard_deduction)}</td>
                      <td>{fmt(r.rebate_threshold)}</td>
                      <td>{r.cess_percent}%</td>
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

      <Modal show={showModal} onClose={() => setShowModal(false)} title={editRow ? 'Edit Slab Config' : 'New Slab Config'} width="620px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}><i className="fas fa-check" /> Save</button>
        </>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Financial Year *</label>
            <input className="form-input" placeholder="2026-27" value={form.financial_year} onChange={(e) => setForm({ ...form, financial_year: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Regime</label>
            <select className="form-select" value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value })}>
              <option value="New">New Regime</option>
              <option value="Old">Old Regime</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Standard Deduction (₹/yr)</label>
            <input className="form-input" type="number" value={form.standard_deduction} onChange={(e) => setForm({ ...form, standard_deduction: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Zero-Tax Rebate Threshold (₹)</label>
            <input className="form-input" type="number" value={form.rebate_threshold} onChange={(e) => setForm({ ...form, rebate_threshold: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Health &amp; Education Cess (%)</label>
          <input className="form-input" type="number" step="0.1" style={{ maxWidth: 140 }} value={form.cess_percent} onChange={(e) => setForm({ ...form, cess_percent: e.target.value })} />
        </div>

        <div className="form-group">
          <label className="form-label">Slabs</label>
          {form.slabs.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input className="form-input" type="number" placeholder="From" value={s.from} onChange={(e) => updateSlabRow(i, 'from', e.target.value)} style={{ width: 110 }} />
              <span style={{ color: 'var(--text-muted)' }}>to</span>
              <input className="form-input" type="number" placeholder="∞" value={s.to} onChange={(e) => updateSlabRow(i, 'to', e.target.value)} style={{ width: 110 }} />
              <input className="form-input" type="number" placeholder="Rate %" value={s.rate} onChange={(e) => updateSlabRow(i, 'rate', e.target.value)} style={{ width: 90 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
              <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeSlabRow(i)}><i className="fas fa-trash" /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={addSlabRow}><i className="fas fa-plus" /> Add Slab</button>
        </div>

        <div style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          Preview — annual tax on ₹18,00,000 taxable income: <strong>{fmt(previewTax)}</strong>
        </div>
      </Modal>
    </>
  );
}
