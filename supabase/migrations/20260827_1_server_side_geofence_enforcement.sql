-- =============================================================
-- Server-side (DB-level) geofence enforcement for clock-IN.
--
-- Problem: geofencing was only ever enforced in application code
-- (src/hooks/useGeofenceClock.js client-side, src/services/attendanceService.js
-- clockIn()/clockOut()). Both run as the employee's own browser session over
-- the public Supabase REST API with the anon/authenticated key. RLS on
-- `attendance` only checked row ownership (profile_id = auth.uid()), never the
-- submitted coordinates -- so anyone comfortable calling the REST API directly
-- (devtools, curl with their own JWT) could INSERT an attendance row claiming
-- to be inside the fence, or with no location at all, completely bypassing the
-- app's check. That is the actual fraud vector this feature exists to close
-- (a fabricated on-site clock-in), so it needs a check the client cannot skip.
--
-- This migration adds that check as a BEFORE INSERT trigger on `attendance`,
-- re-deriving "inside an allowed fence" from the same data the app uses
-- (tenant/outlet geofence_lat/lng/radius, profile_outlet_access,
-- allow_any_outlet_clockin, approved WFH for the day) and rejecting the
-- INSERT outright if the submitted punch_in_lat/lng don't land inside any of
-- them. Mirrors checkGeofenceMulti()/geofenceIsConfigured() in
-- src/lib/helpers.js and clockIn() in src/services/attendanceService.js --
-- keep those in sync if the geofence rule ever changes.
--
-- Deliberately NOT applied to essl/manual-entry writes (service-role client,
-- auth.role() <> 'authenticated') or to admin/manager correcting someone
-- else's row (auth.uid() <> NEW.profile_id) -- those aren't live GPS punches.
--
-- Clock-OUT is intentionally left alone at the DB layer: the app already
-- blocks a manual out-of-fence clock-out (see clockOut() in
-- attendanceService.js), but useGeofenceClock's automatic safety-net
-- clock-out -- which force-ends a session specifically because the employee
-- left the fence -- authenticates as that same employee and must still be
-- able to write punch_out_lat/lng that are outside it. A DB trigger has no
-- way to tell "employee spoofing a punch" apart from "system honestly ending
-- an out-of-bounds session" on that same UPDATE, so enforcing it there would
-- either block the safety net or be trivially defeated by it.
-- =============================================================

CREATE OR REPLACE FUNCTION geofence_distance_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371000 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

-- True if (p_lat, p_lng) falls inside any fence the profile may clock in
-- from. Returns true when no fence is configured at all (unchanged from the
-- app's behavior: geofencing that was never set up never blocks a punch).
CREATE OR REPLACE FUNCTION profile_punch_is_inside_geofence(
  p_profile_id uuid, p_lat double precision, p_lng double precision
) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_home_outlet_id uuid;
  v_tenant_id       uuid;
  v_tenant          record;
  v_any_configured  boolean := false;
  v_inside          boolean := false;
  v_eff_lat         double precision;
  v_eff_lng         double precision;
  v_eff_radius      double precision;
  r record;
BEGIN
  SELECT outlet_id, tenant_id INTO v_home_outlet_id, v_tenant_id
  FROM profiles WHERE id = p_profile_id;

  SELECT id, geofence_lat, geofence_lng, geofence_radius, allow_any_outlet_clockin
    INTO v_tenant
    FROM tenants WHERE id = v_tenant_id;

  IF v_tenant.id IS NULL THEN
    RETURN true; -- no tenant resolved -- fail open, same as "not configured"
  END IF;

  FOR r IN
    SELECT o.geofence_lat, o.geofence_lng, o.geofence_radius
    FROM outlets o
    WHERE o.tenant_id = v_tenant.id
      AND o.is_active = true
      AND (
        v_tenant.allow_any_outlet_clockin = true
        OR o.id = v_home_outlet_id
        OR o.id IN (SELECT outlet_id FROM profile_outlet_access WHERE profile_id = p_profile_id)
      )
  LOOP
    v_eff_lat    := COALESCE(r.geofence_lat, v_tenant.geofence_lat);
    v_eff_lng    := COALESCE(r.geofence_lng, v_tenant.geofence_lng);
    v_eff_radius := COALESCE(r.geofence_radius, v_tenant.geofence_radius, 200);
    IF v_eff_lat IS NOT NULL AND v_eff_lng IS NOT NULL THEN
      v_any_configured := true;
      IF p_lat IS NOT NULL AND p_lng IS NOT NULL
         AND geofence_distance_meters(p_lat, p_lng, v_eff_lat, v_eff_lng) <= v_eff_radius THEN
        v_inside := true;
      END IF;
    END IF;
  END LOOP;

  -- No accessible outlet resolved to a fence (e.g. no outlet access rows at
  -- all) -- fall back to the tenant-level default, same as
  -- listAccessibleOutlets() returning [] on the client.
  IF NOT v_any_configured AND v_tenant.geofence_lat IS NOT NULL AND v_tenant.geofence_lng IS NOT NULL THEN
    v_any_configured := true;
    IF p_lat IS NOT NULL AND p_lng IS NOT NULL
       AND geofence_distance_meters(p_lat, p_lng, v_tenant.geofence_lat, v_tenant.geofence_lng)
           <= COALESCE(v_tenant.geofence_radius, 200) THEN
      v_inside := true;
    END IF;
  END IF;

  IF NOT v_any_configured THEN
    RETURN true;
  END IF;

  RETURN v_inside;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_geofence_on_attendance_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_wfh    boolean;
  v_exists boolean;
BEGIN
  -- Only the employee's own live self-service clock-in (authenticated
  -- session, inserting their own profile_id) is checked here.
  IF auth.role() = 'authenticated' AND auth.uid() = NEW.profile_id THEN
    -- clockIn() upserts with ON CONFLICT (profile_id, date) DO NOTHING to stay
    -- idempotent against double-taps/retries. A BEFORE INSERT trigger still
    -- fires on that proposed (soon to be discarded) row, so skip the check
    -- when today's row already exists -- otherwise a harmless duplicate
    -- attempt fired while the employee has since stepped outside the fence
    -- would raise a scary error instead of quietly no-opping like it should.
    SELECT EXISTS (
      SELECT 1 FROM attendance WHERE profile_id = NEW.profile_id AND date = NEW.date
    ) INTO v_exists;
    IF v_exists THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM wfh_requests
      WHERE profile_id = NEW.profile_id AND status = 'Approved'
        AND from_date <= NEW.date AND to_date >= NEW.date
    ) INTO v_wfh;

    IF NOT v_wfh AND NOT profile_punch_is_inside_geofence(NEW.profile_id, NEW.punch_in_lat, NEW.punch_in_lng) THEN
      RAISE EXCEPTION 'You are outside all of your allowed clock-in locations. Move inside one of them and try again.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_geofence_on_attendance_insert ON attendance;
CREATE TRIGGER trg_enforce_geofence_on_attendance_insert
  BEFORE INSERT ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION enforce_geofence_on_attendance_insert();
