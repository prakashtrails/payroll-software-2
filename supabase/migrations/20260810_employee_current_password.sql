-- Tracks each employee's live/current password in plaintext, visible to
-- superadmin only. Kept in its own table rather than a profiles column so
-- RLS can restrict it to the superadmin app-role without touching the many
-- existing `select('*')` queries against profiles used across admin/manager/
-- employee views — those all share the same Postgres "authenticated" role,
-- so a column-level GRANT/REVOKE on profiles can't tell those app-roles apart;
-- a separate table with its own RLS policy is the only clean way to do that.
--
-- Distinct from profiles.temp_password, which is the one-time onboarding
-- password shown to admins/managers to hand off to new hires and goes stale
-- (but is intentionally left in place) the moment the employee sets their own.

CREATE TABLE IF NOT EXISTS employee_current_passwords (
  profile_id  uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  password    text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_current_passwords_tenant_id ON employee_current_passwords(tenant_id);

ALTER TABLE employee_current_passwords ENABLE ROW LEVEL SECURITY;

-- Only superadmin can ever read this table. No INSERT/UPDATE/DELETE policy is
-- defined for regular clients — the only way to write a row is through
-- set_current_password() below, which runs as SECURITY DEFINER and is scoped
-- to auth.uid(), so a user can only ever record their own password.
DROP POLICY IF EXISTS "employee_current_passwords: superadmin only read" ON employee_current_passwords;
CREATE POLICY "employee_current_passwords: superadmin only read"
  ON employee_current_passwords FOR SELECT
  USING (my_role() = 'superadmin');

CREATE OR REPLACE FUNCTION set_current_password(p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO employee_current_passwords (profile_id, tenant_id, password, updated_at)
  SELECT id, tenant_id, p_password, now()
  FROM profiles
  WHERE id = auth.uid()
  ON CONFLICT (profile_id) DO UPDATE
    SET password = excluded.password, updated_at = excluded.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION set_current_password(text) TO authenticated;
