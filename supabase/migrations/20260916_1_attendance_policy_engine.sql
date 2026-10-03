-- =============================================================
-- Reusable, opt-in attendance-policy engine (built for Raniwala Jewellers'
-- written Timing & Attendance policy, but gated behind flags so no other
-- tenant's behavior changes unless they opt in).
--
-- New capability                          | Off-by-default via
-- ----------------------------------------|--------------------------------
-- Monthly late grace, up to N uses/month  | outlets.late_grace_max_per_month
--   (was hardcoded to exactly 1 use)      |   NULL -> 1 (unchanged)
-- Per-outlet week-off (overrides tenant)  | outlets.weekly_off_days
--                                         |   NULL -> falls back to tenant
-- Early-departure / extreme-late-arrival  | shifts.early_departure_after /
--   monthly allowance (1 use/month, then |   shifts.late_arrival_allowance_until
--   half-day)                             |   NULL -> feature off for that shift
-- Late-arrival-count deduction ladder     | tenants.late_deduction_enabled
--   (extra day(s) deducted in payroll)   |   default false
-- Leave "sandwich rule" (an off-day       | tenants.sandwich_rule_enabled
--   bracketed by approved leave on both  |   default false
--   sides also counts as leave)          |
-- =============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sandwich_rule_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS late_deduction_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS late_deduction_tier2_min int NOT NULL DEFAULT 4;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS late_deduction_tier2_days numeric NOT NULL DEFAULT 0.5;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS late_deduction_tier3_min int NOT NULL DEFAULT 7;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS late_deduction_tier3_days numeric NOT NULL DEFAULT 1;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS late_grace_max_per_month int;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS weekly_off_days int[];

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS early_departure_after time;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS late_arrival_allowance_until time;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS monthly_allowance_used boolean NOT NULL DEFAULT false;


-- ── Sandwich rule, wired into the existing approval choke-point ──
-- record_leave_deduction() already runs for every approval path (self,
-- manager, admin — see src/services/leaveService.js). Extending it here
-- rather than adding a second trigger avoids re-deriving the same
-- authorization/idempotency checks a third time.
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
  SELECT t.*, o.weekly_off_days AS outlet_weekly_off_days
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
        OR EXISTS (SELECT 1 FROM holidays h WHERE h.tenant_id = v_req.tenant_id AND h.date = v_cursor);
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
        OR EXISTS (SELECT 1 FROM holidays h WHERE h.tenant_id = v_req.tenant_id AND h.date = v_cursor);
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
