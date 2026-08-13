-- Employee location tracking: while an employee is clocked in, their browser
-- periodically logs a GPS ping. HR can then pick an employee and see today's
-- trail on a map, with consecutive nearby pings clustered client-side into
-- "stayed here for X" visits — no separate visits table needed.
--
-- This only ever captures location while the employee has the app open and
-- has granted location permission (same mechanism the geofenced clock-in
-- already relies on) — there is no way for a web app to track someone once
-- they close the tab. Scope is deliberately "while on duty", not "always on".

CREATE TABLE IF NOT EXISTS location_pings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy    double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_location_pings_profile_time ON location_pings(profile_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_pings_tenant_time  ON location_pings(tenant_id, recorded_at DESC);

ALTER TABLE location_pings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "location_pings: employee can insert own"
  ON location_pings FOR INSERT
  WITH CHECK (tenant_id = (select my_tenant_id()) AND profile_id = (select auth.uid()));

CREATE POLICY "location_pings: employee can view own"
  ON location_pings FOR SELECT
  USING (profile_id = (select auth.uid()));

CREATE POLICY "location_pings: HR can view tenant"
  ON location_pings FOR SELECT
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) IN ('admin', 'superadmin'));
