import React, { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchGroupDashboard, fetchGroupEmployees,
  transferEmployee, fetchTransferHistory,
} from '@/services/groupService';
import { getInitials, getAvatarColor, fullName } from '@/lib/helpers';

const PALETTE = [
  { bg: 'var(--primary-light)', fg: 'var(--primary)',  bar: 'var(--primary)'  },
  { bg: 'var(--success-light)', fg: 'var(--success)',  bar: 'var(--success)'  },
  { bg: '#ede9fe',              fg: '#7c3aed',         bar: '#7c3aed'         },
  { bg: 'var(--warning-light)', fg: 'var(--warning)',  bar: 'var(--warning)'  },
  { bg: 'var(--danger-light)',  fg: 'var(--danger)',   bar: 'var(--danger)'   },
  { bg: '#fce7f3',              fg: '#be185d',         bar: '#be185d'         },
];

function fmtMoney(n, currency = '₹') {
  if (!n || n === 0) return null;
  if (n >= 100000) return `${currency}${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `${currency}${(n / 1000).toFixed(1)}K`;
  return `${currency}${n}`;
}

function buildNewEmployeeId(currentId, destLocationCode) {
  if (!currentId || currentId.length < 4) return currentId || '';
  const outletCode = currentId.slice(0, 2);
  const suffix     = currentId.slice(4);
  const locCode    = (destLocationCode || '').slice(0, 2).toUpperCase().padEnd(2, 'X');
  return outletCode + locCode + suffix;
}

// ── Transfer modal ────────────────────────────────────────────────────────────
function TransferModal({ show, onClose, employee, outlets, onTransferred }) {
  const [destId,      setDestId]      = useState('');
  const [newEmpId,    setNewEmpId]    = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [notes,       setNotes]       = useState('');
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    if (show) { setDestId(''); setNewEmpId(''); setNewLocation(''); setNotes(''); }
  }, [show]);

  const destOutlets = (outlets || []).filter(o => o.id !== employee?.tenant_id);

  const handleDestChange = (id) => {
    setDestId(id);
    const dest = destOutlets.find(o => o.id === id);
    if (dest) {
      setNewEmpId(buildNewEmployeeId(employee?.employee_id || '', dest.location_code));
      setNewLocation(dest.company_name || '');
    }
  };

  const handleSave = async () => {
    if (!destId) return showToast('Select destination branch', 'warning');
    setSaving(true);
    const { error } = await transferEmployee({
      profileId:      employee.id,
      fromTenantId:   employee.tenant_id,
      toTenantId:     destId,
      newEmployeeId:  newEmpId,
      outletLocation: newLocation,
      notes,
    });
    setSaving(false);
    if (error) return showToast('Transfer failed: ' + error.message, 'error');
    showToast(`${employee.first_name} transferred successfully`, 'success');
    onClose();
    onTransferred();
  };

  return (
    <Modal show={show} onClose={onClose} title="Transfer Employee" width="500px"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !destId}>
          {saving
            ? <><div className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} /> Transferring…</>
            : <><i className="fas fa-exchange-alt" /> Transfer</>}
        </button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Employee card */}
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(135deg, ${getAvatarColor(employee?.id || '')})`,
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 15,
          }}>
            {getInitials(employee?.first_name, employee?.last_name)}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{fullName(employee)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{employee?.company_name}</div>
            {employee?.employee_id && (
              <code style={{ fontSize: 11, color: 'var(--primary)', background: 'var(--primary-light)', padding: '1px 6px', borderRadius: 4, marginTop: 2, display: 'inline-block' }}>
                {employee.employee_id}
              </code>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Transfer To Branch *</label>
          <select className="form-select" value={destId} onChange={e => handleDestChange(e.target.value)}>
            <option value="">Select destination branch</option>
            {destOutlets.map(o => (
              <option key={o.id} value={o.id}>
                {o.company_name}{o.location_code ? ` (${o.location_code})` : ''}
              </option>
            ))}
          </select>
        </div>

        {destId && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">New Employee ID</label>
              <input
                className="form-input"
                value={newEmpId}
                onChange={e => setNewEmpId(e.target.value.toUpperCase())}
                placeholder="Auto-computed"
                style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}
              />
              <div className="form-hint">Outlet code stays, location code updates to destination.</div>
            </div>
            <div className="form-group">
              <label className="form-label">Outlet Location Name</label>
              <input className="form-input" value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="e.g. Mumbai" />
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Transfer Notes</label>
          <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional reason for transfer" />
        </div>

        <div style={{ background: 'var(--warning-light)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 8 }}>
          <i className="fas fa-info-circle" style={{ marginTop: 1, flexShrink: 0 }} />
          Historical attendance, payroll, and leave records remain in the current branch. Future records will be under the new branch.
        </div>
      </div>
    </Modal>
  );
}

// ── Transfer history modal ────────────────────────────────────────────────────
function TransferHistoryModal({ show, onClose, employee }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show || !employee?.id) return;
    setLoading(true);
    fetchTransferHistory(employee.id).then(({ data }) => {
      setHistory(data || []);
      setLoading(false);
    });
  }, [show, employee?.id]);

  return (
    <Modal show={show} onClose={onClose} title="Transfer History" width="560px"
      footer={<button className="btn btn-outline" onClick={onClose}>Close</button>}
    >
      <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 13 }}>
        {fullName(employee)}
        {employee?.employee_id && (
          <code style={{ marginLeft: 8, fontSize: 11, color: 'var(--primary)', background: 'var(--primary-light)', padding: '1px 6px', borderRadius: 4 }}>
            {employee.employee_id}
          </code>
        )}
      </div>
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading history…
        </div>
      ) : history.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <i className="fas fa-history" style={{ fontSize: 24, marginBottom: 10, display: 'block' }} />
          No transfer history found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {history.map((h, i) => (
            <div key={h.id || i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{h.from_branch}</span>
                  <i className="fas fa-arrow-right" style={{ color: 'var(--primary)', fontSize: 11 }} />
                  <span style={{ color: 'var(--primary)' }}>{h.to_branch}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(h.transferred_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
                {h.from_employee_id && (
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>Old ID: </span>
                    <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4 }}>{h.from_employee_id}</code>
                  </span>
                )}
                {h.to_employee_id && (
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>New ID: </span>
                    <code style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '1px 5px', borderRadius: 4 }}>{h.to_employee_id}</code>
                  </span>
                )}
                {h.from_location && (
                  <span style={{ color: 'var(--text-muted)' }}>{h.from_location} → {h.to_location}</span>
                )}
              </div>
              {h.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>{h.notes}</div>}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>By {h.transferred_by}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GroupDashboardPage() {
  const { tenant }          = useAuth();
  const [data,    setData]  = useState(null);
  const [loading, setLoad]  = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'employees'

  // employees tab state
  const [employees,     setEmployees]     = useState([]);
  const [empLoading,    setEmpLoading]    = useState(false);
  const [empSearch,     setEmpSearch]     = useState('');
  const [empBranch,     setEmpBranch]     = useState('');
  const [empStatus,     setEmpStatus]     = useState('');
  const [transferEmp,   setTransferEmp]   = useState(null);
  const [historyEmp,    setHistoryEmp]    = useState(null);

  const load = useCallback(async () => {
    if (!tenant?.group_code) return;
    setLoad(true);
    const { data: res, error } = await fetchGroupDashboard(tenant.group_code);
    if (error) showToast('Could not load group data: ' + error.message, 'error');
    else setData(res);
    setLoad(false);
  }, [tenant]);

  const loadEmployees = useCallback(async () => {
    if (!tenant?.group_code) return;
    setEmpLoading(true);
    const { data: list, error } = await fetchGroupEmployees(tenant.group_code);
    if (error) showToast('Could not load employees: ' + error.message, 'error');
    else setEmployees(list || []);
    setEmpLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (activeTab === 'employees') loadEmployees();
  }, [activeTab, loadEmployees]);

  if (!tenant?.group_code) {
    return (
      <>
        <Header title="Group Dashboard" breadcrumb="Dashboard / Group Dashboard" />
        <div className="page-content">
          <div style={{ padding: 72, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18, background: 'var(--primary-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', fontSize: 28, color: 'var(--primary)',
            }}>
              <i className="fas fa-layer-group" />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Not linked to any group
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Go to <strong>Settings → Organization Group</strong> to create a new group<br />
              or join an existing one using a group code.
            </div>
          </div>
        </div>
      </>
    );
  }

  const outlets      = data?.outlets || [];
  const totalEmps    = outlets.reduce((s, o) => s + (o.employee_count  || 0), 0);
  const totalPresent = outlets.reduce((s, o) => s + (o.present_today   || 0), 0);
  const totalLate    = outlets.reduce((s, o) => s + (o.late_today      || 0), 0);
  const totalLeaves  = outlets.reduce((s, o) => s + (o.pending_leaves  || 0), 0);
  const totalPayroll = outlets.reduce((s, o) => s + (o.payrolls_processed || 0), 0);
  const overallPct   = totalEmps > 0 ? Math.round((totalPresent / totalEmps) * 100) : 0;

  // Filtered employees for the employees tab
  const filteredEmps = employees.filter(e => {
    if (empBranch && e.tenant_id !== empBranch) return false;
    if (empStatus && e.status !== empStatus) return false;
    if (empSearch) {
      const q = empSearch.toLowerCase();
      return (
        (e.first_name || '').toLowerCase().includes(q) ||
        (e.middle_name || '').toLowerCase().includes(q) ||
        (e.last_name  || '').toLowerCase().includes(q) ||
        (e.email      || '').toLowerCase().includes(q) ||
        (e.employee_id || '').toLowerCase().includes(q) ||
        (e.department || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <>
      <Header
        title={data?.group_name || 'Group Dashboard'}
        breadcrumb={`Dashboard / ${data?.group_name || 'Group'}`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Tab toggle */}
            <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => setActiveTab('overview')}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: activeTab === 'overview' ? 'var(--primary)' : 'transparent',
                  color: activeTab === 'overview' ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                <i className="fas fa-store" style={{ marginRight: 5 }} />Overview
              </button>
              <button
                onClick={() => setActiveTab('employees')}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: activeTab === 'employees' ? 'var(--primary)' : 'transparent',
                  color: activeTab === 'employees' ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                <i className="fas fa-users" style={{ marginRight: 5 }} />All Employees
              </button>
            </div>
            <button className="btn btn-outline btn-sm" onClick={activeTab === 'overview' ? load : loadEmployees} disabled={loading || empLoading}>
              <i className={`fas fa-sync-alt${(loading || empLoading) ? ' fa-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />

      <div className="page-content">
        {/* ── OVERVIEW TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          loading && !data ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading group data…
            </div>
          ) : (
            <>
              {/* Summary stat cards */}
              <div className="stats-row" style={{ marginBottom: 24 }}>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                    <i className="fas fa-store" />
                  </div>
                  <div>
                    <div className="stat-value">{outlets.length}</div>
                    <div className="stat-label">Outlets</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
                    <i className="fas fa-users" />
                  </div>
                  <div>
                    <div className="stat-value">{totalEmps}</div>
                    <div className="stat-label">Total Employees</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: '#ede9fe', color: '#7c3aed' }}>
                    <i className="fas fa-user-check" />
                  </div>
                  <div>
                    <div className="stat-value">
                      {totalPresent}
                      <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 5 }}>
                        {overallPct}%
                      </span>
                    </div>
                    <div className="stat-label">Present Today</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                    <i className="fas fa-clock" />
                  </div>
                  <div>
                    <div className="stat-value">{totalLate}</div>
                    <div className="stat-label">Late Today</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                    <i className="fas fa-calendar-times" />
                  </div>
                  <div>
                    <div className="stat-value">{totalLeaves}</div>
                    <div className="stat-label">Pending Leaves</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
                    <i className="fas fa-file-invoice-dollar" />
                  </div>
                  <div>
                    <div className="stat-value">{totalPayroll}</div>
                    <div className="stat-label">Payrolls Processed</div>
                  </div>
                </div>
              </div>

              {/* Combined attendance bar */}
              <div className="card" style={{ marginBottom: 24, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Combined Attendance Today</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: overallPct >= 75 ? 'var(--success)' : overallPct >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
                    {totalPresent} / {totalEmps} &nbsp;({overallPct}%)
                  </span>
                </div>
                <div style={{ height: 10, background: 'var(--border)', borderRadius: 99 }}>
                  <div style={{
                    height: '100%', width: `${overallPct}%`, borderRadius: 99,
                    background: overallPct >= 75 ? 'var(--success)' : overallPct >= 50 ? 'var(--warning)' : 'var(--danger)',
                    transition: 'width 0.6s ease',
                  }} />
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span><span style={{ color: 'var(--success)', fontWeight: 600 }}>{totalPresent}</span> present</span>
                  <span><span style={{ color: 'var(--warning)', fontWeight: 600 }}>{totalLate}</span> late</span>
                  <span><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{totalEmps - totalPresent}</span> absent / unmarked</span>
                </div>
              </div>

              {/* Outlet cards */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="fas fa-store" style={{ color: 'var(--primary)' }} />
                  All Outlets
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>({outlets.length})</span>
                </div>

                {outlets.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--card-bg)', borderRadius: 12, border: '1px solid var(--border)' }}>
                    No outlet data found. Make sure each outlet's tenant has the same group code set in Settings.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                    {outlets.map((outlet, idx) => {
                      const c   = PALETTE[idx % PALETTE.length];
                      const pct = outlet.employee_count > 0
                        ? Math.round((outlet.present_today / outlet.employee_count) * 100) : 0;
                      const advStr = fmtMoney(outlet.advances_balance, outlet.currency);
                      const isCurrent = outlet.id === tenant?.id;

                      return (
                        <div key={outlet.id} style={{
                          background: 'var(--card-bg)',
                          border: `1px solid ${isCurrent ? c.fg : 'var(--border)'}`,
                          borderRadius: 12, overflow: 'hidden',
                          boxShadow: isCurrent ? `0 0 0 1px ${c.fg}22` : undefined,
                        }}>
                          <div style={{ background: c.bg, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{
                              width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                              background: c.fg, color: '#fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 18, fontWeight: 700,
                            }}>
                              {outlet.company_name.charAt(0).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 700, fontSize: 14, color: c.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {outlet.company_name}
                                </span>
                                {isCurrent && (
                                  <span style={{ fontSize: 9, fontWeight: 700, background: c.fg, color: '#fff', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                                    THIS
                                  </span>
                                )}
                                {outlet.location_code && (
                                  <code style={{ fontSize: 9, background: c.fg + '22', color: c.fg, padding: '1px 5px', borderRadius: 4, flexShrink: 0, fontWeight: 700 }}>
                                    {outlet.location_code}
                                  </code>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: c.fg, opacity: 0.75, marginTop: 2 }}>
                                {outlet.employee_count} active employee{outlet.employee_count !== 1 ? 's' : ''}
                              </div>
                            </div>
                            {outlet.pending_leaves > 0 && (
                              <div style={{ background: 'var(--danger)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '3px 8px', flexShrink: 0 }}>
                                {outlet.pending_leaves} leave{outlet.pending_leaves !== 1 ? 's' : ''}
                              </div>
                            )}
                          </div>

                          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Today's Attendance</span>
                                <span style={{ fontWeight: 700, color: c.fg }}>{pct}%</span>
                              </div>
                              <div style={{ height: 6, background: 'var(--border)', borderRadius: 99 }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: c.bar, borderRadius: 99, transition: 'width 0.5s ease' }} />
                              </div>
                              <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
                                <span style={{ color: 'var(--success)' }}>
                                  <i className="fas fa-check-circle" style={{ marginRight: 3 }} />{outlet.present_today} present
                                </span>
                                {outlet.late_today > 0 && (
                                  <span style={{ color: 'var(--warning)' }}>
                                    <i className="fas fa-clock" style={{ marginRight: 3 }} />{outlet.late_today} late
                                  </span>
                                )}
                                {outlet.absent_today > 0 && (
                                  <span style={{ color: 'var(--danger)' }}>
                                    <i className="fas fa-times-circle" style={{ marginRight: 3 }} />{outlet.absent_today} absent
                                  </span>
                                )}
                              </div>
                            </div>

                            <div style={{ height: 1, background: 'var(--border)' }} />

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                              <div>
                                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Last Payroll</div>
                                <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                                  {outlet.last_payroll || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </div>
                              </div>
                              <div>
                                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Runs Done</div>
                                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{outlet.payrolls_processed}</div>
                              </div>
                            </div>

                            {advStr && (
                              <div style={{ fontSize: 11, color: 'var(--warning)', background: 'var(--warning-light)', padding: '5px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <i className="fas fa-hand-holding-usd" />
                                {advStr} advances outstanding
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Per-outlet attendance comparison */}
              {outlets.length > 1 && (
                <div className="card">
                  <div className="card-header">
                    <h3>Attendance Comparison</h3>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Today's attendance rate per outlet — sorted highest first</span>
                  </div>
                  <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {[...outlets]
                      .map((o, i) => ({
                        ...o,
                        pct: o.employee_count > 0 ? Math.round((o.present_today / o.employee_count) * 100) : 0,
                        color: PALETTE[i % PALETTE.length],
                      }))
                      .sort((a, b) => b.pct - a.pct)
                      .map(o => (
                        <div key={o.id}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 10, height: 10, borderRadius: '50%', background: o.color.bar, flexShrink: 0 }} />
                              <span style={{ fontWeight: 500 }}>{o.company_name}</span>
                              {o.id === tenant?.id && (
                                <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--primary)', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>
                                  THIS
                                </span>
                              )}
                              {o.location_code && (
                                <code style={{ fontSize: 9, color: o.color.fg, background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                                  {o.location_code}
                                </code>
                              )}
                            </div>
                            <span style={{ fontWeight: 700, color: o.color.fg }}>{o.pct}%</span>
                          </div>
                          <div style={{ height: 8, background: 'var(--border)', borderRadius: 99 }}>
                            <div style={{ height: '100%', width: `${o.pct}%`, background: o.color.bar, borderRadius: 99, transition: 'width 0.6s ease' }} />
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            {o.present_today} of {o.employee_count} present
                            {o.late_today > 0 && <span style={{ marginLeft: 10, color: 'var(--warning)' }}>{o.late_today} late</span>}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )
        )}

        {/* ── EMPLOYEES TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'employees' && (
          <>
            {/* Filters */}
            <div className="filter-bar" style={{ marginBottom: 16 }}>
              <select className="form-select" value={empBranch} onChange={e => setEmpBranch(e.target.value)}>
                <option value="">All Branches</option>
                {outlets.map(o => (
                  <option key={o.id} value={o.id}>{o.company_name}</option>
                ))}
              </select>
              <select className="form-select" value={empStatus} onChange={e => setEmpStatus(e.target.value)}>
                <option value="">All Status</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <input
                className="form-input"
                placeholder="Search name, email, employee ID, department…"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                style={{ minWidth: 240 }}
              />
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                {filteredEmps.length} of {employees.length} employees
              </span>
            </div>

            {empLoading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading employees…
              </div>
            ) : (
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Branch</th>
                        <th>Department</th>
                        <th>Designation</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmps.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                            {empSearch || empBranch || empStatus
                              ? 'No employees match your filters.'
                              : 'No employees found in this group.'}
                          </td>
                        </tr>
                      ) : filteredEmps.map((e) => {
                        const outletIdx = outlets.findIndex(o => o.id === e.tenant_id);
                        const c = PALETTE[(outletIdx >= 0 ? outletIdx : 0) % PALETTE.length];
                        return (
                          <tr key={e.id}>
                            <td>
                              <div className="emp-cell">
                                <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(e.id)})` }}>
                                  {getInitials(e.first_name, e.last_name)}
                                </div>
                                <div>
                                  <div className="emp-name">{fullName(e)}</div>
                                  <div className="emp-role">{e.email}</div>
                                  {e.employee_id && (
                                    <code style={{ fontSize: 10, color: 'var(--primary)', background: 'var(--primary-light)', padding: '0 5px', borderRadius: 3, marginTop: 2, display: 'inline-block' }}>
                                      {e.employee_id}
                                    </code>
                                  )}
                                  {e.outlet_location && (
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{e.outlet_location}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span style={{
                                fontSize: 11, fontWeight: 600,
                                background: c.bg, color: c.fg,
                                padding: '3px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                              }}>
                                {e.company_name}
                                {e.location_code && <code style={{ fontSize: 9, opacity: 0.8 }}>{e.location_code}</code>}
                              </span>
                            </td>
                            <td>{e.department || '—'}</td>
                            <td>{e.designation || '—'}</td>
                            <td>
                              <span className={`badge ${e.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>
                                {e.status}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  className="btn btn-outline btn-icon btn-sm"
                                  title="Transfer to another branch"
                                  style={{ color: 'var(--primary)' }}
                                  onClick={() => setTransferEmp(e)}
                                >
                                  <i className="fas fa-exchange-alt" />
                                </button>
                                <button
                                  className="btn btn-outline btn-icon btn-sm"
                                  title="Transfer history"
                                  style={{ color: 'var(--text-muted)' }}
                                  onClick={() => setHistoryEmp(e)}
                                >
                                  <i className="fas fa-history" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <TransferModal
        show={!!transferEmp}
        onClose={() => setTransferEmp(null)}
        employee={transferEmp}
        outlets={outlets}
        onTransferred={() => {
          load();
          loadEmployees();
        }}
      />

      <TransferHistoryModal
        show={!!historyEmp}
        onClose={() => setHistoryEmp(null)}
        employee={historyEmp}
      />
    </>
  );
}
