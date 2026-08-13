-- =============================================================
-- Employee self-service profile details (Home > Welcome page)
-- Run this after supabase_migration.sql (relies on my_tenant_id(), my_role())
--
-- Kept as a separate table from `profiles` rather than new columns on it:
-- `profiles` holds HR-managed identity/employment data (role, ctc, bank
-- details) and its RLS intentionally restricts updates to admin/superadmin.
-- A blanket "own row" update policy on `profiles` would let employees edit
-- those sensitive columns too. This table has nothing sensitive in it, so
-- the RLS boundary can simply be "own row only".
-- =============================================================

CREATE TABLE IF NOT EXISTS profile_details (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             uuid REFERENCES profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  tenant_id              uuid REFERENCES tenants(id) ON DELETE CASCADE,
  date_of_birth          date,
  gender                 text NOT NULL DEFAULT '',
  marital_status         text NOT NULL DEFAULT '',
  blood_group            text NOT NULL DEFAULT '',
  physically_handicapped boolean NOT NULL DEFAULT false,
  nationality            text NOT NULL DEFAULT 'India',
  personal_email         text NOT NULL DEFAULT '',
  work_number            text NOT NULL DEFAULT '',
  residence_number       text NOT NULL DEFAULT '',
  current_address        jsonb NOT NULL DEFAULT '{}',
  permanent_address      jsonb NOT NULL DEFAULT '{}',
  about_me               text NOT NULL DEFAULT '',
  about_job              text NOT NULL DEFAULT '',
  hobbies                text NOT NULL DEFAULT '',
  emergency_contacts     jsonb NOT NULL DEFAULT '[]',
  education              jsonb NOT NULL DEFAULT '[]',
  experience             jsonb NOT NULL DEFAULT '[]',
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_details_tenant ON profile_details(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profile_details_dob ON profile_details(date_of_birth);

ALTER TABLE profile_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_details: select own or admin/manager"
  ON profile_details FOR SELECT
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','manager','superadmin')));

CREATE POLICY "profile_details: insert own"
  ON profile_details FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND profile_id = auth.uid());

CREATE POLICY "profile_details: update own or admin"
  ON profile_details FOR UPDATE
  USING (tenant_id = my_tenant_id() AND (profile_id = auth.uid() OR my_role() IN ('admin','superadmin')));

CREATE POLICY "profile_details: admin can delete"
  ON profile_details FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));
