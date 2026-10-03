-- =============================================================
-- Real-time, per-instance comp-off grant: opt-in per tenant.
--
-- When tenants.auto_comp_off_on_weekly_off_worked is true, punching in
-- (Present/Late) on the employee's own effective weekly-off day (outlet
-- override, falling back to the tenant default -- see
-- getTenantWeeklyOffDays in src/lib/helpers.js) credits +1 to
-- profiles.comp_off_balance immediately, once per attendance row
-- (attendance.comp_off_granted guards against re-granting on a later
-- punch/edit of the same day).
--
-- This REPLACES the older month-end "worked every weekly-off with zero
-- comp-leaves -> +1 comp-off" settlement (compOffService.js /
-- settleWeeklyOffForMonth) for any tenant that turns this flag on -- the
-- caller in PayrollPage.jsx skips that settlement call when the flag is
-- set, so a tenant never gets credited by both mechanisms for the same
-- worked weekly-off.
-- =============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_comp_off_on_weekly_off_worked boolean NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS comp_off_granted boolean NOT NULL DEFAULT false;
