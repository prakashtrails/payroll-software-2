import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { listAccessibleOutlets, resolveAttendanceSettings } from '@/services/tenantService';
import { isFeatureEnabledForOutlet } from '@/services/featureService';
import { getApprovedWfhForDate } from '@/services/wfhService';
import { todayStr, distanceMeters as calcDistance } from '@/lib/helpers';

// 30 seconds outside before auto clock-out triggers
export const AUTO_CLOCKOUT_GRACE_MS = 30000;

// Browsers without a GPS chip (most desktops/laptops) fall back to WiFi/IP-based
// positioning, which in India can be off by tens or hundreds of km — sometimes
// resolving to a completely different city. A fix with a large accuracy radius
// can't be trusted to enforce a geofence, so we refuse to treat it as "inside"
// even if the reported coordinates happen to land within range.
//
// 300m (rather than a tighter value) accommodates realistic WiFi-positioning
// accuracy on desktops/laptops with no GPS chip — a well-connected machine
// usually resolves to 50-150m, but 150m alone was rejecting legitimate
// in-office fixes on some networks. Mobile GPS fixes are typically <50m and
// clear this bar easily either way.
const MAX_LOCATION_ACCURACY_M = 300;

// A trustworthy fix captured by the background watcher (used to drive the live
// "Inside office area" status) is reused as a clock-in/out fallback when a fresh
// one-shot request can't get a fix in time — as long as it's no older than this.
const FALLBACK_POSITION_MAX_AGE_MS = 45000;

// The background watcher (watchPosition below, maximumAge 10s / timeout 15s)
// is already continuously updating lastGoodPosRef while the dashboard is open
// — by the time the user clicks Clock In/Out there's almost always a fix no
// more than ~15s old sitting there already. Reusing it outright instead of
// firing a brand new GPS/WiFi request is what makes the button feel instant;
// without this, every click paid the full cost of a fresh fix even though a
// perfectly good one was already on hand.
const FRESH_WATCHER_POS_MAX_AGE_MS = 15000;

// Hard budget for a *new* one-shot fix when there's no fresh watcher position
// to reuse (e.g. right after the page loads). Kept short so a slow/cold GPS
// can't stall the click — it falls back to the watcher's last-known-good fix
// (up to FALLBACK_POSITION_MAX_AGE_MS old) the moment this elapses, rather
// than the ~30s worst case of retrying at full accuracy then low accuracy.
const CLOCK_ACTION_FIX_TIMEOUT_MS = 2000;

// Budget for recording where an unfenced punch was made (see
// bestEffortPunchLocation). No background watcher runs when there's no fence,
// so this is usually a cold fix; still capped so the punch never waits long.
const BEST_EFFORT_FIX_TIMEOUT_MS = 5000;

// Checks a position against every candidate fence and returns whichever one it's
// inside (if any); when outside all of them, returns the nearest miss — ranked by
// how far past that outlet's own radius the position is, not raw distance, so a
// small nearby outlet doesn't lose to a big distant one just because it's "closer".
function evaluateFences(lat, lng, candidates) {
  let nearest = null;
  for (const c of candidates) {
    const dist = calcDistance(lat, lng, c.lat, c.lng);
    if (dist <= c.radius) return { inside: true, dist, outletName: c.name };
    const overshoot = dist - c.radius;
    if (!nearest || overshoot < nearest.overshoot) nearest = { dist, overshoot, outletName: c.name };
  }
  return { inside: false, dist: nearest?.dist ?? 0, outletName: nearest?.outletName ?? null };
}

