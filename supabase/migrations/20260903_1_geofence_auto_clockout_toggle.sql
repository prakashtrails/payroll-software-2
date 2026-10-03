-- =============================================================
-- Auto clock-out becomes opt-in per tenant instead of always-on.
--
-- Problem: useGeofenceClock's safety-net auto clock-out (force-ending a
-- session ~30s after the employee's live position falls outside every
-- allowed fence) previously ran unconditionally whenever geofencing was
-- configured. That's wrong for tenants whose staff legitimately work
-- outside the office during a shift (field sales, delivery, site visits) --
-- for them, leaving the fence is expected, not a fraud signal, so
-- force-ending the punch is actively harmful. It's only useful for tenants
-- that want to strictly confine on-site staff to the premises.
--
-- Fix: a tenant-level opt-in flag, off by default, that only a superadmin
-- can flip (Tenant Management -> Manage -> Settings tab). The manual
-- inside/outside-fence check on clock-in/out (checkPosition/
-- resolveClockLocation, and the DB trigger from
-- 20260827_1_server_side_geofence_enforcement.sql) is unaffected -- this
-- only gates the *automatic* clock-out-on-exit behavior.
-- =============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_clockout_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.auto_clockout_enabled IS
  'When true, an employee whose live position leaves every allowed geofence while clocked in is automatically clocked out after a grace period. Default false: geofencing still blocks manual clock-in/out from outside the fence, but never force-ends a session on its own. Superadmin-only toggle (Tenant Management > Manage > Settings) intended for tenants whose staff must stay on-site all shift -- leave off for tenants with field/outside staff.';
