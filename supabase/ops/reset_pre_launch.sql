-- =========================================================================
-- PayrollPro — Pre-launch platform reset
--
-- Deletes every tenant (company) and every user account EXCEPT the
-- superadmin login (prakashgovtportal@gmail.com). Takes a same-database
-- snapshot first so this can be rolled back if needed.
--
-- HOW TO RUN: Supabase Dashboard -> your project -> SQL Editor -> paste
-- this whole file -> Run. Do NOT run this through the app; it needs
-- postgres-level privileges to touch auth.users and bypass RLS.
-- =========================================================================

-- ---- 0. Safety check: abort if the superadmin account is missing ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = 'prakashgovtportal@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Superadmin account not found — aborting to avoid locking everyone out.';
  END IF;
END $$;

-- ---- 1. Snapshot every affected table into a backup schema ----
-- Restore any table later with:
--   INSERT INTO public.<table> SELECT * FROM backup_20260726.<table>;
CREATE SCHEMA IF NOT EXISTS backup_20260726;

CREATE TABLE backup_20260726.auth_users             AS TABLE auth.users;
CREATE TABLE backup_20260726.tenants                AS TABLE tenants;
CREATE TABLE backup_20260726.profiles               AS TABLE profiles;
CREATE TABLE backup_20260726.outlets                AS TABLE outlets;
CREATE TABLE backup_20260726.departments            AS TABLE departments;
CREATE TABLE backup_20260726.salary_components      AS TABLE salary_components;
CREATE TABLE backup_20260726.attendance             AS TABLE attendance;
CREATE TABLE backup_20260726.punches                AS TABLE punches;
CREATE TABLE backup_20260726.payrolls                AS TABLE payrolls;
CREATE TABLE backup_20260726.payslips               AS TABLE payslips;
CREATE TABLE backup_20260726.advances               AS TABLE advances;
CREATE TABLE backup_20260726.leave_requests         AS TABLE leave_requests;
CREATE TABLE backup_20260726.attendance_audit_log   AS TABLE attendance_audit_log;
CREATE TABLE backup_20260726.shifts                 AS TABLE shifts;
CREATE TABLE backup_20260726.employee_transfers     AS TABLE employee_transfers;
CREATE TABLE backup_20260726.weekly_off_settlements AS TABLE weekly_off_settlements;
CREATE TABLE backup_20260726.employee_promotions    AS TABLE employee_promotions;
CREATE TABLE backup_20260726.request_quotas         AS TABLE request_quotas;
CREATE TABLE backup_20260726.regularize_requests    AS TABLE regularize_requests;
CREATE TABLE backup_20260726.special_requests       AS TABLE special_requests;
CREATE TABLE backup_20260726.announcements          AS TABLE announcements;
CREATE TABLE backup_20260726.policies                AS TABLE policies;
CREATE TABLE backup_20260726.otp_table              AS TABLE otp_table;

-- ---- 2. Clear employee_transfers first ----
-- Its from_tenant_id / to_tenant_id FKs do NOT cascade, so it would block
-- the tenant delete below if left in place.
DELETE FROM employee_transfers;

-- ---- 3. Delete every tenant (company) ----
-- Cascades to: departments, salary_components, attendance, payrolls,
-- payslips, advances, leave_requests, attendance_audit_log, shifts,
-- outlets, weekly_off_settlements, employee_promotions, request_quotas,
-- regularize_requests, special_requests, announcements, policies, AND
-- every profile whose tenant_id is set (i.e. every non-superadmin profile —
-- the superadmin's profile has tenant_id = NULL, so it is untouched).
DELETE FROM tenants;

-- ---- 4. Delete every login account except the superadmin ----
-- By now step 3 already removed every other profile, so this just clears
-- the corresponding auth accounts (and cascades to any leftover profile
-- rows, though none should remain).
DELETE FROM auth.users
WHERE email <> 'prakashgovtportal@gmail.com';

-- ---- 5. Clear standalone signup OTP records (not tenant-scoped) ----
DELETE FROM otp_table;

-- ---- 6. Verify: should show exactly one row (the superadmin) ----
SELECT id, email, role, tenant_id FROM profiles;
SELECT count(*) AS remaining_tenants FROM tenants;
SELECT count(*) AS remaining_auth_users FROM auth.users;