// Shared geofenced clock-in/out behavior for any role's dashboard (employee,
// admin, manager, ...). Watches the browser's position against every outlet the
// profile is allowed to clock in from (their home outlet plus any extra
// multi-outlet access grants — see profile_outlet_access), exposes live status
// for the UI, and auto clocks-out via `onAutoClockOut` after a grace period spent
// outside every one of them. `isClockedIn` must reflect current punch state so
// the auto clock-out grace timer only runs while actually clocked in.
export function useGeofenceClock({ profile, tenant, isClockedIn, onAutoClockOut, bypassGeofence = false }) {
  const [accessibleOutlets, setAccessibleOutlets] = useState([]);
  const [isWfhToday, setIsWfhToday] = useState(false);
  const [outletGeofencingOff, setOutletGeofencingOff] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Checking location…');
  const [insideFence, setInsideFence] = useState(null); // null=unknown, true, false

  const watchRef = useRef(null);
  const graceTimerRef = useRef(null);
  const isClockedInRef = useRef(isClockedIn);
  const lastGoodPosRef = useRef(null); // most recent watcher fix trusted enough to fall back on
  useEffect(() => { isClockedInRef.current = isClockedIn; }, [isClockedIn]);

  useEffect(() => {
    if (!profile?.id) { setAccessibleOutlets([]); return; }
    let cancelled = false;
    listAccessibleOutlets(profile.id, profile.outlet_id, tenant).then(({ data }) => { if (!cancelled) setAccessibleOutlets(data || []); });
    return () => { cancelled = true; };
  }, [profile?.id, profile?.outlet_id, tenant?.id, tenant?.allow_any_outlet_clockin]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    getApprovedWfhForDate(profile.id, todayStr()).then(({ data }) => { if (!cancelled) setIsWfhToday(!!data); });
    return () => { cancelled = true; };
  }, [profile]);

  // Per-outlet superadmin toggle (Toggle Services > Geofencing, Scope: an
  // outlet) — checked against the employee's own outlet, same as the
  // server-side trigger in profile_punch_is_inside_geofence(). Resolving
  // this off the profile's actual home outlet (rather than, say, whichever
  // outlet an admin/manager happens to be *viewing* in the dashboard filter)
  // keeps this in sync with the DB check, which only ever knows the punching
  // employee's own outlet.
  useEffect(() => {
    if (!tenant?.id) { setOutletGeofencingOff(false); return; }
    let cancelled = false;
    isFeatureEnabledForOutlet(tenant.id, profile?.outlet_id || null, 'geofencing').then((enabled) => {
      if (!cancelled) setOutletGeofencingOff(!enabled);
    });
    return () => { cancelled = true; };
  }, [tenant?.id, profile?.outlet_id]);

  // One candidate fence per accessible outlet, each falling back to the tenant
  // default when that outlet has no override of its own. A profile with no
  // extra access grants (the common case) ends up with exactly one candidate —
  // its home outlet — so behavior is unchanged from the single-outlet check.
  const candidates = useMemo(() => {
    const outlets = accessibleOutlets.length ? accessibleOutlets : [null];
    return outlets
      .map((outlet) => ({ ...resolveAttendanceSettings(tenant, outlet), name: outlet?.name }))
      .filter((c) => c.geofence_lat != null && c.geofence_lng != null)
      .map((c) => ({ lat: c.geofence_lat, lng: c.geofence_lng, radius: c.geofence_radius, name: c.name }));
  }, [accessibleOutlets, tenant]);

  const multiOutlet = candidates.length > 1;
  // Approved WFH for today, or Live Tracking being on for this employee
  // (they're a field employee whose movement is already monitored, so
  // confining them to a fixed geofence defeats the point), lifts the
  // geofence entirely — clock in from anywhere.
  const geofenceEnabled = candidates.length > 0 && !isWfhToday && !bypassGeofence && !outletGeofencingOff;
  // Off by default (see 20260903_1_geofence_auto_clockout_toggle.sql) — a
  // superadmin opts individual tenants in from Tenant Management > Manage >
  // Settings, for tenants that want on-site staff confined to the premises.
  const autoClockoutEnabled = !!tenant?.auto_clockout_enabled;

  useEffect(() => {
    if (!geofenceEnabled) {
      setLocationStatus(
        bypassGeofence ? 'Live Tracking enabled — geofencing disabled for this employee'
          : outletGeofencingOff ? 'Geofencing disabled for your outlet'
          : isWfhToday ? 'Approved WFH today — geofencing disabled'
          : 'Geofencing not configured'
      );
      setInsideFence(true); // treat as always inside when not configured (WFH-approved, or tracking-bypassed)
      return;
    }
    if (!navigator.geolocation) {
      setLocationStatus('Geolocation not supported by this browser');
      setInsideFence(false);
      return;
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = pos.coords.accuracy;
        const accuracyTooLow = accuracy != null && accuracy > MAX_LOCATION_ACCURACY_M;
        const { inside, dist, outletName } = evaluateFences(pos.coords.latitude, pos.coords.longitude, candidates);
        const outside = !inside || accuracyTooLow;
        setInsideFence(!outside);

        // Cache trustworthy fixes so a slow/failed one-shot request at clock-in
        // time can fall back to the watcher's last known-good position instead
        // of blocking the user outright.
        if (!accuracyTooLow) {
          lastGoodPosRef.current = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: Date.now(),
          };
        }

        if (outside) {
          setLocationStatus(accuracyTooLow
            ? `Location too imprecise to verify (±${Math.round(accuracy)} m) — enable GPS/precise location`
            : multiOutlet
              ? `Outside your allowed outlets · ${Math.round(dist)} m from ${outletName || 'nearest one'}`
              : `Outside office area · ${Math.round(dist)} m away`);
          // Only start grace timer if clocked in, no timer already running, and
          // this tenant has opted into auto clock-out (off by default — see
          // 20260903_1_geofence_auto_clockout_toggle.sql). Tenants with staff
          // who legitimately work outside the fence during a shift must not be
          // force-clocked-out just for leaving the premises.
          if (autoClockoutEnabled && isClockedInRef.current && !graceTimerRef.current) {
            graceTimerRef.current = setTimeout(() => {
              onAutoClockOut?.(pos.coords.latitude, pos.coords.longitude);
              graceTimerRef.current = null;
            }, AUTO_CLOCKOUT_GRACE_MS);
          }
        } else {
          setLocationStatus(multiOutlet
            ? `Inside ${outletName} · ${Math.round(dist)} m from centre`
            : `Inside office area · ${Math.round(dist)} m from centre`);
          // Cancel grace timer — came back inside
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
  }, [geofenceEnabled, isWfhToday, bypassGeofence, outletGeofencingOff, candidates, multiOutlet, onAutoClockOut, autoClockoutEnabled]);

  // Cancel grace timer the moment the caller reports clocked-out (manual or auto)
  useEffect(() => {
    if (!isClockedIn && graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, [isClockedIn]);

  const getCurrentPos = (opts) =>
    new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, opts)
    );

  // One fast attempt at a fresh fix, capped at CLOCK_ACTION_FIX_TIMEOUT_MS so a
  // cold/slow GPS can't stall the click. maximumAge is generous here on
  // purpose — most browsers/OSes keep their own recent internal fix and
  // return it immediately, which is what makes this fast in practice. If it
  // doesn't resolve in time (or fails for any reason other than the user
  // denying permission), fall straight back to the watcher's last known-good
  // fix rather than retrying — a second network round trip is exactly the
  // kind of multi-second wait this is meant to avoid.
  const getResilientPos = useCallback(async () => {
    try {
      return await getCurrentPos({ enableHighAccuracy: true, timeout: CLOCK_ACTION_FIX_TIMEOUT_MS, maximumAge: FRESH_WATCHER_POS_MAX_AGE_MS });
    } catch (err) {
      if (err.code === 1) throw err; // permission denied — no point retrying
      const last = lastGoodPosRef.current;
      if (last && Date.now() - last.timestamp <= FALLBACK_POSITION_MAX_AGE_MS) {
        return { coords: last, timestamp: last.timestamp };
      }
      throw err;
    }
  }, []);

  // Authoritative geofence check for a fresh one-shot position: rejects both
  // "too far from every allowed outlet" and "too imprecise to trust" fixes.
  const checkPosition = useCallback((pos) => {
    const accuracy = pos.coords.accuracy;
    if (accuracy != null && accuracy > MAX_LOCATION_ACCURACY_M) {
      return { ok: false, message: `Your location is too imprecise to verify (±${Math.round(accuracy)} m). Enable GPS/precise location and try again.` };
    }
    const { inside, dist, outletName } = evaluateFences(pos.coords.latitude, pos.coords.longitude, candidates);
    if (!inside) {
      return {
        ok: false,
        message: multiOutlet
          ? `You are ${Math.round(dist)} m from ${outletName || 'the nearest allowed outlet'}. Move inside one of your allowed outlets.`
          : `You are ${Math.round(dist)} m from the office. Move inside the office area.`,
      };
    }
    return { ok: true };
  }, [candidates, multiOutlet]);

  // Where the punch was made, for the record only, when no geofence is
  // checked (Live Tracking field staff, WFH-approved, outlet without a fence).
  // Never blocks the punch: no fix in time, or no permission, just means the
  // punch is saved without coordinates. Only a tracked employee is prompted
  // for permission; everyone else is recorded only if the browser already
  // has it, so tenants without geofencing don't suddenly get a location prompt.
  const bestEffortPunchLocation = useCallback(async () => {
    if (!navigator.geolocation) return null;
    if (!bypassGeofence) {
      try {
        const perm = await navigator.permissions?.query({ name: 'geolocation' });
        if (perm?.state !== 'granted') return null;
      } catch {
        return null;
      }
    }
    try {
      const pos = await getCurrentPos({ enableHighAccuracy: true, timeout: BEST_EFFORT_FIX_TIMEOUT_MS, maximumAge: FALLBACK_POSITION_MAX_AGE_MS });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return null;
    }
  }, [bypassGeofence]);

  // Resolves a verified {lat,lng} to attach to a punch. When geofencing isn't
  // in effect (not configured, WFH-approved today, or Live Tracking bypass)
  // it's a best-effort, unverified position, or null.
  // Throws a user-facing message when the punch should be blocked.
  const resolveClockLocation = useCallback(async () => {
    if (!geofenceEnabled) return bestEffortPunchLocation();
    if (insideFence === false) throw new Error(multiOutlet
      ? 'You are outside all of your allowed clock-in locations. Move closer to one of them.'
      : 'You are outside the office area. Move closer to clock in/out.');
    if (insideFence === null) throw new Error('Waiting for location. Please allow location access and try again.');

    // Fast path: the background watcher almost always already has a fix no
    // older than FRESH_WATCHER_POS_MAX_AGE_MS by the time this runs — reuse
    // it instantly instead of waiting on a brand new GPS/WiFi request.
    const cached = lastGoodPosRef.current;
    if (cached && Date.now() - cached.timestamp <= FRESH_WATCHER_POS_MAX_AGE_MS) {
      const check = checkPosition({ coords: cached });
      if (!check.ok) throw new Error(check.message);
      return { lat: cached.latitude, lng: cached.longitude };
    }

    let pos;
    try {
      pos = await getResilientPos();
    } catch (err) {
      throw new Error(err.code === 1
        ? 'Location permission denied — please allow location access'
        : 'Could not get a location fix. Move to an open area with a clear sky view (or near a window) and try again.');
    }
    const check = checkPosition(pos);
    if (!check.ok) throw new Error(check.message);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }, [geofenceEnabled, insideFence, multiOutlet, checkPosition, getResilientPos, bestEffortPunchLocation]);

  return { geofenceEnabled, insideFence, locationStatus, resolveClockLocation, isWfhToday, autoClockoutEnabled };
}
