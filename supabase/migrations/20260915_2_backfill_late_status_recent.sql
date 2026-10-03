-- =============================================================
-- Re-run of 20260914_7_backfill_late_status_from_shift_settings.sql's
-- correction for the days since then, now that the actual root cause is
-- fixed (see 20260915_1_recompute_trigger_preserves_late_and_outlet_hours.sql
-- and the essl-punch edge function fix in the same commit):
--
-- essl-punch previously resolved shift_start/late_threshold from the ESSL
-- *device's* outlet_id, not each employee's own profiles.outlet_id. Raniwala
-- runs one shared device/API key across multiple outlets (see
-- supabase/functions/essl-web-poll/index.ts), so every employee synced
-- through it got evaluated against one single outlet's (or the tenant's
-- default) reporting time — e.g. Delhi employees clocking in at 10:52/11:03,
-- both before Delhi's actual 11:05 Shift Start, still got marked 'Late'
-- because the device's own outlet override (or lack of one) was used instead
-- of Delhi's.
--
-- This backfill is identical in logic to 20260914_7 (which already resolved
-- shift_start via each row's own profile.outlet_id correctly — the bug was
-- only ever in essl-punch's per-request settings, not this script) — just
-- re-run for the window since it last ran, since fresh device punches kept
-- getting written with the wrong status right up until the code fix above
-- landed.
-- =============================================================

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
  ALTER TABLE attendance DISABLE TRIGGER USER;

  FOR v_row IN
    SELECT a.id, a.profile_id, a.status,
           p.outlet_id, p.shift_id, p.tenant_id
    FROM attendance a
    JOIN profiles p ON p.id = a.profile_id
    WHERE a.date >= '2026-09-01'
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

  RAISE NOTICE 'Late/Present backfill (recent): % row(s) updated', v_updated;
END $$;
