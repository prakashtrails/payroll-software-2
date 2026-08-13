-- Wrap auth.uid()/my_tenant_id()/my_role() calls in RLS policies as
-- scalar subqueries so Postgres evaluates them once per statement
-- (InitPlan) instead of once per row scanned. Same predicates, same
-- semantics -- verified via a live pg_policies dump before/after.
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security#calling-functions-with-select

-- ---- advances ----
DROP POLICY IF EXISTS "advances: admin/manager can write" ON advances;
CREATE POLICY "advances: admin/manager can write" ON advances
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "advances: admin/manager sees tenant" ON advances;
CREATE POLICY "advances: admin/manager sees tenant" ON advances
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "advances: employee sees own" ON advances;
CREATE POLICY "advances: employee sees own" ON advances
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- agenda_templates ----
DROP POLICY IF EXISTS "agenda_templates: owner or admin can delete" ON agenda_templates;
CREATE POLICY "agenda_templates: owner or admin can delete" ON agenda_templates
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((created_by = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "agenda_templates: owner or admin can update" ON agenda_templates;
CREATE POLICY "agenda_templates: owner or admin can update" ON agenda_templates
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((created_by = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "agenda_templates: select own or shared" ON agenda_templates;
CREATE POLICY "agenda_templates: select own or shared" ON agenda_templates
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND (is_shared OR (created_by = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "agenda_templates: tenant member can insert own" ON agenda_templates;
CREATE POLICY "agenda_templates: tenant member can insert own" ON agenda_templates
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND (created_by = (select auth.uid()))));

-- ---- announcements ----
DROP POLICY IF EXISTS "Admins and managers can manage announcements" ON announcements;
CREATE POLICY "Admins and managers can manage announcements" ON announcements
  FOR ALL
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))))));

DROP POLICY IF EXISTS "Users can view announcements for their tenant and department" ON announcements;
CREATE POLICY "Users can view announcements for their tenant and department" ON announcements
  FOR SELECT
  USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))) AND ((department = 'All'::text) OR (department = ( SELECT profiles.department
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))))));

DROP POLICY IF EXISTS "announcements: admin can delete" ON announcements;
CREATE POLICY "announcements: admin can delete" ON announcements
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "announcements: admin can insert" ON announcements;
CREATE POLICY "announcements: admin can insert" ON announcements
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "announcements: admin/superadmin can write" ON announcements;
CREATE POLICY "announcements: admin/superadmin can write" ON announcements
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "announcements: tenant members can read" ON announcements;
CREATE POLICY "announcements: tenant members can read" ON announcements
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- attendance ----
DROP POLICY IF EXISTS "attendance: admin can insert any" ON attendance;
CREATE POLICY "attendance: admin can insert any" ON attendance
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "attendance: admin can update any" ON attendance;
CREATE POLICY "attendance: admin can update any" ON attendance
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "attendance: admin/manager sees tenant" ON attendance;
CREATE POLICY "attendance: admin/manager sees tenant" ON attendance
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "attendance: employee can insert own" ON attendance;
CREATE POLICY "attendance: employee can insert own" ON attendance
  FOR INSERT
  WITH CHECK (((profile_id = (select auth.uid())) AND (tenant_id = (select my_tenant_id()))));

DROP POLICY IF EXISTS "attendance: employee can update own" ON attendance;
CREATE POLICY "attendance: employee can update own" ON attendance
  FOR UPDATE
  USING ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "attendance: employee sees own" ON attendance;
CREATE POLICY "attendance: employee sees own" ON attendance
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- attendance_audit_log ----
DROP POLICY IF EXISTS "audit_log: admin/manager can insert" ON attendance_audit_log;
CREATE POLICY "audit_log: admin/manager can insert" ON attendance_audit_log
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "audit_log: admin/manager can read tenant" ON attendance_audit_log;
CREATE POLICY "audit_log: admin/manager can read tenant" ON attendance_audit_log
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "audit_log: employee can insert own self-regularize entry" ON attendance_audit_log;
CREATE POLICY "audit_log: employee can insert own self-regularize entry" ON attendance_audit_log
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND (profile_id = (select auth.uid())) AND (changed_by = (select auth.uid()))));

