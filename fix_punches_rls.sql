-- =============================================================
-- FIX: Missing punches RLS policies for admin/manager
-- Run this in Supabase SQL Editor NOW to fix the error:
-- "new row violates row-level security policy for table punches"
-- =============================================================

-- Allow admin/manager to INSERT punches for any employee in their tenant
CREATE POLICY "punches: admin/manager can insert"
  ON punches FOR INSERT
  WITH CHECK (
    attendance_id IN (
      SELECT id FROM attendance WHERE tenant_id = my_tenant_id()
    )
    AND my_role() IN ('admin','manager','superadmin')
  );

-- Allow admin/manager to DELETE punches (needed when overwriting manual attendance)
CREATE POLICY "punches: admin/manager can delete"
  ON punches FOR DELETE
  USING (
    attendance_id IN (
      SELECT id FROM attendance WHERE tenant_id = my_tenant_id()
    )
    AND my_role() IN ('admin','manager','superadmin')
  );
