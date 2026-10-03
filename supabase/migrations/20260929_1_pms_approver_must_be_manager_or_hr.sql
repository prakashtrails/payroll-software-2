-- PMS: a KPI approver confirms monthly results and, for company/department/
-- team scorecards, becomes the scorecard approver. pms_create_kpi only checked
-- that the approver was an active member, so a plain employee (e.g. a cashier)
-- could be made the sole approver of a department scorecard, and HR could not
-- step in. Approvers must now be managers/HOD/management or HR.
-- Additive: one helper, one trigger, one data correction.

CREATE OR REPLACE FUNCTION public.pms_can_approve(p_tenant uuid, p_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile AND tenant_id = p_tenant AND status = 'Active'
                 AND (pms_is_hr(role) OR pms_is_mgr(role)));
$$;

CREATE OR REPLACE FUNCTION public.pms_kpis_check_approver()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.approver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.approver_id IS DISTINCT FROM OLD.approver_id)
     AND NOT pms_can_approve(NEW.tenant_id, NEW.approver_id) THEN
    PERFORM pms_fail('Choose an approver who is a manager, HOD, management or HR user.');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pms_kpis_check_approver ON public.pms_kpis;
CREATE TRIGGER pms_kpis_check_approver BEFORE INSERT OR UPDATE OF approver_id ON public.pms_kpis
  FOR EACH ROW EXECUTE FUNCTION public.pms_kpis_check_approver();

-- Existing ineligible approvers: clear them so HR decides (NULL approver falls
-- back to HR in pms_decide_update and pms_scorecard_action).
UPDATE public.pms_kpis k SET approver_id = NULL, updated_at = now()
 WHERE k.approver_id IS NOT NULL AND NOT pms_can_approve(k.tenant_id, k.approver_id);
UPDATE public.pms_scorecards c SET approver_id = NULL, updated_at = now()
 WHERE c.approver_id IS NOT NULL AND NOT pms_can_approve(c.tenant_id, c.approver_id);
