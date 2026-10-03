-- =============================================================
-- Applies Raniwala Jewellers' written Timing & Attendance Policy
-- ("Timing & Attendance.docx") onto the attendance-policy engine built in
-- 20260916_1_attendance_policy_engine.sql (+ 20260914_5/_6 outlet shift
-- timing/grace). Scoped entirely to Raniwala's tenant_id and its 4 existing
-- outlets — Sales Outlet and Worklocation, and every other tenant, are
-- untouched.
--
-- Policy -> engine mapping:
--   "10-minute grace, up to 3x/month"    -> outlets.late_threshold = 0,
--                                           late_grace_minutes = N,
--                                           late_grace_max_per_month = 3
--   Week Off                             -> outlets.weekly_off_days
--   "One early departure OR one late     -> shifts.early_departure_after /
--    arrival per month, else half-day"      late_arrival_allowance_until
--                                           (per-shift; profiles.shift_id
--                                           assigned per outlet below)
--   Late-arrival deduction ladder        -> tenants.late_deduction_enabled
--     4-6 late = 0.5 day, 7+ = 1 day        + tier2/tier3 columns (already
--     flat (confirmed with HR: no          matched the doc's defaults, set
--     further tier beyond 9)                explicitly here anyway)
--   Sandwich Rule                        -> tenants.sandwich_rule_enabled
--
-- Confirmed with HR before writing this:
--   - Factory Staff's "late arrival up to 11:00 PM" is a typo for 11:00 AM
--     (Factory shift starts 09:30 AM).
--   - No further deduction tier beyond 9 late instances — stays flat at the
--     7+ tier's 1 day.
--   - Gurgaon Laa Polki Stories' two shift timings (11:00 AM and 12:30 PM)
--     can't be split by employee from the document — every current Gurgaon
--     employee defaults to the 11:00 AM-7:30 PM shift; HR/admin moves the
--     12:30 PM group individually afterward via Settings -> Shifts.
--   - Gurgaon's weekly off is "yet to plan" per the document -- left
--     unset (falls back to the tenant-wide default) rather than guessed.
-- =============================================================

