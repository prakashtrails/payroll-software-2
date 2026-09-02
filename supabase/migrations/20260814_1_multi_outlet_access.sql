-- Multi-outlet clock-in access: some employees (e.g. HR visiting branches)
-- need to clock in/out from more than one outlet's geofence. A profile's
-- `outlet_id` stays their single "home" outlet for org-chart/reporting
-- purposes; this table adds a *supplementary* list of other outlets the
-- same profile is allowed to clock in/out from. Clock-in passes geofencing
-- if the employee is inside ANY of their allowed outlets (home + extras).

CREATE TABLE IF NOT EXISTS profile_outlet_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outlet_id   uuid NOT NULL REFERENCES outlets(id)  ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, outlet_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_outlet_access_profile ON profile_outlet_access(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_outlet_access_tenant  ON profile_outlet_access(tenant_id);

ALTER TABLE profile_outlet_access ENABLE ROW LEVEL SECURITY;

-- The employee needs to read their own extra outlets to evaluate geofencing
-- at clock-in time; admin/manager can see everyone's for the assignment UI.
CREATE POLICY "profile_outlet_access: own or admin/manager can select"
  ON profile_outlet_access FOR SELECT
  USING (
    tenant_id = (select my_tenant_id())
    AND (profile_id = (select auth.uid()) OR (select my_role()) IN ('admin', 'manager', 'superadmin'))
  );

CREATE POLICY "profile_outlet_access: admin/superadmin can insert"
  ON profile_outlet_access FOR INSERT
  WITH CHECK (tenant_id = (select my_tenant_id()) AND (select my_role()) IN ('admin', 'superadmin'));

CREATE POLICY "profile_outlet_access: admin/superadmin can delete"
  ON profile_outlet_access FOR DELETE
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) IN ('admin', 'superadmin'));
