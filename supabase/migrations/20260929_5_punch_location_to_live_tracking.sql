-- Put every app/web punch location on the Live Tracking map.
--
-- A tracked (Live Tracking) employee's clock-in/out coordinates land on
-- attendance.punch_in_lat/lng and punch_out_lat/lng, but the Live Tracking
-- page only reads employee_location_pings, which until now came solely from
-- the client's background capture. Android no longer has background location
-- (CrewCore 2.0.0 / versionCode 50 dropped it for Play review), so for field
-- staff such as Raniwala's B2B SALES the punch itself is the only reliable
-- fix. This trigger copies it into a ping, for web and app alike, with no
-- extra client request.
--
-- Same gate as the pings INSERT policy: only while the employee's own
-- employee_tracking_toggles row is enabled. At most two rows per tracked
-- employee per clock-in/out pair.

CREATE OR REPLACE FUNCTION public.trg_attendance_punch_location_ping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_outlet uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employee_tracking_toggles t
    WHERE t.tenant_id = NEW.tenant_id AND t.employee_id = NEW.profile_id AND t.enabled = true
  ) THEN
    RETURN NULL;
  END IF;

  SELECT outlet_id INTO v_outlet FROM profiles WHERE id = NEW.profile_id;

  -- (0,0) is the app's old "no location" sentinel, never a real punch.
  IF NEW.punch_in_lat IS NOT NULL AND NEW.punch_in_lng IS NOT NULL
     AND NOT (NEW.punch_in_lat = 0 AND NEW.punch_in_lng = 0)
     AND (TG_OP = 'INSERT'
          OR NEW.punch_in_lat IS DISTINCT FROM OLD.punch_in_lat
          OR NEW.punch_in_lng IS DISTINCT FROM OLD.punch_in_lng) THEN
    INSERT INTO employee_location_pings (tenant_id, employee_id, outlet_id, lat, lng, recorded_date)
    VALUES (NEW.tenant_id, NEW.profile_id, v_outlet, NEW.punch_in_lat, NEW.punch_in_lng, NEW.date);
  END IF;

  IF NEW.punch_out_lat IS NOT NULL AND NEW.punch_out_lng IS NOT NULL
     AND NOT (NEW.punch_out_lat = 0 AND NEW.punch_out_lng = 0)
     AND (TG_OP = 'INSERT'
          OR NEW.punch_out_lat IS DISTINCT FROM OLD.punch_out_lat
          OR NEW.punch_out_lng IS DISTINCT FROM OLD.punch_out_lng) THEN
    INSERT INTO employee_location_pings (tenant_id, employee_id, outlet_id, lat, lng, recorded_date)
    VALUES (NEW.tenant_id, NEW.profile_id, v_outlet, NEW.punch_out_lat, NEW.punch_out_lng, NEW.date);
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_attendance_punch_location_ping ON public.attendance;
CREATE TRIGGER trg_attendance_punch_location_ping
  AFTER INSERT OR UPDATE OF punch_in_lat, punch_in_lng, punch_out_lat, punch_out_lng ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.trg_attendance_punch_location_ping();
