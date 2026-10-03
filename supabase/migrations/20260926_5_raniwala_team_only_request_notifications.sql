-- =============================================================
-- Raniwala: request notifications reach a manager/HOD only for their own
-- team (26 Sep 2026).
--
-- The web and mobile apps notify "every manager in the tenant" when an
-- employee submits a regularize / WFH / special / expense / travel /
-- verification request (notificationService.notifyRoles). Installed app
-- builds keep doing that, so the rule is enforced here: an app_notifications
-- row about a request, addressed to a Raniwala manager or HOD, is dropped
-- unless the employee who triggered it (actor_id) is below that person in
-- the manager_id tree. HR (admin) and every other tenant are unaffected.
-- =============================================================

-- Is p_member anywhere below p_leader in the manager_id tree?
CREATE OR REPLACE FUNCTION is_in_team_of(p_member uuid, p_leader uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur uuid;
  i int := 0;
BEGIN
  SELECT manager_id INTO v_cur FROM profiles WHERE id = p_member;
  WHILE v_cur IS NOT NULL AND i < 8 LOOP
    IF v_cur = p_leader THEN
      RETURN true;
    END IF;
    SELECT manager_id INTO v_cur FROM profiles WHERE id = v_cur;
    i := i + 1;
  END LOOP;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION trg_team_only_request_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  IF NEW.actor_id IS NULL OR NEW.actor_id = NEW.profile_id
     OR NEW.link_key IS NULL
     OR NEW.link_key NOT IN ('leave_requests', 'regularize_attendance', 'wfh_requests', 'special_requests',
                             'expense_claims', 'travel_requests', 'verification_requests') THEN
    RETURN NEW;
  END IF;

  SELECT p.role INTO v_role
  FROM profiles p JOIN tenants t ON t.id = p.tenant_id
  WHERE p.id = NEW.profile_id AND t.company_name ILIKE '%Raniwala%';

  -- Only Raniwala managers/HODs are filtered; the actor must be in their team.
  IF v_role IN ('manager', 'hod') AND NOT is_in_team_of(NEW.actor_id, NEW.profile_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_only_request_notifications ON app_notifications;
CREATE TRIGGER trg_team_only_request_notifications
  BEFORE INSERT ON app_notifications
  FOR EACH ROW EXECUTE FUNCTION trg_team_only_request_notifications();
