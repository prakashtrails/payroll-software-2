-- =============================================================
-- Simplifies "Late" to one fixed rule, everywhere, and applies it to
-- Raniwala Jewellers' 4 outlets: Report Time (outlets.shift_start) + Late
-- Allowed minutes (outlets.late_threshold) is the *whole* rule. A punch more
-- than Late Allowed minutes after Report Time is Late — every single day of
-- the month, no exceptions, no cap on how many times it happens.
--
-- This retires the separate monthly "grace waiver" mechanism added in
-- 20260914_6_outlet_monthly_late_grace.sql / extended in
-- 20260916_1_attendance_policy_engine.sql (outlets.late_grace_minutes +
-- late_grace_max_per_month, consumed via attendance.late_grace_used). That
-- mechanism let the first N late arrivals within a grace window each month
-- get silently flipped back to 'Present' — so a genuinely late employee could
-- vanish from the Late Comers Report entirely, and, once the N-per-month cap
-- was used up, an arrival that WAS within the grace window would flip back
-- to 'Late' anyway. Confirmed with HR this was more than needed: the client
-- wants exactly two numbers per outlet (Report Time, Late Allowed minutes)
-- and a report that highlights every late day, with a separate highlight
-- for employees who rack up more than 3 in a month (already how
-- src/pages/dashboard/LateComersReportPage.jsx reads MONTHLY_LATE_HIGHLIGHT_LIMIT
-- / lateThisMonth — that part needed no change).
--
-- The client-side mirrors (src/services/attendanceService.js clockIn(),
-- supabase/functions/essl-punch/index.ts) were simplified in this same
-- change to drop the grace-waiver branch — see that commit's diff. This
-- migration:
--   1. Adds a reusable recompute_attendance_late_status() so Settings ->
--      Attendance & Geofencing can re-score already-written rows the moment
--      an admin changes Report Time / Late Allowed for an outlet (wired up
--      in src/pages/dashboard/SettingsPage.jsx saveAttendanceSettings /
--      saveSettings), not just punches from that point on.
--   2. Sets Raniwala's 4 outlets to the client's fixed numbers and clears
--      the now-unused grace columns for them.
--   3. Runs that recompute once, now, for every Raniwala outlet, scoped from
--      2026-09-17 (the day 20260917_2_raniwala_timing_attendance_policy.sql
--      put these outlets' Report Times into effect) through today — NOT
--      further back, since attendance dated before that reflects whatever
--      different outlet names/timings were actually in effect at the time,
--      and rewriting it under today's Report Times would misrepresent that
--      history rather than correct it.
-- =============================================================

-- ── Reusable recompute, callable both from this migration (no auth.uid() —
-- trusted the same as every other migration in this repo) and from the app
-- as an authenticated admin/manager/superadmin action. ──────────────────
CREATE OR REPLACE FUNCTION recompute_attendance_late_status(
  p_tenant_id uuid,
  p_outlet_id uuid,      -- NULL = every outlet under the tenant
  p_from_date date,
  p_to_date   date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD;
  v_shift_start text;
  v_late_threshold int;
  v_first_in text;
  v_diff_min int;
  v_new_status text;
  v_updated int := 0;
BEGIN
  -- auth.uid() is NULL when run as a plain migration/service-role script
  -- (trusted, same as every DO block elsewhere in supabase/migrations/); a
  -- real end-user session must be admin/manager/superadmin for this tenant.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id AND role IN ('admin','manager','superadmin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Same reason as every backfill before this one: the plain UPDATE below
  -- would otherwise be immediately recomputed back to Present/Half
  -- Day/Absent by trg_recompute_attendance_from_punches, which has no
  -- concept of 'Late' unless the caller is already an authenticated
  -- admin/manager/superadmin (it trusts those and returns early). USER (not
  -- ALL) — ALL also tries to disable internal RI_ConstraintTrigger_* FK
  -- triggers this role doesn't own.
  ALTER TABLE attendance DISABLE TRIGGER USER;

  FOR v_row IN
    SELECT a.id, a.status, p.outlet_id, p.shift_id, p.tenant_id
    FROM attendance a
    JOIN profiles p ON p.id = a.profile_id
    WHERE p.tenant_id = p_tenant_id
      AND (p_outlet_id IS NULL OR p.outlet_id = p_outlet_id)
      AND a.date BETWEEN p_from_date AND p_to_date
      AND a.status IN ('Present', 'Late')
      AND a.location IN ('Office', 'Office (Device)')
  LOOP
    SELECT pu.punch_time INTO v_first_in
    FROM punches pu
    WHERE pu.attendance_id = v_row.id AND pu.punch_type = 'in'
    ORDER BY pu.punch_time
    LIMIT 1;

    IF v_first_in IS NULL THEN
      CONTINUE;
    END IF;

    v_shift_start := NULL;
    IF v_row.shift_id IS NOT NULL THEN
      SELECT s.start_time INTO v_shift_start FROM shifts s WHERE s.id = v_row.shift_id;
    END IF;

    -- Same outlet-then-tenant-then-hard-default precedence as
    -- resolveAttendanceSettings() in src/services/tenantService.js.
    SELECT
      COALESCE(v_shift_start, o.shift_start, t.shift_start, '10:30'),
      COALESCE(o.late_threshold, t.late_threshold, 0)
    INTO v_shift_start, v_late_threshold
    FROM tenants t
    LEFT JOIN outlets o ON o.id = v_row.outlet_id
    WHERE t.id = v_row.tenant_id;

    v_diff_min := (EXTRACT(HOUR FROM v_first_in::time)::int * 60 + EXTRACT(MINUTE FROM v_first_in::time)::int)
                - (EXTRACT(HOUR FROM v_shift_start::time)::int * 60 + EXTRACT(MINUTE FROM v_shift_start::time)::int);

    -- The whole rule: later than Report Time + Late Allowed minutes is Late.
    -- No grace waiver on top of this.
    v_new_status := CASE WHEN v_diff_min > v_late_threshold THEN 'Late' ELSE 'Present' END;

    IF v_new_status IS DISTINCT FROM v_row.status THEN
      UPDATE attendance SET status = v_new_status, late_grace_used = false WHERE id = v_row.id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  ALTER TABLE attendance ENABLE TRIGGER USER;

  RETURN v_updated;
END;
$$;
GRANT EXECUTE ON FUNCTION recompute_attendance_late_status(uuid, uuid, date, date) TO authenticated;

-- ── Raniwala's fixed numbers + retire the grace columns for its outlets ──
DO $$
DECLARE
  v_tenant  uuid;
  v_office  uuid;
  v_factory uuid;
  v_delhi   uuid;
  v_gurgaon uuid;
  v_updated int;
  v_total   int := 0;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_office  FROM outlets WHERE tenant_id = v_tenant AND name = 'Office Staff';
  SELECT id INTO v_factory FROM outlets WHERE tenant_id = v_tenant AND name = 'Factory Staff';
  SELECT id INTO v_delhi   FROM outlets WHERE tenant_id = v_tenant AND name = 'Delhi Experience Centre';
  SELECT id INTO v_gurgaon FROM outlets WHERE tenant_id = v_tenant AND name = 'Gurgaon Laa Polki Stories';

  IF v_office IS NULL OR v_factory IS NULL OR v_delhi IS NULL OR v_gurgaon IS NULL THEN
    RAISE EXCEPTION 'Expected outlets Office Staff/Factory Staff/Delhi Experience Centre/Gurgaon Laa Polki Stories not all found for Raniwala (tenant %) -- run 20260917_2_raniwala_timing_attendance_policy.sql first -- aborting, nothing changed', v_tenant;
  END IF;

  -- Office Staff: 10:20 AM Report Time, 10 minutes allowed -> Late at 10:31.
  UPDATE outlets SET late_threshold = 10, late_grace_minutes = NULL, late_grace_max_per_month = NULL
  WHERE id = v_office;

  -- Factory Staff: 09:30 AM Report Time, 5 minutes allowed -> Late at 09:36.
  UPDATE outlets SET late_threshold = 5, late_grace_minutes = NULL, late_grace_max_per_month = NULL
  WHERE id = v_factory;

  -- Delhi Experience Centre: 11:00 AM Report Time, 5 minutes allowed -> Late at 11:06.
  UPDATE outlets SET late_threshold = 5, late_grace_minutes = NULL, late_grace_max_per_month = NULL
  WHERE id = v_delhi;

  -- Gurgaon Laa Polki Stories: same 5-minute allowance as Factory/Delhi.
  UPDATE outlets SET late_threshold = 5, late_grace_minutes = NULL, late_grace_max_per_month = NULL
  WHERE id = v_gurgaon;

  -- Recompute every Raniwala outlet's attendance since these Report Times
  -- took effect, now against the fixed rule above (no grace waiver, so this
  -- also un-waives any late arrival that previously got forgiven).
  v_updated := recompute_attendance_late_status(v_tenant, v_office,  '2026-09-17', CURRENT_DATE); v_total := v_total + v_updated;
  v_updated := recompute_attendance_late_status(v_tenant, v_factory, '2026-09-17', CURRENT_DATE); v_total := v_total + v_updated;
  v_updated := recompute_attendance_late_status(v_tenant, v_delhi,   '2026-09-17', CURRENT_DATE); v_total := v_total + v_updated;
  v_updated := recompute_attendance_late_status(v_tenant, v_gurgaon, '2026-09-17', CURRENT_DATE); v_total := v_total + v_updated;

  RAISE NOTICE 'Raniwala fixed late-status recompute: % attendance row(s) updated', v_total;
END $$;
