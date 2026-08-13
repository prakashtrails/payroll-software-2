-- Postgres reuses a policy's USING expression as its WITH CHECK when no
-- explicit WITH CHECK is given, so most UPDATE-only-USING policies in this
-- schema already block cross-tenant row moves implicitly. Two real gaps
-- remain, fixed below:
--
-- 1. "profiles: admin/manager can update tenant" never inspects the `role`
--    column of the new row, so a tenant admin/manager can set anyone's role
--    to 'superadmin' — which then grants cross-tenant visibility into every
--    other company's payroll data via the "tenant: superadmin sees all" and
--    "profiles: admin/manager sees tenant" SELECT policies.
--
-- 2. "rq_tenant_update" on request_quotas allows ANY member of a tenant
--    (not just admin/manager, and not just the row's own owner) to update
--    ANY employee's approval-quota row — letting a regular employee reset
--    their own self_approved_count to bypass the "3 self-approvals/month"
--    cap that the whole tiered-approval system depends on.

-- ---- 1. profiles: block role escalation on update ----
DROP POLICY IF EXISTS "profiles: admin/manager can update tenant" ON profiles;
CREATE POLICY "profiles: admin/manager can update tenant"
  ON profiles FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'))
  WITH CHECK (
    tenant_id = my_tenant_id()
    AND (role <> 'superadmin' OR my_role() = 'superadmin')
  );

-- ---- 2. request_quotas: route increments through a SECURITY DEFINER RPC ----
-- Only admin/manager may write request_quotas directly now (e.g. manual
-- corrections). Employees get their own-row increments via the RPC below,
-- which enforces ownership/role AND only ever increments (never resets).
DROP POLICY IF EXISTS "rq_tenant_update" ON request_quotas;
CREATE POLICY "rq_tenant_update" ON request_quotas FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin','manager','superadmin')
    )
  );

CREATE OR REPLACE FUNCTION increment_request_quota(p_tenant_id uuid, p_profile_id uuid, p_field text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role   text;
  v_caller_tenant uuid;
  v_month         smallint := EXTRACT(MONTH FROM now())::smallint;
  v_year          int      := EXTRACT(YEAR FROM now())::int;
BEGIN
  IF p_field NOT IN ('self_approved_count', 'manager_approved_count') THEN
    RAISE EXCEPTION 'Invalid quota field: %', p_field;
  END IF;

  SELECT role, tenant_id INTO v_caller_role, v_caller_tenant
  FROM profiles WHERE id = auth.uid();

  IF v_caller_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Not authorized for this tenant';
  END IF;

  IF NOT (auth.uid() = p_profile_id OR v_caller_role IN ('admin','manager','superadmin')) THEN
    RAISE EXCEPTION 'Not authorized to update this quota';
  END IF;

  INSERT INTO request_quotas (tenant_id, profile_id, month, year)
  VALUES (p_tenant_id, p_profile_id, v_month, v_year)
  ON CONFLICT (tenant_id, profile_id, month, year) DO NOTHING;

  IF p_field = 'self_approved_count' THEN
    UPDATE request_quotas SET self_approved_count = self_approved_count + 1, updated_at = now()
      WHERE tenant_id = p_tenant_id AND profile_id = p_profile_id AND month = v_month AND year = v_year;
  ELSE
    UPDATE request_quotas SET manager_approved_count = manager_approved_count + 1, updated_at = now()
      WHERE tenant_id = p_tenant_id AND profile_id = p_profile_id AND month = v_month AND year = v_year;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_request_quota(uuid, uuid, text) TO authenticated;
