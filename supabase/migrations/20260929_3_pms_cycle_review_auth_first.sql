-- pms_submit_cycle_assessment validated the answers before checking who was
-- calling, so an outsider got "Answer the required question…" instead of a
-- permission error. Check the caller first. Otherwise identical to 20260929_2.

CREATE OR REPLACE FUNCTION public.pms_submit_cycle_assessment(p_review uuid, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; r pms_cycle_reviews; v_clean jsonb; v_self boolean;
BEGIN
  SELECT * INTO a FROM pms_actor();
  PERFORM pms_require_feature(a.tenant_id, 'performance_reviews');
  SELECT * INTO r FROM pms_cycle_reviews WHERE id = p_review AND tenant_id = a.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pms_fail('Review not found.'); END IF;
  IF r.status = 'Released' THEN PERFORM pms_fail('This review has been released and is read-only.'); END IF;
  v_self := r.employee_id = a.uid;
  IF NOT v_self AND NOT pms_can_manage_emp(a.uid, a.role, r.employee_id) THEN
    PERFORM pms_fail('Only the employee, their manager or HR can complete this assessment.');
  END IF;
  v_clean := pms_clean_cycle_answers(r.questions, p_answers);
  IF v_self THEN
    IF r.manager_answers IS NOT NULL THEN
      PERFORM pms_fail('Your manager has already assessed this review, so your self-assessment is locked.');
    END IF;
    UPDATE pms_cycle_reviews SET self_answers = v_clean, updated_at = now(), status = 'Self submitted' WHERE id = r.id;
    PERFORM pms_notify(a.tenant_id, pms_employee_approver(r.employee_id), a.uid, 'pms_self_submitted', 'Self-assessment submitted',
      COALESCE(pms_person_name(a.uid), 'An employee') || ' submitted a ' || r.period || ' self-assessment.', r.id);
    PERFORM pms_audit(a.tenant_id, 'cycle_review', r.id, 'self-submit', a.uid);
  ELSE
    IF r.self_answers IS NULL THEN
      PERFORM pms_fail('Wait for the employee''s self-assessment before submitting the manager assessment.');
    END IF;
    UPDATE pms_cycle_reviews SET manager_answers = v_clean, manager_by = a.uid, status = 'Manager submitted', updated_at = now() WHERE id = r.id;
    PERFORM pms_audit(a.tenant_id, 'cycle_review', r.id, 'manager-submit', a.uid);
  END IF;
  RETURN pms_workspace(r.fy);
END;
$$;
