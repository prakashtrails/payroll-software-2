-- Self-regularize (first SELF_LIMIT requests/month, see requestQuotaService.js)
-- auto-approves and calls regularizeAttendance() with changedBy = the employee's
-- own profile id, which writes an attendance_audit_log row. The existing INSERT
-- policy only allowed admin/manager/superadmin, so that write was rejected with
-- "new row violates row-level security policy for table attendance_audit_log".
--
-- Allow an employee to insert an audit log row only for their own attendance,
-- only as the actor (changed_by = themselves) — they still cannot log changes
-- against anyone else's record.

CREATE POLICY "audit_log: employee can insert own self-regularize entry"
  ON attendance_audit_log FOR INSERT
  WITH CHECK (
    tenant_id = my_tenant_id()
    AND profile_id = auth.uid()
    AND changed_by = auth.uid()
  );
