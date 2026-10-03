-- =============================================================
-- Raniwala: Management (ABHISHEK SIR, ABHIYANT SIR) use the HOD portal
-- (26 Sep 2026).
--
-- User: "abhishek sir and abhiyant sir are the managements so provide them
-- the HOD portal and assign as the list HOD.xlsx — whoever manager under
-- them and employees of that manager comes under them".
--
-- 1. Every "hod sees/updates team" policy now also covers role =
--    'management', with the same my_team_ids() scope: their own reports
--    plus everyone below those reports in the manager_id tree.
-- 2. my_team_ids() walks up to 10 levels (was 6). Owners sit above the
--    whole org (Abhiyant -> Abhishek -> Amit -> Ramesh -> Manoj -> Jayanta
--    -> employee is already 6 deep).
-- 3. Leave route: when the leave's HOD is a Management user, their HOD
--    approval already is management's approval, so no separate Management
--    stage (no one approves the same leave twice).
--
-- The reporting links themselves (manager_id / hod_id to the two owner
-- accounts) are set by 20260926_13 once HR has created those accounts.
-- =============================================================

ALTER POLICY "attendance: hod sees team" ON attendance
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "leave_ledger: hod sees team" ON leave_ledger
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "profiles: hod sees team" ON profiles
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "regularize_requests: hod sees team" ON regularize_requests
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "regularize_requests: hod updates team" ON regularize_requests
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "special_requests: hod sees team" ON special_requests
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "special_requests: hod updates team" ON special_requests
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "wfh_requests: hod sees team" ON wfh_requests
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));
ALTER POLICY "wfh_requests: hod updates team" ON wfh_requests
  USING (((SELECT my_role()) IN ('hod', 'management')) AND (tenant_id = (SELECT my_tenant_id())) AND (profile_id = ANY ((SELECT my_team_ids())::uuid[])));

CREATE OR REPLACE FUNCTION public.my_team_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE tree(id, depth) AS (
    SELECT p.id, 1 FROM profiles p
    WHERE (p.manager_id = auth.uid() OR p.hod_id = auth.uid()) AND p.id <> auth.uid()
    UNION
    SELECT p.id, t.depth + 1 FROM profiles p JOIN tree t ON p.manager_id = t.id
    WHERE t.depth < 10 AND p.id <> auth.uid()
  )
  SELECT COALESCE(array_agg(DISTINCT id), '{}'::uuid[]) FROM tree;
$function$;

CREATE OR REPLACE FUNCTION public.raniwala_leave_route(p_profile_id uuid, p_tenant_id uuid, p_start date, p_end date, p_applied_on date, OUT o_manager uuid, OUT o_hod uuid, OUT o_duration integer, OUT o_manager_status text, OUT o_hod_status text, OUT o_hr_status text, OUT o_management_status text, OUT o_short_notice boolean)
RETURNS record
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hod_role text;
BEGIN
  o_duration := (p_end - p_start) + 1;
  SELECT r.o_manager, r.o_hod INTO o_manager, o_hod FROM resolve_leave_approvers(p_profile_id) r;
  SELECT role INTO v_hod_role FROM profiles WHERE id = o_hod;

  o_manager_status := CASE WHEN o_manager IS NULL THEN 'Not Required' ELSE 'Pending' END;
  o_management_status := 'Not Required';
  o_short_notice := false;

  -- Manager = HOD = HR: that one person's approval is the whole flow.
  IF o_manager IS NULL AND o_hod IS NOT NULL AND v_hod_role IN ('admin', 'superadmin') THEN
    o_hod_status := 'Pending';
    o_hr_status := 'Not Required';
    o_short_notice := o_duration >= 6 AND p_start - p_applied_on < 15;
    RETURN;
  END IF;

  IF o_duration <= 3 THEN
    o_hod_status := CASE WHEN o_manager IS NULL AND o_hod IS NOT NULL THEN 'Pending' ELSE 'Not Required' END;
    o_hr_status  := CASE WHEN o_manager IS NULL AND o_hod IS NULL THEN 'Pending' ELSE 'Not Required' END;
  ELSIF o_duration <= 5 THEN
    o_hod_status := CASE WHEN o_hod IS NULL THEN 'Not Required' ELSE 'Pending' END;
    o_hr_status  := CASE WHEN o_hod IS NULL THEN 'Pending' ELSE 'Not Required' END;
  ELSE
    o_hod_status := CASE WHEN o_hod IS NULL THEN 'Not Required' ELSE 'Pending' END;
    o_hr_status  := 'Pending';
    -- An HOD who is Management has already given management's approval.
    o_management_status := CASE
      WHEN v_hod_role = 'management' THEN 'Not Required'
      WHEN tenant_has_active_role(p_tenant_id, 'management') THEN 'Pending'
      ELSE 'Not Required' END;
    o_short_notice := p_start - p_applied_on < 15;
  END IF;
END;
$function$;