-- ---- departments ----
DROP POLICY IF EXISTS "departments: admin/manager can delete" ON departments;
CREATE POLICY "departments: admin/manager can delete" ON departments
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "departments: admin/manager can insert" ON departments;
CREATE POLICY "departments: admin/manager can insert" ON departments
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "departments: superadmin_platform_all" ON departments;
CREATE POLICY "departments: superadmin_platform_all" ON departments
  FOR ALL
  USING (((select my_role()) = 'superadmin'::text))
  WITH CHECK (((select my_role()) = 'superadmin'::text));

DROP POLICY IF EXISTS "departments: tenant members can read" ON departments;
CREATE POLICY "departments: tenant members can read" ON departments
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- employee_optional_holidays ----
DROP POLICY IF EXISTS "opt_holidays: admin sees tenant" ON employee_optional_holidays;
CREATE POLICY "opt_holidays: admin sees tenant" ON employee_optional_holidays
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "opt_holidays: employee can delete own" ON employee_optional_holidays;
CREATE POLICY "opt_holidays: employee can delete own" ON employee_optional_holidays
  FOR DELETE
  USING ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "opt_holidays: employee can insert own" ON employee_optional_holidays;
CREATE POLICY "opt_holidays: employee can insert own" ON employee_optional_holidays
  FOR INSERT
  WITH CHECK (((profile_id = (select auth.uid())) AND (tenant_id = (select my_tenant_id()))));

DROP POLICY IF EXISTS "opt_holidays: employee sees own" ON employee_optional_holidays;
CREATE POLICY "opt_holidays: employee sees own" ON employee_optional_holidays
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- employee_promotions ----
DROP POLICY IF EXISTS "ep_admin_insert" ON employee_promotions;
CREATE POLICY "ep_admin_insert" ON employee_promotions
  FOR INSERT
  WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'superadmin'::text]))))));

DROP POLICY IF EXISTS "ep_tenant_select" ON employee_promotions;
CREATE POLICY "ep_tenant_select" ON employee_promotions
  FOR SELECT
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))));

-- ---- employee_transfers ----
DROP POLICY IF EXISTS "admins insert transfers from their tenant" ON employee_transfers;
CREATE POLICY "admins insert transfers from their tenant" ON employee_transfers
  FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = ANY (ARRAY['admin'::text, 'superadmin'::text])) AND (p.tenant_id = employee_transfers.from_tenant_id)))));

DROP POLICY IF EXISTS "admins see transfers involving their tenant" ON employee_transfers;
CREATE POLICY "admins see transfers involving their tenant" ON employee_transfers
  FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = ANY (ARRAY['admin'::text, 'superadmin'::text, 'manager'::text])) AND ((p.tenant_id = employee_transfers.from_tenant_id) OR (p.tenant_id = employee_transfers.to_tenant_id))))));

