-- =============================================================
-- Backfill: recompute Present vs Late for existing attendance rows using the
-- shift-start / late-threshold settings that are actually configured today,
-- instead of whatever the old client-side default was at clock-in time.
--
-- Scope: attendance rows dated 2026-08-18 through today, with status
-- currently 'Present' or 'Late', written by an actual punch -- app clock-in
-- (location = 'Office') or ESSL biometric device sync (location = 'Office
-- (Device)', see supabase/functions/essl-punch/index.ts) -- excludes admin
-- 'Office (Manual)' and 'Office (Regularized)' entries, which were
-- deliberately hand-set and shouldn't be second-guessed, and NOT already
-- covered by the one-time-per-month late grace waiver
-- (late_grace_used = true) -- those were intentionally waived and must stay
-- 'Present'.
--
-- Effective shift start / late threshold per row, same precedence as
-- resolveAttendanceSettings() in src/services/tenantService.js:
--   profile's custom shift (shifts.start_time) if assigned
--     > outlet override (outlets.shift_start / late_threshold)
--     > tenant default (tenants.shift_start / late_threshold)
--     > hard default: 10:30 AM reporting time, late_threshold 0
--       (i.e. a punch at 10:31 or later is Late) -- matches the new JS
--       default in resolveAttendanceSettings.
--
-- Attendance triggers are disabled for the duration so the plain status
-- UPDATE below isn't immediately recomputed back from total_hours (the
-- BEFORE UPDATE trg_recompute_attendance_from_punches trigger only knows
-- Present/Half Day/Absent from hours -- it has no concept of "Late" -- and
-- would otherwise silently undo this).
-- =============================================================

-- Defensive: make sure the columns this backfill reads actually exist on this
-- database before querying them. The live DB was found to be missing
-- late_grace_used (from 20260914_6_outlet_monthly_late_grace.sql) even though
-- it's tracked in this repo's migrations, so don't assume migration order —
-- IF NOT EXISTS makes each of these a no-op if it's already there.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_grace_used boolean NOT NULL DEFAULT false;
ALTER TABLE outlets    ADD COLUMN IF NOT EXISTS shift_start text;
ALTER TABLE outlets    ADD COLUMN IF NOT EXISTS shift_end text;
ALTER TABLE outlets    ADD COLUMN IF NOT EXISTS late_threshold integer;
ALTER TABLE outlets    ADD COLUMN IF NOT EXISTS late_grace_minutes integer;

DO $$
DECLARE
  v_row RECORD;
  v_shift_start text;
  v_late_threshold int;
  v_first_in text;
  v_diff_min int;
  v_new_status text;
  v_updated int := 0;
BEGIN
  -- USER (not ALL) -- ALL also tries to disable the internal RI_ConstraintTrigger_*
  -- foreign-key triggers, which the Supabase SQL-editor role isn't the owner of
  -- and can't touch (42501 permission denied); USER only touches the trigger
  -- functions defined above, which is all this needs.
  ALTER TABLE attendance DISABLE TRIGGER USER;

  FOR v_row IN
    SELECT a.id, a.profile_id, a.status,
           p.outlet_id, p.shift_id, p.tenant_id
    FROM attendance a
    JOIN profiles p ON p.id = a.profile_id
    WHERE a.date >= '2026-08-18'
      AND a.date <= CURRENT_DATE
      AND a.status IN ('Present', 'Late')
      AND a.location IN ('Office', 'Office (Device)')
      AND COALESCE(a.late_grace_used, false) = false
  LOOP
    SELECT p.punch_time INTO v_first_in
    FROM punches p
    WHERE p.attendance_id = v_row.id AND p.punch_type = 'in'
    ORDER BY p.punch_time
    LIMIT 1;

    IF v_first_in IS NULL THEN
      CONTINUE;
    END IF;

    v_shift_start := NULL;
    IF v_row.shift_id IS NOT NULL THEN
      SELECT s.start_time INTO v_shift_start FROM shifts s WHERE s.id = v_row.shift_id;
    END IF;

    SELECT
      COALESCE(v_shift_start, o.shift_start, t.shift_start, '10:30'),
      COALESCE(o.late_threshold, t.late_threshold, 0)
    INTO v_shift_start, v_late_threshold
    FROM tenants t
    LEFT JOIN outlets o ON o.id = v_row.outlet_id
    WHERE t.id = v_row.tenant_id;

    v_diff_min := (EXTRACT(HOUR FROM v_first_in::time)::int * 60 + EXTRACT(MINUTE FROM v_first_in::time)::int)
                - (EXTRACT(HOUR FROM v_shift_start::time)::int * 60 + EXTRACT(MINUTE FROM v_shift_start::time)::int);

    v_new_status := CASE WHEN v_diff_min > v_late_threshold THEN 'Late' ELSE 'Present' END;

    IF v_new_status IS DISTINCT FROM v_row.status THEN
      UPDATE attendance SET status = v_new_status WHERE id = v_row.id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  ALTER TABLE attendance ENABLE TRIGGER USER;

  RAISE NOTICE 'Late/Present backfill: % row(s) updated', v_updated;
END $$;
