-- Schedules essl-web-poll (supabase/functions/essl-web-poll) to run every 2
-- minutes via pg_cron, so Raniwala's live ESSL dashboard is polled and new
-- punches land in CrewCore automatically -- no local agent, no manual step.
--
-- pg_net's http_post is fire-and-forget from SQL's perspective (the request
-- runs async; this statement doesn't wait for essl-web-poll to finish), which
-- is what we want for a cron trigger.
--
-- The anon key below is CrewCore's own public anon key (same one already
-- shipped in the frontend bundle to every visitor -- see VITE_SUPABASE_ANON_KEY
-- in .env) -- it can't bypass RLS or authorize anything sensitive on its own,
-- it's only here to satisfy the Edge Functions gateway's own auth layer.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('essl-raniwala-live-sync')
where exists (select 1 from cron.job where jobname = 'essl-raniwala-live-sync');

select cron.schedule(
  'essl-raniwala-live-sync',
  '*/2 * * * *',
  $$
  -- timeout_milliseconds raised from pg_net's 5s default: the first-ever fire
  -- timed out on the Edge Function's cold start alone, and a cycle with
  -- several changed punches (essl-punch does a few DB round trips per punch)
  -- can also run past 5s. 25s comfortably fits inside the 2-minute interval.
  select net.http_post(
    url := 'https://yxueywgrqrfgynqknsqs.supabase.co/functions/v1/essl-web-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dWV5d2dycXJmZ3lucWtuc3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzMyMTEsImV4cCI6MjA5MjQ0OTIxMX0.HPddy4u4Qy4E1RHZXt3yUcrv8yO-ha5z1tYhNrH42J4'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
