import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { fetchTenantLeaveBalances, listLeaveTypes, allocateLeave, recordLeaveEncashment, fetchLeaveLedgerHistory } from '@/services/leaveLedgerService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName, getInitials, getAvatarColor, scopedToOutlet } from '@/lib/helpers';

export default function LeaveBalancesPage() {
  const { tenant } = useAuth();
  const { outletProfileIds } = useOutletView();
  const [balances, setBalances]   = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [allocateFor, setAllocateFor] = useState(null); // { profile, leaveType }
  const [allocateDays, setAllocateDays] = useState('');
  const [encashFor, setEncashFor] = useState(null);
  const [encashDays, setEncashDays] = useState('');
  const [encashAmount, setEncashAmount] = useState('');
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [balRes, typesRes, empRes] = await Promise.all([
        fetchTenantLeaveBalances(tenant.id),
        listLeaveTypes(tenant.id),
        listActiveEmployees(tenant.id),
      ]);
      setBalances(scopedToOutlet(balRes.data, outletProfileIds));
      setLeaveTypes(typesRes.data);
      setEmployees(scopedToOutlet(empRes.data, outletProfileIds, 'id'));
    } finally {
      setLoading(false);
    }
  }, [tenant, outletProfileIds]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Every employee × every active leave type, joined against whatever ledger rows already exist (balance defaults to 0).
  const grid = employees.flatMap((emp) =>
    leaveTypes.filter((lt) => lt.is_active).map((lt) => {
      const bal = balances.find((b) => b.profile_id === emp.id && b.leave_type_id === lt.id);
      return { emp, leaveType: lt, balance: bal?.balance || 0 };
    })
  );

  const doAllocate = async () => {
    if (!allocateDays) return showToast('Enter a number of days', 'error');
    const { error } = await allocateLeave(allocateFor.emp.id, allocateFor.leaveType.id, parseFloat(allocateDays), 'Manual allocation');
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Allocated', 'success');
    setAllocateFor(null);
    setAllocateDays('');
    fetchData();
  };

  const doEncash = async () => {
    if (!encashDays || !encashAmount) return showToast('Enter days and amount', 'error');
    const now = new Date();
    const { error } = await recordLeaveEncashment(encashFor.emp.id, encashFor.leaveType.id, parseFloat(encashDays), parseFloat(encashAmount), now.getMonth() + 1, now.getFullYear());
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Encashed — added to this month\'s one-off pay items', 'success');
    setEncashFor(null);
    setEncashDays('');
    setEncashAmount('');
    fetchData();
  };

  const openHistory = async (emp, leaveType) => {
    setHistoryFor({ emp, leaveType });
    const { data } = await fetchLeaveLedgerHistory(emp.id, leaveType.id);
    setHistory(data);
  };

  return (
    <>
      <Header title="Leave Balances" breadcrumb="Ledger-derived balances — every allocation, accrual, deduction and encashment is a permanent entry" />
      <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : leaveTypes.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            No leave types configured yet — set them up on the Leave Types page first.
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Leave Type</th><th>Balance</th><th>Actions</th></tr></thead>
                <tbody>
                  {grid.map(({ emp, leaveType, balance }) => (
                    <tr key={emp.id + leaveType.id}>
                      <td>
                        <div className="emp-cell">
                          <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(emp.id)})` }}>{getInitials(emp.first_name, emp.last_name)}</div>
                          <div><div className="emp-name">{fullName(emp)}</div></div>
                        </div>
                      </td>
                      <td>{leaveType.name}</td>
                      <td><strong>{balance}</strong> days</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => setAllocateFor({ emp, leaveType })}>Allocate</button>
                          {leaveType.encashable && (
                            <button className="btn btn-outline btn-sm" onClick={() => setEncashFor({ emp, leaveType })} disabled={balance <= 0}>Encash</button>
                          )}
                          <button className="btn btn-outline btn-icon btn-sm" title="History" onClick={() => openHistory(emp, leaveType)}><i className="fas fa-history" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={!!allocateFor} onClose={() => setAllocateFor(null)} title={`Allocate — ${allocateFor?.leaveType.name}`} width="360px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setAllocateFor(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={doAllocate}>Allocate</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">{allocateFor && fullName(allocateFor.emp)} — Days to allocate (negative to correct downward)</label>
          <input className="form-input" type="number" value={allocateDays} onChange={(e) => setAllocateDays(e.target.value)} autoFocus />
        </div>
      </Modal>

      <Modal show={!!encashFor} onClose={() => setEncashFor(null)} title={`Encash — ${encashFor?.leaveType.name}`} width="360px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setEncashFor(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={doEncash}>Encash</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Days to encash</label>
          <input className="form-input" type="number" value={encashDays} onChange={(e) => setEncashDays(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Payout Amount (₹)</label>
          <input className="form-input" type="number" value={encashAmount} onChange={(e) => setEncashAmount(e.target.value)} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Applied to this month's One-Off Pay Items — flows into the next payroll run.</div>
      </Modal>

      <Modal show={!!historyFor} onClose={() => setHistoryFor(null)} title={`Ledger — ${historyFor?.leaveType.name}`} width="480px"
        footer={<button className="btn btn-outline" onClick={() => setHistoryFor(null)}>Close</button>}
      >
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Days</th><th>Note</th></tr></thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>No ledger entries yet</td></tr>
              ) : history.map((h) => (
                <tr key={h.id}>
                  <td>{h.effective_date}</td>
                  <td><span className="badge badge-info">{h.entry_type}</span></td>
                  <td style={{ color: h.days >= 0 ? 'var(--success)' : 'var(--danger)' }}>{h.days > 0 ? '+' : ''}{h.days}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
