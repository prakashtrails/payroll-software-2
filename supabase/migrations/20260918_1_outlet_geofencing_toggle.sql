-- =============================================================
-- Per-outlet Geofencing on/off toggle (Toggle Services > Geofencing).
--
-- Problem: the location fence a punch must fall inside to clock in/out
-- could only be turned off entirely by clearing every geofence_lat/lng on
-- the tenant AND every outlet -- there was no way to exempt just ONE
-- outlet's staff while keeping the fence enforced everywhere else, short
-- of deleting that outlet's coordinates (which also breaks anything else
-- that reads them, e.g. an outlet map/display).
--
-- Fix: reuse the existing generic per-tenant/per-outlet feature-toggle
-- system (20260813_9_feature_toggles.sql) with a new 'geofencing' feature
-- key -- a superadmin flips it off for one outlet from Toggle Services,
-- Scope: <that outlet>, the same UI already used for every other
-- per-branch override. Default stays enabled (no row in
-- company_feature_toggles = enabled), so no existing tenant's behavior
-- changes until a superadmin explicitly turns an outlet off.
--
-- This only disables the fence CHECK -- clock-in/out, the attendance page,
-- etc. all keep working as normal for that outlet's employees, just
-- without location enforcement (and its auto clock-out safety net, which
-- has nothing to trigger once geofencing itself is off).
--
-- App-side wiring (same commit): src/lib/featureRegistry.js ('geofencing'
-- entry), src/services/featureService.js (isFeatureEnabledForOutlet),
-- src/hooks/useGeofenceClock.js, src/services/attendanceService.js
-- (clockIn/clockOut).
-- =============================================================

INSERT INTO features (key, name, category, description, sort_order, is_premium) VALUES
  ('geofencing', 'Geofencing', 'General',
   'Location-fence check on clock-in/out. Turn off for one outlet (via Scope) to let that outlet''s employees clock in/out from anywhere -- leave on everywhere else.',
   25, false)
ON CONFLICT (key) DO UPDATE
  SET name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_premium = excluded.is_premium;

-- Mirrors resolveFeatureState() in src/services/featureService.js: an
-- outlet-scoped row wins, else the company-wide row, else enabled (true) by
-- default -- same fallback order the client uses for every other toggle.
CREATE OR REPLACE FUNCTION outlet_geofencing_enabled(p_tenant_id uuid, p_outlet_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT enabled FROM company_feature_toggles
       WHERE tenant_id = p_tenant_id AND feature_key = 'geofencing' AND outlet_id = p_outlet_id),
    (SELECT enabled FROM company_feature_toggles
       WHERE tenant_id = p_tenant_id AND feature_key = 'geofencing' AND outlet_id IS NULL),
    true
  );
$$;

-- Re-published with one added early-out at the top: an employee whose home
-- outlet has geofencing switched off is always treated as inside the
-- fence, same as "not configured". Everything else about this function
-- (fence resolution, allow_any_outlet_clockin, multi-outlet access) is
-- unchanged from 20260827_1_server_side_geofence_enforcement.sql.
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

  IF NOT outlet_geofencing_enabled(v_tenant_id, v_home_outlet_id) THEN
    RETURN true;
  END IF;

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