DO $$
DECLARE
  v_tenant       uuid;
  v_office       uuid;
  v_factory      uuid;
  v_delhi        uuid;
  v_gurgaon      uuid;
  v_shift_office uuid;
  v_shift_factory uuid;
  v_shift_delhi  uuid;
  v_shift_gurgaon1 uuid;
  v_shift_gurgaon2 uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_office  FROM outlets WHERE tenant_id = v_tenant AND trim(lower(name)) = 'office';
  SELECT id INTO v_factory FROM outlets WHERE tenant_id = v_tenant AND trim(lower(name)) = 'factory';
  SELECT id INTO v_delhi   FROM outlets WHERE tenant_id = v_tenant AND trim(lower(name)) = 'delhi';
  SELECT id INTO v_gurgaon FROM outlets WHERE tenant_id = v_tenant AND trim(lower(name)) = 'gurgaon';

  IF v_office IS NULL OR v_factory IS NULL OR v_delhi IS NULL OR v_gurgaon IS NULL THEN
    RAISE EXCEPTION 'Expected outlets Office/Factory/Delhi/Gurgaon not all found for Raniwala (tenant %) -- aborting, nothing changed', v_tenant;
  END IF;

  -- ── Shift A — Office Staff: 10:20 AM-7:15 PM, 10-min grace up to 3x/month,
  -- Week Off Sunday. Early departure from 5:30 PM, late arrival up to 12:00 PM
  -- (one-time/month, else Half Day).
  UPDATE outlets SET
    name = 'Office Staff',
    shift_start = '10:20',
    shift_end = '19:15',
    late_threshold = 0,
    late_grace_minutes = 10,
    late_grace_max_per_month = 3,
    weekly_off_days = ARRAY[0]
  WHERE id = v_office;

  -- ── Shift B — Factory Staff: 09:30 AM-6:00 PM, 5-min grace up to 3x/month,
  -- Week Off Sunday. Early departure from 4:30 PM, late arrival up to 11:00 AM
  -- (confirmed typo fix from the document's "11:00 PM").
  UPDATE outlets SET
    name = 'Factory Staff',
    shift_start = '09:30',
    shift_end = '18:00',
    late_threshold = 0,
    late_grace_minutes = 5,
    late_grace_max_per_month = 3,
    weekly_off_days = ARRAY[0]
  WHERE id = v_factory;

  -- ── Shift C — Delhi Experience Centre: 11:00 AM-7:30 PM, 5-min grace up to
  -- 3x/month, Week Off Monday. Early departure from 6:00 PM, late arrival up
  -- to 12:30 PM (one-time/month, else Half Day).
  UPDATE outlets SET
    name = 'Delhi Experience Centre',
    shift_start = '11:00',
    shift_end = '19:30',
    late_threshold = 0,
    late_grace_minutes = 5,
    late_grace_max_per_month = 3,
    weekly_off_days = ARRAY[1]
  WHERE id = v_delhi;

  -- ── Shift D — Gurgaon Laa Polki Stories: two timings, 5-min grace up to
  -- 3x/month. Week Off left unset ("yet to plan" per the document) -- falls
  -- back to the tenant-wide default until HR decides. Outlet-level
  -- shift_start/shift_end set to the 11:00 AM timing (the default shift
  -- below); the 12:30 PM group gets its own correct start time once assigned
  -- to shift 2.
  UPDATE outlets SET
    name = 'Gurgaon Laa Polki Stories',
    shift_start = '11:00',
    shift_end = '19:30',
    late_threshold = 0,
    late_grace_minutes = 5,
    late_grace_max_per_month = 3
  WHERE id = v_gurgaon;

  -- ── Per-shift monthly early-departure/late-arrival allowance ──────────
  -- Only takes effect for employees whose profiles.shift_id points at one of
  -- these rows (assigned below), since shifts.early_departure_after /
  -- late_arrival_allowance_until are per-shift, not per-outlet.

  SELECT id INTO v_shift_office FROM shifts WHERE tenant_id = v_tenant AND name = 'Office Staff';
  IF v_shift_office IS NULL THEN
    INSERT INTO shifts (tenant_id, name, start_time, end_time, total_hours, early_departure_after, late_arrival_allowance_until)
    VALUES (v_tenant, 'Office Staff', '10:20', '19:15', 8.42, '17:30', '12:00')
    RETURNING id INTO v_shift_office;
  ELSE
    UPDATE shifts SET start_time = '10:20', end_time = '19:15', total_hours = 8.42,
      early_departure_after = '17:30', late_arrival_allowance_until = '12:00'
    WHERE id = v_shift_office;
  END IF;

  SELECT id INTO v_shift_factory FROM shifts WHERE tenant_id = v_tenant AND name = 'Factory Staff';
  IF v_shift_factory IS NULL THEN
    INSERT INTO shifts (tenant_id, name, start_time, end_time, total_hours, early_departure_after, late_arrival_allowance_until)
    VALUES (v_tenant, 'Factory Staff', '09:30', '18:00', 8.0, '16:30', '11:00')
    RETURNING id INTO v_shift_factory;
  ELSE
    UPDATE shifts SET start_time = '09:30', end_time = '18:00', total_hours = 8.0,
      early_departure_after = '16:30', late_arrival_allowance_until = '11:00'
    WHERE id = v_shift_factory;
  END IF;

  SELECT id INTO v_shift_delhi FROM shifts WHERE tenant_id = v_tenant AND name = 'Delhi Experience Centre';
  IF v_shift_delhi IS NULL THEN
    INSERT INTO shifts (tenant_id, name, start_time, end_time, total_hours, early_departure_after, late_arrival_allowance_until)
    VALUES (v_tenant, 'Delhi Experience Centre', '11:00', '19:30', 8.0, '18:00', '12:30')
    RETURNING id INTO v_shift_delhi;
  ELSE
    UPDATE shifts SET start_time = '11:00', end_time = '19:30', total_hours = 8.0,
      early_departure_after = '18:00', late_arrival_allowance_until = '12:30'
    WHERE id = v_shift_delhi;
  END IF;

  SELECT id INTO v_shift_gurgaon1 FROM shifts WHERE tenant_id = v_tenant AND name = 'Gurgaon Laa Polki Stories - 11:00 AM';
  IF v_shift_gurgaon1 IS NULL THEN
    INSERT INTO shifts (tenant_id, name, start_time, end_time, total_hours, early_departure_after, late_arrival_allowance_until)
    VALUES (v_tenant, 'Gurgaon Laa Polki Stories - 11:00 AM', '11:00', '19:30', 8.0, '18:00', '12:30')
    RETURNING id INTO v_shift_gurgaon1;
  ELSE
    UPDATE shifts SET start_time = '11:00', end_time = '19:30', total_hours = 8.0,
      early_departure_after = '18:00', late_arrival_allowance_until = '12:30'
    WHERE id = v_shift_gurgaon1;
  END IF;

  SELECT id INTO v_shift_gurgaon2 FROM shifts WHERE tenant_id = v_tenant AND name = 'Gurgaon Laa Polki Stories - 12:30 PM';
  IF v_shift_gurgaon2 IS NULL THEN
    INSERT INTO shifts (tenant_id, name, start_time, end_time, total_hours, early_departure_after, late_arrival_allowance_until)
    VALUES (v_tenant, 'Gurgaon Laa Polki Stories - 12:30 PM', '12:30', '21:00', 8.0, '19:30', '14:00')
    RETURNING id INTO v_shift_gurgaon2;
  ELSE
    UPDATE shifts SET start_time = '12:30', end_time = '21:00', total_hours = 8.0,
      early_departure_after = '19:30', late_arrival_allowance_until = '14:00'
    WHERE id = v_shift_gurgaon2;
  END IF;

  -- ── Assign every current employee at each outlet to that outlet's shift,
  -- so the monthly allowance actually takes effect for them. Gurgaon
  -- defaults everyone to the 11:00 AM shift (confirmed) -- move the 12:30 PM
  -- group individually via Settings -> Shifts afterward.
  UPDATE profiles SET shift_id = v_shift_office  WHERE tenant_id = v_tenant AND outlet_id = v_office;
  UPDATE profiles SET shift_id = v_shift_factory WHERE tenant_id = v_tenant AND outlet_id = v_factory;
  UPDATE profiles SET shift_id = v_shift_delhi   WHERE tenant_id = v_tenant AND outlet_id = v_delhi;
  UPDATE profiles SET shift_id = v_shift_gurgaon1 WHERE tenant_id = v_tenant AND outlet_id = v_gurgaon;

  -- ── Tenant-wide: late-arrival deduction ladder + Sandwich Rule ─────────
  -- Tier defaults (4-6 lates -> 0.5 day, 7+ lates -> 1 day flat) already
  -- matched the document; set explicitly here for certainty. Confirmed with
  -- HR: no further tier beyond 9 -- stays flat at 1 day.
  UPDATE tenants SET
    late_deduction_enabled = true,
    late_deduction_tier2_min = 4,
    late_deduction_tier2_days = 0.5,
    late_deduction_tier3_min = 7,
    late_deduction_tier3_days = 1,
    sandwich_rule_enabled = true
  WHERE id = v_tenant;
END $$;
