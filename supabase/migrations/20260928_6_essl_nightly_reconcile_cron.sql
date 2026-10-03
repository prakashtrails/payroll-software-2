-- Nightly 7-day re-pull of Raniwala's ESSL feed (essl-web-poll with
-- { "days": 7 }). The 2-minute job only reads today + yesterday; a reader
-- that syncs to the dashboard late (DELHI has lagged by hours) or a stretch
-- of failed cycles would otherwise leave those punches out for good.
-- Unchanged rows are no-ops in essl_ingest_daily(), so this costs one feed
-- read plus a handful of real updates.
--
-- 01:40 IST (20:10 UTC): after the day closes, before the 02:00 IST nightly
-- attendance sweep (mark_attendance_from_punches) marks absents/mispunches.
-- Same public anon key as 20260819_2 (only satisfies the Functions gateway).

select cron.unschedule('essl-raniwala-nightly-reconcile')
where exists (select 1 from cron.job where jobname = 'essl-raniwala-nightly-reconcile');

select cron.schedule(
  'essl-raniwala-nightly-reconcile',
  '10 20 * * *',
  $$
  select net.http_post(
    url := 'https://yxueywgrqrfgynqknsqs.supabase.co/functions/v1/essl-web-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dWV5d2dycXJmZ3lucWtuc3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzMyMTEsImV4cCI6MjA5MjQ0OTIxMX0.HPddy4u4Qy4E1RHZXt3yUcrv8yO-ha5z1tYhNrH42J4'
    ),
    body := '{"days": 7}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
