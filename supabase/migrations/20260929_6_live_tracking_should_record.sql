-- One cheap check for the CrewCore app's background Live Tracking task:
-- should this employee's phone still be recording right now?
--
-- True only while the caller's own employee_tracking_toggles row is enabled
-- AND they're clocked in on p_date (more 'in' than 'out' punches that day,
-- the same rule the app's useClockInOut uses for its Clock In/Out button).
-- A clock-out from the web, the ESSL device or another phone therefore stops
-- a phone that's still recording in the background (or after being swiped
-- away) within one check. The task calls this every few minutes instead of
-- reading the toggle on every GPS fix, which is fewer requests than before.
--
-- p_date comes from the client (its local calendar day, like
-- employee_location_pings.recorded_date), not now() in UTC.

CREATE OR REPLACE FUNCTION public.live_tracking_should_record(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM employee_tracking_toggles t
           WHERE t.employee_id = auth.uid() AND t.enabled = true
         )
     AND COALESCE((
           SELECT count(*) FILTER (WHERE pu.punch_type = 'in')
                > count(*) FILTER (WHERE pu.punch_type = 'out')
           FROM attendance a
           JOIN punches pu ON pu.attendance_id = a.id
           WHERE a.profile_id = auth.uid() AND a.date = p_date
         ), false);
$function$;

REVOKE ALL ON FUNCTION public.live_tracking_should_record(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.live_tracking_should_record(date) TO authenticated;