-- ---- feedback ----
DROP POLICY IF EXISTS "feedback: admin can delete" ON feedback;
CREATE POLICY "feedback: admin can delete" ON feedback
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "feedback: involved parties or admin can select" ON feedback;
CREATE POLICY "feedback: involved parties or admin can select" ON feedback
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((created_by = (select auth.uid())) OR (from_profile_id = (select auth.uid())) OR (to_profile_id = (select auth.uid())) OR (requested_from = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "feedback: requester or requested party can update" ON feedback;
CREATE POLICY "feedback: requester or requested party can update" ON feedback
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((requested_from = (select auth.uid())) OR (created_by = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "feedback: tenant member can insert own" ON feedback;
CREATE POLICY "feedback: tenant member can insert own" ON feedback
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND (created_by = (select auth.uid()))));

-- ---- holidays ----
DROP POLICY IF EXISTS "holidays: admin/manager can write" ON holidays;
CREATE POLICY "holidays: admin/manager can write" ON holidays
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "holidays: tenant members can read" ON holidays;
CREATE POLICY "holidays: tenant members can read" ON holidays
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- kra_kpis ----
DROP POLICY IF EXISTS "kra_kpis: admin/manager can delete" ON kra_kpis;
CREATE POLICY "kra_kpis: admin/manager can delete" ON kra_kpis
  FOR DELETE
  USING ((((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (EXISTS ( SELECT 1
   FROM kras k
  WHERE ((k.id = kra_kpis.kra_id) AND (k.tenant_id = (select my_tenant_id())))))));

DROP POLICY IF EXISTS "kra_kpis: admin/manager can insert" ON kra_kpis;
CREATE POLICY "kra_kpis: admin/manager can insert" ON kra_kpis
  FOR INSERT
  WITH CHECK ((((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (EXISTS ( SELECT 1
   FROM kras k
  WHERE ((k.id = kra_kpis.kra_id) AND (k.tenant_id = (select my_tenant_id())))))));

DROP POLICY IF EXISTS "kra_kpis: admin/manager can update" ON kra_kpis;
CREATE POLICY "kra_kpis: admin/manager can update" ON kra_kpis
  FOR UPDATE
  USING ((((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (EXISTS ( SELECT 1
   FROM kras k
  WHERE ((k.id = kra_kpis.kra_id) AND (k.tenant_id = (select my_tenant_id())))))));

DROP POLICY IF EXISTS "kra_kpis: select via parent kra" ON kra_kpis;
CREATE POLICY "kra_kpis: select via parent kra" ON kra_kpis
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM kras k
  WHERE ((k.id = kra_kpis.kra_id) AND (k.tenant_id = (select my_tenant_id())) AND ((k.profile_id IS NULL) OR (k.profile_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))))));

-- ---- kras ----
DROP POLICY IF EXISTS "kras: admin/manager can delete" ON kras;
CREATE POLICY "kras: admin/manager can delete" ON kras
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "kras: admin/manager can insert" ON kras;
CREATE POLICY "kras: admin/manager can insert" ON kras
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "kras: admin/manager can update" ON kras;
CREATE POLICY "kras: admin/manager can update" ON kras
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "kras: owner can update own progress" ON kras;
CREATE POLICY "kras: owner can update own progress" ON kras
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND (profile_id = (select auth.uid()))));

DROP POLICY IF EXISTS "kras: select own, company-wide, or admin/manager" ON kras;
CREATE POLICY "kras: select own, company-wide, or admin/manager" ON kras
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((profile_id IS NULL) OR (profile_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))));

-- ---- leave_requests ----
DROP POLICY IF EXISTS "Admins can update leave status" ON leave_requests;
CREATE POLICY "Admins can update leave status" ON leave_requests
  FOR UPDATE
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS "Admins can view all leaves" ON leave_requests;
CREATE POLICY "Admins can view all leaves" ON leave_requests
  FOR SELECT
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS "Employees can insert own leaves" ON leave_requests;
CREATE POLICY "Employees can insert own leaves" ON leave_requests
  FOR INSERT
  WITH CHECK ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "Employees can view own leaves" ON leave_requests;
CREATE POLICY "Employees can view own leaves" ON leave_requests
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "leaves: admin can update tenant" ON leave_requests;
CREATE POLICY "leaves: admin can update tenant" ON leave_requests
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "leaves: admin sees tenant" ON leave_requests;
CREATE POLICY "leaves: admin sees tenant" ON leave_requests
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "leaves: employee can insert own" ON leave_requests;
CREATE POLICY "leaves: employee can insert own" ON leave_requests
  FOR INSERT
  WITH CHECK (((profile_id = (select auth.uid())) AND (tenant_id = (select my_tenant_id()))));

DROP POLICY IF EXISTS "leaves: employee sees own" ON leave_requests;
CREATE POLICY "leaves: employee sees own" ON leave_requests
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- notifications ----
DROP POLICY IF EXISTS "notifications: user can mark own read" ON notifications;
CREATE POLICY "notifications: user can mark own read" ON notifications
  FOR UPDATE
  USING ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "notifications: user sees own" ON notifications;
CREATE POLICY "notifications: user sees own" ON notifications
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- one_on_ones ----
DROP POLICY IF EXISTS "one_on_ones: organizer can insert" ON one_on_ones;
CREATE POLICY "one_on_ones: organizer can insert" ON one_on_ones
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND (organizer_id = (select auth.uid()))));

