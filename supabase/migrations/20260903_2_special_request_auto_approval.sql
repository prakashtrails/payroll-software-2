-- =============================================================
-- Per-tenant special-request (overtime / salary overtime / late arrival)
-- auto-approval control — same pattern as 20260816_1_leave_auto_approval.sql
-- and 20260816_3_regularize_auto_approval.sql, but for special_requests.
-- Previously every tenant got the same hardcoded 3 self-approvals/month
-- (requestQuotaService.SELF_LIMIT) with no way to change or disable it for
-- special requests specifically. Defaults to the prior hardcoded behavior
-- (enabled, limit 3) so existing tenants see no change until a superadmin
-- explicitly adjusts them.
-- =============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS special_auto_approval_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS special_auto_approval_limit   integer NOT NULL DEFAULT 3 CHECK (special_auto_approval_limit >= 0);
