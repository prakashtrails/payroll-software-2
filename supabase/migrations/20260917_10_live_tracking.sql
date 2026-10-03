-- Live Tracking: premium, opt-in-per-tenant field-tracking feature.
--
-- Two new tables:
--   1. employee_tracking_toggles — per-employee on/off switch (an admin/
--      manager turns tracking on for one field employee at a time; the
--      employee's own client reads its own row to decide whether to start
--      capturing).
--   2. employee_location_pings — the actual GPS trail, written by the
--      employee's own client while tracking is on and they're clocked in,
--      read back by admin/manager for the Live Tracking page's map + stats.
--
-- Ships as a PREMIUM feature (features.is_premium = true, added below). The
-- app-side resolveFeatureState()/FeatureContext change (same commit) makes a
-- premium feature default OFF for every tenant unless a superadmin
-- explicitly turns it on from Toggle Services. Nothing here auto-enables it
-- for any existing customer.

-- ---- 1. employee_tracking_toggles ----
CREATE TABLE IF NOT EXISTS employee_tracking_toggles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES profiles(id),
  UNIQUE (tenant_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_ett_tenant ON employee_tracking_toggles(tenant_id);

ALTER TABLE employee_tracking_toggles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_tracking_toggles: self or admin can select" ON employee_tracking_toggles;
CREATE POLICY "employee_tracking_toggles: self or admin can select"
  ON employee_tracking_toggles FOR SELECT
  USING (tenant_id = my_tenant_id() AND (employee_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

DROP POLICY IF EXISTS "employee_tracking_toggles: admin manages" ON employee_tracking_toggles;
CREATE POLICY "employee_tracking_toggles: admin manages"
  ON employee_tracking_toggles FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

-- ---- 2. employee_location_pings ----
CREATE TABLE IF NOT EXISTS employee_location_pings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outlet_id     uuid REFERENCES outlets(id) ON DELETE SET NULL,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  accuracy      double precision,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  -- Set client-side from the same local-day helper every other date field in
  -- this app uses (todayStr()/getLocalDateString) — avoids reading back the
  -- wrong calendar day from a UTC conversion for IST users.
  recorded_date date NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_elp_employee_date ON employee_location_pings(tenant_id, employee_id, recorded_date);

ALTER TABLE employee_location_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_location_pings: admin can select" ON employee_location_pings;
CREATE POLICY "employee_location_pings: admin can select"
  ON employee_location_pings FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

-- An employee may only insert their own pings, and only while their own
-- tracking toggle is on — a defense-in-depth check so a tampered client
-- can't write pings just because it can reach the table; the real on/off
-- gate is this row plus the live_tracking feature flag checked client-side.
DROP POLICY IF EXISTS "employee_location_pings: self insert while tracked" ON employee_location_pings;
CREATE POLICY "employee_location_pings: self insert while tracked"
  ON employee_location_pings FOR INSERT
  WITH CHECK (
    tenant_id = my_tenant_id()
    AND employee_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM employee_tracking_toggles t
      WHERE t.tenant_id = employee_location_pings.tenant_id
        AND t.employee_id = auth.uid()
        AND t.enabled = true
    )
  );

-- Latest ping per employee, for the Live Tracking list's "last seen" column.
-- security_invoker so it re-checks the querying user's own RLS on the base
-- table rather than the view owner's — an employee querying this view still
-- only ever sees rows they'd be allowed to see directly (none, per the
-- SELECT policy above), admins see their tenant's employees.
DROP VIEW IF EXISTS employee_last_ping;
CREATE VIEW employee_last_ping WITH (security_invoker = true) AS
SELECT DISTINCT ON (employee_id) employee_id, tenant_id, lat, lng, recorded_at
FROM employee_location_pings
ORDER BY employee_id, recorded_at DESC;

-- ---- 3. Register + seed the feature ----
ALTER TABLE features ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;

INSERT INTO features (key, name, category, description, sort_order, is_premium) VALUES
  ('live_tracking', 'Live Tracking', 'Premium', 'Real-time and historical field-employee location tracking, with standing/moving time and a route map. Opt in per employee.', 700, true)
ON CONFLICT (key) DO UPDATE
  SET name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_premium = excluded.is_premium;
