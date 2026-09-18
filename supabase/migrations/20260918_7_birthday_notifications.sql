-- Daily birthday notifications: a special "Happy Birthday" in-app
-- notification to the birthday employee, plus a heads-up to HR/admin so they
-- can arrange something -- nothing like this existed before (no birthday/DOB
-- notification, no relevant cron job).
--
-- Delivery reuses the existing in-app notification center
-- (app_notifications, 20260813_10_notification_center.sql) that every other
-- request/approval notification already goes through
-- (src/services/notificationService.js: notifyProfiles/notifyRoles/
-- withHrRole) -- this just inserts the same shape of row directly from SQL,
-- since a cron job has no authenticated browser session to call those
-- client-side helpers with.
--
-- Reads profiles.date_of_birth first (the HR-managed field added in
-- 20260918_4_profiles_date_of_birth.sql), falling back to
-- profile_details.date_of_birth (20260812_employee_profile_details.sql) for
-- any employee who self-set it before profiles.date_of_birth existed.
--
-- Scoped to Raniwala for now, same as the other Raniwala-only migrations in
-- this batch -- drop the `t.company_name ILIKE '%Raniwala%'` filter below to
-- cover every tenant once this has been validated.
--
-- "Today" is computed in Asia/Kolkata (IST) regardless of the server's UTC
-- clock, and the cron schedule below (02:30 UTC = 08:00 IST) is timed to
-- match.

CREATE OR REPLACE FUNCTION send_birthday_notifications()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_row RECORD;
  v_admin_id uuid;
  v_name text;
  v_sent int := 0;
BEGIN
  FOR v_row IN
    SELECT p.id AS profile_id, p.tenant_id, p.first_name, p.last_name,
           COALESCE(p.date_of_birth, pd.date_of_birth) AS dob
    FROM profiles p
    JOIN tenants t ON t.id = p.tenant_id
    LEFT JOIN profile_details pd ON pd.profile_id = p.id
    WHERE t.company_name ILIKE '%Raniwala%'
      AND p.status = 'Active'
      AND COALESCE(p.date_of_birth, pd.date_of_birth) IS NOT NULL
      AND EXTRACT(MONTH FROM COALESCE(p.date_of_birth, pd.date_of_birth)) = EXTRACT(MONTH FROM v_today)
      AND EXTRACT(DAY   FROM COALESCE(p.date_of_birth, pd.date_of_birth)) = EXTRACT(DAY   FROM v_today)
  LOOP
    v_name := v_row.first_name || ' ' || v_row.last_name;

    -- Skip if we already sent today's birthday notifications for this
    -- person (cron re-runs, manual re-invocation for testing).
    IF EXISTS (
      SELECT 1 FROM app_notifications
      WHERE type = 'birthday_employee' AND related_id = v_row.profile_id
        AND created_at::date = v_today
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO app_notifications (tenant_id, profile_id, type, title, body, related_id)
    VALUES (
      v_row.tenant_id, v_row.profile_id, 'birthday_employee',
      'Happy Birthday!',
      '🎉 Happy Birthday, ' || v_name || '! Wishing you a great year ahead.',
      v_row.profile_id
    );

    FOR v_admin_id IN
      SELECT id FROM profiles WHERE tenant_id = v_row.tenant_id AND role = 'admin'
    LOOP
      INSERT INTO app_notifications (tenant_id, profile_id, type, title, body, related_id)
      VALUES (
        v_row.tenant_id, v_admin_id, 'birthday_hr_reminder',
        'Birthday today',
        'It''s ' || v_name || '''s birthday today!',
        v_row.profile_id
      );
    END LOOP;

    v_sent := v_sent + 1;
  END LOOP;

  RETURN v_sent;
END;
$$;

create extension if not exists pg_cron;

select cron.unschedule('birthday-notifications')
where exists (select 1 from cron.job where jobname = 'birthday-notifications');

select cron.schedule(
  'birthday-notifications',
  '30 2 * * *', -- 02:30 UTC = 08:00 IST, daily
  $$ select send_birthday_notifications(); $$
);
