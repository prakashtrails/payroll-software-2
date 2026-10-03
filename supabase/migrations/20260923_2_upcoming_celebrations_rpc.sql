-- Upcoming birthdays & work anniversaries for the Home dashboard (web
-- src/pages/home/HomePage.jsx and the CrewCore mobile Home tab).
--
-- Both screens used to query profiles / profile_details directly, but RLS
-- only lets an employee SELECT their own row on those tables
-- (20260820_profiles_select_role_check.sql,
-- 20260812_employee_profile_details.sql) — so an employee only ever saw
-- themselves. Opening those tables up would leak PAN/bank/CTC, so instead
-- this SECURITY DEFINER function returns only what the cards display:
-- name, division, outlet name and the date.
--
-- Scope: employees see their own outlet only (an employee with no outlet
-- sees others with no outlet); admin/manager/superadmin see their whole
-- tenant. Only Active employees are included.
--
-- DOB reads profiles.date_of_birth first (HR-managed,
-- 20260918_4_profiles_date_of_birth.sql) and falls back to the self-set
-- profile_details.date_of_birth — same rule as send_birthday_notifications()
-- (20260918_7_birthday_notifications.sql).
--
-- "Today" is computed in Asia/Kolkata to match the birthday notification
-- cron. Adding whole years as an interval maps a 29 Feb date to 28 Feb in
-- non-leap years instead of erroring.

CREATE OR REPLACE FUNCTION list_upcoming_celebrations(p_days int DEFAULT 5)
RETURNS TABLE (
  kind text,              -- 'birthday' | 'anniversary'
  profile_id uuid,
  first_name text,
  middle_name text,
  last_name text,
  division text,
  outlet_location text,
  event_date date,        -- the original DOB / join date
  next_date date,         -- next occurrence on or after today
  days_away int,
  years int               -- completed years at next_date (anniversary count / age)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_tenant uuid := my_tenant_id();
  v_role text := my_role();
  v_outlet uuid;
  v_days int := LEAST(GREATEST(COALESCE(p_days, 5), 0), 366);
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT p.outlet_id INTO v_outlet FROM profiles p WHERE p.id = auth.uid();

  RETURN QUERY
  WITH scoped AS (
    SELECT p.id, p.first_name, p.middle_name, p.last_name, p.division, p.outlet_location,
           COALESCE(p.date_of_birth, pd.date_of_birth) AS dob,
           p.join_date
    FROM profiles p
    LEFT JOIN profile_details pd ON pd.profile_id = p.id
    WHERE p.tenant_id = v_tenant
      AND p.status = 'Active'
      AND (v_role IN ('admin', 'manager', 'superadmin') OR p.outlet_id IS NOT DISTINCT FROM v_outlet)
  ),
  events AS (
    SELECT 'birthday'::text AS kind, s.*, s.dob AS event_date FROM scoped s WHERE s.dob IS NOT NULL
    UNION ALL
    SELECT 'anniversary'::text, s.*, s.join_date FROM scoped s WHERE s.join_date IS NOT NULL
  ),
  nexts AS (
    SELECT e.*,
           CASE
             WHEN (e.event_date + make_interval(years => EXTRACT(YEAR FROM v_today)::int - EXTRACT(YEAR FROM e.event_date)::int))::date >= v_today
               THEN (e.event_date + make_interval(years => EXTRACT(YEAR FROM v_today)::int - EXTRACT(YEAR FROM e.event_date)::int))::date
             ELSE (e.event_date + make_interval(years => EXTRACT(YEAR FROM v_today)::int + 1 - EXTRACT(YEAR FROM e.event_date)::int))::date
           END AS next_date
    FROM events e
  )
  SELECT n.kind, n.id, n.first_name, n.middle_name, n.last_name, n.division, n.outlet_location,
         n.event_date, n.next_date,
         (n.next_date - v_today)::int,
         (EXTRACT(YEAR FROM n.next_date) - EXTRACT(YEAR FROM n.event_date))::int
  FROM nexts n
  WHERE n.next_date - v_today <= v_days
    AND (n.kind = 'birthday' OR EXTRACT(YEAR FROM n.next_date) > EXTRACT(YEAR FROM n.event_date))
  ORDER BY n.next_date, n.first_name;
END;
$$;

REVOKE ALL ON FUNCTION list_upcoming_celebrations(int) FROM public;
GRANT EXECUTE ON FUNCTION list_upcoming_celebrations(int) TO authenticated;
