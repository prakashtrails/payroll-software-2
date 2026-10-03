-- Re-applies 20260820_profiles_select_role_check.sql, which never reached the
-- live database: "profiles: admin/manager sees tenant" has no role check, so
-- ANY employee can SELECT every profile in their company — PAN, Aadhaar,
-- bank account/IFSC, CTC — straight from the browser/app Supabase client.
--
-- After this, only admin/manager/superadmin see the whole tenant; everyone
-- else sees only their own row (existing "profiles: employee sees self").
--
-- DEPLOY ORDER — apply only AFTER:
--   1. 20260923_3_profile_directory_view.sql is applied, and
--   2. the web app and the CrewCore mobile app that read other people from
--      profile_directory (instead of profiles) are deployed/released.
-- Older clients still query profiles for other people (notification
-- recipients, approver names) and would silently lose those lookups.
--
-- Checked against the live DB before writing this: every non-SECURITY
-- DEFINER function and every other table's policy that reads profiles only
-- reads the caller's own row, so none of them are affected.

DROP POLICY IF EXISTS "profiles: admin/manager sees tenant" ON profiles;
CREATE POLICY "profiles: admin/manager sees tenant" ON profiles
  FOR SELECT
  USING (
    (tenant_id = (select my_tenant_id()))
    AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))
  );