DROP POLICY IF EXISTS "one_on_ones: organizer or admin can delete" ON one_on_ones;
CREATE POLICY "one_on_ones: organizer or admin can delete" ON one_on_ones
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((organizer_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "one_on_ones: participants or admin can select" ON one_on_ones;
CREATE POLICY "one_on_ones: participants or admin can select" ON one_on_ones
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((organizer_id = (select auth.uid())) OR (participant_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "one_on_ones: participants or admin can update" ON one_on_ones;
CREATE POLICY "one_on_ones: participants or admin can update" ON one_on_ones
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((organizer_id = (select auth.uid())) OR (participant_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

-- ---- outlet_transfers ----
DROP POLICY IF EXISTS "outlet_transfers: admin/manager can insert" ON outlet_transfers;
CREATE POLICY "outlet_transfers: admin/manager can insert" ON outlet_transfers
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (transferred_by = (select auth.uid()))));

DROP POLICY IF EXISTS "outlet_transfers: own history or admin/manager can select" ON outlet_transfers;
CREATE POLICY "outlet_transfers: own history or admin/manager can select" ON outlet_transfers
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((profile_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))));

-- ---- outlets ----
DROP POLICY IF EXISTS "outlets: admin/manager manage own tenant" ON outlets;
CREATE POLICY "outlets: admin/manager manage own tenant" ON outlets
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "outlets: superadmin full access" ON outlets;
CREATE POLICY "outlets: superadmin full access" ON outlets
  FOR ALL
  USING (((select my_role()) = 'superadmin'::text))
  WITH CHECK (((select my_role()) = 'superadmin'::text));

DROP POLICY IF EXISTS "outlets: tenant select own" ON outlets;
CREATE POLICY "outlets: tenant select own" ON outlets
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- payrolls ----
DROP POLICY IF EXISTS "payrolls: admin/manager can write" ON payrolls;
CREATE POLICY "payrolls: admin/manager can write" ON payrolls
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "payrolls: tenant members can read" ON payrolls;
CREATE POLICY "payrolls: tenant members can read" ON payrolls
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- payslips ----
DROP POLICY IF EXISTS "payslips: admin/manager can write" ON payslips;
CREATE POLICY "payslips: admin/manager can write" ON payslips
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "payslips: admin/manager sees tenant" ON payslips;
CREATE POLICY "payslips: admin/manager sees tenant" ON payslips
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "payslips: employee sees own" ON payslips;
CREATE POLICY "payslips: employee sees own" ON payslips
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- pip_checkins ----
DROP POLICY IF EXISTS "pip_checkins: admin/manager can insert own" ON pip_checkins;
CREATE POLICY "pip_checkins: admin/manager can insert own" ON pip_checkins
  FOR INSERT
  WITH CHECK (((author_id = (select auth.uid())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (EXISTS ( SELECT 1
   FROM pips pp
  WHERE ((pp.id = pip_checkins.pip_id) AND (pp.tenant_id = (select my_tenant_id())))))));

DROP POLICY IF EXISTS "pip_checkins: select via parent pip" ON pip_checkins;
CREATE POLICY "pip_checkins: select via parent pip" ON pip_checkins
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM pips pp
  WHERE ((pp.id = pip_checkins.pip_id) AND (pp.tenant_id = (select my_tenant_id())) AND ((pp.profile_id = (select auth.uid())) OR (pp.manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))))));

