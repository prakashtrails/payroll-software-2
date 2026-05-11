import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMyMonthAttendance,
} from '@/services/attendanceService';
import { listHolidays } from '@/services/tenantService';
import { todayStr, dateStr, fmtTime12, fmtDuration, monthLabel } from '@/lib/helpers';

export default function MyAttendancePage() {
  const { profile, tenant } = useAuth();
  const [attMonth, setAttMonth] = useState(new Date().getMonth());
  const [attYear, setAttYear] = useState(new Date().getFullYear());
  const [myRecords, setMyRecords] = useState([]);
  const [myPunches, setMyPunches] = useState({});
  const [holidays, setHolidays] = useState([]);

  const fetchMyAttendance = useCallback(async () => {
    if (!profile || !tenant) return;
    const { data } = await fetchMyMonthAttendance(profile.id, attYear, attMonth);
    setMyRecords(data);
    const todayRec = data.find((r) => r.date === todayStr());
    if (todayRec) {
      setMyPunches(todayRec);
    } else {
      setMyPunches({});
    }
  }, [profile, tenant, attMonth, attYear]);

  useEffect(() => { fetchMyAttendance(); }, [fetchMyAttendance]);

  const fetchHolidayData = useCallback(async () => {
    if (!tenant) return;
    const { data, error } = await listHolidays(tenant.id);
    if (error) return showToast('Could not load holidays: ' + error.message, 'error');
    setHolidays(data);
  }, [tenant]);

  const getHolidayDate = (h) => h.holiday_date || h.date;

  useEffect(() => { fetchHolidayData(); }, [fetchHolidayData]);

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
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => cells.push(<div className="att-cal-header" key={'h-' + d}>{d}</div>));
    for (let i = 0; i < firstDay; i++) cells.push(<div className="att-cal-day empty" key={'e-' + i} />);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(attYear, attMonth, d);
      const ds = dateStr(date);
      const isToday = d === today.getDate() && attMonth === today.getMonth() && attYear === today.getFullYear();
      const isFuture = date > today;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const rec = myRecords.find((r) => r.date === ds);
      const holiday = holidays.find((h) => getHolidayDate(h) === ds && h.status === 'Approved');
      let cls = '', hoursStr = '';
      if (isFuture) cls = 'future';
      else if (holiday) { cls = 'holiday'; hoursStr = holiday.name; }
      else if (isWeekend) cls = 'weekend';
      else if (rec) { cls = rec.status?.toLowerCase().replace(/\s/g, '-') || 'present'; if (rec.total_hours) hoursStr = fmtDuration(rec.total_hours); }
      else if (!isFuture && !isToday) cls = 'absent';
      if (isToday) cls += ' today';
      cells.push(<div className={`att-cal-day ${cls}`} key={d}><div className="day-num">{d}</div>{hoursStr && <div className="day-hours">{hoursStr}</div>}</div>);
    }
    return cells;
  };

  const summary = { present: 0, absent: 0, halfDay: 0, late: 0, leaves: 0, totalHours: 0 };
  const today = new Date();
  for (let d = 1; d <= new Date(attYear, attMonth + 1, 0).getDate(); d++) {
    const date = new Date(attYear, attMonth, d);
    if (date > today || date.getDay() === 0 || date.getDay() === 6) continue;
    const ds = dateStr(date);
    const holiday = holidays.find((h) => getHolidayDate(h) === ds && h.status === 'Approved');
    if (holiday) continue;
    const rec = myRecords.find((r) => r.date === ds);
    if (!rec?.status) { if (date < today) summary.absent++; continue; }
    if (rec.status === 'Present') summary.present++;
    else if (rec.status === 'Late') { summary.late++; summary.present++; }
    else if (rec.status === 'Half Day') summary.halfDay++;
    else if (rec.status === 'Leave') summary.leaves++;
    else if (rec.status === 'Absent') summary.absent++;
    summary.totalHours += rec.total_hours || 0;
  }

  return (
    <>
      <Header title="My Attendance" breadcrumb={monthLabel(attMonth, attYear)} />
      <div className="page-content">
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
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>Today&apos;s Timeline</h3></div>
            <div className="card-body">
              {!myPunches?.punches?.length ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No punches recorded today.</p>
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
      </div>
    </>
  );
}
