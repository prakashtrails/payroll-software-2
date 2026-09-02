import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { listAccessibleOutlets, resolveAttendanceSettings } from '@/services/tenantService';
import { getApprovedWfhForDate } from '@/services/wfhService';
import { todayStr } from '@/lib/helpers';

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
export const AUTO_CLOCKOUT_GRACE_MS = 30000;

// Browsers without a GPS chip (most desktops/laptops) fall back to WiFi/IP-based
// positioning, which in India can be off by tens or hundreds of km — sometimes
// resolving to a completely different city. A fix with a large accuracy radius
// can't be trusted to enforce a geofence, so we refuse to treat it as "inside"
// even if the reported coordinates happen to land within range.
const MAX_LOCATION_ACCURACY_M = 150;

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
export function useGeofenceClock({ profile, tenant, isClockedIn, onAutoClockOut }) {
  const [accessibleOutlets, setAccessibleOutlets] = useState([]);
  const [isWfhToday, setIsWfhToday] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Checking location…');
  const [insideFence, setInsideFence] = useState(null); // null=unknown, true, false

  const watchRef = useRef(null);
  const graceTimerRef = useRef(null);
  const isClockedInRef = useRef(isClockedIn);
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
  // Approved WFH for today lifts the geofence entirely — clock in from anywhere.
  const geofenceEnabled = candidates.length > 0 && !isWfhToday;

  useEffect(() => {
    if (!geofenceEnabled) {
      setLocationStatus(isWfhToday ? 'Approved WFH today — geofencing disabled' : 'Geofencing not configured');
      setInsideFence(true); // treat as always inside when not configured (or WFH-approved)
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

        if (outside) {
          setLocationStatus(accuracyTooLow
            ? `Location too imprecise to verify (±${Math.round(accuracy)} m) — enable GPS/precise location`
            : multiOutlet
              ? `Outside your allowed outlets · ${Math.round(dist)} m from ${outletName || 'nearest one'}`
              : `Outside office area · ${Math.round(dist)} m away`);
          // Only start grace timer if clocked in and no timer already running
          if (isClockedInRef.current && !graceTimerRef.current) {
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
  }, [geofenceEnabled, isWfhToday, candidates, multiOutlet, onAutoClockOut]);

  // Cancel grace timer the moment the caller reports clocked-out (manual or auto)
  useEffect(() => {
    if (!isClockedIn && graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, [isClockedIn]);

  const getCurrentPos = () =>
    new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
    );

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

  // Resolves a verified {lat,lng} to attach to a punch. Returns null when
  // geofencing isn't in effect (not configured, or WFH-approved today).
  // Throws a user-facing message when the punch should be blocked.
  const resolveClockLocation = useCallback(async () => {
    if (!geofenceEnabled) return null;
    if (insideFence === false) throw new Error(multiOutlet
      ? 'You are outside all of your allowed clock-in locations. Move closer to one of them.'
      : 'You are outside the office area. Move closer to clock in/out.');
    if (insideFence === null) throw new Error('Waiting for location. Please allow location access and try again.');
    const pos = await getCurrentPos();
    const check = checkPosition(pos);
    if (!check.ok) throw new Error(check.message);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }, [geofenceEnabled, insideFence, multiOutlet, checkPosition]);

  return { geofenceEnabled, insideFence, locationStatus, resolveClockLocation, isWfhToday };
}
