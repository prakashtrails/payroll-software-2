import React, { useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listActiveEmployees } from '@/services/employeeService';
import { fetchMyMonthAttendance, fetchEmployeeProfileInfo } from '@/services/attendanceService';
import { fmt, fmtTime12, dateStr, monthLabel } from '@/lib/helpers';

function getFirstIn(punches) {
  return (punches || [])
    .filter(p => p.punch_type === 'in')
    .sort((a, b) => a.punch_time.localeCompare(b.punch_time))[0]?.punch_time || null;
}

function getLastOut(punches) {
  const outs = (punches || []).filter(p => p.punch_type === 'out').sort((a, b) => a.punch_time.localeCompare(b.punch_time));
  return outs[outs.length - 1]?.punch_time || null;
}

const STATUS_COLOR = {
  Present: 'var(--success)',
  Late: 'var(--accent)',
  'Half Day': 'var(--warning)',
  Absent: 'var(--danger)',
  Leave: 'var(--purple)',
};

const now = new Date();

export default function EmployeeCalendarPage() {
  const { tenant } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [records, setRecords] = useState([]);
  const [empProfile, setEmpProfile] = useState(null);
  const [loadingEmps, setLoadingEmps] = useState(true);
  const [loading, setLoading] = useState(false);
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-based
  const [viewYear, setViewYear] = useState(now.getFullYear());

  useEffect(() => {
    if (!tenant) return;
    setLoadingEmps(true);
    listActiveEmployees(tenant.id).then(({ data }) => {
      setEmployees(data || []);
      setLoadingEmps(false);
    });
  }, [tenant]);

  // When employee changes: fetch profile, reset to current month
  useEffect(() => {
    if (!selectedId) { setEmpProfile(null); setRecords([]); return; }
    setViewMonth(now.getMonth());
    setViewYear(now.getFullYear());
    fetchEmployeeProfileInfo(selectedId).then(({ profile }) => setEmpProfile(profile));
  }, [selectedId]);

  // When employee or month/year changes: fetch that month's records
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetchMyMonthAttendance(selectedId, viewYear, viewMonth).then(({ data, error }) => {
      if (error) showToast(error.message, 'error');
      else setRecords(data || []);
    }).finally(() => setLoading(false));
  }, [selectedId, viewMonth, viewYear]);

  // Build month options from join date (or 12 months back) to current month, newest first
  const monthOptions = () => {
    const opts = [];
    let startY = now.getFullYear(), startM = now.getMonth() - 11; // default: 12 months back
    if (startM < 0) { startY--; startM += 12; }

    if (empProfile?.join_date) {
      const [jy, jm] = empProfile.join_date.split('-').map(Number);
      // Use whichever is earlier: join date or 12-months-back default
      const joinIsEarlier = jy < startY || (jy === startY && jm - 1 < startM);
      if (joinIsEarlier) { startY = jy; startM = jm - 1; }
    }

    let y = now.getFullYear(), m = now.getMonth();
    while (y > startY || (y === startY && m >= startM)) {
      opts.push({ year: y, month: m, label: monthLabel(m, y) });
      if (--m < 0) { m = 11; y--; }
    }
    return opts;
  };

  // Build days for the selected month, latest first, skipping future dates
  const buildDays = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days = [];
    for (let d = daysInMonth; d >= 1; d--) {
      const cur = new Date(viewYear, viewMonth, d);
      if (cur > today) continue;
      const ds = dateStr(cur);
      days.push({ date: ds, rec: records.find(r => r.date === ds) || null, dayObj: cur });
    }
    return days;
  };

  const days = buildDays();

  // Month summary stats (weekdays only)
  const stats = { present: 0, absent: 0, halfDay: 0, late: 0, leave: 0 };
  days.forEach(({ rec, dayObj }) => {
    if (dayObj.getDay() === 0 || dayObj.getDay() === 6) return;
    const s = rec?.status;
    if (s === 'Present') stats.present++;
    else if (s === 'Late') { stats.present++; stats.late++; }
    else if (s === 'Half Day') stats.halfDay++;
    else if (s === 'Leave') stats.leave++;
    else stats.absent++;
  });

  const exportToExcel = () => {
    if (!empProfile) return;
    const empName = `${empProfile.first_name || ''} ${empProfile.last_name || ''}`.trim();
    const wsData = [
      [`Employee: ${empName}`],
      [`Month: ${monthLabel(viewMonth, viewYear)}`],
      [`Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`],
      [],
      ['Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours'],
    ];
    days.forEach(({ date, rec, dayObj }) => {
      const isWeekend = dayObj.getDay() === 0 || dayObj.getDay() === 6;
      wsData.push([
        date,
        dayObj.toLocaleDateString('en-IN', { weekday: 'short' }),
        rec?.status || (isWeekend ? 'Weekend' : 'Absent'),
        rec ? (getFirstIn(rec.punches) || '') : '',
        rec ? (getLastOut(rec.punches) || '') : '',
        rec?.total_hours ? `${rec.total_hours}h` : '',
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, `${empName.replace(/\s+/g, '_')}_${viewYear}_${String(viewMonth + 1).padStart(2, '0')}.xlsx`);
  };

  const options = monthOptions();

  return (
    <div className="page-container">
      <Header
        title="Employee Calendar"
        breadcrumb="Dashboard / Employee Calendar"
        actions={
          selectedId && days.length > 0 && (
            <button className="btn btn-outline" onClick={exportToExcel}>
              <i className="fas fa-file-excel" style={{ marginRight: 6 }} />
              Export to Excel
            </button>
          )
        }
      />

      <div className="card" style={{ marginTop: 24 }}>
        {/* Controls row */}
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, whiteSpace: 'nowrap' }}>Select Employee</h3>

          <div style={{ flex: 1, minWidth: 200, maxWidth: 340 }}>
            <select
              className="form-select"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              disabled={loadingEmps}
            >
              <option value="">— Choose an employee —</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name}{emp.department ? ` (${emp.department})` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Month:</span>
              <select
                className="form-select"
                value={`${viewYear}-${viewMonth}`}
                onChange={e => {
                  const [y, m] = e.target.value.split('-').map(Number);
                  setViewYear(y);
                  setViewMonth(m);
                }}
                style={{ minWidth: 150 }}
              >
                {options.map(o => (
                  <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {empProfile?.join_date && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--primary-light, #ede9fe)', color: 'var(--primary)',
              border: '1px solid var(--primary)', borderRadius: 20,
              padding: '3px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              <i className="fas fa-calendar-check" />
              Joined: {fmt.date(empProfile.join_date)}
            </span>
          )}
        </div>

        {!selectedId && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <i className="fas fa-user-clock" style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
            Select an employee to view their attendance.
          </div>
        )}

        {selectedId && loading && (
          <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
        )}

        {selectedId && !loading && (
          <>
            {/* Stats bar */}
            <div style={{ display: 'flex', gap: 28, padding: '14px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              {[
                ['Present', stats.present, 'var(--success)'],
                ['Absent', stats.absent, 'var(--danger)'],
                ['Half Day', stats.halfDay, 'var(--warning)'],
                ['Late', stats.late, 'var(--accent)'],
                ['Leave', stats.leave, 'var(--purple)'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ textAlign: 'center', minWidth: 52 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
                </div>
              ))}
              <div style={{ marginLeft: 'auto', textAlign: 'right', alignSelf: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {monthLabel(viewMonth, viewYear)} · {days.length} working day{days.length !== 1 ? 's' : ''} shown
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Status</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {days.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                        No data for {monthLabel(viewMonth, viewYear)}.
                      </td>
                    </tr>
                  ) : days.map(({ date, rec, dayObj }) => {
                    const isWeekend = dayObj.getDay() === 0 || dayObj.getDay() === 6;
                    const dayName = dayObj.toLocaleDateString('en-IN', { weekday: 'short' });
                    const clockIn = rec ? getFirstIn(rec.punches) : null;
                    const clockOut = rec ? getLastOut(rec.punches) : null;
                    const status = rec?.status || (isWeekend ? 'Weekend' : 'Absent');
                    const color = STATUS_COLOR[status];

                    return (
                      <tr key={date} style={isWeekend ? { opacity: 0.55 } : undefined}>
                        <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{date}</td>
                        <td style={{ fontSize: 12, color: isWeekend ? 'var(--text-muted)' : undefined }}>{dayName}</td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                            fontSize: 11, fontWeight: 600,
                            background: color ? `${color}22` : 'var(--bg-card)',
                            color: color || 'var(--text-muted)',
                            border: `1px solid ${color || 'var(--border)'}`,
                          }}>
                            {status}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--success)' }}>
                          {clockIn ? fmtTime12(clockIn) : '—'}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--danger)' }}>
                          {clockOut ? fmtTime12(clockOut) : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {rec?.total_hours ? `${rec.total_hours}h` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
