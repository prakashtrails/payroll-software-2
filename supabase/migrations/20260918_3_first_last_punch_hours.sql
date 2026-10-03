-- =============================================================
-- Stops accidental double-punches (a duplicate scan a few seconds apart, or
-- an employee mistakenly re-scanning the ESSL machine after already
-- leaving) from corrupting total_hours.
--
-- trg_recompute_attendance_from_punches (see 20260914_2, 20260915_1) is the
-- actual source of truth for total_hours/status on every attendance UPDATE
-- made by a non-admin/manager/superadmin caller — which is BOTH the web
-- app's own clockOut() (src/services/attendanceService.js) AND the ESSL
-- device sync (supabase/functions/essl-punch/index.ts runs as the service
-- role, so auth.uid() is NULL there too and this trigger still applies).
-- Whatever total_hours those callers compute themselves gets overwritten by
-- this trigger's own recompute from the raw `punches` rows.
--
-- Until now that recompute paired punches by type: every 'in' (sorted
-- ascending) with the 'out' (sorted ascending) at the same index. That's
-- right for a clean day (in, out) or a real multi-session day (in, out,
-- in, out — e.g. a lunch break). But one extra, out-of-place punch — the
-- device logging the same scan twice, or an employee scanning again by
-- mistake after already punching out — shifts every later pairing by one
-- slot and can silently double-count or drop hours. Example: in 9:00, in
-- 9:02 (mistake), out 13:00 (lunch), in 14:00, out 18:00 -- the old pairing
-- matches (9:00->13:00) and (9:02->18:00), overcounting by the whole
-- lunch-to-close span instead of the correct (9:00->13:00)+(14:00->18:00).
--
-- Fixed rule (per the client): the day's FIRST punch, of either type, is
-- when they arrived; the day's LAST punch so far, of either type, is when
-- they left. Every punch in between — mistaken double-scan or not — is
-- still stored in `punches` for the audit trail, it just no longer moves
-- either end of the calculation. essl-punch's own local total_hours
-- computation was simplified to match in the same change; this migration
-- fixes the trigger that's actually authoritative.
-- =============================================================

CREATE OR REPLACE FUNCTION trg_recompute_attendance_from_punches()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_total numeric := 0;
  v_half  numeric;
  v_full  numeric;
  v_first text;
  v_last  text;
  v_outlet_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM leave_requests lr
    WHERE lr.profile_id = NEW.profile_id
      AND lr.status = 'Approved'
      AND NEW.date BETWEEN lr.start_date AND lr.end_date
  ) THEN
    NEW.status := 'Leave';
    RETURN NEW;
  END IF;

  IF my_role() IN ('admin','manager','superadmin') THEN
    RETURN NEW; -- trust manual admin corrections
  END IF;

  -- First punch of the day to the last, of EITHER type — not paired in/out
  -- sessions (see header). A stray duplicate scan or a mistaken re-punch
  -- after leaving is still stored, it just no longer skews the total.
  SELECT min(punch_time), max(punch_time) INTO v_first, v_last
  FROM punches WHERE attendance_id = NEW.id;

  IF v_first IS NOT NULL AND v_last IS NOT NULL THEN
    -- Wraps past midnight the same way lib/helpers.js diffHours does, for
    -- the rare overnight shift.
    v_total := (
      (EXTRACT(EPOCH FROM (v_last::time - v_first::time))::numeric % 86400 + 86400) % 86400
    ) / 3600.0;
  END IF;

  SELECT p.outlet_id INTO v_outlet_id FROM profiles p WHERE p.id = NEW.profile_id;

  SELECT
    COALESCE(o.min_half_day_hours, t.min_half_day_hours, 4),
    COALESCE(o.min_full_day_hours, t.min_full_day_hours, 8)
  INTO v_half, v_full
  FROM tenants t
  LEFT JOIN outlets o ON o.id = v_outlet_id
  WHERE t.id = NEW.tenant_id;

  NEW.total_hours := GREATEST(round(v_total * 100) / 100, 0);
  NEW.status := CASE
    WHEN NEW.total_hours >= v_full THEN 'Present'
    WHEN NEW.total_hours >= v_half THEN 'Half Day'
    ELSE 'Absent'
  END;

  IF OLD.status = 'Late' AND NEW.status = 'Present' THEN
    NEW.status := 'Late';
  END IF;

  RETURN NEW;
END;
$$;
