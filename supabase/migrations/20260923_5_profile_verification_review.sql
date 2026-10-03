-- Profile verification (Bank / PAN / Aadhar) — review hardening on top of
-- 20260922_4_profile_verification_requests.sql.
--
-- 1. Who reviews: HR (admin/superadmin) or the employee's OWN reporting
--    manager (profiles.manager_id), whatever that person's role. Live data
--    (checked 2026-09-23): no profile has role 'manager' — all 45 reporting
--    managers are role 'employee' (plus 2 admins) — so a role-based check
--    would have left HR as the only possible reviewer. Previously any
--    'manager'-role user could see and approve anyone's request.
--
-- 2. Atomic approve/reject via review_verification_request(): the web page
--    used to mark the request Approved and then update profiles in a second
--    client call — if that second call failed, the request read Approved but
--    nothing was applied. Now both happen in one transaction, and only the
--    columns belonging to the request's field_group are copied.
--
-- 3. "Verified until unverified": a trigger clears the matching
--    *_verified_at whenever bank/PAN/Aadhar values change by any path OTHER
--    than an approval (e.g. HR editing the employee on the web), so a field
--    never shows Verified for a value nobody verified. Approval stamps a new
--    *_verified_at in the same UPDATE, which the trigger leaves alone.

-- True when the caller is p_profile_id's reporting manager. SECURITY DEFINER
-- because after 20260923_4 an employee-role manager can't read their
-- reports' profiles rows, so an inline subquery in a policy would see none.
CREATE OR REPLACE FUNCTION is_reporting_manager_of(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile_id AND manager_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION is_reporting_manager_of(uuid) FROM public;
GRANT EXECUTE ON FUNCTION is_reporting_manager_of(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION review_verification_request(p_request_id uuid, p_approve boolean)
RETURNS profile_verification_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req  profile_verification_requests;
  v_role text := my_role();
  v_now  timestamptz := now();
  v_new  jsonb;
BEGIN
  SELECT * INTO v_req FROM profile_verification_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Verification request not found';
  END IF;
  IF v_req.tenant_id IS DISTINCT FROM my_tenant_id() AND v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'Not allowed to review this request';
  END IF;
  IF NOT (v_role IN ('admin', 'superadmin') OR is_reporting_manager_of(v_req.profile_id)) THEN
    RAISE EXCEPTION 'Only HR or this employee''s reporting manager can review this request';
  END IF;
  IF v_req.profile_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot review your own verification request';
  END IF;
  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'This request has already been reviewed.';
  END IF;

  UPDATE profile_verification_requests
     SET status = CASE WHEN p_approve THEN 'Approved' ELSE 'Rejected' END,
         reviewed_by = auth.uid(),
         reviewed_at = v_now
   WHERE id = p_request_id
   RETURNING * INTO v_req;

  IF p_approve THEN
    v_new := v_req.new_value;
    IF v_req.field_group = 'bank' THEN
      UPDATE profiles SET
        bank_acc  = COALESCE(v_new->>'bank_acc', bank_acc),
        bank_name = COALESCE(v_new->>'bank_name', bank_name),
        ifsc_code = COALESCE(v_new->>'ifsc_code', ifsc_code),
        bank_verified_at = v_now
      WHERE id = v_req.profile_id;
    ELSIF v_req.field_group = 'pan' THEN
      UPDATE profiles SET pan = COALESCE(v_new->>'pan', pan), pan_verified_at = v_now
      WHERE id = v_req.profile_id;
    ELSIF v_req.field_group = 'aadhar' THEN
      UPDATE profiles SET aadhar = COALESCE(v_new->>'aadhar', aadhar), aadhar_verified_at = v_now
      WHERE id = v_req.profile_id;
    END IF;
  END IF;

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION review_verification_request(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION review_verification_request(uuid, boolean) TO authenticated;

-- ---- Unverify on any non-approval change --------------------------------
CREATE OR REPLACE FUNCTION profiles_clear_stale_verification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.bank_acc, NEW.bank_name, NEW.ifsc_code) IS DISTINCT FROM (OLD.bank_acc, OLD.bank_name, OLD.ifsc_code)
     AND NEW.bank_verified_at IS NOT DISTINCT FROM OLD.bank_verified_at THEN
    NEW.bank_verified_at := NULL;
  END IF;
  IF NEW.pan IS DISTINCT FROM OLD.pan AND NEW.pan_verified_at IS NOT DISTINCT FROM OLD.pan_verified_at THEN
    NEW.pan_verified_at := NULL;
  END IF;
  IF NEW.aadhar IS DISTINCT FROM OLD.aadhar AND NEW.aadhar_verified_at IS NOT DISTINCT FROM OLD.aadhar_verified_at THEN
    NEW.aadhar_verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_clear_stale_verification ON profiles;
CREATE TRIGGER trg_profiles_clear_stale_verification
  BEFORE UPDATE OF bank_acc, bank_name, ifsc_code, pan, aadhar ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_clear_stale_verification();

-- ---- Reporting managers see / touch only their own reports' requests ----
DROP POLICY IF EXISTS "pvr: own or admin/manager can select" ON profile_verification_requests;
CREATE POLICY "pvr: own or admin/manager can select"
  ON profile_verification_requests FOR SELECT
  USING (
    tenant_id = my_tenant_id() AND (
      profile_id = auth.uid()
      OR my_role() IN ('admin', 'superadmin')
      OR is_reporting_manager_of(profile_id)
    )
  );

-- Reviews go through review_verification_request(); direct UPDATEs are
-- limited to the same reviewers as a backstop.
DROP POLICY IF EXISTS "pvr: admin/manager can update" ON profile_verification_requests;
CREATE POLICY "pvr: admin/manager can update"
  ON profile_verification_requests FOR UPDATE
  USING (
    tenant_id = my_tenant_id() AND (
      my_role() IN ('admin', 'superadmin')
      OR is_reporting_manager_of(profile_id)
    )
  );
