-- "profiles: admin/manager sees tenant" is missing its role check — unlike
-- every equivalent "<table>: admin/manager sees tenant" SELECT policy
-- elsewhere in this schema (advances, attendance, payslips, etc.), its USING
-- clause only checks `tenant_id = my_tenant_id()`, with no role restriction.
--
-- Net effect: ANY authenticated member of a tenant (employee role included)
-- can currently SELECT every other profile row in their company — full name,
-- phone, PAN, Aadhar, bank account/IFSC, CTC/salary — not just their own.
-- "profiles: employee sees self" is redundant under it, since the broad
-- policy already covers that case. This is reachable directly via the
-- browser's own Supabase client (e.g. from devtools), no admin access
-- required. Restoring the role check brings this policy back in line with
-- the rest of the schema: only admin/manager/superadmin see the whole
-- tenant; everyone else only sees their own row via the existing
-- "profiles: employee sees self" policy.
DROP POLICY IF EXISTS "profiles: admin/manager sees tenant" ON profiles;
CREATE POLICY "profiles: admin/manager sees tenant" ON profiles
  FOR SELECT
  USING (
    (tenant_id = (select my_tenant_id()))
    AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))
  );
