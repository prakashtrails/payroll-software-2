-- =========================================================================
-- Pending-migration checker
--
-- Run this in the Supabase Dashboard -> SQL Editor (or `psql -f`). It
-- doesn't change anything — it just checks whether each migration file in
-- the repo has actually been applied to THIS database, and prints
-- APPLIED / MISSING for every one of them. Anything marked MISSING should
-- be run — find it by filename in supabase/migrations/ (or the repo root
-- for the handful of pre-migrations-folder *_migration.sql files).
--
-- Covers every file under supabase/migrations/ as of 2026-09-01, plus the
-- legacy root-level *_migration.sql files applied before that folder
-- existed. If you add a new migration, add one more UNION ALL block here
-- with a check for something that migration uniquely creates/changes.
-- =========================================================================

WITH checks AS (
  -- ── Legacy root-level migrations (pre supabase/migrations/) ──────────
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

  -- ── supabase/migrations/20260605_*..20260615_* ───────────────────────
  UNION ALL
  SELECT '20260605_add_compliance_pf_esic.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'pf_number')
  UNION ALL
  SELECT '20260605_regularize_requests.sql',
         to_regclass('public.regularize_requests') IS NOT NULL
  UNION ALL
  SELECT '20260605_regularize_reviewed_at.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'regularize_requests' AND column_name = 'reviewed_at')
  UNION ALL
  SELECT '20260607_payroll_compliance_group.sql',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'payrolls_country_group_check'
                   AND pg_get_constraintdef(oid) LIKE '%Compliance%')
  UNION ALL
  SELECT '20260607_salary_overtime.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'special_requests' AND column_name = 'overtime_pay')
  UNION ALL
  SELECT '20260607_weekly_off_comp_off.sql',
         to_regclass('public.weekly_off_settlements') IS NOT NULL
  UNION ALL
  SELECT '20260610_fix_payroll_country_group.sql',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'payrolls_country_group_check')
  UNION ALL
  SELECT '20260610_tenant_groups.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'tenants' AND column_name = 'group_code')
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fetch_group_dashboard')
  UNION ALL
  SELECT '20260611_employee_id_transfers.sql',
         to_regclass('public.employee_transfers') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'profiles' AND column_name = 'employee_id')
  UNION ALL
  SELECT '20260614_request_routing.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'leave_requests' AND column_name = 'required_approver_role')
  UNION ALL
  SELECT '20260615_probation_promotions.sql',
         to_regclass('public.employee_promotions') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'profiles' AND column_name = 'probation_months')

  -- ── 20260714_* (security-hardening batch) ─────────────────────────────
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

  -- ── 20260725 - 20260805 ────────────────────────────────────────────────
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
  SELECT '20260805_employee_outlet_transfers.sql',
         to_regclass('public.outlet_transfers') IS NOT NULL
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

  -- ── 20260806 ────────────────────────────────────────────────────────
  UNION ALL
  SELECT '20260806_announcements_drop_legacy_message.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'announcements' AND column_name = 'message' AND is_nullable = 'YES')
  UNION ALL
  SELECT '20260806_audit_log_self_insert.sql',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'attendance_audit_log' AND policyname = 'audit_log: employee can insert own self-regularize entry')
  UNION ALL
  SELECT '20260806_wfh_requests.sql',
         to_regclass('public.wfh_requests') IS NOT NULL

  -- ── 20260810 ────────────────────────────────────────────────────────
  UNION ALL
  SELECT '20260810_bulk_comp_off_adjust.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bulk_adjust_comp_off_balance')
  UNION ALL
  SELECT '20260810_employee_current_password.sql',
         to_regclass('public.employee_current_passwords') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_current_password')
  UNION ALL
  SELECT '20260810_punches_flood_guard.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'punches_guard')
  UNION ALL
  SELECT '20260810_rls_wrap_functions.sql',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'advances' AND policyname = 'advances: admin/manager can write'
                   AND qual ILIKE '%SELECT my_tenant_id()%')

  -- ── 20260812 ────────────────────────────────────────────────────────
  UNION ALL
  SELECT '20260812_employee_profile_details.sql',
         to_regclass('public.profile_details') IS NOT NULL
  UNION ALL
  SELECT '20260812_hiring_referrals.sql',
         to_regclass('public.job_postings') IS NOT NULL
         AND to_regclass('public.referrals') IS NOT NULL
  UNION ALL
  SELECT '20260812_kra_goals_upgrade.sql',
         to_regclass('public.kra_checkins') IS NOT NULL
  UNION ALL
  SELECT '20260812_location_tracking.sql',
         to_regclass('public.location_pings') IS NOT NULL
  UNION ALL
  SELECT '20260812_payroll_formula_tax_gl.sql',
         to_regclass('public.tax_slabs') IS NOT NULL
         AND to_regclass('public.tax_declarations') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'salary_components' AND column_name = 'formula')
  UNION ALL
  SELECT '20260812_platform_analytics_summary.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'platform_analytics_summary')
  UNION ALL
  SELECT '20260812_referral_resume_upload.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'referrals' AND column_name = 'resume_file_path')
  UNION ALL
  SELECT '20260812_support_tickets.sql',
         to_regclass('public.support_tickets') IS NOT NULL
         AND to_regclass('public.support_ticket_messages') IS NOT NULL

  -- ── 20260813_1..11 ──────────────────────────────────────────────────
  UNION ALL
  SELECT '20260813_1_leave_ledger.sql',
         to_regclass('public.leave_types') IS NOT NULL
         AND to_regclass('public.leave_ledger') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'run_monthly_leave_accrual')
  UNION ALL
  SELECT '20260813_2_attendance_automation.sql',
         to_regclass('public.shift_assignments') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_attendance_from_punches')
  UNION ALL
  SELECT '20260813_3_grievances.sql',
         to_regclass('public.grievances') IS NOT NULL
  UNION ALL
  SELECT '20260813_4_recruitment_pipeline.sql',
         to_regclass('public.headcount_requests') IS NOT NULL
         AND to_regclass('public.interviews') IS NOT NULL
         AND to_regclass('public.offer_letters') IS NOT NULL
  UNION ALL
  SELECT '20260813_5_training_skills.sql',
         to_regclass('public.skills') IS NOT NULL
         AND to_regclass('public.training_programs') IS NOT NULL
         AND to_regclass('public.training_enrollments') IS NOT NULL
  UNION ALL
  SELECT '20260813_6_expense_travel.sql',
         to_regclass('public.expense_claims') IS NOT NULL
         AND to_regclass('public.travel_requests') IS NOT NULL
  UNION ALL
  SELECT '20260813_7_approval_chains_and_audit.sql',
         to_regclass('public.approval_chains') IS NOT NULL
  UNION ALL
  SELECT '20260813_8_keka_leave_categories.sql',
         EXISTS (SELECT 1 FROM leave_types WHERE name IN ('Planned Leave', 'Emergency Leave', 'Unplanned Leave'))
  UNION ALL
  SELECT '20260813_9_feature_toggles.sql',
         to_regclass('public.features') IS NOT NULL
         AND to_regclass('public.company_feature_toggles') IS NOT NULL
  UNION ALL
  SELECT '20260813_10_notification_center.sql',
         to_regclass('public.app_notifications') IS NOT NULL
         AND to_regclass('public.announcement_acknowledgements') IS NOT NULL
  UNION ALL
  SELECT '20260813_11_announcements_rls_lockdown.sql',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'announcements' AND policyname = 'announcements: tenant member or superadmin can read')

  -- ── 20260814 - 20260816 ─────────────────────────────────────────────
  UNION ALL
  SELECT '20260814_1_multi_outlet_access.sql',
         to_regclass('public.profile_outlet_access') IS NOT NULL
  UNION ALL
  SELECT '20260814_2_multi_outlet_any_clockin.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'tenants' AND column_name = 'allow_any_outlet_clockin')
  UNION ALL
  SELECT '20260815_1_onboarding.sql',
         to_regclass('public.onboarding_processes') IS NOT NULL
         AND to_regclass('public.onboarding_checklist_items') IS NOT NULL
  UNION ALL
  SELECT '20260815_2_offboarding.sql',
         to_regclass('public.offboarding_processes') IS NOT NULL
         AND to_regclass('public.offboarding_checklist_items') IS NOT NULL
  UNION ALL
  SELECT '20260815_3_onboarding_offboarding_features.sql',
         EXISTS (SELECT 1 FROM features WHERE key IN ('onboarding', 'offboarding'))
  UNION ALL
  SELECT '20260815_4_assets.sql',
         to_regclass('public.assets') IS NOT NULL
         AND to_regclass('public.asset_assignments') IS NOT NULL
  UNION ALL
  SELECT '20260815_5_projects.sql',
         to_regclass('public.projects') IS NOT NULL
         AND to_regclass('public.project_tasks') IS NOT NULL
  UNION ALL
  SELECT '20260815_6_assets_projects_features.sql',
         EXISTS (SELECT 1 FROM features WHERE key IN ('assets', 'projects'))
  UNION ALL
  SELECT '20260816_1_leave_auto_approval.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'tenants' AND column_name = 'leave_auto_approval_enabled')
  UNION ALL
  SELECT '20260816_2_unlimited_leave_and_balance_detail.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'leave_types' AND column_name = 'is_unlimited')
         AND to_regclass('public.leave_balances_detail') IS NOT NULL
  UNION ALL
  SELECT '20260816_3_regularize_auto_approval.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'tenants' AND column_name = 'regularize_auto_approval_enabled')

  -- ── 20260818 - 20260820 ─────────────────────────────────────────────
  -- Note: the two essl_web_poll_cron checks below query cron.job directly.
  -- If pg_cron has never been enabled on this project at all (Database ->
  -- Extensions), Postgres fails the whole script at parse time with
  -- "schema cron does not exist" rather than reporting MISSING for just
  -- those two rows — that error itself means pg_cron needs enabling first.
  UNION ALL
  SELECT '20260818_essl_integration.sql',
         to_regclass('public.essl_devices') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'profiles' AND column_name = 'essl_employee_code')
  UNION ALL
  SELECT '20260819_1_essl_web_poll_state.sql',
         to_regclass('public.essl_web_poll_state') IS NOT NULL
  UNION ALL
  SELECT '20260819_2_essl_web_poll_cron.sql',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'essl-raniwala-live-sync')
  UNION ALL
  SELECT '20260819_3_essl_web_poll_cleanup.sql',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'essl-web-poll-response-cleanup')
  UNION ALL
  SELECT '20260820_2_leave_balances_security_invoker.sql',
         EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'leave_balances')
         AND (SELECT relrowsecurity FROM pg_class
              WHERE relname = 'leave_balances' AND relnamespace = 'public'::regnamespace) IS NOT NULL
  UNION ALL
  SELECT '20260820_3_otp_table_lockdown.sql',
         NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'otp_table' AND policyname = 'service_role_all')
  UNION ALL
  SELECT '20260820_4_punches_select_role_check.sql',
         EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'punches' AND policyname = 'punches: admin/manager can read tenant')
  UNION ALL
  SELECT '20260820_5_recruitment_stage_and_verification.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'referrals' AND column_name = 'bgv_status')
  UNION ALL
  SELECT '20260820_6_headcount_rr_number_and_recruiter.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'headcount_requests' AND column_name = 'rr_number')
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'generate_rr_number')
  UNION ALL
  SELECT '20260820_7_interview_piq_and_rejection.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'interviews' AND column_name = 'piq_form_path')
  UNION ALL
  SELECT '20260820_8_offer_letters_loi_and_onboarding_extras.sql',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'offer_letters' AND column_name = 'letter_type')
  UNION ALL
  SELECT '20260820_9_recruitment_checklist_seed.sql',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_checklist_items_tenant_title_key')
  UNION ALL
  SELECT '20260820_profiles_select_role_check.sql',
         EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles: admin/manager sees tenant')

  -- ── 20260821 - 20260827 ─────────────────────────────────────────────
  UNION ALL
  SELECT '20260821_1_critical_security_fixes.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'attendance_employee_update_guard')
         AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'punches' AND policyname = 'punches: employee can insert own')
  UNION ALL
  SELECT '20260823_1_hierarchy_org_structure.sql',
         to_regclass('public.hierarchy_levels') IS NOT NULL
         AND to_regclass('public.locations') IS NOT NULL
         AND to_regclass('public.designations') IS NOT NULL
  UNION ALL
  SELECT '20260823_2_rbac_schema.sql',
         to_regclass('public.roles') IS NOT NULL
         AND to_regclass('public.reporting_relationships') IS NOT NULL
         AND to_regclass('public.audit_logs') IS NOT NULL
  UNION ALL
  SELECT '20260823_3_hierarchy_rbac_functions.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_permission')
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'resolve_scope_profile_ids')
  UNION ALL
  SELECT '20260823_4_hierarchy_rbac_backfill.sql',
         EXISTS (SELECT 1 FROM hierarchy_levels WHERE name = 'HR / Company Admin')
  UNION ALL
  SELECT '20260826_1_org_hierarchy_rpc.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_direct_manager')
  UNION ALL
  SELECT '20260826_2_org_hierarchy_feature.sql',
         EXISTS (SELECT 1 FROM features WHERE key = 'org_hierarchy')
  UNION ALL
  SELECT '20260827_1_server_side_geofence_enforcement.sql',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_geofence_on_attendance_insert')

  -- ── 20260901 ────────────────────────────────────────────────────────
  UNION ALL
  SELECT '20260901_1_hr_current_password_read.sql',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'employee_current_passwords'
                   AND policyname = 'employee_current_passwords: admin tenant read')
)
SELECT migration, CASE WHEN applied THEN 'APPLIED' ELSE 'MISSING — run this one' END AS status
FROM checks
ORDER BY applied, migration;