-- ---- pip_goals ----
DROP POLICY IF EXISTS "pip_goals: admin/manager can delete" ON pip_goals;
CREATE POLICY "pip_goals: admin/manager can delete" ON pip_goals
  FOR DELETE
  USING ((((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (EXISTS ( SELECT 1
   FROM pips pp
  WHERE ((pp.id = pip_goals.pip_id) AND (pp.tenant_id = (select my_tenant_id())))))));

DROP POLICY IF EXISTS "pip_goals: admin/manager can insert" ON pip_goals;
CREATE POLICY "pip_goals: admin/manager can insert" ON pip_goals
  FOR INSERT
  WITH CHECK ((((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (EXISTS ( SELECT 1
   FROM pips pp
  WHERE ((pp.id = pip_goals.pip_id) AND (pp.tenant_id = (select my_tenant_id())))))));

DROP POLICY IF EXISTS "pip_goals: admin/manager can update" ON pip_goals;
CREATE POLICY "pip_goals: admin/manager can update" ON pip_goals
  FOR UPDATE
  USING ((((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])) AND (EXISTS ( SELECT 1
   FROM pips pp
  WHERE ((pp.id = pip_goals.pip_id) AND (pp.tenant_id = (select my_tenant_id())))))));

DROP POLICY IF EXISTS "pip_goals: select via parent pip" ON pip_goals;
CREATE POLICY "pip_goals: select via parent pip" ON pip_goals
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM pips pp
  WHERE ((pp.id = pip_goals.pip_id) AND (pp.tenant_id = (select my_tenant_id())) AND ((pp.profile_id = (select auth.uid())) OR (pp.manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))))));

-- ---- pips ----
DROP POLICY IF EXISTS "pips: admin can delete" ON pips;
CREATE POLICY "pips: admin can delete" ON pips
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "pips: admin/manager can insert" ON pips;
CREATE POLICY "pips: admin/manager can insert" ON pips
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "pips: admin/manager can update" ON pips;
CREATE POLICY "pips: admin/manager can update" ON pips
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "pips: own, managing, or admin/manager can select" ON pips;
CREATE POLICY "pips: own, managing, or admin/manager can select" ON pips
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((profile_id = (select auth.uid())) OR (manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))));

-- ---- policies ----
DROP POLICY IF EXISTS "policies: admin can delete" ON policies;
CREATE POLICY "policies: admin can delete" ON policies
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "policies: admin can insert" ON policies;
CREATE POLICY "policies: admin can insert" ON policies
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "policies: admin/superadmin can write" ON policies;
CREATE POLICY "policies: admin/superadmin can write" ON policies
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "policies: tenant members can read" ON policies;
CREATE POLICY "policies: tenant members can read" ON policies
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- profiles ----
DROP POLICY IF EXISTS "profiles: admin/manager can delete from tenant" ON profiles;
CREATE POLICY "profiles: admin/manager can delete from tenant" ON profiles
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "profiles: admin/manager can update tenant" ON profiles;
CREATE POLICY "profiles: admin/manager can update tenant" ON profiles
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((role <> 'superadmin'::text) OR ((select my_role()) = 'superadmin'::text))));

DROP POLICY IF EXISTS "profiles: admin/manager sees tenant" ON profiles;
CREATE POLICY "profiles: admin/manager sees tenant" ON profiles
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) OR ((select my_role()) = 'superadmin'::text)));

DROP POLICY IF EXISTS "profiles: employee sees self" ON profiles;
CREATE POLICY "profiles: employee sees self" ON profiles
  FOR SELECT
  USING ((id = (select auth.uid())));

DROP POLICY IF EXISTS "profiles: superadmin_platform_all" ON profiles;
CREATE POLICY "profiles: superadmin_platform_all" ON profiles
  FOR ALL
  USING (((select my_role()) = 'superadmin'::text))
  WITH CHECK (((select my_role()) = 'superadmin'::text));

