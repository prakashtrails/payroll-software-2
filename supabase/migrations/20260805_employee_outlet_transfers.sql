-- =============================================================
-- Employee outlet transfers (same-tenant, append-only audit trail)
-- Run this after 20260805_outlet_attendance_settings.sql (needs outlets)
-- =============================================================

CREATE TABLE IF NOT EXISTS outlet_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id        uuid REFERENCES profiles(id) ON DELETE CASCADE,
  from_outlet_id    uuid REFERENCES outlets(id),
  to_outlet_id      uuid REFERENCES outlets(id) NOT NULL,
  from_outlet_name  text NOT NULL DEFAULT '',
  to_outlet_name    text NOT NULL DEFAULT '',
  transferred_by    uuid REFERENCES profiles(id),
  notes             text NOT NULL DEFAULT '',
  transferred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outlet_transfers_profile ON outlet_transfers(profile_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outlet_transfers_tenant ON outlet_transfers(tenant_id);

ALTER TABLE outlet_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outlet_transfers: own history or admin/manager can select"
  ON outlet_transfers FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

CREATE POLICY "outlet_transfers: admin/manager can insert"
  ON outlet_transfers FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin') AND transferred_by = auth.uid());
