-- =============================================================
-- App-punch approval: status of a day that's still open (29 Sep 2026).
--
-- Bug: Aman Biswas (Raniwala, Office Staff) clocked in from the app at
-- 10:35; HR approved it and the day flipped to 'Absent'. The recompute
-- scored the day purely on hours between the first and last APPROVED
-- punch — with only a clock-in approved that's 0 h, i.e. Absent.
--
-- Fix (trg_recompute_attendance_from_punches, live def from
-- 20260928_10_app_punch_manager_approval.sql): when the latest approved
-- punch is a clock-IN (no clock-out yet), the day isn't scored on hours:
--   * today  -> Late if the first approved punch is after Report Time +
--               Late Allowed (same rule as recompute_attendance_late_status),
--               otherwise Present — what clockIn() shows for a normal day;
--   * past   -> Mispunch when the tenant has mark_single_punch_mispunch
--               (Raniwala), else Late/Present as above — the same
--               single-punch rule essl_apply_to_attendance() uses. Only
--               when leaving 'Pending Approval' / on a review, so nothing
--               else about past days changes.
-- A closed day (latest approved punch is 'out') keeps the hours rule, and
-- now re-derives Late on EVERY exit from Pending Approval or review.
--
-- Applies to every tenant's app punches; the open-day branch only changes
-- days that previously came out as 0-hour Absent.
-- =============================================================

CREATE OR REPLACE FUNCTION public.trg_recompute_attendance_from_punches()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total numeric := 0;
  v_half  numeric;
  v_full  numeric;
  v_first text;
  v_last  text;
  v_last_type text;
  v_outlet_id uuid;
  v_shift_id uuid;
  v_shift_start text;
  v_late_min int;
  v_forced boolean := current_setting('app.punch_review', true) = 'on';
  v_pending boolean;
  v_unreviewed boolean;
  v_reviewing boolean;
  v_is_late boolean;
  v_single_mispunch boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
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

  SELECT COALESCE(bool_or(approval_status = 'pending'), false),
         COALESCE(bool_or(approval_status <> 'approved'), false)
  INTO v_pending, v_unreviewed
  FROM punches WHERE attendance_id = NEW.id;

  IF my_role() IN ('admin','manager','superadmin')
     AND NOT v_forced
     AND (auth.uid() IS DISTINCT FROM NEW.profile_id OR NOT v_unreviewed) THEN
    RETURN NEW; -- trust manual admin corrections
  END IF;

  -- approved regularize request being applied by apply_approved_regularize_request()
  IF current_setting('app.regularize_apply', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Mispunch' AND NOT v_forced
     AND (SELECT count(*) FROM punches WHERE attendance_id = NEW.id) <= 1 THEN
    RETURN NEW;
  END IF;

  SELECT min(punch_time), max(punch_time) INTO v_first, v_last
  FROM punches WHERE attendance_id = NEW.id AND approval_status = 'approved';

  SELECT punch_type INTO v_last_type
  FROM punches WHERE attendance_id = NEW.id AND approval_status = 'approved'
  ORDER BY punch_time DESC, created_at DESC
  LIMIT 1;

  IF v_first IS NOT NULL AND v_last IS NOT NULL THEN
    v_total := (
      (EXTRACT(EPOCH FROM (v_last::time - v_first::time))::numeric % 86400 + 86400) % 86400
    ) / 3600.0;
  END IF;

  SELECT p.outlet_id, p.shift_id INTO v_outlet_id, v_shift_id FROM profiles p WHERE p.id = NEW.profile_id;

  SELECT
    COALESCE(o.min_half_day_hours, t.min_half_day_hours, 4),
    COALESCE(o.min_full_day_hours, t.min_full_day_hours, 8)
  INTO v_half, v_full
  FROM tenants t
  LEFT JOIN outlets o ON o.id = v_outlet_id
  WHERE t.id = NEW.tenant_id;

  -- Report Time + Late Allowed — same precedence as recompute_attendance_late_status().
  IF v_shift_id IS NOT NULL THEN
    SELECT s.start_time INTO v_shift_start FROM shifts s WHERE s.id = v_shift_id;
  END IF;
  SELECT COALESCE(v_shift_start, o.shift_start, t.shift_start, '10:30'),
         COALESCE(o.late_threshold, t.late_threshold, 0),
         COALESCE(t.mark_single_punch_mispunch, false)
  INTO v_shift_start, v_late_min, v_single_mispunch
  FROM tenants t
  LEFT JOIN outlets o ON o.id = v_outlet_id
  WHERE t.id = NEW.tenant_id;

  v_reviewing := v_forced OR OLD.status = 'Pending Approval';
  v_is_late := v_first IS NOT NULL AND
    (EXTRACT(HOUR FROM v_first::time)::int * 60 + EXTRACT(MINUTE FROM v_first::time)::int)
    - (EXTRACT(HOUR FROM v_shift_start::time)::int * 60 + EXTRACT(MINUTE FROM v_shift_start::time)::int)
    > v_late_min;

  NEW.total_hours := GREATEST(round(v_total * 100) / 100, 0);
  NEW.status := CASE
    WHEN NEW.total_hours >= v_full THEN 'Present'
    WHEN NEW.total_hours >= v_half THEN 'Half Day'
    ELSE 'Absent'
  END;

  IF v_pending THEN
    NEW.status := 'Pending Approval';
  ELSIF v_last_type = 'in' AND (NEW.date >= v_today OR v_reviewing) THEN
    -- No clock-out yet: judged on arrival time, not (unfinished) hours. A
    -- past day that never got one is a Mispunch where the tenant opts in.
    NEW.status := CASE
      WHEN NEW.date < v_today AND v_single_mispunch THEN 'Mispunch'
      WHEN v_is_late THEN 'Late'
      ELSE 'Present'
    END;
  ELSIF OLD.status = 'Late' AND NEW.status = 'Present' THEN
    NEW.status := 'Late';
  ELSIF v_reviewing AND NEW.status = 'Present' AND v_is_late THEN
    NEW.status := 'Late';
  END IF;

  RETURN NEW;
END;
$function$;

-- Re-derive app-punch days already reviewed under the old rule that came
-- out as a 0-hour Absent while clocked in (e.g. Aman Biswas, 29 Sep).
DO $$
BEGIN
  PERFORM set_config('app.punch_review', 'on', true);
  UPDATE attendance a SET total_hours = total_hours
  WHERE a.status = 'Absent'
    AND a.date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7
    AND EXISTS (SELECT 1 FROM punches pu WHERE pu.attendance_id = a.id AND pu.reviewed_at IS NOT NULL);
  PERFORM set_config('app.punch_review', 'off', true);
END $$;
