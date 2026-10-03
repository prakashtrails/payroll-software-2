-- =============================================================
-- Punch approval follow-ups (28 Sep 2026). 20260928_10 (app punch manager
-- approval) is live in its first form; this adds:
--
--   1. HR copy: every held punch now also notifies every active HR (admin)
--      as the record -- not only when the employee has no manager / HOD.
--      Manager / HOD still get the approval request; with neither, HR is
--      the approver.
--   2. list_punch_approvals(): reviewed history keyed on reviewed_at, so a
--      punch HR approved for an employee with no approver still shows.
--   3. essl_apply_to_attendance() (20260928_8 + _9, other session) totalled
--      hours over EVERY punch of the day -- a pending or rejected app punch
--      would have counted as soon as that day's machine punch synced.
--      Patched in place (same targeted-replace approach as _9) to count
--      approved punches only. A day already 'Pending Approval' is left as
--      is by that function; review_punches() recomputes it.
-- =============================================================


-- ── 1. HR copy ─────────────────────────────────────────────────────────
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


-- ── 2. Reviewed history keyed on reviewed_at ───────────────────────────
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


-- ── 3. ESSL apply: approved punches only ──────────────────────────────
DO $$
DECLARE
  v_def text;
  v_old constant text := $q$FROM punches WHERE attendance_id = v_att_id;$q$;
  v_new constant text := $q$FROM punches WHERE attendance_id = v_att_id AND approval_status = 'approved';$q$;
BEGIN
  SELECT pg_get_functiondef('public.essl_apply_to_attendance(uuid, text[], date, date, boolean)'::regprocedure) INTO v_def;
  -- Already patched (re-run): nothing to do.
  IF position(v_new IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'essl_apply_to_attendance punch totals not in the expected form -- aborting';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
