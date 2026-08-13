-- The superadmin "Manage Company -> Bulk Upload" flow auto-creates any
-- department named in an uploaded sheet (src/lib/employeeImport.js), but
-- departments' RLS only allows tenant-scoped admin/manager to insert
-- ("departments: admin/manager can insert" requires tenant_id = my_tenant_id()
-- AND role IN ('admin','manager')) — superadmin's own tenant_id is NULL and
-- 'superadmin' isn't in that role list, so every auto-create insert was
-- rejected with a 42501 RLS violation. Add the same superadmin-bypass
-- pattern already used for tenants/profiles/outlets.
DROP POLICY IF EXISTS "departments: superadmin_platform_all" ON departments;
CREATE POLICY "departments: superadmin_platform_all"
  ON departments FOR ALL
  USING (my_role() = 'superadmin')
  WITH CHECK (my_role() = 'superadmin');
