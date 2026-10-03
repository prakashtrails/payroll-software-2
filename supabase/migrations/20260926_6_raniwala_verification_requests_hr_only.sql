-- =============================================================
-- Raniwala: profile verification requests (bank / PAN / Aadhaar changes)
-- are HR-only (26 Sep 2026). Managers and HODs neither see, approve, nor
-- get notified about them -- not even for their own team. Their own
-- request stays visible to them. Other tenants unchanged.
-- =============================================================

-- Access: cut the reporting-manager grant (is_reporting_manager_of) down to
-- the caller's own row for Raniwala managers/HODs.
DROP POLICY IF EXISTS "pvr: raniwala hr only" ON profile_verification_requests;
CREATE POLICY "pvr: raniwala hr only" ON profile_verification_requests AS RESTRICTIVE FOR ALL
  USING (
    NOT ((select my_role()) IN ('manager', 'hod') AND (select my_is_raniwala()))
    OR profile_id = (select auth.uid())
  )
  WITH CHECK (
    NOT ((select my_role()) IN ('manager', 'hod') AND (select my_is_raniwala()))
    OR profile_id = (select auth.uid())
  );

-- Notifications: verification requests never reach a Raniwala manager/HOD;
-- every other request type stays team-only (20260926_5).
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

  IF v_role IN ('manager', 'hod') THEN
    IF NEW.link_key = 'verification_requests' THEN
      RETURN NULL;
    END IF;
    IF NOT is_in_team_of(NEW.actor_id, NEW.profile_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
