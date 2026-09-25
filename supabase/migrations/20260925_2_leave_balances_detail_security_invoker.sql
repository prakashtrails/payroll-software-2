-- =============================================================
-- Re-apply section 1 of 20260821_1_critical_security_fixes.sql.
--
-- Found on prod 2026-09-25: leave_balances_detail had no reloptions, i.e.
-- security_invoker was OFF. The view therefore ran as its owner, bypassed
-- leave_ledger's RLS, and with PostgREST's default anon SELECT grant any
-- unauthenticated request (anon key only) could read every tenant's leave
-- balances. The view definition on prod already matches the repo; only the
-- option was missing, so this just switches it on.
--
-- Sections 2 (profiles role-escalation WITH CHECK) and 3 (punches source
-- restriction) of 20260821_1 were also found NOT live on prod; they are
-- deliberately not re-applied here -- see the 2026-09-25 audit notes.
-- =============================================================

ALTER VIEW public.leave_balances_detail SET (security_invoker = on);
