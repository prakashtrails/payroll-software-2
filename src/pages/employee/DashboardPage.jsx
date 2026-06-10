import React from 'react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMyMonthAttendance,
  clockIn as svcClockIn,
  clockOut as svcClockOut,
} from '@/services/attendanceService';
import { monthLabel, todayStr, timeStr, fmtTime12, diffHours, fmtDuration } from '@/lib/helpers';

// Haversine distance in metres between two lat/lng points
function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 30 seconds outside before auto clock-out triggers
const AUTO_CLOCKOUT_GRACE_MS = 30000;

export default function EmployeeDashboard() {
  const { profile, tenant } = useAuth();
  const navigate = useNavigate();

  const [liveClock,      setLiveClock]      = useState('');
  const [liveDate,       setLiveDate]       = useState('');
  const [timerDisplay,   setTimerDisplay]   = useState('00:00:00');
  const [isClockedIn,    setIsClockedIn]    = useState(false);
  const [locationStatus, setLocationStatus] = useState('Checking location…');
  const [insideFence,    setInsideFence]    = useState(null); // null=unknown, true, false
  const [myPunches,      setMyPunches]      = useState({});
  const [clockingIn,     setClockingIn]     = useState(false);
  const [clockingOut,    setClockedOut]     = useState(false);

  const clockRef        = useRef(null);
  const timerRef        = useRef(null);
  const watchRef        = useRef(null);   // geolocation watchPosition id
  const graceTimerRef   = useRef(null);   // debounce timer for auto clock-out
  const isClockedInRef  = useRef(false);  // ref mirror of isClockedIn for use inside callbacks

  const geofenceEnabled = !!(tenant?.geofence_lat && tenant?.geofence_lng);
  const geofenceRadius  = tenant?.geofence_radius || 200;

  // Keep ref in sync
  useEffect(() => { isClockedInRef.current = isClockedIn; }, [isClockedIn]);

  // ── Attendance data ──────────────────────────────────────────────────────────
  const fetchMyAttendance = useCallback(async () => {
    if (!profile || !tenant) return;
    const now = new Date();
    const { data } = await fetchMyMonthAttendance(profile.id, now.getFullYear(), now.getMonth());
    const todayRec = data.find(r => r.date === todayStr());
    if (todayRec) {
      const ins  = (todayRec.punches || []).filter(p => p.punch_type === 'in').length;
      const outs = (todayRec.punches || []).filter(p => p.punch_type === 'out').length;
      setIsClockedIn(ins > outs);
      setMyPunches(todayRec);
    } else {
      setIsClockedIn(false);
      setMyPunches({});
    }
  }, [profile, tenant]);

  useEffect(() => { fetchMyAttendance(); }, [fetchMyAttendance]);

  // ── Live clock ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setLiveClock(n.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setLiveDate(n.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    };
    tick();
    clockRef.current = setInterval(tick, 1000);
    return () => clearInterval(clockRef.current);
  }, []);

  // ── Working hours timer ──────────────────────────────────────────────────────
  useEffect(() => {
    const tickTimer = () => {
      const todayRec = myPunches;
      if (!todayRec?.punches?.length) { setTimerDisplay('00:00:00'); return; }
      const sorted = [...todayRec.punches].sort((a, b) => a.punch_time.localeCompare(b.punch_time));
      const ins  = sorted.filter(p => p.punch_type === 'in');
      const outs = sorted.filter(p => p.punch_type === 'out');
      let secs = 0;
      for (let i = 0; i < ins.length; i++) {
        secs += diffHours(ins[i].punch_time, outs[i]?.punch_time || timeStr(new Date())) * 3600;
      }
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      setTimerDisplay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tickTimer();
    timerRef.current = setInterval(tickTimer, 1000);
    return () => clearInterval(timerRef.current);
  }, [myPunches]);

  // ── Auto clock-out (called internally, bypasses geofence check) ──────────────
  const doAutoClockOut = useCallback(async (lat, lng) => {
    if (!isClockedInRef.current) return;
    try {
      setClockedOut(true);
      const { total } = await svcClockOut(profile.id, { lat, lng });
      showToast(`Auto clocked out — left office area. Worked ${fmtDuration(total)}`, 'warning');
      fetchMyAttendance();
    } catch (err) {
      showToast('Auto clock-out failed: ' + err.message, 'error');
    } finally {
      setClockedOut(false);
    }
  }, [profile, fetchMyAttendance]);

  // ── Geofence watchPosition ───────────────────────────────────────────────────
  useEffect(() => {
    if (!geofenceEnabled) {
      setLocationStatus('Geofencing not configured');
      setInsideFence(true); // treat as always inside when not configured
      return;
    }
    if (!navigator.geolocation) {
      setLocationStatus('Geolocation not supported by this browser');
      setInsideFence(false);
      return;
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const dist = calcDistance(
          pos.coords.latitude, pos.coords.longitude,
          tenant.geofence_lat, tenant.geofence_lng
        );
        const outside = dist > geofenceRadius;
        setInsideFence(!outside);

        if (outside) {
          setLocationStatus(`Outside office area · ${Math.round(dist)} m away`);
          // Only start grace timer if clocked in and no timer already running
          if (isClockedInRef.current && !graceTimerRef.current) {
            graceTimerRef.current = setTimeout(() => {
              doAutoClockOut(pos.coords.latitude, pos.coords.longitude);
              graceTimerRef.current = null;
            }, AUTO_CLOCKOUT_GRACE_MS);
          }
        } else {
          setLocationStatus(`Inside office area · ${Math.round(dist)} m from centre`);
          // Cancel grace timer — employee came back inside
          if (graceTimerRef.current) {
            clearTimeout(graceTimerRef.current);
            graceTimerRef.current = null;
          }
        }
      },
      (err) => {
        const msg = err.code === 1
          ? 'Location permission denied — please allow location access'
          : err.code === 2
          ? 'Location unavailable — check GPS/network'
          : 'Location request timed out';
        setLocationStatus(msg);
        setInsideFence(null);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofenceEnabled, tenant?.geofence_lat, tenant?.geofence_lng, geofenceRadius, doAutoClockOut]);

  // Cancel grace timer the moment the employee clocks out (manual or auto)
  useEffect(() => {
    if (!isClockedIn && graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, [isClockedIn]);

  // ── Get current position once (for clock-in / manual clock-out) ─────────────
  const getCurrentPos = () =>
    new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
    );

  // ── Clock In ─────────────────────────────────────────────────────────────────
  const clockIn = async () => {
    if (!profile || !tenant) return showToast('Account setup incomplete. Please re-login.', 'error');
    if (isClockedIn) return showToast('Already clocked in!', 'warning');

    if (geofenceEnabled) {
      if (insideFence === false) {
        return showToast('You are outside the office area. Move closer to clock in.', 'error');
      }
      if (insideFence === null) {
        return showToast('Waiting for location. Please allow location access and try again.', 'error');
      }
    }

    setClockingIn(true);
    try {
      let location = null;
      if (geofenceEnabled) {
        const pos  = await getCurrentPos();
        const dist = calcDistance(pos.coords.latitude, pos.coords.longitude, tenant.geofence_lat, tenant.geofence_lng);
        if (dist > geofenceRadius) {
          showToast(`You are ${Math.round(dist)} m from the office. Move inside the office area to clock in.`, 'error');
          setClockingIn(false);
          return;
        }
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      await svcClockIn(tenant.id, profile.id, tenant, location);
      showToast(`Clocked in at ${fmtTime12(timeStr(new Date()))}`, 'success');
      fetchMyAttendance();
    } catch (err) {
      showToast('Clock in failed: ' + err.message, 'error');
    } finally {
      setClockingIn(false);
    }
  };

  // ── Clock Out (manual) ───────────────────────────────────────────────────────
  const clockOut = async () => {
    if (!isClockedIn) return showToast('Not clocked in!', 'warning');

    if (geofenceEnabled) {
      if (insideFence === false) {
        return showToast('You are outside the office area. You will be auto clocked-out shortly.', 'warning');
      }
      if (insideFence === null) {
        return showToast('Location unavailable. Please allow location access.', 'error');
      }
    }

    setClockedOut(true);
    try {
      let location = null;
      if (geofenceEnabled) {
        const pos  = await getCurrentPos();
        const dist = calcDistance(pos.coords.latitude, pos.coords.longitude, tenant.geofence_lat, tenant.geofence_lng);
        if (dist > geofenceRadius) {
          showToast(`You are ${Math.round(dist)} m from the office. You will be auto clocked-out shortly.`, 'warning');
          setClockedOut(false);
          return;
        }
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      const { total } = await svcClockOut(profile.id, location);
      showToast(`Clocked out. Worked ${fmtDuration(total)}`, 'success');
      fetchMyAttendance();
    } catch (err) {
      showToast('Clock out failed: ' + err.message, 'error');
    } finally {
      setClockedOut(false);
    }
  };

  // ── Location status badge ────────────────────────────────────────────────────
  const fenceColor = !geofenceEnabled ? 'rgba(255,255,255,.5)'
    : insideFence === true  ? '#4ade80'
    : insideFence === false ? '#f87171'
    : 'rgba(255,255,255,.5)';

  const now = new Date();

  return (
    <>
      <Header title={`Welcome back, ${profile?.first_name || 'User'}`} breadcrumb={`${monthLabel(now.getMonth(), now.getFullYear())} Stats`} />
      <div className="page-content">

        <div className="clock-widget">
          <div>
            <div className="clock-time">{liveClock}</div>
            <div className="clock-date">{liveDate}</div>
            <div className={`clock-status ${isClockedIn ? '' : 'not-in'}`}>
              <span className="pulse" />
              <span>{isClockedIn ? 'Currently Working' : (myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In')}</span>
            </div>
            {geofenceEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: fenceColor }}>
                <i className="fas fa-location-dot" />
                <span>{locationStatus}</span>
                {insideFence === false && isClockedIn && (
                  <span style={{ background: 'rgba(248,113,113,.2)', border: '1px solid #f87171', borderRadius: 8, padding: '1px 6px', fontSize: 10 }}>
                    Auto clock-out in ~{AUTO_CLOCKOUT_GRACE_MS / 1000}s
                  </span>
                )}
              </div>
            )}
            {!geofenceEnabled && (
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
            <button
              className="clock-btn clock-in"
              onClick={clockIn}
              disabled={isClockedIn || clockingIn || (geofenceEnabled && insideFence === false)}
            >
              {clockingIn
                ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Clocking In…</>
                : <><i className="fas fa-sign-in-alt" /> Clock In</>}
            </button>
            <button
              className="clock-btn clock-out"
              onClick={clockOut}
              disabled={!isClockedIn || clockingOut || (geofenceEnabled && insideFence === false)}
            >
              {clockingOut
                ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Clocking Out…</>
                : <><i className="fas fa-sign-out-alt" /> Clock Out</>}
            </button>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header"><h3>Recent Announcements</h3></div>
            <div className="card-body">
              <div className="empty-state">
                <i className="fas fa-bullhorn empty-icon" />
                <h3>No new announcements</h3>
                <p>Your team updates will appear here.</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Self Service</h3></div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: 12 }}>
                <button className="btn btn-outline btn-block" style={{ justifyContent: 'left' }} onClick={() => navigate('/my-payslips')}>
                  <i className="fas fa-file-invoice-dollar" style={{ width: 24 }} /> View Latest Payslip
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
