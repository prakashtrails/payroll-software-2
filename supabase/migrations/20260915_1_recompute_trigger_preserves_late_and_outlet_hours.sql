-- =============================================================
-- Two bugs in trg_recompute_attendance_from_punches (BEFORE UPDATE ON
-- attendance, see 20260914_2_fix_recompute_trigger_ignores_leave.sql):
--
-- 1. It unconditionally recomputes NEW.status as Present/Half Day/Absent
--    from punch-derived total_hours, for any UPDATE not issued by an
--    admin/manager/superadmin. A normal employee clock-out is exactly such
--    an UPDATE (see clockOut() in src/services/attendanceService.js and the
--    essl-punch edge function's out-punch handler) — so a day correctly
--    marked 'Late' at clock-in silently flips back to 'Present' the moment
--    the employee clocks out with a full day's hours, because this trigger
--    fires after the app's own UPDATE and overwrites whatever status it
--    just wrote. This is the root cause of late arrivals disappearing from
--    the Late Comers report once the employee clocks out.
--
-- 2. It only reads min_half_day_hours/min_full_day_hours from `tenants`,
--    ignoring any per-outlet override (outlets.min_half_day_hours /
--    min_full_day_hours, see 20260805_outlet_attendance_settings.sql) —
--    so an outlet with its own (e.g. shorter) full-day-hours threshold gets
--    the wrong Present/Half-Day/Absent cutoff on every punch-triggered
--    recompute, even though resolveAttendanceSettings() elsewhere in the
--    app always prefers the outlet's own setting.
--
-- Fix: resolve thresholds the same outlet-then-tenant way as
-- resolveAttendanceSettings() (src/services/tenantService.js), and if the
-- row was already 'Late' before this update and the hours-based recompute
-- would otherwise set 'Present', keep it 'Late' instead — a full day's
-- hours doesn't erase a late arrival. A short day (Half Day/Absent) still
-- wins over 'Late', since leaving early on top of arriving late is worse
-- than either alone, not something to hide behind the Late label.
-- =============================================================

CREATE OR REPLACE FUNCTION trg_recompute_attendance_from_punches()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_total numeric := 0;
  v_half  numeric;
  v_full  numeric;
  v_ins   text[];
  v_outs  text[];
  i       int;
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

  SELECT array_agg(punch_time ORDER BY punch_time) INTO v_ins
    FROM punches WHERE attendance_id = NEW.id AND punch_type = 'in';
  SELECT array_agg(punch_time ORDER BY punch_time) INTO v_outs
    FROM punches WHERE attendance_id = NEW.id AND punch_type = 'out';

  IF v_ins IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_ins, 1) LOOP
      IF v_outs IS NOT NULL AND i <= array_length(v_outs, 1) THEN
        -- Overnight shift (e.g. in 22:00, out 06:00 next day) makes a naive
        -- time-time subtraction negative; wrap past midnight instead of
        -- letting GREATEST(...,0) below silently zero the whole shift. Keeps
        -- this in sync with lib/helpers.ts diffHours, which wraps the same way.
        v_total := v_total + (
          (EXTRACT(EPOCH FROM (v_outs[i]::time - v_ins[i]::time))::numeric % 86400 + 86400) % 86400
        ) / 3600.0;
      END IF;
    END LOOP;
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
  -- Boundary matches the client's own convention (services/attendanceService.ts
  -- clockOut/applyRegularization both use >=), so this trigger's recompute
  -- can't silently downgrade a status the client just computed for the same hours.
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
