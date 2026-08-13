-- =========================================================================
-- Pending-migration checker
--
-- Run this in the Supabase Dashboard -> SQL Editor. It doesn't change
-- anything — it just checks whether each migration file in the repo has
-- actually been applied to this database, and prints APPLIED / MISSING.
-- Anything marked MISSING should be run (find it in supabase/migrations/
-- or the repo root by the filename in the "migration" column below).
-- =========================================================================

WITH checks AS (
  SELECT 'supabase_migration.sql (base schema)' AS migration,
         to_regclass('public.tenants') IS NOT NULL
         AND to_regclass('public.profiles') IS NOT NULL AS applied
  UNION ALL
  SELECT 'special_requests_migration.sql',
         to_regclass('public.special_requests') IS NOT NULL
  UNION ALL
  SELECT 'comp_off_migration.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'comp_off_balance')
  UNION ALL
  SELECT 'country_payroll_migration.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'payrolls' AND column_name = 'country_group')
  UNION ALL
  SELECT 'announcements_policies_migration.sql + fix',
         to_regclass('public.announcements') IS NOT NULL
         AND to_regclass('public.policies') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'announcements' AND column_name = 'tenant_id')
  UNION ALL
  SELECT '20260714_audit_fixes_batch1.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'adjust_comp_off_balance')
         AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_profile_date_unique')
         AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_special_requests_tenant')
  UNION ALL
  SELECT '20260714_otp_attempt_limit.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'otp_table' AND column_name = 'attempts')
  UNION ALL
  SELECT '20260714_payroll_rpc_authz.sql',
         EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname = 'process_payroll_by_country'
                   AND pg_get_functiondef(oid) LIKE '%unauthorized%')
  UNION ALL
  SELECT '20260714_rls_privilege_escalation_fixes.sql',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'profiles' AND policyname = 'profiles: admin/manager can update tenant'
                   AND with_check LIKE '%superadmin%')
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_request_quota')
  UNION ALL
  SELECT '20260714_signup_rpc_hijack_fix.sql',
         EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname = 'create_workspace'
                   AND pg_get_functiondef(oid) LIKE '%must match the authenticated caller%')
  UNION ALL
  SELECT '20260714_transfer_employee_tenant_check.sql',
         EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname = 'transfer_employee'
                   AND pg_get_functiondef(oid) LIKE '%does not belong to the source tenant%')
  UNION ALL
  SELECT '20260725_super_admin_platform.sql',
         to_regclass('public.outlets') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tenants' AND policyname = 'tenants: superadmin_platform_all')
  UNION ALL
  SELECT '20260726_tenant_delete_fk_fix.sql',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'employee_transfers_to_tenant_id_fkey' AND confdeltype = 'n')
  UNION ALL
  SELECT '20260726_actor_fk_set_null.sql',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'leave_requests_approved_by_fkey' AND confdeltype = 'n')
         AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'regularize_requests_reviewed_by_fkey' AND confdeltype = 'n')
         AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'special_requests_approved_by_fkey' AND confdeltype = 'n')
         AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'employee_transfers_transferred_by_fkey' AND confdeltype = 'n')
         AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'employee_promotions_created_by_fkey' AND confdeltype = 'n')
         AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'announcements_created_by_fkey' AND confdeltype = 'n')
         AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'policies_created_by_fkey' AND confdeltype = 'n')
  UNION ALL
  SELECT '20260726_departments_superadmin_bypass.sql',
         EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'departments' AND policyname = 'departments: superadmin_platform_all')
  UNION ALL
  SELECT '20260726_employee_middle_name.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'middle_name')
  UNION ALL
  SELECT '20260803_bank_name_ifsc.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'bank_name')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'ifsc_code')
  UNION ALL
  SELECT '20260805_performance_management.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'manager_id')
         AND to_regclass('public.kras') IS NOT NULL
         AND to_regclass('public.one_on_ones') IS NOT NULL
         AND to_regclass('public.feedback') IS NOT NULL
         AND to_regclass('public.pips') IS NOT NULL
         AND to_regclass('public.review_cycles') IS NOT NULL
  UNION ALL
  SELECT '20260805_outlet_attendance_settings.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'outlets' AND column_name = 'geofence_lat')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'outlets' AND column_name = 'min_half_day_hours')
)
SELECT migration, CASE WHEN applied THEN 'APPLIED' ELSE 'MISSING — run this one' END AS status
FROM checks
ORDER BY applied, migration;
