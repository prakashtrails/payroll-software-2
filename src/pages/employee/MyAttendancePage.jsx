import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { fetchMyMonthAttendance } from '@/services/attendanceService';
import { listHolidays } from '@/services/tenantService';
import { todayStr, dateStr, fmtTime12, fmtDuration, monthLabel } from '@/lib/helpers';

export default function MyAttendancePage() {
  const { profile, tenant } = useAuth();
  const [attMonth, setAttMonth]       = useState(new Date().getMonth());
  const [attYear, setAttYear]         = useState(new Date().getFullYear());
  const [myRecords, setMyRecords]     = useState([]);
  const [holidays, setHolidays]       = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayStr());

  const fetchMyAttendance = useCallback(async () => {
    if (!profile || !tenant) return;
    const { data } = await fetchMyMonthAttendance(profile.id, attYear, attMonth);
    setMyRecords(data || []);
  }, [profile, tenant, attMonth, attYear]);

  useEffect(() => { fetchMyAttendance(); }, [fetchMyAttendance]);

  const fetchHolidayData = useCallback(async () => {
    if (!tenant) return;
    const { data, error } = await listHolidays(tenant.id);
    if (error) return showToast('Could not load holidays: ' + error.message, 'error');
    setHolidays(data);
  }, [tenant]);

  useEffect(() => { fetchHolidayData(); }, [fetchHolidayData]);

  const getHolidayDate = (h) => h.holiday_date || h.date;

  const changeMonth = (delta) => {
    let m = attMonth + delta, y = attYear;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setAttMonth(m);
    setAttYear(y);
    // reset selected date to 1st of the new month
    const newMonthStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    setSelectedDate(newMonthStr);
  };

  const today = new Date();
  const todayDateStr = todayStr();

  // ── Calendar cells ──────────────────────────────────────────────────────────
  const firstDay    = new Date(attYear, attMonth, 1).getDay();
  const daysInMonth = new Date(attYear, attMonth + 1, 0).getDate();
  const calendarCells = [];

  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) =>
    calendarCells.push(<div className="att-cal-header" key={'h-' + d}>{d}</div>)
  );
  for (let i = 0; i < firstDay; i++) {
    calendarCells.push(<div className="att-cal-day empty" key={'e-' + i} />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date     = new Date(attYear, attMonth, d);
    const ds       = dateStr(date);
    const isToday  = ds === todayDateStr;
    const isFuture = date > today;
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const rec      = myRecords.find((r) => r.date === ds);
    const holiday  = holidays.find((h) => getHolidayDate(h) === ds && h.status === 'Approved');

    let cls = '';
    let hoursStr = '';
    if (isFuture)       { cls = 'future'; }
    else if (holiday)   { cls = 'holiday'; hoursStr = holiday.name; }
    else if (isWeekend) { cls = 'weekend'; }
    else if (rec)       { cls = rec.status?.toLowerCase().replace(/\s/g, '-') || 'present'; if (rec.total_hours) hoursStr = fmtDuration(rec.total_hours); }
    else                { cls = 'absent'; }
    if (isToday) cls += ' today';
    if (ds === selectedDate) cls += ' selected';

    calendarCells.push(
      <div
        key={ds}
        className={`att-cal-day ${cls}`}
        onClick={isFuture ? undefined : () => setSelectedDate(ds)}
        style={isFuture ? undefined : { cursor: 'pointer' }}
      >
        <div className="day-num">{d}</div>
        {hoursStr && <div className="day-hours">{hoursStr}</div>}
      </div>
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = { present: 0, absent: 0, halfDay: 0, late: 0, leaves: 0, totalHours: 0 };
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(attYear, attMonth, d);
    if (date > today || date.getDay() === 0 || date.getDay() === 6) continue;
    const ds = dateStr(date);
    if (holidays.find((h) => getHolidayDate(h) === ds && h.status === 'Approved')) continue;
    const rec = myRecords.find((r) => r.date === ds);
    if (!rec?.status) { if (date < today) summary.absent++; continue; }
    if (rec.status === 'Present')  summary.present++;
    else if (rec.status === 'Late')     { summary.late++; summary.present++; }
    else if (rec.status === 'Half Day') summary.halfDay++;
    else if (rec.status === 'Leave')    summary.leaves++;
    else if (rec.status === 'Absent')   summary.absent++;
    summary.totalHours += rec.total_hours || 0;
  }

  // ── Selected day data ────────────────────────────────────────────────────────
  const selectedRec  = myRecords.find((r) => r.date === selectedDate);
  const sortedPunches = selectedRec?.punches
    ? [...selectedRec.punches].sort((a, b) => a.punch_time.localeCompare(b.punch_time))
    : [];
  const selectedLabel = selectedDate
    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <>
      <Header title="My Attendance" breadcrumb={monthLabel(attMonth, attYear)} />
      <div className="page-content">

        {/* Summary bar */}
        <div className="att-summary-bar">
          <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--success)' }}>{summary.present}</div><div className="att-s-lbl">Present</div></div>
          <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--danger)' }}>{summary.absent}</div><div className="att-s-lbl">Absent</div></div>
          <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--warning)' }}>{summary.halfDay}</div><div className="att-s-lbl">Half Day</div></div>
          <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--accent)' }}>{summary.late}</div><div className="att-s-lbl">Late</div></div>
          <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--purple)' }}>{summary.leaves}</div><div className="att-s-lbl">Leaves</div></div>
          <div className="att-summary-item"><div className="att-s-val" style={{ color: 'var(--primary)' }}>{fmtDuration(summary.totalHours)}</div><div className="att-s-lbl">Total Hours</div></div>
        </div>

        <div className="grid-3-1">

          {/* Calendar */}
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
              <div className="att-calendar">{calendarCells}</div>
            </div>
          </div>

          {/* Timeline panel */}
          <div className="card">
            <div className="card-header">
              <h3>Day Timeline</h3>
            </div>
            <div className="card-body">
              {selectedDate && (
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 12 }}>
                  {selectedLabel}
                </div>
              )}

              {sortedPunches.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  No punches recorded for this day.
                </p>
              ) : (
                <div className="att-timeline">
                  {sortedPunches.map((p, i) => (
                    <div
                      key={p.id || i}
                      className={`att-timeline-item ${p.punch_type === 'in' ? 'punch-in' : 'punch-out'}`}
                    >
                      <span className="att-timeline-time">{fmtTime12(p.punch_time)}</span>
                      <span className="att-timeline-label">
                        {p.punch_type === 'in' ? (i === 0 ? 'Clock In' : 'Resume') : 'Clock Out'}
                      </span>
                    </div>
                  ))}
                  {selectedRec?.total_hours > 0 && (
                    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <i className="fas fa-clock" style={{ marginRight: 6 }} />
                      Total: <strong>{fmtDuration(selectedRec.total_hours)}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
