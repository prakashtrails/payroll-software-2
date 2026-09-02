import React from 'react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import RecentUpdatesCard from '@/components/RecentUpdatesCard';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMyMonthAttendance,
  clockIn as svcClockIn,
  clockOut as svcClockOut,
} from '@/services/attendanceService';
import { fetchRecentUpdates } from '@/services/activityFeedService';
import { submitWfhRequest } from '@/services/wfhService';
import { monthLabel, todayStr, timeStr, fmtTime12, diffHours, fmtDuration, elapsedSecondsToday } from '@/lib/helpers';
import { useGeofenceClock, AUTO_CLOCKOUT_GRACE_MS } from '@/hooks/useGeofenceClock';

export function DashboardContent() {
  const { profile, tenant } = useAuth();
  const navigate = useNavigate();

  const [liveClock,      setLiveClock]      = useState('');
  const [liveDate,       setLiveDate]       = useState('');
  const [timerDisplay,   setTimerDisplay]   = useState('00:00:00');
  const [isClockedIn,    setIsClockedIn]    = useState(false);
  const [myPunches,      setMyPunches]      = useState({});
  const [clockingIn,     setClockingIn]     = useState(false);
  const [clockingOut,    setClockedOut]     = useState(false);
  const [updates,        setUpdates]        = useState([]);
  const [updatesLoading, setUpdatesLoading] = useState(true);
  const [showWfhModal,   setShowWfhModal]   = useState(false);
  const [wfhForm,        setWfhForm]        = useState({ from_date: todayStr(), to_date: todayStr(), reason: '' });
  const [wfhSaving,      setWfhSaving]      = useState(false);

  const clockRef        = useRef(null);
  const timerRef        = useRef(null);
  const isClockedInRef  = useRef(false);  // ref mirror of isClockedIn for use inside stable callbacks

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

  useEffect(() => {
    if (!tenant || !profile) return;
    setUpdatesLoading(true);
    fetchRecentUpdates(tenant.id, { profileId: profile.id })
      .then(({ data }) => setUpdates(data || []))
      .finally(() => setUpdatesLoading(false));
  }, [tenant, profile]);

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
      const secs = elapsedSecondsToday(todayRec.punches);
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
      const { total } = await svcClockOut(profile.id, { lat, lng }, { allowOutsideGeofence: true });
      showToast(`Auto clocked out — left office area. Worked ${fmtDuration(total)}`, 'warning');
      fetchMyAttendance();
    } catch (err) {
      showToast('Auto clock-out failed: ' + err.message, 'error');
    } finally {
      setClockedOut(false);
    }
  }, [profile, fetchMyAttendance]);

  const { geofenceEnabled, insideFence, locationStatus, resolveClockLocation, isWfhToday } =
    useGeofenceClock({ profile, tenant, isClockedIn, onAutoClockOut: doAutoClockOut });

  // ── Clock In ─────────────────────────────────────────────────────────────────
  const clockIn = async () => {
    if (!profile || !tenant) return showToast('Account setup incomplete. Please re-login.', 'error');
    if (isClockedIn) return showToast('Already clocked in!', 'warning');

    setClockingIn(true);
    try {
      const location = await resolveClockLocation();
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

    setClockedOut(true);
    try {
      const location = await resolveClockLocation();
      const { total } = await svcClockOut(profile.id, location);
      showToast(`Clocked out. Worked ${fmtDuration(total)}`, 'success');
      fetchMyAttendance();
    } catch (err) {
      showToast('Clock out failed: ' + err.message, 'error');
    } finally {
      setClockedOut(false);
    }
  };

  // ── Work From Home request ───────────────────────────────────────────────────
  const openWfhModal = () => {
    setWfhForm({ from_date: todayStr(), to_date: todayStr(), reason: '' });
    setShowWfhModal(true);
  };

  const submitWfh = async () => {
    if (!wfhForm.from_date || !wfhForm.to_date) return showToast('Select a date range', 'error');
    if (wfhForm.to_date < wfhForm.from_date) return showToast('End date must be on or after the start date', 'error');
    if (!wfhForm.reason.trim()) return showToast('Please provide a reason', 'error');
    if (!tenant || !profile) return showToast('Account setup incomplete. Please re-login.', 'error');

    setWfhSaving(true);
    try {
      const { error } = await submitWfhRequest({
        tenantId: tenant.id,
        profileId: profile.id,
        fromDate: wfhForm.from_date,
        toDate: wfhForm.to_date,
        reason: wfhForm.reason.trim(),
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('WFH request submitted — pending manager/HR approval', 'success');
      setShowWfhModal(false);
    } finally {
      setWfhSaving(false);
    }
  };

  // ── Location status badge ────────────────────────────────────────────────────
  const fenceColor = !geofenceEnabled ? 'rgba(255,255,255,.5)'
    : insideFence === true  ? '#4ade80'
    : insideFence === false ? '#f87171'
    : 'rgba(255,255,255,.5)';

  return (
    <>
      <div className="page-content">

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: fenceColor }}>
                <i className="fas fa-location-dot" />
                <span>{locationStatus}</span>
                {insideFence === false && isClockedIn && (
                  <span style={{ background: 'rgba(248,113,113,.2)', border: '1px solid #f87171', borderRadius: 8, padding: '1px 6px', fontSize: 10 }}>
                    Auto clock-out in ~{AUTO_CLOCKOUT_GRACE_MS / 1000}s
                  </span>
                )}
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0 4px' }}>
          <button className="btn btn-outline btn-sm" onClick={openWfhModal}>
            <i className="fas fa-house-laptop" /> Request Work From Home
          </button>
        </div>

        <div className="grid-2">
          <RecentUpdatesCard items={updates} loading={updatesLoading} />

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

      <Modal
        show={showWfhModal}
        onClose={() => setShowWfhModal(false)}
        title="Request Work From Home"
        footer={
          <div className="flex gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-outline" onClick={() => setShowWfhModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitWfh} disabled={wfhSaving}>
              {wfhSaving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From *</label>
            <input type="date" className="form-input" min={todayStr()} value={wfhForm.from_date}
              onChange={(e) => setWfhForm({ ...wfhForm, from_date: e.target.value, to_date: wfhForm.to_date < e.target.value ? e.target.value : wfhForm.to_date })} />
          </div>
          <div className="form-group">
            <label className="form-label">To *</label>
            <input type="date" className="form-input" min={wfhForm.from_date || todayStr()} value={wfhForm.to_date}
              onChange={(e) => setWfhForm({ ...wfhForm, to_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-input" rows={3}
            placeholder="Why are you working from home for these dates?"
            value={wfhForm.reason} onChange={(e) => setWfhForm({ ...wfhForm, reason: e.target.value })} />
        </div>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)',
        }}>
          <i className="fas fa-info-circle" style={{ marginRight: 6 }} />
          Once approved, geofencing is disabled for these dates so you can clock in from anywhere.
        </div>
      </Modal>
    </>
  );
}

export default function EmployeeDashboard() {
  const { profile } = useAuth();
  const now = new Date();
  return (
    <>
      <Header title={`Welcome back, ${profile?.first_name || 'User'}`} breadcrumb={`${monthLabel(now.getMonth(), now.getFullYear())} Stats`} />
      <DashboardContent />
    </>
  );
}
