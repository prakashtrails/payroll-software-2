-- ESSL biometric device integration: lets a tenant's on-premise ESSL punch
-- machine (via its local eTimeTrackLite software/DB) push punch events into
-- CrewCore attendance, so an employee punching at the physical machine shows
-- up as clocked in/out here too -- not just employees using the app.
--
-- Flow: a local sync agent (outside this repo, runs on the PC connected to
-- the machine) reads new rows out of eTimeTrackLite's local database and
-- POSTs them to the essl-punch Edge Function using the device's api_key.
-- The Edge Function maps each ESSL employee code to a CrewCore profile via
-- profiles.essl_employee_code, then applies the exact same attendance/status
-- logic as the app's own clock-in/clock-out.

-- ---- 1. essl_devices: one row per physical ESSL machine registered to a tenant ----
CREATE TABLE IF NOT EXISTS essl_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id    uuid REFERENCES outlets(id) ON DELETE SET NULL,
  name         text NOT NULL,
  api_key      text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  is_active    boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE essl_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "essl_devices: tenant admin manage" ON essl_devices;
CREATE POLICY "essl_devices: tenant admin manage"
  ON essl_devices FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin', 'manager'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin', 'manager'));

DROP POLICY IF EXISTS "essl_devices: superadmin manage all" ON essl_devices;
CREATE POLICY "essl_devices: superadmin manage all"
  ON essl_devices FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- ---- 2. Employee <-> ESSL device mapping ----
-- The employee code configured on the ESSL device/enrolment software. Stored
-- on profiles (not a separate mapping table) because eTimeTrackLite assigns
-- one global employee code per person across the tenant's whole device
-- estate, so device-scoping it would just add join complexity with no payoff.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS essl_employee_code text;

-- One ESSL code can't point at two different employees within the same tenant.
DROP INDEX IF EXISTS profiles_essl_employee_code_tenant_uidx;
CREATE UNIQUE INDEX profiles_essl_employee_code_tenant_uidx
  ON profiles (tenant_id, essl_employee_code)
  WHERE essl_employee_code IS NOT NULL;

-- ---- 3. Track punch origin so admins can tell a device punch from a self-service one ----
ALTER TABLE punches ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app'
  CHECK (source IN ('app', 'device', 'manual'));