-- ---- punches ----
DROP POLICY IF EXISTS "punches: admin/manager can delete" ON punches;
CREATE POLICY "punches: admin/manager can delete" ON punches
  FOR DELETE
  USING (((attendance_id IN ( SELECT attendance.id
   FROM attendance
  WHERE (attendance.tenant_id = (select my_tenant_id())))) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "punches: admin/manager can insert" ON punches;
CREATE POLICY "punches: admin/manager can insert" ON punches
  FOR INSERT
  WITH CHECK (((attendance_id IN ( SELECT attendance.id
   FROM attendance
  WHERE (attendance.tenant_id = (select my_tenant_id())))) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "punches: admin/manager can read tenant" ON punches;
CREATE POLICY "punches: admin/manager can read tenant" ON punches
  FOR SELECT
  USING ((attendance_id IN ( SELECT attendance.id
   FROM attendance
  WHERE (attendance.tenant_id = (select my_tenant_id())))));

DROP POLICY IF EXISTS "punches: employee can insert own" ON punches;
CREATE POLICY "punches: employee can insert own" ON punches
  FOR INSERT
  WITH CHECK ((attendance_id IN ( SELECT attendance.id
   FROM attendance
  WHERE (attendance.profile_id = (select auth.uid())))));

DROP POLICY IF EXISTS "punches: employee can read own" ON punches;
CREATE POLICY "punches: employee can read own" ON punches
  FOR SELECT
  USING ((attendance_id IN ( SELECT attendance.id
   FROM attendance
  WHERE (attendance.profile_id = (select auth.uid())))));

-- ---- push_tokens ----
DROP POLICY IF EXISTS "push_tokens: user manages own" ON push_tokens;
CREATE POLICY "push_tokens: user manages own" ON push_tokens
  FOR ALL
  USING ((profile_id = (select auth.uid())))
  WITH CHECK (((profile_id = (select auth.uid())) AND (tenant_id = (select my_tenant_id()))));

-- ---- regularize_requests ----
DROP POLICY IF EXISTS "admin_manager_select_tenant" ON regularize_requests;
CREATE POLICY "admin_manager_select_tenant" ON regularize_requests
  FOR SELECT
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))))));

DROP POLICY IF EXISTS "admin_manager_update_tenant" ON regularize_requests;
CREATE POLICY "admin_manager_update_tenant" ON regularize_requests
  FOR UPDATE
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))))));

DROP POLICY IF EXISTS "employee_insert_own" ON regularize_requests;
CREATE POLICY "employee_insert_own" ON regularize_requests
  FOR INSERT
  WITH CHECK ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "employee_select_own" ON regularize_requests;
CREATE POLICY "employee_select_own" ON regularize_requests
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- request_quotas ----
DROP POLICY IF EXISTS "rq_tenant_insert" ON request_quotas;
CREATE POLICY "rq_tenant_insert" ON request_quotas
  FOR INSERT
  WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))));

DROP POLICY IF EXISTS "rq_tenant_select" ON request_quotas;
CREATE POLICY "rq_tenant_select" ON request_quotas
  FOR SELECT
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))));

DROP POLICY IF EXISTS "rq_tenant_update" ON request_quotas;
CREATE POLICY "rq_tenant_update" ON request_quotas
  FOR UPDATE
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))))));

-- ---- review_answers ----
DROP POLICY IF EXISTS "review_answers: author or admin can update" ON review_answers;
CREATE POLICY "review_answers: author or admin can update" ON review_answers
  FOR UPDATE
  USING (((answered_by = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_answers: reviewee, manager, or admin can insert own answ" ON review_answers;
CREATE POLICY "review_answers: reviewee, manager, or admin can insert own answ" ON review_answers
  FOR INSERT
  WITH CHECK (((answered_by = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM reviews r
  WHERE ((r.id = review_answers.review_id) AND (r.tenant_id = (select my_tenant_id())) AND ((r.profile_id = (select auth.uid())) OR (r.reporting_manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))))))));

DROP POLICY IF EXISTS "review_answers: select via parent review" ON review_answers;
CREATE POLICY "review_answers: select via parent review" ON review_answers
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM reviews r
  WHERE ((r.id = review_answers.review_id) AND (r.tenant_id = (select my_tenant_id())) AND ((r.profile_id = (select auth.uid())) OR (r.reporting_manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))))));

