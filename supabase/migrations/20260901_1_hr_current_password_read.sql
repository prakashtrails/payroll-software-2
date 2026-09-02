-- =============================================================
-- Let tenant admins (the "HR" role in this app — see TenantsPage's
-- "HR / Admin" role label) view an employee's live current password
-- via employee_current_passwords, same as superadmin already could.
-- Scoped strictly to their own tenant_id — an admin in tenant A can
-- never read a row belonging to tenant B.
--
-- Previously this table's only SELECT policy was superadmin-only
-- (20260810_employee_current_password.sql). This adds a second,
-- narrower policy rather than editing that one, so the superadmin
-- grant is untouched.
-- =============================================================

DROP POLICY IF EXISTS "employee_current_passwords: admin tenant read" ON employee_current_passwords;
CREATE POLICY "employee_current_passwords: admin tenant read"
  ON employee_current_passwords FOR SELECT
  USING (my_role() = 'admin' AND tenant_id = my_tenant_id());
