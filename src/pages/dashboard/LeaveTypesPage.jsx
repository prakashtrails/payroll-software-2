import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listLeaveTypes, saveLeaveType, deleteLeaveType, seedDefaultLeaveTypesIfEmpty } from '@/services/leaveLedgerService';

const CARD_ACCENTS = ['#00AEEF', '#8B5CF6', '#22C55E', '#FF6B35', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1'];
function accentFor(name) {
  const hash = [...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return CARD_ACCENTS[hash % CARD_ACCENTS.length];
}

function blankForm() {
  return {
    name: '', is_paid: true, carry_forward: false, max_carry_forward_days: '',
    accrual_frequency: 'none', accrual_days: '', annual_quota: '', encashable: false,
    max_continuous_days: '', is_active: true, is_unlimited: false,
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
      is_unlimited: !!row.is_unlimited,
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

  const activeCount   = rows.filter((r) => r.is_active).length;
  const paidCount     = rows.filter((r) => r.is_paid).length;
  const carryFwdCount = rows.filter((r) => r.carry_forward).length;

  return (
    <>
      <Header title="Leave Types" breadcrumb="Configure quotas, accrual, carry-forward, deduction and encashment rules — names must match what employees pick when requesting leave" />
      <div className="page-content">
        {!loading && rows.length > 0 && (
          <div className="stats-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <StatCard icon="fa-list-check" iconColor="blue" value={rows.length} label="Leave Types" />
            <StatCard icon="fa-toggle-on" iconColor="green" value={activeCount} label="Active" />
            <StatCard icon="fa-wallet" iconColor="orange" value={paidCount} label="Paid (Balance Deduction)" />
            <StatCard icon="fa-rotate" iconColor="purple" value={carryFwdCount} label="Carry-Forward Enabled" />
          </div>
        )}

        <div className="filter-bar">
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 560 }}>
            <i className="fas fa-circle-info" style={{ marginRight: 6 }} />
            <strong>Deduction Type</strong> decides whether an approved leave is drawn from the employee's balance (Paid)
            or marked Loss of Pay against salary (Unpaid). Comp Off's gain rules live in{' '}
            <strong>Settings → Company Settings</strong>.
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => openModal()}>
              <i className="fas fa-plus" /> New Leave Type
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : rows.length === 0 ? (
          <div className="card">
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              <i className="fas fa-calendar-plus" style={{ fontSize: 28, display: 'block', marginBottom: 10, opacity: 0.5 }} />
              No leave types configured — add "Casual Leave", "Sick Leave" etc. to match what employees select when requesting leave.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {rows.map((r) => (
              <div key={r.id} className="card" style={{ margin: 0, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: 5, height: '100%', background: accentFor(r.name) }} />
                <div style={{ padding: '16px 18px 16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        <span className={`badge ${r.is_paid ? 'badge-success' : 'badge-secondary'}`}>
                          {r.is_paid ? 'Paid' : 'Unpaid / LOP'}
                        </span>
                        <span className={`badge ${r.is_active ? 'badge-info' : 'badge-secondary'}`}>
                          {r.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {r.is_unlimited && <span className="badge badge-purple">Unlimited</span>}
                        {r.encashable && <span className="badge badge-teal">Encashable</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button className="btn btn-outline btn-icon btn-sm" title="Edit" onClick={() => openModal(r)}><i className="fas fa-edit" /></button>
                      <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} title="Delete" onClick={() => handleDelete(r.id)}><i className="fas fa-trash" /></button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 8px', fontSize: 12.5, borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>Annual Quota</div>
                      <div style={{ fontWeight: 600 }}>{r.is_unlimited ? 'Unlimited' : (r.annual_quota ?? 0)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>Accrual</div>
                      <div style={{ fontWeight: 600 }}>{r.accrual_frequency === 'none' ? '—' : `${r.accrual_days}/${r.accrual_frequency === 'monthly' ? 'mo' : 'yr'}`}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>Carry Forward</div>
                      <div style={{ fontWeight: 600 }}>{r.carry_forward ? `Up to ${r.max_carry_forward_days} days` : '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>Max Continuous</div>
                      <div style={{ fontWeight: 600 }}>{r.max_continuous_days || '—'}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
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

        <div className="form-group">
          <label className="form-label">Deduction Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`btn btn-sm ${form.is_paid ? 'btn-success' : 'btn-outline'}`}
              style={{ flex: 1 }}
              onClick={() => setForm({ ...form, is_paid: true })}
            >
              <i className="fas fa-wallet" /> Paid
            </button>
            <button
              type="button"
              className={`btn btn-sm ${!form.is_paid ? 'btn-danger' : 'btn-outline'}`}
              style={{ flex: 1 }}
              onClick={() => setForm({ ...form, is_paid: false })}
            >
              <i className="fas fa-ban" /> Unpaid / LOP
            </button>
          </div>
          <div className="form-hint">
            {form.is_paid
              ? 'Deducted from the employee\'s leave balance — no salary impact.'
              : 'Treated as Loss of Pay — reduces salary for the days taken.'}
          </div>
        </div>

        <div className="form-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={form.encashable} onChange={(e) => setForm({ ...form, encashable: e.target.checked })} disabled={form.is_unlimited} /> Encashable
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
          </label>
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={form.is_unlimited} onChange={(e) => setForm({ ...form, is_unlimited: e.target.checked })} /> Unlimited (e.g. Unpaid Leave) — never blocked by a balance, no accrual/quota
          </label>
        </div>
        {!form.is_unlimited && (
          <>
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
          </>
        )}
      </Modal>
    </>
  );
}
