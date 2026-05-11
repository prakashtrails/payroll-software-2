import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listComponents, saveComponent, deleteComponent } from '@/services/salaryService';
import { fmt, calcSalary } from '@/lib/helpers';

export default function SalaryStructurePage() {
  const { tenant } = useAuth();
  const [components, setComponents] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editComp, setEditComp]     = useState(null);
  const [form, setForm]             = useState({ name: '', category: 'earning', calc_type: 'percent_ctc', percent: '', fixed: '' });

  const fetchComponents = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const { data, error } = await listComponents(tenant.id);
    if (error) console.error(error);
    setComponents(data);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { fetchComponents(); }, [fetchComponents]);

  const openModal = (category, comp = null) => {
    setEditComp(comp);
    setForm({
      name:      comp?.name      || '',
      category:  comp?.category  || category,
      calc_type: comp?.calc_type || 'percent_ctc',
      percent:   comp?.percent   || '',
      fixed:     comp?.fixed     || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return showToast('Name is required', 'error');
    const { error } = await saveComponent(tenant.id, form, editComp?.id);
    if (error) return showToast((editComp ? 'Update' : 'Add') + ' failed: ' + error.message, 'error');
    showToast(editComp ? 'Component updated' : 'Component added', 'success');
    setShowModal(false);
    fetchComponents();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this salary component?')) return;
    const { error } = await deleteComponent(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Deleted', 'success');
    fetchComponents();
  };

  const previewSalary = calcSalary(30000, components, tenant?.work_days || 26, tenant?.work_days || 26);

  const renderTable = (category, label) => {
    const items = components.filter((c) => c.category === category);
    return (
      <div className="card">
        <div className="card-header">
          <h3>{label}</h3>
          <button className="btn btn-primary btn-sm" onClick={() => openModal(category)}>
            <i className="fas fa-plus" /> Add
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Component</th><th>Type</th><th>Value</th><th>Actions</th></tr></thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No components configured</td></tr>
              ) : items.map((c) => {
                const typeLabel = c.calc_type === 'percent_ctc' ? '% of CTC' : c.calc_type === 'percent_basic' ? '% of Basic' : 'Fixed';
                const valLabel  = c.calc_type === 'fixed' ? fmt(c.fixed) : c.percent + '%';
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td><span className={`badge ${category === 'earning' ? 'badge-success' : 'badge-danger'}`}>{typeLabel}</span></td>
                    <td>{valLabel}</td>
                    <td>
                      <button className="btn btn-outline btn-icon btn-sm" onClick={() => openModal(category, c)}><i className="fas fa-edit" /></button>{' '}
                      <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(c.id)}><i className="fas fa-trash" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <Header title="Salary Structure" breadcrumb="Configure earning and deduction components" />
      <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading components…</div>
        ) : (
          <>
            <div className="grid-2">
              {renderTable('earning', 'Earning Components')}
              {renderTable('deduction', 'Deduction Components')}
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Salary Preview</h3>
                <div className="subtitle">See how a sample ₹30,000 CTC breaks down</div>
              </div>
              <div className="card-body">
                <div style={{ maxWidth: 420 }}>
                  <h4 style={{ fontSize: 13, color: 'var(--success)', marginBottom: 8 }}>Earnings</h4>
                  {previewSalary.earnings.map((e, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                      <span>{e.name}</span><span>{fmt(e.amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: 700, borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 13 }}>
                    <span>Total Earnings</span><span>{fmt(previewSalary.totalEarning)}</span>
                  </div>
                  <h4 style={{ fontSize: 13, color: 'var(--danger)', margin: '14px 0 8px' }}>Deductions</h4>
                  {previewSalary.deductions.map((d, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                      <span>{d.name}</span><span>{fmt(d.amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: 700, borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 13 }}>
                    <span>Total Deductions</span><span>{fmt(previewSalary.totalDeduction)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 800, fontSize: 16, borderTop: '2px solid var(--text)', marginTop: 8 }}>
                    <span>Net Salary</span><span style={{ color: 'var(--success)' }}>{fmt(previewSalary.net)}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title={editComp ? 'Edit Component' : 'Add Component'} width="420px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}><i className="fas fa-check" /> Save</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Component Name *</label>
          <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Calculation Type</label>
          <select className="form-select" value={form.calc_type} onChange={(e) => setForm({ ...form, calc_type: e.target.value })}>
            <option value="percent_ctc">% of CTC</option>
            <option value="percent_basic">% of Basic</option>
            <option value="fixed">Fixed Amount</option>
          </select>
        </div>
        {form.calc_type !== 'fixed' ? (
          <div className="form-group">
            <label className="form-label">Percentage (%)</label>
            <input className="form-input" type="number" step="0.01" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Fixed Amount (₹)</label>
            <input className="form-input" type="number" value={form.fixed} onChange={(e) => setForm({ ...form, fixed: e.target.value })} />
          </div>
        )}
      </Modal>
    </>
  );
}
