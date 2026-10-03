-- =============================================================
-- Outlet-scoped holidays.
--
-- Some tenants run different holiday calendars per outlet (e.g. a factory
-- floor closed for Vishwakarma Jayanti / Durga Puja / Dussehra while the
-- office stays open, and vice versa for Bhai Dooj / Govardhan Puja). The
-- `holidays` table was tenant-wide only — this adds an optional outlet_id
-- so a holiday can either apply company-wide (outlet_id NULL, unchanged
-- default behavior) or to one specific outlet only.
-- =============================================================

ALTER TABLE holidays ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES outlets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_holidays_outlet_id ON holidays(outlet_id);

-- The base schema's (tenant_id, date) unique constraint isn't tracked in any
-- migration (see 20260725_super_admin_platform.sql header) and its name is
-- unknown here, so locate it by column set rather than guessing a name.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'holidays'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(attname::text ORDER BY attname)
      FROM pg_attribute
      WHERE attrelid = rel.oid AND attnum = ANY(con.conkey)
    ) = ARRAY['date', 'tenant_id'];

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE holidays DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

-- Replacement: unique per (tenant, outlet, date), treating NULL outlet_id as
-- "the company-wide slot" so two tenant-wide holidays still can't collide on
-- the same date, while a tenant-wide holiday and an outlet-specific one on
-- the same date can coexist. Requires Postgres 15+ (NULLS NOT DISTINCT).
ALTER TABLE holidays
  ADD CONSTRAINT holidays_tenant_outlet_date_key UNIQUE NULLS NOT DISTINCT (tenant_id, outlet_id, date);

-- No RLS change needed: existing policies scope by tenant_id only (see
-- 20260810_rls_wrap_functions.sql, "holidays: *"), matching how outlet
-- scoping is already handled client-side elsewhere (OutletViewContext).

-- ── Sandwich-rule bridging must respect outlet-scoped holidays ──
-- Same function as 20260916_1_attendance_policy_engine.sql, extended so the
-- backward/forward holiday checks only count a holiday as a bridge day when
-- it applies to the requesting employee (tenant-wide OR their own outlet).
CREATE OR REPLACE FUNCTION record_leave_deduction(p_leave_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req         RECORD;
  v_type        uuid;
  v_days        numeric;
  v_day         date;
  v_tenant      RECORD;
  v_off_days    int[];
  v_cursor      date;
  v_bridge_back date[] := ARRAY[]::date[];
  v_bridge_fwd  date[] := ARRAY[]::date[];
  v_is_off      boolean;
BEGIN
  SELECT * INTO v_req FROM leave_requests WHERE id = p_leave_request_id;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF v_req.status <> 'Approved' THEN RAISE EXCEPTION 'Leave request is not Approved'; END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_req.tenant_id AND role IN ('admin','manager','superadmin'))
    OR (auth.uid() = v_req.profile_id AND v_req.required_approver_role = 'self')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Mark every day of the approved leave as 'Leave' on the attendance
  -- calendar. Idempotent by nature of the upsert -- safe to re-run.
  FOR v_day IN SELECT generate_series(v_req.start_date, v_req.end_date, interval '1 day')::date LOOP
    INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location)
    VALUES (v_req.tenant_id, v_req.profile_id, v_day, 'Leave', 0, 'Office')
    ON CONFLICT (profile_id, date) DO UPDATE SET status = 'Leave', total_hours = 0;
  END LOOP;

  -- Sandwich rule (opt-in per tenant): if this leave request is immediately
  -- bounded -- across a run of weekly-offs/holidays -- by ANOTHER approved
  -- leave request for the same employee, the off-days in between also count
  -- as leave. e.g. Sat leave + Sunday off + Mon leave = 3 leave days.
  SELECT t.*, o.weekly_off_days AS outlet_weekly_off_days, p.outlet_id AS profile_outlet_id
  INTO v_tenant
  FROM tenants t
  LEFT JOIN profiles p ON p.id = v_req.profile_id
  LEFT JOIN outlets o ON o.id = p.outlet_id
  WHERE t.id = v_req.tenant_id;

  IF v_tenant.sandwich_rule_enabled THEN
    v_off_days := COALESCE(v_tenant.outlet_weekly_off_days, v_tenant.weekly_off_days, ARRAY[0]);

    -- Walk backward from the day before this leave starts.
    v_cursor := v_req.start_date - 1;
    LOOP
      v_is_off := (EXTRACT(DOW FROM v_cursor)::int = ANY(v_off_days))
        OR EXISTS (
          SELECT 1 FROM holidays h
          WHERE h.tenant_id = v_req.tenant_id AND h.date = v_cursor
            AND (h.outlet_id IS NULL OR h.outlet_id = v_tenant.profile_outlet_id)
        );
      EXIT WHEN NOT v_is_off;
      v_bridge_back := array_append(v_bridge_back, v_cursor);
      v_cursor := v_cursor - 1;
    END LOOP;
    IF array_length(v_bridge_back, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM leave_requests lr
      WHERE lr.profile_id = v_req.profile_id AND lr.status = 'Approved' AND lr.end_date = v_cursor
    ) THEN
      v_bridge_back := ARRAY[]::date[];
    END IF;

    -- Walk forward from the day after this leave ends.
    v_cursor := v_req.end_date + 1;
    LOOP
      v_is_off := (EXTRACT(DOW FROM v_cursor)::int = ANY(v_off_days))
        OR EXISTS (
          SELECT 1 FROM holidays h
          WHERE h.tenant_id = v_req.tenant_id AND h.date = v_cursor
            AND (h.outlet_id IS NULL OR h.outlet_id = v_tenant.profile_outlet_id)
        );
      EXIT WHEN NOT v_is_off;
      v_bridge_fwd := array_append(v_bridge_fwd, v_cursor);
      v_cursor := v_cursor + 1;
    END LOOP;
    IF array_length(v_bridge_fwd, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM leave_requests lr
      WHERE lr.profile_id = v_req.profile_id AND lr.status = 'Approved' AND lr.start_date = v_cursor
    ) THEN
      v_bridge_fwd := ARRAY[]::date[];
    END IF;

    FOR v_day IN SELECT unnest(v_bridge_back || v_bridge_fwd) LOOP
      INSERT INTO attendance (tenant_id, profile_id, date, status, total_hours, location)
      VALUES (v_req.tenant_id, v_req.profile_id, v_day, 'Leave', 0, 'Office')
      ON CONFLICT (profile_id, date) DO UPDATE SET status = 'Leave', total_hours = 0;
    END LOOP;
  END IF;

  IF v_req.leave_type = 'Comp Off' THEN RETURN; END IF; -- balance handled by adjust_comp_off_balance instead

  -- Idempotent — a second call for the same request is a no-op.
  IF EXISTS (SELECT 1 FROM leave_ledger WHERE leave_request_id = p_leave_request_id) THEN RETURN; END IF;

  SELECT id INTO v_type FROM leave_types WHERE tenant_id = v_req.tenant_id AND name = v_req.leave_type LIMIT 1;
  IF v_type IS NULL THEN RETURN; END IF; -- no matching configured leave type — nothing to ledger

  v_days := (v_req.end_date - v_req.start_date) + 1
    + COALESCE(array_length(v_bridge_back, 1), 0)
    + COALESCE(array_length(v_bridge_fwd, 1), 0);

  INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, effective_date, leave_request_id, created_by)
  VALUES (v_req.tenant_id, v_req.profile_id, v_type, 'Deduction', -v_days, v_req.start_date, p_leave_request_id, auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION record_leave_deduction(uuid) TO authenticated;
