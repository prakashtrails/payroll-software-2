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

export default function EmployeeDashboard() {
  const { profile, tenant } = useAuth();
  const navigate = useNavigate();
  
  // Clock state
  const [liveClock, setLiveClock] = useState('');
  const [liveDate, setLiveDate] = useState('');
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Checking...');
  const [myPunches, setMyPunches] = useState({});
  
  const clockRef = useRef(null);
  const timerRef = useRef(null);
  const geofenceRef = useRef(null);

  const fetchMyAttendance = useCallback(async () => {
    if (!profile || !tenant) return;
    const now = new Date();
    const { data } = await fetchMyMonthAttendance(profile.id, now.getFullYear(), now.getMonth());
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
  }, [profile, tenant]);

  useEffect(() => {
    if (!profile || !tenant) return;
    fetchMyAttendance();
  }, [profile, tenant, fetchMyAttendance]);

  const now = new Date();

  // Live clock ticker
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

  // Working hours timer
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

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const checkGeofence = useCallback(async (autoLogout = false) => {
    if (!tenant?.geofence_lat || !tenant?.geofence_lng) {
      setLocationStatus('Geofencing not enabled');
      return true;
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
      });
      const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, tenant.geofence_lat, tenant.geofence_lng);
      const radius = tenant.geofence_radius || 200;
      
      if (dist > radius) {
        setLocationStatus(`Outside area (${Math.round(dist)}m away)`);
        if (autoLogout && isClockedIn) {
          showToast('Auto-logging out: You have left the office area.', 'warning');
          return { outside: true, lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
        return false;
      }
      setLocationStatus('Within office area');
      return { outside: false, lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (_err) {
      setLocationStatus('Location access required');
      return false;
    }
  }, [tenant, isClockedIn]);

  const clockOut = useCallback(async (location = null) => {
    if (!isClockedIn) return showToast('Not clocked in!', 'warning');
    if (!location) {
      const loc = await checkGeofence();
      if (!loc || loc.outside) return showToast(locationStatus, 'error');
      location = loc;
    }
    try {
      const { total } = await svcClockOut(profile.id, location);
      showToast(`Clocked out. Worked ${fmtDuration(total)}`, 'success');
      fetchMyAttendance();
    } catch (err) { showToast('Clock out failed: ' + err.message, 'error'); }
  }, [checkGeofence, fetchMyAttendance, isClockedIn, locationStatus, profile]);

  useEffect(() => {
    if (isClockedIn && tenant?.geofence_lat) {
      geofenceRef.current = setInterval(async () => {
        const result = await checkGeofence(true);
        if (result?.outside) {
          await clockOut({ lat: result.lat, lng: result.lng });
        }
      }, 60000);
    } else {
      clearInterval(geofenceRef.current);
    }
    return () => clearInterval(geofenceRef.current);
  }, [isClockedIn, tenant, checkGeofence, clockOut]);

  const clockIn = async () => {
    if (!profile || !tenant) {
      return showToast('Account setup incomplete. Please contact support or try logging out and back in.', 'error');
    }
    if (isClockedIn) return showToast('Already clocked in!', 'warning');
    
    const location = await checkGeofence();
    if (!location || location.outside) {
      return showToast(locationStatus, 'error');
    }
    try {
      await svcClockIn(tenant.id, profile.id, tenant, location);
      showToast(`Clocked in at ${fmtTime12(timeStr(new Date()))}`, 'success');
      fetchMyAttendance();
    } catch (err) { showToast('Clock in failed: ' + err.message, 'error'); }
  };

  return (
    <>
      <Header title={`Welcome back, ${profile?.first_name || 'User'}`} breadcrumb={`${monthLabel(now.getMonth(), now.getFullYear())} Stats`} />
      <div className="page-content">
        <div className="clock-widget">
          <div>
            <div className="clock-time">{liveClock}</div>
            <div className="clock-date">{liveDate}</div>
            <div className={`clock-status ${isClockedIn ? '' : 'not-in'}`}>
              <span className="pulse" /><span>{isClockedIn ? 'Currently Working' : (myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In')}</span>
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.6)', marginTop: 8 }}>
              <i className="fas fa-location-dot" /> {locationStatus}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="clock-timer">{timerDisplay}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>Today's Working Hours</div>
          </div>
          <div className="clock-actions">
            <button className="clock-btn clock-in" onClick={clockIn} disabled={isClockedIn}><i className="fas fa-sign-in-alt" /> Clock In</button>
            <button className="clock-btn clock-out" onClick={() => clockOut()} disabled={!isClockedIn}><i className="fas fa-sign-out-alt" /> Clock Out</button>
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
