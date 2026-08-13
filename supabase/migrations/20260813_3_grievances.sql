-- =============================================================
-- Confidential grievance intake — filer + admin/superadmin only, no
-- manager visibility (deliberately narrower than the usual pattern).
-- (Onboarding checklists and the Separation/F&F lifecycle that originally
-- shipped alongside this migration were removed post-build at the user's
-- request — this file was trimmed to just the grievance feature that's
-- staying.)
-- Run after supabase_migration.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS grievances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type              text NOT NULL DEFAULT 'Other',
  description       text NOT NULL,
  status            text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Under Review','Resolved','Dismissed')),
  assigned_to       uuid REFERENCES profiles(id),
  resolution_notes  text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grievances_tenant  ON grievances(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_grievances_profile ON grievances(profile_id);

ALTER TABLE grievances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grievances: filer or admin/superadmin can select"
  ON grievances FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','superadmin')));
CREATE POLICY "grievances: tenant member can insert own"
  ON grievances FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND profile_id = auth.uid());
CREATE POLICY "grievances: admin/superadmin can update"
  ON grievances FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));