-- ---- review_cycles ----
DROP POLICY IF EXISTS "review_cycles: admin can delete" ON review_cycles;
CREATE POLICY "review_cycles: admin can delete" ON review_cycles
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_cycles: admin can insert" ON review_cycles;
CREATE POLICY "review_cycles: admin can insert" ON review_cycles
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_cycles: admin can update" ON review_cycles;
CREATE POLICY "review_cycles: admin can update" ON review_cycles
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_cycles: tenant members can select" ON review_cycles;
CREATE POLICY "review_cycles: tenant members can select" ON review_cycles
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- review_kra_ratings ----
DROP POLICY IF EXISTS "review_kra_ratings: manager or admin can insert" ON review_kra_ratings;
CREATE POLICY "review_kra_ratings: manager or admin can insert" ON review_kra_ratings
  FOR INSERT
  WITH CHECK (((rated_by = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM reviews r
  WHERE ((r.id = review_kra_ratings.review_id) AND (r.tenant_id = (select my_tenant_id())) AND ((r.reporting_manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))))))));

DROP POLICY IF EXISTS "review_kra_ratings: rater or admin can update" ON review_kra_ratings;
CREATE POLICY "review_kra_ratings: rater or admin can update" ON review_kra_ratings
  FOR UPDATE
  USING (((rated_by = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_kra_ratings: select via parent review" ON review_kra_ratings;
CREATE POLICY "review_kra_ratings: select via parent review" ON review_kra_ratings
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM reviews r
  WHERE ((r.id = review_kra_ratings.review_id) AND (r.tenant_id = (select my_tenant_id())) AND ((r.profile_id = (select auth.uid())) OR (r.reporting_manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))))));

-- ---- review_questions ----
DROP POLICY IF EXISTS "review_questions: admin can delete" ON review_questions;
CREATE POLICY "review_questions: admin can delete" ON review_questions
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_questions: admin can insert" ON review_questions;
CREATE POLICY "review_questions: admin can insert" ON review_questions
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_questions: admin can update" ON review_questions;
CREATE POLICY "review_questions: admin can update" ON review_questions
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "review_questions: tenant members can select" ON review_questions;
CREATE POLICY "review_questions: tenant members can select" ON review_questions
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- reviews ----
DROP POLICY IF EXISTS "reviews: admin can delete" ON reviews;
CREATE POLICY "reviews: admin can delete" ON reviews
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "reviews: admin can insert" ON reviews;
CREATE POLICY "reviews: admin can insert" ON reviews
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "reviews: reviewee, manager, or admin can select" ON reviews;
CREATE POLICY "reviews: reviewee, manager, or admin can select" ON reviews
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((profile_id = (select auth.uid())) OR (reporting_manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))));

DROP POLICY IF EXISTS "reviews: reviewee, manager, or admin can update" ON reviews;
CREATE POLICY "reviews: reviewee, manager, or admin can update" ON reviews
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((profile_id = (select auth.uid())) OR (reporting_manager_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text])))));

-- ---- salary_components ----
DROP POLICY IF EXISTS "salary_components: admin/manager can write" ON salary_components;
CREATE POLICY "salary_components: admin/manager can write" ON salary_components
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))))
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "salary_components: tenant members can read" ON salary_components;
CREATE POLICY "salary_components: tenant members can read" ON salary_components
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

-- ---- shifts ----
DROP POLICY IF EXISTS "shifts: read for tenant" ON shifts;
CREATE POLICY "shifts: read for tenant" ON shifts
  FOR SELECT
  USING ((tenant_id = (select my_tenant_id())));

