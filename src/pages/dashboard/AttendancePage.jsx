import React from 'react';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import {
  fetchTeamAttendance, fetchAllTenantAttendance, saveManualAttendance, fetchAttendanceAuditLog,
} from '@/services/attendanceService';
import { todayStr, fmtTime12, fmtDuration, getInitials, getAvatarColor, fullName, scopedToOutlet } from '@/lib/helpers';

export default function AttendancePage() {
  const { profile, tenant } = useAuth();
  const { outletProfileIds } = useOutletView();
  const [tab, setTab] = useState('team');

  // Team view
  const [teamDate, setTeamDate] = useState(todayStr());
  const [teamDept, setTeamDept] = useState('');
  const [teamData, setTeamData] = useState([]);
  const [departments, setDepartments] = useState([]);

  // Monthly avg hours (for whichever month teamDate falls in)
  const [monthlyAtt, setMonthlyAtt] = useState([]);

  // Manual attendance modal
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ profile_id: '', date: todayStr(), clockIn: '', clockOut: '', status: 'Present', reason: '' });
  const [employees, setEmployees] = useState([]);

  // Audit log
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchMonthlyAvg = useCallback(async () => {
    if (!tenant) return;
    const d = new Date(teamDate);
    const { data } = await fetchAllTenantAttendance(tenant.id, d.getFullYear(), d.getMonth());
    setMonthlyAtt(data);
  }, [tenant, teamDate]);

  useEffect(() => { if (tab === 'team') fetchMonthlyAvg(); }, [tab, fetchMonthlyAvg]);

  const fetchTeamData = useCallback(async () => {
    if (!tenant) return;
    const { employees: allEmps, departments: depts, records: attRecords } = await fetchTeamAttendance(tenant.id, teamDate);
    const emps = scopedToOutlet(allEmps, outletProfileIds, 'id');
    setEmployees(emps);
    setDepartments(depts);

    let filtered = emps;
    if (teamDept) filtered = filtered.filter((e) => e.department === teamDept);

    const records = {};
    attRecords.forEach((r) => { records[r.profile_id] = r; });

    const rows = filtered.map((emp) => {
      const rec = records[emp.id];
      let clockInT = '—', clockOutT = '—', hours = '—', status = 'Absent', badgeCls = 'badge-danger';
      if (rec?.punches?.length) {
        const sorted = [...rec.punches].sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const firstIn = sorted.find((p) => p.punch_type === 'in');
        const lastOut = [...sorted].reverse().find((p) => p.punch_type === 'out');
        if (firstIn) clockInT = fmtTime12(firstIn.punch_time);
        if (lastOut) clockOutT = fmtTime12(lastOut.punch_time);
        hours = rec.total_hours ? fmtDuration(rec.total_hours) : '—';
        status = rec.status || 'Present';
        if (status === 'Present' || status === 'Late') badgeCls = 'badge-success';
        else if (status === 'Half Day') badgeCls = 'badge-warning';
        else if (status === 'Leave') badgeCls = 'badge-purple';
      } else {
        const d = new Date(teamDate);
        if (d.getDay() === 0 || d.getDay() === 6) { status = 'Weekend'; badgeCls = 'badge-info'; }
      }
      return { ...emp, clockInT, clockOutT, hours, status, badgeCls, outOfGeofence: rec?.out_of_geofence || false };
    });

    setTeamData(rows);
  }, [tenant, teamDate, teamDept, outletProfileIds]);

  useEffect(() => { if (tab === 'team') fetchTeamData(); }, [tab, fetchTeamData]);

  const fetchAuditLogs = useCallback(async () => {
    if (!tenant) return;
    setAuditLoading(true);
    try {
      const { data } = await fetchAttendanceAuditLog(tenant.id);
      setAuditLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setAuditLoading(false);
    }
  }, [tenant]);

  useEffect(() => { if (tab === 'audit') fetchAuditLogs(); }, [tab, fetchAuditLogs]);

  const handleSaveManual = async () => {
    if (!manualForm.profile_id || !manualForm.date) return showToast('Employee and date required', 'error');
    if (!manualForm.reason.trim()) return showToast('Reason is required for manual attendance changes', 'error');
    try {
      await saveManualAttendance(tenant.id, {
        profile_id: manualForm.profile_id,
        date: manualForm.date,
        clockIn: manualForm.clockIn,
        clockOut: manualForm.clockOut,
        status: manualForm.status,
        reason: manualForm.reason,
      }, profile.id);
      showToast('Attendance marked & audit logged', 'success');
      setShowManual(false);
      fetchTeamData();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    }
  };

  // Team summary
  const teamPresent = teamData.filter((r) => r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day').length;
  const teamAbsent = teamData.filter((r) => r.status === 'Absent').length;
  const teamLate = teamData.filter((r) => r.status === 'Late').length;

  // Per-employee avg daily hours + days-with-hours, for the month teamDate falls in
  const monthlyStatsByProfile = useMemo(() => {
    const sums = {};
    monthlyAtt.forEach((r) => {
      if (!r.total_hours) return;
      if (!sums[r.profile_id]) sums[r.profile_id] = { total: 0, days: 0 };
      sums[r.profile_id].total += r.total_hours;
      sums[r.profile_id].days += 1;
    });
    return sums;
  }, [monthlyAtt]);

  // Team-wide avg daily hours this month — weighted across every recorded day,
  // so an employee who logged more days doesn't get diluted to the same weight
  // as one who logged one.
  const teamAvgHours = useMemo(() => {
    let total = 0, days = 0;
    Object.values(monthlyStatsByProfile).forEach((s) => { total += s.total; days += s.days; });
    return days > 0 ? total / days : 0;
  }, [monthlyStatsByProfile]);

  const monthLabelForTeamDate = new Date(teamDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <>
      <Header title="Attendance" breadcrumb="Team attendance & working hours" />
      <div className="page-content">
        {/* Tabs */}
        <div className="tabs">
          {['team', 'audit'].map((t) => (
            <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'team' ? 'Team View' : 'Audit Log'}
            </button>
          ))}
        </div>

        {/* TEAM VIEW TAB */}
        {tab === 'team' && (
          <>
            <div className="filter-bar">
              <select className="form-select" value={teamDept} onChange={(e) => setTeamDept(e.target.value)}>
                <option value="">All Departments</option>
                {departments.map((d) => <option key={d}>{d}</option>)}
              </select>
              <input className="form-input" type="date" value={teamDate} onChange={(e) => setTeamDate(e.target.value)} style={{ width: 'auto' }} />
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn btn-primary" onClick={() => { setManualForm({ profile_id: '', date: teamDate, clockIn: tenant?.shift_start || '', clockOut: tenant?.shift_end || '', status: 'Present', reason: '' }); setShowManual(true); }}>
                  <i className="fas fa-plus" /> Mark Attendance
                </button>
              </div>
            </div>

            <div className="att-summary-bar">
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--success)' }}>{teamPresent}</div><div className="att-s-lbl">Present</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--danger)' }}>{teamAbsent}</div><div className="att-s-lbl">Absent</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--accent)' }}>{teamLate}</div><div className="att-s-lbl">Late</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--primary)' }}>{teamData.length}</div><div className="att-s-lbl">Total Staff</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--success)' }}>{teamData.length > 0 ? Math.round(teamPresent / teamData.length * 100) : 0}%</div><div className="att-s-lbl">Attendance %</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--purple)' }}>{teamData.filter((r) => r.status === 'Leave').length}</div><div className="att-s-lbl">On Leave</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--primary)' }}>{fmtDuration(teamAvgHours)}</div><div className="att-s-lbl">Team Avg Hours/Day ({monthLabelForTeamDate})</div></div>
            </div>

            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Employee</th><th>Department</th><th>Clock In</th><th>Clock Out</th><th>Working Hours</th><th>Status</th><th>Avg Hours/Day ({monthLabelForTeamDate})</th><th>Days Present ({monthLabelForTeamDate})</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {teamData.length === 0 ? (
                      <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No employees found</td></tr>
                    ) : teamData.map((r) => {
                      const monthStat = monthlyStatsByProfile[r.id];
                      const avgHoursThisMonth = monthStat ? monthStat.total / monthStat.days : 0;
                      return (
                      <tr key={r.id}>
                        <td>
                          <div className="emp-cell">
                            <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(r.id)})` }}>{getInitials(r.first_name, r.last_name)}</div>
                            <div><div className="emp-name">{fullName(r)}</div><div className="emp-role">{r.essl_employee_code ? `ESSL: ${r.essl_employee_code}` : '—'}</div></div>
                          </div>
                        </td>
                        <td>{r.department || '—'}</td>
                        <td>{r.clockInT}</td>
                        <td>{r.clockOutT}</td>
                        <td>{r.hours}</td>
                        <td>
                          <span className={`badge ${r.badgeCls}`}>{r.status}</span>
                          {r.outOfGeofence && (
                            <i className="fas fa-map-marker-alt" style={{ marginLeft: 6, color: 'var(--warning)' }} title="Punch was outside the configured geofence" />
                          )}
                        </td>
                        <td>{monthStat ? fmtDuration(avgHoursThisMonth) : '—'}</td>
                        <td>{monthStat ? monthStat.days : 0}</td>
                        <td>
                          <button className="btn btn-outline btn-sm" onClick={() => { setManualForm({ profile_id: r.id, date: teamDate, clockIn: tenant?.shift_start || '', clockOut: tenant?.shift_end || '', status: 'Present', reason: '' }); setShowManual(true); }}>
                            <i className="fas fa-edit" />
                          </button>
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

        {/* AUDIT LOG TAB */}
        {tab === 'audit' && (
          <>
            <div className="card">
              <div className="card-header">
                <h3><i className="fas fa-history" style={{ marginRight: 8 }} />Attendance Change History</h3>
                <button className="btn btn-outline btn-sm" onClick={fetchAuditLogs}><i className="fas fa-sync" /> Refresh</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Employee</th>
                      <th>Action</th>
                      <th>Old Status</th>
                      <th>New Status</th>
                      <th>Hours</th>
                      <th>Changed By</th>
                      <th>Reason</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLoading ? (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading audit log...</td></tr>
                    ) : auditLogs.length === 0 ? (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No manual attendance changes recorded yet.</td></tr>
                    ) : auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{log.date}</td>
                        <td>
                          <div className="emp-cell">
                            <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(log.profile_id)})`, width: 28, height: 28, fontSize: 10 }}>
                              {getInitials(log.target_profile?.first_name, log.target_profile?.last_name)}
                            </div>
                            <span className="emp-name" style={{ fontSize: 12 }}>{fullName(log.target_profile)}</span>
                          </div>
                        </td>
                        <td><span className={`badge ${log.action === 'create' ? 'badge-success' : 'badge-warning'}`}>{log.action === 'create' ? 'Created' : 'Updated'}</span></td>
                        <td style={{ color: 'var(--text-muted)' }}>{log.old_status || '—'}</td>
                        <td><strong>{log.new_status}</strong></td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.old_hours != null ? `${log.old_hours}h` : '—'} → {log.new_hours != null ? `${log.new_hours}h` : '—'}</td>
                        <td style={{ fontSize: 12 }}>{fullName(log.changed_by_profile)}</td>
                        <td style={{ fontSize: 11, maxWidth: 200, whiteSpace: 'normal' }}>{log.reason || '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Manual Attendance Modal */}
      <Modal show={showManual} onClose={() => setShowManual(false)} title="Mark Attendance" width="480px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowManual(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveManual}><i className="fas fa-check" /> Save</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Employee *</label>
          <select className="form-select" value={manualForm.profile_id} onChange={(e) => setManualForm({ ...manualForm, profile_id: e.target.value })}>
            <option value="">Select</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Date *</label>
          <input className="form-input" type="date" value={manualForm.date} onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Clock In</label><input className="form-input" type="time" value={manualForm.clockIn} onChange={(e) => setManualForm({ ...manualForm, clockIn: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Clock Out</label><input className="form-input" type="time" value={manualForm.clockOut} onChange={(e) => setManualForm({ ...manualForm, clockOut: e.target.value })} /></div>
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select" value={manualForm.status} onChange={(e) => setManualForm({ ...manualForm, status: e.target.value })}>
            <option>Present</option><option>Absent</option><option>Half Day</option><option>Leave</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-input" rows={2} placeholder="e.g. Forgot to clock in, Admin override, late arrival correction..." value={manualForm.reason} onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })} style={{ resize: 'vertical' }} />
        </div>
      </Modal>
    </>
  );
}
