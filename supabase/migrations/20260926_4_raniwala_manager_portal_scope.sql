-- =============================================================
-- Raniwala manager portal, phase 2 (26 Sep 2026).
--
--   1. "HR Settings" (per-outlet feature toggles) moves from the outlet
--      manager to HR: admins may manage the same curated feature list for
--      any outlet in their tenant (or company-wide); Raniwala managers no
--      longer can. Other tenants' outlet managers keep it.
--   2. Expense claims and travel requests join the team-only scope that
--      20260926_1 put on every other request type.
--   3. Company setup (outlets, holidays, departments, designations,
--      locations, biometric devices) is HR-only at Raniwala: managers keep
--      read access, lose write access.
-- =============================================================


-- ── 1. HR Settings → HR ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "company_feature_toggles: admin can manage curated features" ON company_feature_toggles;
CREATE POLICY "company_feature_toggles: admin can manage curated features" ON company_feature_toggles
  FOR ALL
  USING (
    (select my_role()) = 'admin'
    AND tenant_id = (select my_tenant_id())
    AND feature_key = ANY (outlet_hr_toggleable_feature_keys())
  )
  WITH CHECK (
    (select my_role()) = 'admin'
    AND tenant_id = (select my_tenant_id())
    AND feature_key = ANY (outlet_hr_toggleable_feature_keys())
    AND (outlet_id IS NULL OR EXISTS (SELECT 1 FROM outlets o WHERE o.id = outlet_id AND o.tenant_id = (select my_tenant_id())))
  );

DROP POLICY IF EXISTS "company_feature_toggles: outlet manager can manage curated features" ON company_feature_toggles;
CREATE POLICY "company_feature_toggles: outlet manager can manage curated features" ON company_feature_toggles
  FOR ALL
  USING (
    my_role() = 'manager'
    AND NOT (select my_is_raniwala())
    AND tenant_id = my_tenant_id()
    AND outlet_id = (SELECT outlet_id FROM profiles WHERE id = auth.uid())
    AND outlet_id IS NOT NULL
    AND feature_key = ANY (outlet_hr_toggleable_feature_keys())
  )
  WITH CHECK (
    my_role() = 'manager'
    AND NOT (select my_is_raniwala())
    AND tenant_id = my_tenant_id()
    AND outlet_id = (SELECT outlet_id FROM profiles WHERE id = auth.uid())
    AND outlet_id IS NOT NULL
    AND feature_key = ANY (outlet_hr_toggleable_feature_keys())
  );


-- ── 2. Team scope for expense / travel ────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('expense_claims', 'profile_id'),
    ('travel_requests', 'profile_id')
  ) AS t(tbl, col)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || ': raniwala team scope', r.tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL
      USING (
        NOT ((select my_role()) IN ('manager', 'hod') AND (select my_is_raniwala()))
        OR %I = (select auth.uid())
        OR %I = ANY ((select my_team_ids())::uuid[])
      )
      WITH CHECK (
        NOT ((select my_role()) IN ('manager', 'hod') AND (select my_is_raniwala()))
        OR %I = (select auth.uid())
        OR %I = ANY ((select my_team_ids())::uuid[])
      )$f$, r.tbl || ': raniwala team scope', r.tbl, r.col, r.col, r.col, r.col);
  END LOOP;
END $$;


-- ── 3. Company setup is HR-only at Raniwala ───────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outlets', 'holidays', 'departments', 'designations', 'locations', 'essl_devices']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': raniwala manager no insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': raniwala manager no update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': raniwala manager no delete', t);
    EXECUTE format($f$CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT
      WITH CHECK (NOT ((select my_role()) = 'manager' AND (select my_is_raniwala())))$f$, t || ': raniwala manager no insert', t);
    EXECUTE format($f$CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE
      USING (NOT ((select my_role()) = 'manager' AND (select my_is_raniwala())))$f$, t || ': raniwala manager no update', t);
    EXECUTE format($f$CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE
      USING (NOT ((select my_role()) = 'manager' AND (select my_is_raniwala())))$f$, t || ': raniwala manager no delete', t);
  END LOOP;
END $$;
