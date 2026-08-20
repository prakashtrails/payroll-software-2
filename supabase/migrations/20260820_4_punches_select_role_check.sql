-- "punches: admin/manager can read tenant" is missing its role check --
-- same bug class as the profiles fix earlier today. Its USING clause only
-- scopes by tenant (via the parent attendance row), with no role
-- restriction, so any authenticated tenant member could read every
-- coworker's clock-in/out punch log, not just their own. The sibling
-- "punches: admin/manager can delete" policy on this same table already has
-- the correct role check, confirming this was an omission.
DROP POLICY IF EXISTS "punches: admin/manager can read tenant" ON punches;
CREATE POLICY "punches: admin/manager can read tenant" ON punches
  FOR SELECT
  USING (
    (attendance_id IN (
      SELECT attendance.id FROM attendance
      WHERE attendance.tenant_id = (select my_tenant_id())
    ))
    AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))
  );
