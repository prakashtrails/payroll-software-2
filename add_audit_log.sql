-- =============================================================
-- ATTENDANCE AUDIT LOG — Run this in Supabase SQL Editor
-- =============================================================

CREATE TABLE IF NOT EXISTS attendance_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attendance_id   uuid REFERENCES attendance(id) ON DELETE SET NULL,
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  changed_by      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date            date NOT NULL,
  action          text NOT NULL CHECK (action IN ('create','update')),
  old_status      text,
  new_status      text NOT NULL,
  old_hours       numeric,
  new_hours       numeric,
  reason          text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE attendance_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log: admin/manager can read tenant"
  ON attendance_audit_log FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "audit_log: admin/manager can insert"
  ON attendance_audit_log FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_date  ON attendance_audit_log(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_audit_log_attendance   ON attendance_audit_log(attendance_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_profile      ON attendance_audit_log(profile_id);
