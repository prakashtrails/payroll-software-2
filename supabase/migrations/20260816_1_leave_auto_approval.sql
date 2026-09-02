-- =============================================================
-- Per-tenant leave auto-approval control (superadmin-configured, Toggle
-- Services page). Previously every tenant got a hardcoded 3 self-approvals/
-- month (requestQuotaService.SELF_LIMIT) with no way to change or disable it.
-- Indwell wants 3; other clients want auto-approval off entirely — this adds
-- the two tenant-level knobs that drive that, defaulting to the prior
-- hardcoded behavior (enabled, limit 3) so existing tenants see no change
-- until a superadmin explicitly adjusts them.
-- =============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS leave_auto_approval_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS leave_auto_approval_limit   integer NOT NULL DEFAULT 3 CHECK (leave_auto_approval_limit >= 0);
