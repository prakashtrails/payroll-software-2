-- =============================================================
-- Hierarchy & Workflow Engine — Phase 1a: org structure tables
-- (hierarchy_levels, designations, locations)
--
-- Purely additive. Does NOT touch profiles/departments/outlets.
-- profiles.department/designation/manager_id/outlet_id keep working
-- unchanged; these new tables let a tenant define a real structure
-- that later phases resolve against, without breaking anything that
-- reads the existing flat columns today.
-- =============================================================

-- ── Hierarchy levels: tenant-defined, ordered (rank 1 = top) ──
CREATE TABLE IF NOT EXISTS hierarchy_levels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  rank       int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rank),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_hierarchy_levels_tenant ON hierarchy_levels(tenant_id, rank);

-- ── Locations: independent of outlets (an outlet can map to a location,
--    but locations can nest, e.g. Region > City, which outlets can't) ──
CREATE TABLE IF NOT EXISTS locations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  parent_location_id  uuid REFERENCES locations(id) ON DELETE SET NULL,
  outlet_id           uuid REFERENCES outlets(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_location_id);

-- ── Designations: job-title master data, optionally tied to a
--    hierarchy level and/or department ──
CREATE TABLE IF NOT EXISTS designations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  hierarchy_level_id  uuid REFERENCES hierarchy_levels(id) ON DELETE SET NULL,
  department_id       uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_designations_tenant ON designations(tenant_id);

ALTER TABLE hierarchy_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE designations     ENABLE ROW LEVEL SECURITY;

-- hierarchy_levels
CREATE POLICY "hierarchy_levels: tenant members can read"
  ON hierarchy_levels FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

CREATE POLICY "hierarchy_levels: admin/superadmin can write"
  ON hierarchy_levels FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

CREATE POLICY "hierarchy_levels: superadmin_platform_all"
  ON hierarchy_levels FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- locations
CREATE POLICY "locations: tenant members can read"
  ON locations FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

CREATE POLICY "locations: admin/manager can write"
  ON locations FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "locations: superadmin_platform_all"
  ON locations FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- designations
CREATE POLICY "designations: tenant members can read"
  ON designations FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

CREATE POLICY "designations: admin/manager can write"
  ON designations FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "designations: superadmin_platform_all"
  ON designations FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');
