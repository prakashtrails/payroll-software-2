-- =============================================================
-- Per-tenant attendance-regularization auto-approval control — same pattern
-- as 20260816_1_leave_auto_approval.sql, but for regularize_requests instead
-- of leave_requests. Previously every tenant got the same hardcoded 3
-- self-approvals/month (requestQuotaService.SELF_LIMIT) with no way to
-- change or disable it for regularization specifically. Defaults to the
-- prior hardcoded behavior (enabled, limit 3) so existing tenants see no
-- change until a superadmin explicitly adjusts them.
-- =============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS regularize_auto_approval_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS regularize_auto_approval_limit   integer NOT NULL DEFAULT 3 CHECK (regularize_auto_approval_limit >= 0);
