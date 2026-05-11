// Advances page removed as per request

import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listAdvances, createAdvance, updateAdvance, deleteAdvance } from '@/services/advanceService';
import { listActiveEmployees } from '@/services/employeeService';
import { fmt, getInitials, getAvatarColor } from '@/lib/helpers';

export default function AdvancesPage() {
  const { tenant } = useAuth();
  const [advances, setAdvances]     = useState([]);
  const [employees, setEmployees]   = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editAdv, setEditAdv]       = useState(null);
  const [form, setForm]             = useState({ profile_id: '', type: 'Salary Advance', amount: '', installments: '', emi: '', remarks: '' });

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [advsRes, empsRes] = await Promise.all([
      listAdvances(tenant.id),
      listActiveEmployees(tenant.id),
    ]);
    setAdvances(advsRes.data);
    setEmployees(empsRes.data);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (adv = null) => {
    setEditAdv(adv);
    setForm({
      profile_id:   adv?.profile_id || '',
      type:         adv?.type || 'Salary Advance',
      amount:       adv?.amount || '',
      installments: adv ? Math.ceil(adv.amount / adv.emi) : '',
      emi:          adv?.emi || '',
      remarks:      adv?.remarks || '',
    });
    setShowModal(true);
  };

  const calcEMI = (amt, inst) => {
    const a = parseFloat(amt) || 0;
    const i = parseInt(inst) || 1;
    setForm((p) => ({ ...p, emi: Math.ceil(a / i) }));
  };

  const saveAdvance = async () => {
    if (!form.profile_id || !form.amount || !form.emi) return showToast('Fill required fields', 'error');

    let result;
    if (editAdv) {
      result = await updateAdvance(editAdv.id, { ...form, paid: editAdv.paid });
    } else {
      result = await createAdvance({ tenantId: tenant.id, ...form });
    }

    if (result.error) return showToast('Failed: ' + result.error.message, 'error');
    showToast(editAdv ? 'Advance updated' : 'Advance recorded', 'success');
    setShowModal(false);
    fetchData();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this advance record?')) return;
    const { error } = await deleteAdvance(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Deleted', 'success');
    fetchData();
  };

  const filtered    = filterStatus ? advances.filter((a) => a.status === filterStatus) : advances;
  const activeAdv   = advances.filter((a) => a.status === 'Active');
  const totalOut    = activeAdv.reduce((s, a) => s + (a.balance || 0), 0);
  const totalEMI    = activeAdv.reduce((s, a) => s + (a.emi    || 0), 0);
  const getEmpName  = (pid) => { const e = employees.find((x) => x.id === pid); return e ? `${e.first_name} ${e.last_name}` : '—'; };

  return (
    <>
      <Header title="Advances & Loans" breadcrumb="Manage employee advances and loan recovery" />
      <div className="page-content">
        <div className="filter-bar">
          <select className="form-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
          </select>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => openModal()}>
              <i className="fas fa-plus" /> New Advance
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <>
            <div className="stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <StatCard icon="fa-hand-holding-usd" iconColor="orange" value={fmt(totalOut)} label="Total Outstanding" />
              <StatCard icon="fa-check" iconColor="green" value={activeAdv.length} label="Active Loans" />
              <StatCard icon="fa-redo" iconColor="blue" value={fmt(totalEMI)} label="Monthly EMI Recovery" />
            </div>

            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Employee</th><th>Type</th><th>Amount</th><th>EMI</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No advances found</td></tr>
                    ) : filtered.map((a) => {
                      const emp = employees.find((x) => x.id === a.profile_id);
                      return (
                        <tr key={a.id}>
                          <td>
                            <div className="emp-cell">
                              <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(a.profile_id)})` }}>
                                {emp ? getInitials(emp.first_name, emp.last_name) : '??'}
                              </div>
                              <div><div className="emp-name">{getEmpName(a.profile_id)}</div></div>
                            </div>
                          </td>
                          <td><span className="badge badge-info">{a.type}</span></td>
                          <td>{fmt(a.amount)}</td>
                          <td>{fmt(a.emi)}/mo</td>
                          <td>{fmt(a.paid)}</td>
                          <td>{fmt(a.balance)}</td>
                          <td><span className={`badge ${a.status === 'Active' ? 'badge-warning' : 'badge-success'}`}>{a.status}</span></td>
                          <td>
                            <button className="btn btn-outline btn-icon btn-sm" onClick={() => openModal(a)}><i className="fas fa-edit" /></button>{' '}
                            <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(a.id)}><i className="fas fa-trash" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title={editAdv ? 'Edit Advance' : 'New Advance'} width="480px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAdvance}><i className="fas fa-check" /> Save</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Employee *</label>
          <select className="form-select" value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}>
            <option value="">Select Employee</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option>Salary Advance</option><option>Personal Loan</option><option>Emergency Advance</option>
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount (₹) *</label>
            <input className="form-input" type="number" value={form.amount}
              onChange={(e) => { setForm({ ...form, amount: e.target.value }); calcEMI(e.target.value, form.installments); }} />
          </div>
          <div className="form-group">
            <label className="form-label">Installments *</label>
            <input className="form-input" type="number" min="1" value={form.installments}
              onChange={(e) => { setForm({ ...form, installments: e.target.value }); calcEMI(form.amount, e.target.value); }} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">EMI Amount</label>
          <input className="form-input" type="number" readOnly value={form.emi} />
        </div>
        <div className="form-group">
          <label className="form-label">Remarks</label>
          <input className="form-input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
