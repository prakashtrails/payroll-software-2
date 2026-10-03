-- =============================================================
-- ESSL punch-machine data is HR-only (28 Sep 2026, Raniwala request).
--
-- "HR" = role 'admin' of the same tenant (the HR portal), plus the platform
-- 'superadmin'. Managers / HODs / management / employees must not see the
-- machine feed. (Employees still see their OWN attendance and punches as
-- before -- that is attendance, not the machine feed.)
--
--   * essl_employee_master / essl_daily_punches (+ essl_code_summary, a
--     security_invoker view over them): SELECT for HR only; no client role
--     may write (only the SECURITY DEFINER ingest functions do).
--   * essl_devices holds each device's api_key -- managers could read it via
--     "tenant admin manage" (admin OR manager). Now HR only. No web screen
--     uses this table.
--   * essl_apply_to_attendance(): direct RPC callers must be HR (managers
--     removed). The profiles trigger path is unchanged.
-- =============================================================

-- ── Mirror tables ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "essl_employee_master: tenant hr read" ON essl_employee_master;
CREATE POLICY "essl_employee_master: tenant hr read" ON essl_employee_master FOR SELECT
  USING ((tenant_id = my_tenant_id() AND my_role() = 'admin') OR my_role() = 'superadmin');

DROP POLICY IF EXISTS "essl_daily_punches: tenant hr read" ON essl_daily_punches;
CREATE POLICY "essl_daily_punches: tenant hr read" ON essl_daily_punches FOR SELECT
  USING ((tenant_id = my_tenant_id() AND my_role() = 'admin') OR my_role() = 'superadmin');

-- Belt and braces on top of RLS: logged-in users may only read, anon nothing.
REVOKE ALL ON essl_employee_master, essl_daily_punches, essl_code_summary FROM anon, authenticated;
GRANT SELECT ON essl_employee_master, essl_daily_punches, essl_code_summary TO authenticated;

-- ── Device registry (api keys) ────────────────────────────────────────────
DROP POLICY IF EXISTS "essl_devices: tenant admin manage" ON essl_devices;
CREATE POLICY "essl_devices: tenant admin manage" ON essl_devices FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() = 'admin')
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() = 'admin');
REVOKE ALL ON essl_devices FROM anon;

-- ── Direct RPC: HR only ───────────────────────────────────────────────────
-- Only the permission check changes; the body is re-declared below via a
-- targeted replace in the live definition so it can't drift from 20260928_8.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.essl_apply_to_attendance(uuid, text[], date, date, boolean)'::regprocedure) INTO v_def;
  -- Already HR-only (this migration ran before): nothing to do. Safe to re-run.
  IF position($q$(tenant_id = p_tenant_id AND role = 'admin')$q$ IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position($q$(tenant_id = p_tenant_id AND role IN ('admin','manager'))$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'essl_apply_to_attendance permission check not in the expected form -- aborting';
  END IF;
  v_def := replace(v_def,
    $q$(tenant_id = p_tenant_id AND role IN ('admin','manager'))$q$,
    $q$(tenant_id = p_tenant_id AND role = 'admin')$q$);
  EXECUTE v_def;
END $$;
