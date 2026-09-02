import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import RecentUpdatesCard from '@/components/RecentUpdatesCard';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { fetchDashboardStats } from '@/services/tenantService';
import { fetchTodayAttendanceSummary, fetchMyMonthAttendance, clockIn as svcClockIn, clockOut as svcClockOut } from '@/services/attendanceService';
import { fetchRecentUpdates } from '@/services/activityFeedService';
import { todayStr, timeStr, fmtTime12, diffHours, monthLabel, elapsedSecondsToday } from '@/lib/helpers';
import { showToast } from '@/components/Toast';
import { useGeofenceClock } from '@/hooks/useGeofenceClock';

export default function GeneralDashboard({ embedded = false }) {
  const { tenant, profile } = useAuth();
  const { needsSelection, outletProfileIds, selectedOutletName } = useOutletView();
  const [stats, setStats]   = useState({ activeEmployees: 0, processedPayrolls: 0 });
  const [attendance, setAttendance] = useState({ present: 0, absent: 0, late: 0, halfDay: 0, leave: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [liveClock, setLiveClock] = useState('');
  const [liveDate, setLiveDate] = useState('');
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [myPunches, setMyPunches] = useState({});
  const [attLoading, setAttLoading] = useState(false);
  const [updates, setUpdates] = useState([]);
  const [updatesLoading, setUpdatesLoading] = useState(true);
  const clockRef = useRef(null);
  const timerRef = useRef(null);
  const isClockedInRef = useRef(false); // ref mirror of isClockedIn for use inside stable callbacks

  useEffect(() => { isClockedInRef.current = isClockedIn; }, [isClockedIn]);

  const fetchMyAttendance = useCallback(async () => {
    if (!profile || !tenant) return;
    const { data } = await fetchMyMonthAttendance(profile.id, new Date().getFullYear(), new Date().getMonth());
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
  }, [profile, tenant]);

  useEffect(() => {
    if (!tenant) { setLoading(false); return; }
    Promise.all([
      fetchDashboardStats(tenant.id, outletProfileIds),
      fetchTodayAttendanceSummary(tenant.id, `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`, outletProfileIds),
    ]).then(([statsRes, attendanceRes]) => {
      if (!statsRes.error) setStats({ activeEmployees: statsRes.activeEmployees, processedPayrolls: statsRes.processedPayrolls });
      if (!attendanceRes.error) setAttendance(attendanceRes);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [tenant, outletProfileIds]);

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
    fetchMyAttendance();
  }, [fetchMyAttendance]);

  useEffect(() => {
    if (!tenant || !profile) return;
    setUpdatesLoading(true);
    fetchRecentUpdates(tenant.id, { profileId: profile.id })
      .then(({ data }) => setUpdates(data || []))
      .finally(() => setUpdatesLoading(false));
  }, [tenant, profile]);

  useEffect(() => {
    const tickTimer = () => {
      const todayRec = myPunches;
      if (!todayRec?.punches?.length) {
        setTimerDisplay('00:00:00');
        return;
      }
      const totalSecs = elapsedSecondsToday(todayRec.punches);
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = Math.floor(totalSecs % 60);
      setTimerDisplay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tickTimer();
    timerRef.current = setInterval(tickTimer, 1000);
    return () => clearInterval(timerRef.current);
  }, [myPunches]);

  // ── Auto clock-out (called internally, bypasses geofence check) ──────────────
  const doAutoClockOut = useCallback(async (lat, lng) => {
    if (!isClockedInRef.current || !profile) return;
    setAttLoading(true);
    try {
      const { total } = await svcClockOut(profile.id, { lat, lng }, { allowOutsideGeofence: true });
      showToast(`Auto clocked out — left office area. Worked ${Math.floor(total)}h ${Math.round((total - Math.floor(total)) * 60)}m`, 'warning');
      await fetchMyAttendance();
    } catch (err) {
      showToast('Auto clock-out failed: ' + err.message, 'error');
    } finally {
      setAttLoading(false);
    }
  }, [profile, fetchMyAttendance]);

  const { geofenceEnabled, insideFence, locationStatus, resolveClockLocation, isWfhToday } =
    useGeofenceClock({ profile, tenant, isClockedIn, onAutoClockOut: doAutoClockOut });

  const handleClockIn = async () => {
    if (isClockedIn || !tenant || !profile) return;
    setAttLoading(true);
    try {
      const location = await resolveClockLocation();
      await svcClockIn(tenant.id, profile.id, tenant, location);
      showToast(`Clocked in at ${fmtTime12(timeStr(new Date()))}`, 'success');
      await fetchMyAttendance();
    } catch (err) {
      showToast('Clock in failed: ' + err.message, 'error');
    } finally {
      setAttLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!isClockedIn || !profile) return;
    setAttLoading(true);
    try {
      const location = await resolveClockLocation();
      const { total } = await svcClockOut(profile.id, location);
      showToast(`Clocked out. Worked ${Math.floor(total)}h ${Math.round((total - Math.floor(total)) * 60)}m`, 'success');
      await fetchMyAttendance();
    } catch (err) {
      showToast('Clock out failed: ' + err.message, 'error');
    } finally {
      setAttLoading(false);
    }
  };

  if (needsSelection) return <Navigate to="/outlets" replace />;

  const now = new Date();

  return (
    <>
      {!embedded && (
        <Header
          title={selectedOutletName ? `Admin Dashboard — ${selectedOutletName}` : 'Admin Dashboard'}
          breadcrumb={`${monthLabel(now.getMonth(), now.getFullYear())} Overview`}
        />
      )}
      <div className="page-content">
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading insights…
          </div>
        ) : (
          <>
            {profile && (
              <div className="clock-widget">
                <div>
                  <div className="clock-time">{liveClock}</div>
                  <div className="clock-date">{liveDate}</div>
                  <div className={`clock-status ${isClockedIn ? '' : 'not-in'}`}>
                    <span className="pulse" />
                    <span>{isClockedIn ? 'Currently Working' : (myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In')}</span>
                  </div>
                  {isWfhToday ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: '#4ade80' }}>
                      <i className="fas fa-house-laptop" />
                      <span>Approved WFH today — clock in from anywhere</span>
                    </div>
                  ) : geofenceEnabled ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11,
                      color: insideFence === true ? '#4ade80' : insideFence === false ? '#f87171' : 'rgba(255,255,255,.5)',
                    }}>
                      <i className="fas fa-location-dot" />
                      <span>{locationStatus}</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 8 }}>
                      <i className="fas fa-location-dot" /> Geofencing not configured
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div className="clock-timer">{timerDisplay}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>Today's Working Hours</div>
                </div>

                <div className="clock-actions">
                  <button className="clock-btn clock-in" onClick={handleClockIn} disabled={isClockedIn || attLoading || (geofenceEnabled && insideFence === false)}>
                    <i className="fas fa-sign-in-alt" /> Clock In
                  </button>
                  <button className="clock-btn clock-out" onClick={handleClockOut} disabled={!isClockedIn || attLoading || (geofenceEnabled && insideFence === false)}>
                    <i className="fas fa-sign-out-alt" /> Clock Out
                  </button>
                </div>
              </div>
            )}

            <div className="stats-row">
              <StatCard icon="fa-users"         iconColor="blue"   value={stats.activeEmployees}   label="Active Employees" />
              <StatCard icon="fa-file-invoice"  iconColor="purple" value={stats.processedPayrolls} label="Payrolls Processed" />
              <StatCard icon="fa-calendar-check" iconColor="green" value={`${attendance.present} / ${attendance.total}`} label="Present Today" />
              <StatCard icon="fa-clock"         iconColor="orange" value={attendance.late}       label="Late Today" />
            </div>

            <div className="grid-3-1">
              <div className="card">
                <div className="card-header"><h3>Recent Payroll History</h3></div>
                <div className="card-body">
                  {stats.processedPayrolls > 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {stats.processedPayrolls} payroll run{stats.processedPayrolls !== 1 ? 's' : ''} processed so far.
                    </p>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      No payroll processed yet. Go to <Link to="/payroll" style={{ color: 'var(--primary)' }}>Run Payroll</Link> to get started.
                    </p>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Quick Actions</h3></div>
                <div className="card-body">
                  <div style={{ display: 'grid', gap: 8 }}>
                    <Link to="/attendance" className="btn btn-primary btn-block"><i className="fas fa-clock" /> Attendance</Link>
                    <Link to="/payroll"   className="btn btn-outline btn-block"><i className="fas fa-play-circle" /> Run Payroll</Link>
                    <Link to="/employees" className="btn btn-outline btn-block"><i className="fas fa-user-plus" /> Manage Employees</Link>
                  </div>
                </div>
              </div>
            </div>

            <RecentUpdatesCard items={updates} loading={updatesLoading} />

            <div className="card">
              <div className="card-header"><h3>System Setup Guide</h3></div>
              <div className="card-body">
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Welcome to CrewCore. Here are the recommended next steps:
                </p>
                <ul style={{ paddingLeft: 20, marginTop: 12, fontSize: 13, color: 'var(--text)', display: 'grid', gap: 8 }}>
                  <li>Go to <strong>Settings</strong> to configure earning and deduction components.</li>
                  <li>Visit <strong>Employees</strong> to add your active workers and sync their CTC.</li>
                  <li>Direct employees to the login page so they can mark <strong>Attendance</strong>.</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
