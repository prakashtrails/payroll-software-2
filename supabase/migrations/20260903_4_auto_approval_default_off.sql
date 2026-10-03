-- =============================================================
-- Flip self-approval auto-approval from opt-out to opt-in.
--
-- Problem: leave_auto_approval_enabled (20260816_1), regularize_auto_approval_enabled
-- (20260816_3), and special_auto_approval_enabled (20260903_2) all default to
-- `true` -- so every tenant, including ones that never touched Toggle
-- Services, silently lets employees self-approve their own leave/
-- regularization/special requests (up to 3/month each, per
-- requestQuotaService.SELF_LIMIT). A company should have to explicitly turn
-- self-approval ON, not have to notice it's already on and turn it off.
--
-- Fix: default all three to false going forward (new tenants), and reset
-- every existing tenant currently sitting on the inherited `true` default
-- back to `false` -- none of them made a deliberate choice, they just never
-- touched the toggle. A tenant that explicitly wants self-approval can turn
-- it back on any time in Toggle Services (superadmin-only).
-- =============================================================

ALTER TABLE tenants
  ALTER COLUMN leave_auto_approval_enabled      SET DEFAULT false,
  ALTER COLUMN regularize_auto_approval_enabled SET DEFAULT false,
  ALTER COLUMN special_auto_approval_enabled    SET DEFAULT false;

UPDATE tenants SET leave_auto_approval_enabled      = false WHERE leave_auto_approval_enabled      = true;
UPDATE tenants SET regularize_auto_approval_enabled = false WHERE regularize_auto_approval_enabled = true;
UPDATE tenants SET special_auto_approval_enabled    = false WHERE special_auto_approval_enabled    = true;
