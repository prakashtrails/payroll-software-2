-- profile_directory: a safe, name-only view of profiles for looking up OTHER
-- people in your own company (approver/reviewer/author names, notification
-- recipients, colleague pickers on Feedback/1-on-1s/KRAs/PIP/Reviews).
--
-- Why: 20260820_profiles_select_role_check.sql (restrict profiles SELECT to
-- own row for employees) was never applied live, because the web + CrewCore
-- apps look other people up straight from `profiles` while logged in as an
-- employee (notifyRoles/notifyTenant, getRequesterLabel, manager name,
-- approver joins, listActiveEmployees...). Locking profiles down would have
-- silently broken those. The apps now read other people from this view
-- instead, and 20260923_4_profiles_select_lockdown.sql then closes profiles.
--
-- Exposes directory columns only — no PAN/Aadhaar, bank, CTC/salary, phone,
-- email, DOB or address. Rows are limited to the caller's own tenant
-- (superadmin: all tenants, matching the profiles superadmin policy).
--
-- It deliberately runs with the view owner's rights (no security_invoker) so
-- employees can read these columns for colleagues while profiles RLS stays
-- own-row-only for them; the WHERE clause is the access check. PostgREST
-- follows the profiles foreign keys through the view, so embeds like
-- `approver:profile_directory!leave_requests_approved_by_fkey(first_name)`
-- work exactly like the old `profiles!...` ones.

CREATE OR REPLACE VIEW profile_directory AS
SELECT
  p.id,
  p.tenant_id,
  p.first_name,
  p.middle_name,
  p.last_name,
  p.employee_id,
  p.role,
  p.status,
  p.department,
  p.designation,
  p.division,
  p.manager_id,
  p.outlet_id,
  p.outlet_location
FROM profiles p
WHERE p.tenant_id = (SELECT my_tenant_id())
   OR (SELECT my_role()) = 'superadmin';

REVOKE ALL ON profile_directory FROM anon, public;
GRANT SELECT ON profile_directory TO authenticated;

NOTIFY pgrst, 'reload schema';
