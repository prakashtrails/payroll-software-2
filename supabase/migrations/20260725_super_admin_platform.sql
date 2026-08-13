-- Super Admin platform console: lets a superadmin create companies (with a
-- ready admin login), organize each company into physical branches
-- ("outlets"), and see employees across every tenant. This schema/RLS is
-- additive only — the base schema (tenants, profiles, my_role()/my_tenant_id())
-- lives directly on the production project and isn't tracked here, so nothing
-- below assumes or replaces policies we can't see; every policy name is new.

-- ---- 1. outlets: physical branches/locations within a tenant ----
CREATE TABLE IF NOT EXISTS outlets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text,
  city        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outlets_tenant_id ON outlets(tenant_id);

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outlets: superadmin full access" ON outlets;
CREATE POLICY "outlets: superadmin full access"
  ON outlets FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

DROP POLICY IF EXISTS "outlets: tenant select own" ON outlets;
CREATE POLICY "outlets: tenant select own"
  ON outlets FOR SELECT
  USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS "outlets: admin/manager manage own tenant" ON outlets;
CREATE POLICY "outlets: admin/manager manage own tenant"
  ON outlets FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin', 'manager'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin', 'manager'));

-- ---- 2. profiles.outlet_id: which branch an employee belongs to ----
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES outlets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_outlet_id ON profiles(outlet_id);

-- ---- 3. Defensive superadmin bypass on tenants/profiles ----
-- Named distinctly from anything in tracked migrations so these purely ADD
-- superadmin coverage (create companies, edit any tenant/profile) without
-- risking collision with an existing policy of the same name but different
-- semantics. Superadmin being allowed to set role='superadmin' via WITH CHECK
-- is intentional, mirroring the existing exception in
-- 20260714_rls_privilege_escalation_fixes.sql for the same reason.
DROP POLICY IF EXISTS "tenants: superadmin_platform_all" ON tenants;
CREATE POLICY "tenants: superadmin_platform_all"
  ON tenants FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

DROP POLICY IF EXISTS "profiles: superadmin_platform_all" ON profiles;
CREATE POLICY "profiles: superadmin_platform_all"
  ON profiles FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');

-- ---- 4. One-time promotion of the platform owner account ----
-- Idempotent no-op if this email has no profile row yet (e.g. hasn't signed
-- up through /signup for the first time). Safe to re-run.
UPDATE profiles
   SET role = 'superadmin'
 WHERE email = 'prakashgovtportal@gmail.com'
   AND role IS DISTINCT FROM 'superadmin';
