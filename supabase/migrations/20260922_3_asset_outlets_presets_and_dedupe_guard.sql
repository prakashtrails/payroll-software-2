-- =============================================================
-- Asset management: three independent fixes/additions.
--
-- 1) Outlet-wise asset listing: assets currently have no location, so the
--    inventory can't be filtered by outlet the way every other admin list
--    (attendance, employees, ...) already is via OutletViewContext. Adds a
--    nullable outlet_id (a head-office/shared asset can be unassigned).
--
-- 2) Asset presets: a tenant-scoped catalog admins can seed once Raniwala
--    HR sends their standard equipment list, so "Add Asset" can offer
--    autocomplete instead of pure free text.
--
-- 3) Dedupe guard: investigating "Pushpander appears twice in Assignments"
--    found two real double-submit bugs in production data — the Assign
--    button has no in-flight guard, so a fast double-click fires
--    assignAsset() twice and inserts two asset_assignments rows for the
--    same asset in the same instant (e.g. Pushpendra Singh Rajput /
--    Desktop, both rows created ~0.7s apart). One case (Suraj Yadav / Dell
--    Laptop #1) left a phantom row stuck showing "Active" forever because
--    only one of the two duplicate rows ever got marked returned. A
--    partial unique index makes this impossible going forward: an asset
--    can only have one un-returned (returned_at IS NULL) assignment at a
--    time, so the second insert of a double-click now fails cleanly
--    instead of silently corrupting the assignment history. (The UI fix
--    disabling the button while saving is client-side, in AssetsPage.jsx.)
-- =============================================================

ALTER TABLE assets ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES outlets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assets_outlet ON assets(outlet_id);

CREATE TABLE IF NOT EXISTS asset_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  category    text NOT NULL DEFAULT 'General',
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_presets_tenant ON asset_presets(tenant_id, name);

ALTER TABLE asset_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_presets: tenant members can select" ON asset_presets FOR SELECT
  USING (tenant_id = my_tenant_id());
CREATE POLICY "asset_presets: admin can write" ON asset_presets FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

-- An asset can only be actively held (not yet returned) by one assignment
-- at a time — makes the double-submit bug fail loudly instead of leaving a
-- phantom "Active" row behind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_assignments_one_active_per_asset
  ON asset_assignments(asset_id) WHERE returned_at IS NULL;