DROP POLICY IF EXISTS "shifts: write for admin" ON shifts;
CREATE POLICY "shifts: write for admin" ON shifts
  FOR ALL
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = 'admin'::text)));

-- ---- special_requests ----
DROP POLICY IF EXISTS "admin_see_tenant_special_requests" ON special_requests;
CREATE POLICY "admin_see_tenant_special_requests" ON special_requests
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.tenant_id = special_requests.tenant_id) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))))));

DROP POLICY IF EXISTS "admin_update_special_requests" ON special_requests;
CREATE POLICY "admin_update_special_requests" ON special_requests
  FOR UPDATE
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.tenant_id = special_requests.tenant_id) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))))));

DROP POLICY IF EXISTS "employee_insert_special_requests" ON special_requests;
CREATE POLICY "employee_insert_special_requests" ON special_requests
  FOR INSERT
  WITH CHECK ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "employee_see_own_special_requests" ON special_requests;
CREATE POLICY "employee_see_own_special_requests" ON special_requests
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

-- ---- tenants ----
DROP POLICY IF EXISTS "tenant: admin can update own" ON tenants;
CREATE POLICY "tenant: admin can update own" ON tenants
  FOR UPDATE
  USING (((id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text]))));

DROP POLICY IF EXISTS "tenant: members see own" ON tenants;
CREATE POLICY "tenant: members see own" ON tenants
  FOR SELECT
  USING ((id = (select my_tenant_id())));

DROP POLICY IF EXISTS "tenant: superadmin sees all" ON tenants;
CREATE POLICY "tenant: superadmin sees all" ON tenants
  FOR SELECT
  USING (((select my_role()) = 'superadmin'::text));

DROP POLICY IF EXISTS "tenants: superadmin_platform_all" ON tenants;
CREATE POLICY "tenants: superadmin_platform_all" ON tenants
  FOR ALL
  USING (((select my_role()) = 'superadmin'::text))
  WITH CHECK (((select my_role()) = 'superadmin'::text));

-- ---- weekly_off_settlements ----
DROP POLICY IF EXISTS "Admins can manage settlements" ON weekly_off_settlements;
CREATE POLICY "Admins can manage settlements" ON weekly_off_settlements
  FOR ALL
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS "Tenant members can view settlements" ON weekly_off_settlements;
CREATE POLICY "Tenant members can view settlements" ON weekly_off_settlements
  FOR SELECT
  USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))));

-- ---- wfh_requests ----
DROP POLICY IF EXISTS "wfh_requests: admin can delete" ON wfh_requests;
CREATE POLICY "wfh_requests: admin can delete" ON wfh_requests
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "wfh_requests: admin/manager can update" ON wfh_requests;
CREATE POLICY "wfh_requests: admin/manager can update" ON wfh_requests
  FOR UPDATE
  USING (((tenant_id = (select my_tenant_id())) AND ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text]))));

DROP POLICY IF EXISTS "wfh_requests: employee can cancel own pending" ON wfh_requests;
CREATE POLICY "wfh_requests: employee can cancel own pending" ON wfh_requests
  FOR DELETE
  USING (((tenant_id = (select my_tenant_id())) AND (profile_id = (select auth.uid())) AND (status = 'Pending'::text)));

DROP POLICY IF EXISTS "wfh_requests: employee can insert own pending" ON wfh_requests;
CREATE POLICY "wfh_requests: employee can insert own pending" ON wfh_requests
  FOR INSERT
  WITH CHECK (((tenant_id = (select my_tenant_id())) AND (profile_id = (select auth.uid())) AND (status = 'Pending'::text)));

DROP POLICY IF EXISTS "wfh_requests: own or admin/manager can select" ON wfh_requests;
CREATE POLICY "wfh_requests: own or admin/manager can select" ON wfh_requests
  FOR SELECT
  USING (((tenant_id = (select my_tenant_id())) AND ((profile_id = (select auth.uid())) OR ((select my_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'superadmin'::text])))));
