-- =============================================================
-- Manager approval for app / web punches (28 Sep 2026, Raniwala request).
--
-- Office, Factory and Delhi staff punch on the ESSL machine. When one of
-- them punches in/out from the phone or the website instead, that punch
-- must be approved by their manager before its hours count anywhere
-- (Attendance Log, payroll, comp off). B2B Sales works in the field and
-- punches from the app all day, so their outlet is not flagged.
--
-- Enforced here, not in a client: the mobile app (separate team, same DB)
-- inserts punches directly, so the DB is the only place both clients meet.
--
--   outlets.app_punch_needs_approval  per-outlet switch (HR can change it)
--   punches.approval_status           approved (default) | pending | rejected
--   punches.approver_id               manager_id -> hod_id -> NULL (= HR)
--
-- Notifications: the approver (manager / HOD) gets the request, and every
-- active HR (admin) gets a copy as the record. With no manager / HOD, HR is
-- the approver. HR's list shows every held punch in the tenant.
--
-- A punch is held as pending only when ALL hold:
--   * source = 'app' (web + mobile; ESSL is 'device', HR edits 'manual')
--   * it is the employee's OWN punch (auth.uid() = attendance.profile_id)
--   * their outlet has app_punch_needs_approval
--   * it isn't an approved regularize request being applied
--
-- While a day has a pending punch its status is 'Pending Approval' (not a
-- paid status, so payroll doesn't count it), and total_hours only ever
-- counts APPROVED punches. review_punches() approves/rejects and then
-- recomputes the day, including Late, from the approved punches.
-- =============================================================


-- ── 1. Columns ──────────────────────────────────────────────────────────
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS app_punch_needs_approval boolean NOT NULL DEFAULT false;

ALTER TABLE punches ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';
ALTER TABLE punches ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE punches DROP CONSTRAINT IF EXISTS punches_approval_status_check;
ALTER TABLE punches ADD CONSTRAINT punches_approval_status_check
  CHECK (approval_status IN ('approved', 'pending', 'rejected'));

CREATE INDEX IF NOT EXISTS punches_pending_approval_idx
  ON punches (attendance_id) WHERE approval_status <> 'approved';

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('Present','Absent','Late','Half Day','Leave','Comp Off','Travel','Show Visit','Mispunch','Pending Approval'));


