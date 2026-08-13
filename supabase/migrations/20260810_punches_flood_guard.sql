-- Server-side guard against duplicate/flooded punch inserts. Runs as a
-- trigger (not app-level code) so it can't be bypassed by calling PostgREST
-- directly, and it's scoped per attendance_id so 10,000 different employees
-- punching in at once never contend with each other -- each check only reads
-- that one employee's own punch history.
CREATE OR REPLACE FUNCTION punches_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count int;
  v_total_count  int;
BEGIN
  -- Cooldown: block a second punch of the same type within 10s (double-click,
  -- slow-network retry, or a client-side spam loop).
  SELECT count(*) INTO v_recent_count
  FROM punches
  WHERE attendance_id = NEW.attendance_id
    AND punch_type = NEW.punch_type
    AND created_at > now() - interval '10 seconds';

  IF v_recent_count > 0 THEN
    RAISE EXCEPTION 'Please wait a few seconds before punching again.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Sanity cap: stop a scripted flood against one attendance record even if
  -- it's spaced out beyond the cooldown window above.
  SELECT count(*) INTO v_total_count
  FROM punches
  WHERE attendance_id = NEW.attendance_id;

  IF v_total_count >= 40 THEN
    RAISE EXCEPTION 'Too many punches recorded for this day. Contact your admin.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_punches_guard ON punches;
CREATE TRIGGER trg_punches_guard
  BEFORE INSERT ON punches
  FOR EACH ROW
  EXECUTE FUNCTION punches_guard();
