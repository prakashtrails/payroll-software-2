import React from 'react';
import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { todayStr, dateStr, timeStr, fmtTime12, diffHours, fmtDuration, monthLabel } from '@/lib/helpers';

export default function MyAttendancePage() {
  const { profile, tenant } = useAuth();
  const [attMonth, setAttMonth] = useState(new Date().getMonth());
  const [attYear, setAttYear] = useState(new Date().getFullYear());
  const [myRecords, setMyRecords] = useState([]);
  const [myPunches, setMyPunches] = useState({});
  const [liveClock, setLiveClock] = useState('');
  const [liveDate, setLiveDate] = useState('');
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const [isClockedIn, setIsClockedIn] = useState(false);
  const clockRef = useRef(null);
  const timerRef = useRef(null);

  const fetchMyAttendance = useCallback(async () => {
    if (!profile || !tenant) return;
    const startDate = `${attYear}-${String(attMonth + 1).padStart(2, '0')}-01`;
    const endDay = new Date(attYear, attMonth + 1, 0).getDate();
    const endDate = `${attYear}-${String(attMonth + 1).padStart(2, '0')}-${endDay}`;

    const { data } = await supabase
      .from('attendance')
      .select('*, punches(*)')
      .eq('profile_id', profile.id)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date');

    setMyRecords(data || []);
    const todayRec = (data || []).find((r) => r.date === todayStr());
    if (todayRec) {
      const ins = (todayRec.punches || []).filter((p) => p.punch_type === 'in').length;
      const outs = (todayRec.punches || []).filter((p) => p.punch_type === 'out').length;
      setIsClockedIn(ins > outs);
      setMyPunches(todayRec);
    } else {
      setIsClockedIn(false);
      setMyPunches({});
    }
  }, [profile, tenant, attMonth, attYear]);

  useEffect(() => { fetchMyAttendance(); }, [fetchMyAttendance]);

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
      let attId;
      const { data: existing } = await supabase.from('attendance').select('id').eq('profile_id', profile.id).eq('date', todayStr()).maybeSingle();
      if (existing) { attId = existing.id; }
      else {
        const shiftStart = tenant?.shift_start || '09:00';
        const lateMin = tenant?.late_threshold || 15;
        const [sh, sm] = shiftStart.split(':').map(Number);
        const now = new Date();
        const diffMin = (now.getHours() * 60 + now.getMinutes()) - (sh * 60 + sm);
        const status = diffMin > lateMin ? 'Late' : 'Present';
        const { data: newAtt, error } = await supabase.from('attendance').insert([{ tenant_id: tenant.id, profile_id: profile.id, date: todayStr(), status, location: 'Office' }]).select().single();
        if (error) throw error;
        attId = newAtt.id;
      }
      await supabase.from('punches').insert([{ attendance_id: attId, punch_time: timeStr(new Date()), punch_type: 'in' }]);
      showToast(`Clocked in at ${fmtTime12(timeStr(new Date()))}`, 'success');
      fetchMyAttendance();
    } catch (err) { showToast('Clock in failed: ' + err.message, 'error'); }
  };

  const clockOut = async () => {
    if (!isClockedIn) return showToast('Not clocked in!', 'warning');
    try {
      const { data: att } = await supabase.from('attendance').select('id').eq('profile_id', profile.id).eq('date', todayStr()).single();
      await supabase.from('punches').insert([{ attendance_id: att.id, punch_time: timeStr(new Date()), punch_type: 'out' }]);
      const { data: allPunches } = await supabase.from('punches').select('*').eq('attendance_id', att.id).order('punch_time');
      const ins = allPunches.filter((p) => p.punch_type === 'in');
      const outs = allPunches.filter((p) => p.punch_type === 'out');
      let total = 0;
      for (let i = 0; i < ins.length; i++) { if (outs[i]) total += diffHours(ins[i].punch_time, outs[i].punch_time); }
      let status = 'Present';
      if (total < 4) status = 'Half Day';
      await supabase.from('attendance').update({ total_hours: Math.round(total * 100) / 100, status }).eq('id', att.id);
      showToast(`Clocked out. Worked ${fmtDuration(total)}`, 'success');
      fetchMyAttendance();
    } catch (err) { showToast('Clock out failed: ' + err.message, 'error'); }
  };

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
      let cls = '', hoursStr = '';
      if (isFuture) cls = 'future';
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
    const rec = myRecords.find((r) => r.date === dateStr(date));
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
        <div className="clock-widget">
          <div>
            <div className="clock-time">{liveClock}</div>
            <div className="clock-date">{liveDate}</div>
            <div className={`clock-status ${isClockedIn ? '' : 'not-in'}`}>
              <span className="pulse" /><span>{isClockedIn ? 'Currently Working' : (myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In')}</span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="clock-timer">{timerDisplay}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>Today&apos;s Working Hours</div>
          </div>
          <div className="clock-actions">
            <button className="clock-btn clock-in" onClick={clockIn} disabled={isClockedIn}><i className="fas fa-sign-in-alt" /> Clock In</button>
            <button className="clock-btn clock-out" onClick={clockOut} disabled={!isClockedIn}><i className="fas fa-sign-out-alt" /> Clock Out</button>
          </div>
        </div>
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