-- ── 2. Who needs approval ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profile_app_punch_needs_approval(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(o.app_punch_needs_approval, false)
  FROM profiles p
  LEFT JOIN outlets o ON o.id = p.outlet_id
  WHERE p.id = p_profile_id;
$$;


-- ── 3. Punch insert: hold it as pending ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_punch_mark_pending_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile uuid;
BEGIN
  IF NEW.source IS DISTINCT FROM 'app'
     OR auth.uid() IS NULL
     OR current_setting('app.regularize_apply', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_profile FROM attendance WHERE id = NEW.attendance_id;
  IF v_profile IS DISTINCT FROM auth.uid() OR NOT profile_app_punch_needs_approval(v_profile) THEN
    RETURN NEW;
  END IF;

  NEW.approval_status := 'pending';
  NEW.approver_id := (SELECT COALESCE(manager_id, hod_id) FROM profiles WHERE id = v_profile);
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_punch_mark_pending_approval ON punches;
CREATE TRIGGER trg_punch_mark_pending_approval
  BEFORE INSERT ON punches
  FOR EACH ROW EXECUTE FUNCTION trg_punch_mark_pending_approval();


-- ── 4. After a pending punch: flag the day + tell the approver ─────────
CREATE OR REPLACE FUNCTION public.trg_punch_pending_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_att      RECORD;
  v_name     text;
  v_approver text;
  v_what     text;
BEGIN
  IF NEW.approval_status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT a.id, a.tenant_id, a.profile_id, a.date INTO v_att FROM attendance a WHERE a.id = NEW.attendance_id;

  -- Re-derive the day (-> 'Pending Approval'); forced so it runs whoever
  -- the caller is.
  PERFORM set_config('app.punch_review', 'on', true);
  UPDATE attendance SET total_hours = total_hours WHERE id = v_att.id;
  PERFORM set_config('app.punch_review', 'off', true);

  SELECT trim(concat_ws(' ', first_name, last_name)) INTO v_name FROM profiles WHERE id = v_att.profile_id;
  SELECT trim(concat_ws(' ', first_name, last_name)) INTO v_approver FROM profiles WHERE id = NEW.approver_id;
  v_what := v_name || ' punched ' || NEW.punch_type || ' at ' || left(NEW.punch_time, 5)
            || ' on ' || to_char(v_att.date, 'DD Mon') || ' from the app/web';

  -- The manager (or HOD) decides.
  IF NEW.approver_id IS NOT NULL AND NEW.approver_id <> v_att.profile_id THEN
    INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
    VALUES (v_att.tenant_id, NEW.approver_id, v_att.profile_id, 'punch_approval_request',
            'Punch needs your approval', v_what || '.', 'punch_approvals', NEW.id);
  END IF;

  -- HR always gets it too, as the record (and can approve it themselves).
  -- With no manager / HOD on file, HR is the approver.
  INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
  SELECT v_att.tenant_id, p.id, v_att.profile_id, 'punch_approval_request',
         CASE WHEN NEW.approver_id IS NULL THEN 'Punch needs your approval' ELSE 'App punch sent for approval' END,
         v_what || CASE WHEN NEW.approver_id IS NULL THEN ' — no manager assigned, so HR approves.'
                        ELSE ' — sent to ' || COALESCE(v_approver, 'their manager') || ' for approval.' END,
         'punch_approvals', NEW.id
  FROM profiles p
  WHERE p.tenant_id = v_att.tenant_id
    AND p.role = 'admin' AND p.status = 'Active'
    AND p.id <> v_att.profile_id
    AND p.id IS DISTINCT FROM NEW.approver_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_punch_pending_notify ON punches;
CREATE TRIGGER trg_punch_pending_notify
  AFTER INSERT ON punches
  FOR EACH ROW EXECUTE FUNCTION trg_punch_pending_notify();


-- ── 5. Day created by the employee's own app clock-in ──────────────────
-- clockIn() (web + mobile) creates the row as Present/Late before the punch
-- exists; for approval outlets it starts as Pending Approval instead.
CREATE OR REPLACE FUNCTION public.trg_attendance_app_insert_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() = NEW.profile_id
     AND NEW.status IN ('Present', 'Late')
     AND current_setting('app.regularize_apply', true) IS DISTINCT FROM 'on'
     AND profile_app_punch_needs_approval(NEW.profile_id) THEN
    NEW.status := 'Pending Approval';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_app_insert_pending ON attendance;
CREATE TRIGGER trg_attendance_app_insert_pending
  BEFORE INSERT ON attendance
  FOR EACH ROW EXECUTE FUNCTION trg_attendance_app_insert_pending();


-- ── 6. Recompute: approved punches only ────────────────────────────────
-- Live definition (last redeclared in 20260925_2) with three changes:
--   a) hours span only APPROVED punches;
--   b) a day with a pending punch is 'Pending Approval';
--   c) the "trust admin/manager" shortcut no longer applies to someone
--      updating their OWN day while it has unreviewed punches (a manager's
--      own clock-out would otherwise count their pending punch), nor when
--      review_punches() forces a recompute. On leaving Pending Approval,
--      Late is re-derived from the first approved punch.
CREATE OR REPLACE FUNCTION public.trg_recompute_attendance_from_punches()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_total numeric := 0;
  v_half  numeric;
  v_full  numeric;
  v_first text;
  v_last  text;
  v_outlet_id uuid;
  v_shift_id uuid;
  v_shift_start text;
  v_late_min int;
  v_forced boolean := current_setting('app.punch_review', true) = 'on';
  v_pending boolean;
  v_unreviewed boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM leave_requests lr
    WHERE lr.profile_id = NEW.profile_id
      AND lr.status = 'Approved'
      AND NEW.date BETWEEN lr.start_date AND lr.end_date
  ) THEN
    NEW.status := 'Leave';
    RETURN NEW;
  END IF;

  SELECT COALESCE(bool_or(approval_status = 'pending'), false),
         COALESCE(bool_or(approval_status <> 'approved'), false)
  INTO v_pending, v_unreviewed
  FROM punches WHERE attendance_id = NEW.id;

  IF my_role() IN ('admin','manager','superadmin')
     AND NOT v_forced
     AND (auth.uid() IS DISTINCT FROM NEW.profile_id OR NOT v_unreviewed) THEN
    RETURN NEW; -- trust manual admin corrections
  END IF;

  -- approved regularize request being applied by apply_approved_regularize_request()
  IF current_setting('app.regularize_apply', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Mispunch' AND NOT v_forced
     AND (SELECT count(*) FROM punches WHERE attendance_id = NEW.id) <= 1 THEN
    RETURN NEW;
  END IF;

  SELECT min(punch_time), max(punch_time) INTO v_first, v_last
  FROM punches WHERE attendance_id = NEW.id AND approval_status = 'approved';

  IF v_first IS NOT NULL AND v_last IS NOT NULL THEN
    v_total := (
      (EXTRACT(EPOCH FROM (v_last::time - v_first::time))::numeric % 86400 + 86400) % 86400
    ) / 3600.0;
  END IF;

  SELECT p.outlet_id, p.shift_id INTO v_outlet_id, v_shift_id FROM profiles p WHERE p.id = NEW.profile_id;

  SELECT
    COALESCE(o.min_half_day_hours, t.min_half_day_hours, 4),
    COALESCE(o.min_full_day_hours, t.min_full_day_hours, 8)
  INTO v_half, v_full
  FROM tenants t
  LEFT JOIN outlets o ON o.id = v_outlet_id
  WHERE t.id = NEW.tenant_id;

  NEW.total_hours := GREATEST(round(v_total * 100) / 100, 0);
  NEW.status := CASE
    WHEN NEW.total_hours >= v_full THEN 'Present'
    WHEN NEW.total_hours >= v_half THEN 'Half Day'
    ELSE 'Absent'
  END;

  IF v_pending THEN
    NEW.status := 'Pending Approval';
  ELSIF OLD.status = 'Late' AND NEW.status = 'Present' THEN
    NEW.status := 'Late';
  ELSIF OLD.status = 'Pending Approval' AND NEW.status = 'Present' THEN
    -- Same Report Time + Late Allowed rule as recompute_attendance_late_status().
    IF v_shift_id IS NOT NULL THEN
      SELECT s.start_time INTO v_shift_start FROM shifts s WHERE s.id = v_shift_id;
    END IF;
    SELECT COALESCE(v_shift_start, o.shift_start, t.shift_start, '10:30'),
           COALESCE(o.late_threshold, t.late_threshold, 0)
    INTO v_shift_start, v_late_min
    FROM tenants t
    LEFT JOIN outlets o ON o.id = v_outlet_id
    WHERE t.id = NEW.tenant_id;

    IF (EXTRACT(HOUR FROM v_first::time)::int * 60 + EXTRACT(MINUTE FROM v_first::time)::int)
       - (EXTRACT(HOUR FROM v_shift_start::time)::int * 60 + EXTRACT(MINUTE FROM v_shift_start::time)::int)
       > v_late_min THEN
      NEW.status := 'Late';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ── 7. Review (approve / reject) ───────────────────────────────────────
-- Caller must be the punch's approver, the employee's manager or HOD, or
-- HR (admin) of the same tenant. Never your own punch.
CREATE OR REPLACE FUNCTION public.review_punches(p_punch_ids uuid[], p_approve boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_tenant uuid;
  r        RECORD;
  v_atts   uuid[] := '{}';
  v_count  int := 0;
BEGIN
  SELECT role, tenant_id INTO v_role, v_tenant FROM profiles WHERE id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  FOR r IN
    SELECT pu.id, pu.attendance_id, pu.approver_id, pu.punch_type, pu.punch_time,
           a.profile_id, a.tenant_id, a.date, p.manager_id, p.hod_id
    FROM punches pu
    JOIN attendance a ON a.id = pu.attendance_id
    JOIN profiles p ON p.id = a.profile_id
    WHERE pu.id = ANY (p_punch_ids) AND pu.approval_status = 'pending'
    FOR UPDATE OF pu
  LOOP
    IF r.profile_id = v_uid THEN
      RAISE EXCEPTION 'You cannot approve your own punch';
    END IF;
    IF NOT (
      v_uid IN (r.approver_id, r.manager_id, r.hod_id)
      OR (v_role = 'admin' AND v_tenant = r.tenant_id)
      OR v_role = 'superadmin'
    ) THEN
      RAISE EXCEPTION 'Not authorized to review this punch';
    END IF;

    UPDATE punches
    SET approval_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        reviewed_by = v_uid,
        reviewed_at = now()
    WHERE id = r.id;

    INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
    VALUES (r.tenant_id, r.profile_id, v_uid, 'punch_approval_result',
            CASE WHEN p_approve THEN 'Punch approved' ELSE 'Punch rejected' END,
            'Your app punch ' || r.punch_type || ' at ' || left(r.punch_time, 5) || ' on '
              || to_char(r.date, 'DD Mon') || ' was ' || CASE WHEN p_approve THEN 'approved.' ELSE 'rejected — it won''t count towards your hours.' END,
            'attendance', r.attendance_id);

    v_atts := array_append(v_atts, r.attendance_id);
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    PERFORM set_config('app.punch_review', 'on', true);
    UPDATE attendance SET total_hours = total_hours WHERE id = ANY (v_atts);
    PERFORM set_config('app.punch_review', 'off', true);
  END IF;

  RETURN v_count;
END;
$$;


-- ── 8. Listing for the approver screens (web + mobile) ─────────────────
-- p_status: 'pending' | 'approved' | 'rejected' | 'all'. Reviewed rows are
-- limited to punches made on/after p_since (default: last 30 days).
CREATE OR REPLACE FUNCTION public.list_punch_approvals(p_status text DEFAULT 'pending', p_since date DEFAULT NULL)
RETURNS TABLE (
  punch_id uuid, attendance_id uuid, profile_id uuid,
  employee_name text, employee_code text, department text, outlet_name text,
  date date, punch_time text, punch_type text, approval_status text,
  approver_name text, reviewed_by_name text, reviewed_at timestamptz, created_at timestamptz,
  lat double precision, lng double precision, out_of_geofence boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_tenant uuid;
BEGIN
  SELECT pr.role, pr.tenant_id INTO v_role, v_tenant FROM profiles pr WHERE pr.id = v_uid;
  IF v_role IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pu.id, a.id, a.profile_id,
         trim(concat_ws(' ', e.first_name, e.last_name)),
         COALESCE(e.employee_id, e.essl_employee_code),
         e.department, o.name,
         a.date, pu.punch_time::text, pu.punch_type::text, pu.approval_status,
         trim(concat_ws(' ', ap.first_name, ap.last_name)),
         trim(concat_ws(' ', rv.first_name, rv.last_name)),
         pu.reviewed_at, pu.created_at,
         (CASE WHEN pu.punch_type = 'in' THEN a.punch_in_lat ELSE a.punch_out_lat END)::double precision,
         (CASE WHEN pu.punch_type = 'in' THEN a.punch_in_lng ELSE a.punch_out_lng END)::double precision,
         a.out_of_geofence
  FROM punches pu
  JOIN attendance a ON a.id = pu.attendance_id
  JOIN profiles e ON e.id = a.profile_id
  LEFT JOIN outlets o ON o.id = e.outlet_id
  LEFT JOIN profiles ap ON ap.id = pu.approver_id
  LEFT JOIN profiles rv ON rv.id = pu.reviewed_by
  WHERE a.tenant_id = v_tenant
    AND (pu.reviewed_at IS NOT NULL OR pu.approval_status <> 'approved')
    AND (p_status = 'all' OR pu.approval_status = p_status)
    AND (pu.approval_status = 'pending' OR a.date >= COALESCE(p_since, current_date - 30))
    AND a.profile_id <> v_uid
    AND (
      v_uid IN (pu.approver_id, e.manager_id, e.hod_id)
      OR v_role IN ('admin', 'superadmin')
    )
  ORDER BY a.date DESC, pu.punch_time DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.review_punches(uuid[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_punch_approvals(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_punches(uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_punch_approvals(text, date) TO authenticated;


-- ── 9. Turn it on for Raniwala's machine outlets ───────────────────────
UPDATE outlets o SET app_punch_needs_approval = true
FROM tenants t
WHERE t.id = o.tenant_id
  AND t.company_name ILIKE '%raniwala%'
  AND o.name IN ('Office Staff', 'Factory Staff', 'Delhi Experience Centre');
