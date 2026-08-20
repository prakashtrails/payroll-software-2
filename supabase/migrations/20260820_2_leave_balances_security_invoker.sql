-- public.leave_balances was created without security_invoker, so it runs
-- with its owner's (postgres) privileges rather than the querying user's.
-- Since it's a plain view (not a table), Postgres has no RLS of its own to
-- enable on it -- the *only* thing standing between callers and every
-- tenant's leave balances was security_invoker. Without it, RLS on the
-- underlying leave_ledger table (tenant-scoped: own row, or admin/manager/
-- superadmin) was silently skipped entirely, and because `anon` holds the
-- default PostgREST SELECT grant on this view, that meant an unauthenticated
-- request with just the public anon key could read every tenant's
-- (tenant_id, profile_id, leave_type_id, balance) rows.
--
-- security_invoker=on makes the view evaluate leave_ledger's RLS as the
-- calling user, same query/columns otherwise -- legitimate access
-- (employee sees own balance, admin/manager/superadmin see their tenant's)
-- is unaffected.
CREATE OR REPLACE VIEW public.leave_balances
WITH (security_invoker = on)
AS
SELECT
  tenant_id,
  profile_id,
  leave_type_id,
  sum(days) AS balance
FROM leave_ledger
GROUP BY tenant_id, profile_id, leave_type_id;
