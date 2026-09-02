-- pg_net logs every request it makes permanently in net._http_response. At
-- essl-raniwala-live-sync's rate (every 2 min = ~720 rows/day) that's small
-- individually but grows forever if nothing prunes it -- not something to
-- leave to an assumed platform default. This keeps only the last 3 days,
-- which is far more than enough for debugging a stuck cycle, and runs
-- independently of the sync job itself so a bug in one can't affect the other.

select cron.unschedule('essl-web-poll-response-cleanup')
where exists (select 1 from cron.job where jobname = 'essl-web-poll-response-cleanup');

select cron.schedule(
  'essl-web-poll-response-cleanup',
  '17 3 * * *',  -- once daily, off the 2-minute mark so it never overlaps a sync fire
  $$ delete from net._http_response where created < now() - interval '3 days' $$
);
