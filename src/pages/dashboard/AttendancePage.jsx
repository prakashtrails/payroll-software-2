import React from 'react';
import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMyMonthAttendance, clockIn as svcClockIn, clockOut as svcClockOut,
  fetchTeamAttendance, saveManualAttendance, fetchAttendanceAuditLog,
} from '@/services/attendanceService';
import { todayStr, dateStr, timeStr, fmtTime12, diffHours, fmtDuration, monthLabel, getInitials, getAvatarColor } from '@/lib/helpers';

export default function AttendancePage() {
  const { profile, tenant } = useAuth();
  const [tab, setTab] = useState('my');
  const [attMonth, setAttMonth] = useState(new Date().getMonth());
  const [attYear, setAttYear] = useState(new Date().getFullYear());

  // My Attendance
  const [myRecords, setMyRecords] = useState([]);
  const [myPunches, setMyPunches] = useState({});
  const [liveClock, setLiveClock] = useState('');
  const [liveDate, setLiveDate] = useState('');
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const [isClockedIn, setIsClockedIn] = useState(false);
  const clockRef = useRef(null);
  const timerRef = useRef(null);

  // Team view
  const [teamDate, setTeamDate] = useState(todayStr());
  const [teamDept, setTeamDept] = useState('');
  const [teamData, setTeamData] = useState([]);
  const [departments, setDepartments] = useState([]);

  // Manual attendance modal
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ profile_id: '', date: todayStr(), clockIn: '09:00', clockOut: '18:00', status: 'Present', reason: '' });
  const [employees, setEmployees] = useState([]);

  // Audit log
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchMyAttendance = useCallback(async () => {
    if (!profile || !tenant) return;
    const { data } = await fetchMyMonthAttendance(profile.id, attYear, attMonth);
    setMyRecords(data);
    const todayRec = data.find((r) => r.date === todayStr());
    if (todayRec) {
      const ins  = (todayRec.punches || []).filter((p) => p.punch_type === 'in').length;
      const outs = (todayRec.punches || []).filter((p) => p.punch_type === 'out').length;
      setIsClockedIn(ins > outs);
      setMyPunches(todayRec);
    } else {
      setIsClockedIn(false);
      setMyPunches({});
    }
  }, [profile, tenant, attMonth, attYear]);

  useEffect(() => { fetchMyAttendance(); }, [fetchMyAttendance]);

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setLiveClock(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setLiveDate(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    };
    tick();
    clockRef.current = setInterval(tick, 1000);
    return () => clearInterval(clockRef.current);
  }, []);

  // Work timer
  useEffect(() => {
    const tickTimer = () => {
      const todayRec = myPunches;
      if (!todayRec?.punches?.length) { setTimerDisplay('00:00:00'); return; }
      const sorted = [...todayRec.punches].sort((a, b) => a.punch_time.localeCompare(b.punch_time));
      let totalSecs = 0;
      const ins = sorted.filter((p) => p.punch_type === 'in');
      const outs = sorted.filter((p) => p.punch_type === 'out');
      for (let i = 0; i < ins.length; i++) {
        const outTime = outs[i]?.punch_time || timeStr(new Date());
        totalSecs += diffHours(ins[i].punch_time, outTime) * 3600;
      }
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = Math.floor(totalSecs % 60);
      setTimerDisplay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tickTimer();
    timerRef.current = setInterval(tickTimer, 1000);
    return () => clearInterval(timerRef.current);
  }, [myPunches]);

  const clockIn = async () => {
    if (isClockedIn) return showToast('Already clocked in!', 'warning');
    try {
      await svcClockIn(tenant.id, profile.id, tenant);
      showToast(`Clocked in at ${fmtTime12(timeStr(new Date()))}`, 'success');
      fetchMyAttendance();
    } catch (err) {
      showToast('Clock in failed: ' + err.message, 'error');
    }
  };

  const clockOut = async () => {
    if (!isClockedIn) return showToast('Not clocked in!', 'warning');
    try {
      const { total } = await svcClockOut(profile.id);
      showToast(`Clocked out. Worked ${fmtDuration(total)}`, 'success');
      fetchMyAttendance();
    } catch (err) {
      showToast('Clock out failed: ' + err.message, 'error');
    }
  };

  const fetchTeamData = useCallback(async () => {
    if (!tenant) return;
    const { employees: emps, departments: depts, records: attRecords } = await fetchTeamAttendance(tenant.id, teamDate);
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
      return { ...emp, clockInT, clockOutT, hours, status, badgeCls };
    });

    setTeamData(rows);
  }, [tenant, teamDate, teamDept]);

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

  // Calendar rendering
  const changeMonth = (delta) => {
    let m = attMonth + delta, y = attYear;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setAttMonth(m); setAttYear(y);
  };

  const renderCalendar = () => {
    const firstDay = new Date(attYear, attMonth, 1).getDay();
    const daysInMonth = new Date(attYear, attMonth + 1, 0).getDate();
    const today = new Date();
    const cells = [];

    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) =>
      cells.push(<div className="att-cal-header" key={'h-' + d}>{d}</div>)
    );

    for (let i = 0; i < firstDay; i++) cells.push(<div className="att-cal-day empty" key={'e-' + i} />);

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(attYear, attMonth, d);
      const ds = dateStr(date);
      const isToday = d === today.getDate() && attMonth === today.getMonth() && attYear === today.getFullYear();
      const isFuture = date > today;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const rec = myRecords.find((r) => r.date === ds);

      let cls = '', hoursStr = '';
      if (isFuture) cls = 'future';
      else if (isWeekend) cls = 'weekend';
      else if (rec) {
        const st = rec.status?.toLowerCase().replace(/\s/g, '-') || 'present';
        cls = st;
        if (rec.total_hours) hoursStr = fmtDuration(rec.total_hours);
        else if (rec.punches?.length) hoursStr = 'In progress';
      } else if (!isFuture && !isToday) {
        cls = 'absent';
      }
      if (isToday) cls += ' today';

      cells.push(
        <div className={`att-cal-day ${cls}`} key={d}>
          <div className="day-num">{d}</div>
          {hoursStr && <div className="day-hours">{hoursStr}</div>}
        </div>
      );
    }
    return cells;
  };

  // Summary stats
  const summary = { present: 0, absent: 0, halfDay: 0, late: 0, leaves: 0, totalHours: 0 };
  const today = new Date();
  const daysInMonth = new Date(attYear, attMonth + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(attYear, attMonth, d);
    if (date > today || date.getDay() === 0 || date.getDay() === 6) continue;
    const ds = dateStr(date);
    const rec = myRecords.find((r) => r.date === ds);
    if (!rec?.status) { if (date < today) summary.absent++; continue; }
    if (rec.status === 'Present') summary.present++;
    else if (rec.status === 'Late') { summary.late++; summary.present++; }
    else if (rec.status === 'Half Day') summary.halfDay++;
    else if (rec.status === 'Leave') summary.leaves++;
    else if (rec.status === 'Absent') summary.absent++;
    summary.totalHours += rec.total_hours || 0;
  }

  // Team summary
  const teamPresent = teamData.filter((r) => r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day').length;
  const teamAbsent = teamData.filter((r) => r.status === 'Absent').length;
  const teamLate = teamData.filter((r) => r.status === 'Late').length;

  return (
    <>
      <Header title="Attendance" breadcrumb="Track attendance and clock in/out" />
      <div className="page-content">
        {/* Clock Widget */}
        <div className="clock-widget">
          <div>
            <div className="clock-time">{liveClock}</div>
            <div className="clock-date">{liveDate}</div>
            <div className={`clock-status ${isClockedIn ? '' : 'not-in'}`}>
              <span className="pulse" />
              <span>{isClockedIn ? 'Currently Working' : (myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In')}</span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="clock-timer">{timerDisplay}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>Today&apos;s Working Hours</div>
          </div>
          <div className="clock-actions">
            <button className="clock-btn clock-in" onClick={clockIn} disabled={isClockedIn}>
              <i className="fas fa-sign-in-alt" /> Clock In
            </button>
            <button className="clock-btn clock-out" onClick={clockOut} disabled={!isClockedIn}>
              <i className="fas fa-sign-out-alt" /> Clock Out
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          {['my', 'team', 'audit'].map((t) => (
            <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'my' ? 'My Attendance' : t === 'team' ? 'Team View' : 'Audit Log'}
            </button>
          ))}
        </div>

        {/* MY ATTENDANCE TAB */}
        {tab === 'my' && (
          <>
            <div className="att-summary-bar">
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--success)' }}>{summary.present}</div><div className="att-s-lbl">Present</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--danger)' }}>{summary.absent}</div><div className="att-s-lbl">Absent</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--warning)' }}>{summary.halfDay}</div><div className="att-s-lbl">Half Day</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--accent)' }}>{summary.late}</div><div className="att-s-lbl">Late</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--purple)' }}>{summary.leaves}</div><div className="att-s-lbl">Leaves</div></div>
              <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--primary)' }}>{fmtDuration(summary.totalHours)}</div><div className="att-s-lbl">Total Hours</div></div>
            </div>

            <div className="grid-3-1">
              <div className="card">
                <div className="card-header">
                  <h3>Monthly Calendar</h3>
                  <div className="month-selector">
                    <button onClick={() => changeMonth(-1)}><i className="fas fa-chevron-left" /></button>
                    <span>{monthLabel(attMonth, attYear)}</span>
                    <button onClick={() => changeMonth(1)}><i className="fas fa-chevron-right" /></button>
                  </div>
                </div>
                <div className="card-body">
                  <div className="att-calendar">{renderCalendar()}</div>
                  <div className="att-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: '12px 0', fontSize: 11 }}>
                    {[['var(--success)', 'Present'], ['var(--danger)', 'Absent'], ['var(--warning)', 'Half Day'], ['var(--accent)', 'Late'], ['var(--purple)', 'Leave']].map(([c, l]) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, background: c }} />{l}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Today&apos;s Timeline</h3></div>
                <div className="card-body">
                  {!myPunches?.punches?.length ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No punches recorded today. Click &quot;Clock In&quot; to start.</p>
                  ) : (
                    <div className="att-timeline">
                      {[...myPunches.punches].sort((a, b) => a.punch_time.localeCompare(b.punch_time)).map((p, i) => (
                        <div className={`att-timeline-item ${p.punch_type === 'in' ? 'punch-in' : 'punch-out'}`} key={p.id || i}>
                          <span className="att-timeline-time">{fmtTime12(p.punch_time)}</span>
                          <span className="att-timeline-label">{p.punch_type === 'in' ? (i === 0 ? 'Clock In' : 'Resume') : 'Clock Out'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

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
                <button className="btn btn-primary" onClick={() => { setManualForm({ profile_id: '', date: teamDate, clockIn: '09:00', clockOut: '18:00', status: 'Present', reason: '' }); setShowManual(true); }}>
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
            </div>

            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Employee</th><th>Department</th><th>Clock In</th><th>Clock Out</th><th>Working Hours</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {teamData.length === 0 ? (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No employees found</td></tr>
                    ) : teamData.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div className="emp-cell">
                            <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(r.id)})` }}>{getInitials(r.first_name, r.last_name)}</div>
                            <div><div className="emp-name">{r.first_name} {r.last_name}</div><div className="emp-role">{r.id.slice(0, 8)}</div></div>
                          </div>
                        </td>
                        <td>{r.department || '—'}</td>
                        <td>{r.clockInT}</td>
                        <td>{r.clockOutT}</td>
                        <td>{r.hours}</td>
                        <td><span className={`badge ${r.badgeCls}`}>{r.status}</span></td>
                        <td>
                          <button className="btn btn-outline btn-sm" onClick={() => { setManualForm({ profile_id: r.id, date: teamDate, clockIn: '09:00', clockOut: '18:00', status: 'Present', reason: '' }); setShowManual(true); }}>
                            <i className="fas fa-edit" />
                          </button>
                        </td>
                      </tr>
                    ))}
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
                            <span className="emp-name" style={{ fontSize: 12 }}>{log.target_profile?.first_name} {log.target_profile?.last_name}</span>
                          </div>
                        </td>
                        <td><span className={`badge ${log.action === 'create' ? 'badge-success' : 'badge-warning'}`}>{log.action === 'create' ? 'Created' : 'Updated'}</span></td>
                        <td style={{ color: 'var(--text-muted)' }}>{log.old_status || '—'}</td>
                        <td><strong>{log.new_status}</strong></td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.old_hours != null ? `${log.old_hours}h` : '—'} → {log.new_hours != null ? `${log.new_hours}h` : '—'}</td>
                        <td style={{ fontSize: 12 }}>{log.changed_by_profile?.first_name} {log.changed_by_profile?.last_name}</td>
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
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
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
          <textarea className="form-input" rows={2} placeholder="e.g. Forgot to clock in, manager override, late arrival correction..." value={manualForm.reason} onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })} style={{ resize: 'vertical' }} />
        </div>
      </Modal>
    </>
  );
}
