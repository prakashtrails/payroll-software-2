-- =============================================================
-- Raniwala birthdays / work anniversaries for EMPLOYEES (3 Oct 2026, user
-- request): employees now see the people of their OWN OUTLET whose birthday
-- or work anniversary is TODAY (not upcoming) — on the website and the app.
-- Forced here (v_days := 0, outlet scope) so neither client can widen it.
-- An employee with no outlet sees nothing.
--
-- Unchanged: HR (admin) everyone's, next 5 days; manager / HOD their team,
-- today only; management nothing; other tenants as before.
-- Based on the live definition (20260929_3).
-- =============================================================

CREATE OR REPLACE FUNCTION public.list_upcoming_celebrations(p_days integer DEFAULT 5)
 RETURNS TABLE(kind text, profile_id uuid, first_name text, middle_name text, last_name text, division text, outlet_location text, event_date date, next_date date, days_away integer, years integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_tenant uuid := my_tenant_id();
  v_role text := my_role();
  v_outlet uuid;
  v_days int := LEAST(GREATEST(COALESCE(p_days, 5), 0), 366);
  v_raniwala boolean := my_is_raniwala();
  v_team uuid[];
  v_outlet_only boolean := false;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT p.outlet_id INTO v_outlet FROM profiles p WHERE p.id = auth.uid();

  IF v_raniwala THEN
    IF v_role = 'management' OR v_role IS NULL THEN
      RETURN;
    ELSIF v_role = 'employee' THEN
      IF v_outlet IS NULL THEN
        RETURN;
      END IF;
      v_outlet_only := true;
      v_days := 0;  -- employees: own outlet, today only, whatever the client asks
    ELSIF v_role IN ('manager', 'hod') THEN
      v_team := my_team_ids();
      v_days := 0;  -- managers / HODs: today only, whatever the client asks
    END IF;
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT p.id, p.first_name, p.middle_name, p.last_name, p.division, p.outlet_location,
           COALESCE(p.date_of_birth, pd.date_of_birth) AS dob,
           p.join_date
    FROM profiles p
    LEFT JOIN profile_details pd ON pd.profile_id = p.id
    WHERE p.tenant_id = v_tenant
      AND p.status = 'Active'
      AND (
        CASE WHEN v_team IS NOT NULL THEN p.id = ANY (v_team)
             WHEN v_outlet_only THEN p.outlet_id = v_outlet
             WHEN v_raniwala THEN true
             ELSE (v_role IN ('admin', 'manager', 'superadmin') OR p.outlet_id IS NOT DISTINCT FROM v_outlet)
        END
      )
  ),
  events AS (
    SELECT 'birthday'::text AS kind, s.*, s.dob AS event_date FROM scoped s WHERE s.dob IS NOT NULL
    UNION ALL
    SELECT 'anniversary'::text, s.*, s.join_date FROM scoped s
    WHERE s.join_date IS NOT NULL
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
$function$;
