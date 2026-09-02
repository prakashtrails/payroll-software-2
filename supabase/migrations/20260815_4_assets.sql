-- =============================================================
-- Asset Management: a tenant-wide inventory of company equipment, plus an
-- assignment history linking each asset to the employees who've held it.
-- Run after supabase_migration.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  category       text NOT NULL DEFAULT 'General',
  serial_number  text NOT NULL DEFAULT '',
  purchase_date  date,
  status         text NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Assigned','Retired')),
  notes          text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenant_id, status);

CREATE TABLE IF NOT EXISTS asset_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  asset_id         uuid NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_at      date NOT NULL DEFAULT current_date,
  returned_at      date,
  condition_notes  text NOT NULL DEFAULT '',
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_tenant  ON asset_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset   ON asset_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_profile ON asset_assignments(profile_id);

ALTER TABLE assets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assets: tenant members can select" ON assets FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "assets: admin can write" ON assets FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "asset_assignments: own or admin/manager can select" ON asset_assignments FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));
CREATE POLICY "asset_assignments: admin/manager can insert" ON asset_assignments FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "asset_assignments: admin/manager can update" ON asset_assignments FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
CREATE POLICY "asset_assignments: admin/manager can delete" ON asset_assignments FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));
