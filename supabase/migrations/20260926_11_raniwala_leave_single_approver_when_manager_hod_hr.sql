-- =============================================================
-- Raniwala: one approval when the employee's manager, HOD and HR are the
-- same person (26 Sep 2026).
--
-- User rule:
--   * Manager = HOD = HR (e.g. POOJA KHANDELWAL, admin, for 365/430/450/453):
--     one approval for ANY leave length. No separate HR or Management stage.
--   * Manager = HOD (not HR): they alone approve up to 5 days; for 6+ days
--     HR must approve as well before it counts as leave. This was already
--     the behaviour and is unchanged.
--
-- resolve_leave_approvers() (20260926_10) already folds manager = HOD into
-- a single HOD stage. Here, when that one approver is HR (admin), the HR
-- and Management stages are dropped too.
-- =============================================================

CREATE OR REPLACE FUNCTION public.raniwala_leave_route(p_profile_id uuid, p_tenant_id uuid, p_start date, p_end date, p_applied_on date, OUT o_manager uuid, OUT o_hod uuid, OUT o_duration integer, OUT o_manager_status text, OUT o_hod_status text, OUT o_hr_status text, OUT o_management_status text, OUT o_short_notice boolean)
RETURNS record
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  o_duration := (p_end - p_start) + 1;
  SELECT r.o_manager, r.o_hod INTO o_manager, o_hod FROM resolve_leave_approvers(p_profile_id) r;

  o_manager_status := CASE WHEN o_manager IS NULL THEN 'Not Required' ELSE 'Pending' END;
  o_management_status := 'Not Required';
  o_short_notice := false;

  -- Manager = HOD = HR: that one person's approval is the whole flow.
  IF o_manager IS NULL AND o_hod IS NOT NULL
     AND EXISTS (SELECT 1 FROM profiles WHERE id = o_hod AND role IN ('admin', 'superadmin')) THEN
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
    o_management_status := CASE WHEN tenant_has_active_role(p_tenant_id, 'management') THEN 'Pending' ELSE 'Not Required' END;
    o_short_notice := p_start - p_applied_on < 15;
  END IF;
END;
$function$;
