-- =============================================================
-- Task register rules (OKR-style execution, phase 1) on top of
-- 20261003_1_task_management.sql.
--
-- Statuses stay To Do / In Progress / Blocked / Done / Cancelled (the app
-- uses them). A separate review state is added:
--   Done → review_status 'Pending' → 'Approved'  (or 'Sent back' → In Progress)
--
-- Strict rules (agreed 2026-10-05), enforced here so app + web behave the same:
--   • A due date is required to leave To Do (In Progress / Blocked / Done).
--     The assignee may fill a missing due date themselves.
--   • Once work starts (started_at set) the due date is frozen — slippage goes
--     on revised_due_date (task managers only).
--   • Blocked needs a reason (status_note sent with the status change).
--   • Done after the effective due date needs a reason for the delay.
--   • Done that goes to review needs a deliverable link, or a completion note
--     when there is no document.
--   • Done is refused while a sub-task or a "waiting on" task is still open.
--   • An approved task can only be reopened by a task manager.
--
-- Review: approver = named reviewer_id, else the assigner (if not the
-- assignee), else the assignee's manager. With none of those the task is
-- approved on Done. Anyone who can manage the task (creator, managers up
-- the chain, admin) or the named reviewer may decide — never the assignee.
-- Decisions go through task_review() only.
--
-- Also: sub-tasks (parent_task_id), dependencies (waiting_on), start date,
-- repeat (daily/weekly/monthly → next copy on Done), link to a PMS KPI,
-- deliverable links, and a field-level change log in task_activity.
--
-- Re-runnable and additive. Only one task exists on prod at the time of
-- writing; the rules apply to status transitions, not to existing rows.
-- =============================================================

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS reviewer_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status    text,
  ADD COLUMN IF NOT EXISTS reviewed_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS start_date       date,
  ADD COLUMN IF NOT EXISTS started_at       timestamptz,
  ADD COLUMN IF NOT EXISTS revised_due_date date,
  ADD COLUMN IF NOT EXISTS status_note      text,
  ADD COLUMN IF NOT EXISTS deliverables     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_task_id   uuid REFERENCES project_tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS waiting_on       uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS repeat_rule      text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS repeat_of        uuid REFERENCES project_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kpi_id           uuid REFERENCES pms_kpis(id) ON DELETE SET NULL;

ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_review_status_check;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_review_status_check
  CHECK (review_status IS NULL OR review_status IN ('Pending','Approved','Sent back'));
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_repeat_rule_check;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_repeat_rule_check
  CHECK (repeat_rule IN ('none','daily','weekly','monthly'));
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_status_note_len;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_status_note_len
  CHECK (status_note IS NULL OR char_length(status_note) <= 500);
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_deliverables_shape;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_deliverables_shape
  CHECK (jsonb_typeof(deliverables) = 'array' AND jsonb_array_length(deliverables) <= 10);
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_waiting_on_len;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_waiting_on_len
  CHECK (cardinality(waiting_on) <= 20);
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_not_own_parent;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_not_own_parent
  CHECK (parent_task_id IS NULL OR parent_task_id <> id);

-- Existing rows: anything already past To Do counts as started; Done rows approved.
UPDATE project_tasks SET started_at = COALESCE(started_at, created_at) WHERE status <> 'To Do' AND started_at IS NULL;
UPDATE project_tasks SET review_status = 'Approved' WHERE status = 'Done' AND review_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_tasks_parent   ON project_tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_reviewer ON project_tasks(reviewer_id)    WHERE reviewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_kpi      ON project_tasks(kpi_id)         WHERE kpi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_repeat_of ON project_tasks(repeat_of)     WHERE repeat_of IS NOT NULL;

ALTER TABLE task_activity DROP CONSTRAINT IF EXISTS task_activity_kind_check;
ALTER TABLE task_activity ADD CONSTRAINT task_activity_kind_check
  CHECK (kind IN ('created','comment','status','assigned','due_date','field','review'));

-- ── 2. Helpers ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION task_today() RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Who a Done task waits on: reviewer, else the assigner (when not the
-- assignee), else the assignee's manager. NULL = nobody → auto-approve.
CREATE OR REPLACE FUNCTION task_default_approver(p_assignee uuid, p_creator uuid, p_reviewer uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(p_reviewer, p_assignee),
    NULLIF(p_creator, p_assignee),
    (SELECT NULLIF(a.manager_id, p_assignee) FROM profiles a
      JOIN profiles m ON m.id = a.manager_id AND m.status = 'Active'
     WHERE a.id = p_assignee));
$$;

-- May the caller approve / send back this task?
CREATE OR REPLACE FUNCTION task_can_review(p_tenant uuid, p_project uuid, p_assignee uuid, p_creator uuid, p_reviewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- COALESCE: with no named reviewer, auth.uid() = NULL is NULL, and NOT NULL lets anyone through.
  SELECT COALESCE(auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_assignee
     AND (auth.uid() = p_reviewer OR task_can_manage(p_tenant, p_project, p_assignee, p_creator)), false);
$$;

GRANT EXECUTE ON FUNCTION task_today() TO authenticated;
GRANT EXECUTE ON FUNCTION task_can_review(uuid, uuid, uuid, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION task_default_approver(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Guard trigger (replaces 20261003_1's) ──────────────────────────────
CREATE OR REPLACE FUNCTION trg_project_tasks_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  -- COALESCE: an unset setting reads as NULL, and NOT NULL would skip every check.
  v_system   boolean := COALESCE(current_setting('crewcore.task_system', true), '') = 'on';
  v_review   boolean := COALESCE(current_setting('crewcore.task_review', true), '') = 'on';
  v_trusted  boolean;
  v_manager  boolean := false;
  v_status_changed boolean;
  v_today    date := task_today();
  v_approver uuid;
  v_open     text;
  v_item     jsonb;
  v_parent   project_tasks;
BEGIN
  v_trusted := v_uid IS NULL OR v_system;

  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND NOT v_system THEN NEW.created_by := v_uid; END IF;
    IF NEW.project_id IS NULL AND NEW.assigned_to IS NULL THEN
      NEW.assigned_to := NEW.created_by;
    END IF;
    IF NOT v_trusted THEN
      NEW.started_at := NULL;  -- stamped below from the status
      NEW.repeat_of  := NULL;  -- only the repeat job links copies
    END IF;
  ELSE
    NEW.tenant_id  := OLD.tenant_id;
    NEW.created_by := OLD.created_by;
    NEW.source     := OLD.source;
    NEW.repeat_of  := OLD.repeat_of;
    NEW.started_at := OLD.started_at;
  END IF;

  -- Review columns are written only by task_review() / this trigger.
  IF NOT v_review AND NOT v_trusted THEN
    IF TG_OP = 'INSERT' THEN
      NEW.review_status := NULL; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    ELSIF (NEW.review_status, NEW.reviewed_by, NEW.reviewed_at)
          IS DISTINCT FROM (OLD.review_status, OLD.reviewed_by, OLD.reviewed_at) THEN
      RAISE EXCEPTION 'Approve or send back a task from its review panel.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.title := btrim(NEW.title);
  END IF;
  NEW.updated_at := now();
  v_status_changed := TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status;

  IF v_status_changed THEN
    NEW.completed_at := CASE WHEN NEW.status = 'Done' THEN now() END;
    -- A note belongs to the status change it was sent with.
    IF TG_OP = 'UPDATE' AND NEW.status_note IS NOT DISTINCT FROM OLD.status_note THEN
      NEW.status_note := NULL;
    END IF;
    IF NEW.status <> 'To Do' AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
      NEW.start_date := COALESCE(NEW.start_date, v_today);
    END IF;
  ELSE
    NEW.completed_at := OLD.completed_at;
  END IF;
  NEW.status_note := NULLIF(btrim(NEW.status_note), '');

  IF TG_OP = 'UPDATE' THEN
    v_manager := task_can_manage(OLD.tenant_id, OLD.project_id, OLD.assigned_to, OLD.created_by);
  END IF;

  -- ── Permissions (people only; service role / system jobs are trusted) ──
  IF NOT v_trusted AND NOT v_review THEN
    IF TG_OP = 'UPDATE' AND NOT v_manager THEN
      -- The assignee: status (+ its note), deliverable links, and a missing due date.
      IF (NEW.title, NEW.description, NEW.assigned_to, NEW.priority, NEW.project_id, NEW.reviewer_id,
          NEW.start_date, NEW.revised_due_date, NEW.parent_task_id, NEW.waiting_on, NEW.repeat_rule, NEW.kpi_id)
         IS DISTINCT FROM
         (OLD.title, OLD.description, OLD.assigned_to, OLD.priority, OLD.project_id, OLD.reviewer_id,
          COALESCE(OLD.start_date, CASE WHEN v_status_changed AND OLD.started_at IS NULL THEN v_today END),
          OLD.revised_due_date, OLD.parent_task_id, OLD.waiting_on, OLD.repeat_rule, OLD.kpi_id)
         OR (NEW.due_date IS DISTINCT FROM OLD.due_date AND OLD.due_date IS NOT NULL) THEN
        RAISE EXCEPTION 'You can only update the status, deliverables and a missing due date of a task assigned to you.' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' THEN
        RAISE EXCEPTION 'Only the person who assigned this task (or a manager) can cancel it.' USING ERRCODE = '42501';
      END IF;
      IF v_status_changed AND OLD.status = 'Done' AND OLD.review_status = 'Approved' THEN
        RAISE EXCEPTION 'This task is approved — ask the person who assigned it to reopen it.' USING ERRCODE = '42501';
      END IF;
    END IF;

    IF TG_OP = 'INSERT'
       OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.project_id  IS DISTINCT FROM OLD.project_id THEN
      IF NOT task_can_assign(NEW.tenant_id, NEW.project_id, NEW.assigned_to) THEN
        RAISE EXCEPTION '%', CASE WHEN NEW.project_id IS NOT NULL
          THEN 'Project tasks can only be assigned to project members, by HR or a manager.'
          ELSE 'You can only assign tasks to yourself or to people in your reporting team.' END
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- ── Shape checks (everyone) ──
  IF NEW.reviewer_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
                                      OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.reviewer_id AND tenant_id = NEW.tenant_id AND status = 'Active') THEN
      RAISE EXCEPTION 'Choose an active colleague as the reviewer.' USING ERRCODE = '22023';
    END IF;
    IF NEW.reviewer_id = NEW.assigned_to THEN
      RAISE EXCEPTION 'The reviewer must be someone other than the task owner.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.parent_task_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id) THEN
    SELECT * INTO v_parent FROM project_tasks WHERE id = NEW.parent_task_id;
    IF v_parent.id IS NULL OR v_parent.tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Parent task not found.' USING ERRCODE = '22023';
    END IF;
    IF v_parent.parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Sub-tasks cannot have their own sub-tasks.' USING ERRCODE = '22023';
    END IF;
    IF NOT v_trusted AND v_parent.assigned_to IS DISTINCT FROM v_uid
       AND NOT task_can_manage(v_parent.tenant_id, v_parent.project_id, v_parent.assigned_to, v_parent.created_by) THEN
      RAISE EXCEPTION 'You can only add sub-tasks to a task you own or manage.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.waiting_on IS DISTINCT FROM OLD.waiting_on THEN
    NEW.waiting_on := ARRAY(SELECT DISTINCT x FROM unnest(NEW.waiting_on) x WHERE x IS NOT NULL);
    IF NEW.id = ANY (NEW.waiting_on) THEN
      RAISE EXCEPTION 'A task cannot wait on itself.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(NEW.waiting_on) x
               WHERE NOT EXISTS (SELECT 1 FROM project_tasks t WHERE t.id = x AND t.tenant_id = NEW.tenant_id)) THEN
      RAISE EXCEPTION 'One of the tasks this waits on no longer exists.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM project_tasks t WHERE t.id = ANY (NEW.waiting_on) AND NEW.id = ANY (t.waiting_on)) THEN
      RAISE EXCEPTION 'Those two tasks would wait on each other.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.deliverables IS DISTINCT FROM OLD.deliverables THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.deliverables) LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR COALESCE(v_item->>'url', '') !~* '^https?://\S+$'
         OR char_length(v_item->>'url') > 500
         OR char_length(COALESCE(v_item->>'label', '')) > 120 THEN
        RAISE EXCEPTION 'Deliverables must be web links (http/https), up to 500 characters.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF NEW.kpi_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.kpi_id IS DISTINCT FROM OLD.kpi_id)
     AND NOT EXISTS (SELECT 1 FROM pms_kpis k WHERE k.id = NEW.kpi_id AND k.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'That KPI is not part of this company.' USING ERRCODE = '22023';
  END IF;

  -- ── Planning rules ──
  IF TG_OP = 'UPDATE' AND OLD.started_at IS NOT NULL AND OLD.due_date IS NOT NULL
     AND NEW.due_date IS DISTINCT FROM OLD.due_date AND NOT v_trusted THEN
    RAISE EXCEPTION 'The due date is locked once work starts — set a revised due date instead.' USING ERRCODE = '22023';
  END IF;
  IF NEW.revised_due_date IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.revised_due_date IS DISTINCT FROM OLD.revised_due_date)
     AND NEW.started_at IS NULL AND NOT v_trusted THEN
    RAISE EXCEPTION 'This task has not started — change its due date instead of a revised one.' USING ERRCODE = '22023';
  END IF;

  -- ── Status rules ──
  IF v_status_changed AND NOT v_trusted THEN
    IF NEW.status IN ('In Progress','Blocked','Done') AND NEW.due_date IS NULL THEN
      RAISE EXCEPTION 'Set a due date before starting this task.' USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'Blocked' AND NEW.status_note IS NULL THEN
      RAISE EXCEPTION 'Add a reason when marking a task Blocked.' USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'Done' THEN
      IF COALESCE(NEW.revised_due_date, NEW.due_date) < v_today AND NEW.status_note IS NULL THEN
        RAISE EXCEPTION 'This task is past its due date — add a reason for the delay.' USING ERRCODE = '22023';
      END IF;
      SELECT string_agg(t.title, ', ') INTO v_open FROM (
        SELECT title FROM project_tasks
         WHERE (parent_task_id = NEW.id OR id = ANY (NEW.waiting_on))
           AND status IN ('To Do','In Progress','Blocked') AND id <> NEW.id
         LIMIT 3) t;
      IF v_open IS NOT NULL THEN
        RAISE EXCEPTION 'Finish these first: %', v_open USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- ── Review state ──
  IF v_status_changed AND NOT v_review THEN
    IF NEW.status = 'Done' THEN
      v_approver := task_default_approver(NEW.assigned_to, NEW.created_by, NEW.reviewer_id);
      IF v_approver IS NULL
         OR (v_uid IS NOT NULL AND task_can_review(NEW.tenant_id, NEW.project_id, NEW.assigned_to, NEW.created_by, NEW.reviewer_id)) THEN
        -- No one to wait on, or the approver closed it themselves.
        NEW.review_status := 'Approved';
        NEW.reviewed_by   := CASE WHEN v_approver IS NULL THEN NULL ELSE v_uid END;
        NEW.reviewed_at   := now();
      ELSE
        IF NOT v_trusted AND jsonb_array_length(NEW.deliverables) = 0 AND NEW.status_note IS NULL THEN
          RAISE EXCEPTION 'Add a deliverable link (or a completion note if there is no document) before sending this for review.' USING ERRCODE = '22023';
        END IF;
        NEW.review_status := 'Pending';
        NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
      END IF;
    ELSE
      NEW.review_status := NULL; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Review RPC ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION task_review(p_task uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t project_tasks;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  SELECT * INTO t FROM project_tasks WHERE id = p_task AND tenant_id = my_tenant_id() FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Task not found.' USING ERRCODE = '22023'; END IF;
  IF t.status <> 'Done' OR t.review_status IS DISTINCT FROM 'Pending' THEN
    RAISE EXCEPTION 'This task is not waiting for review.' USING ERRCODE = '22023';
  END IF;
  IF NOT task_can_review(t.tenant_id, t.project_id, t.assigned_to, t.created_by, t.reviewer_id) THEN
    RAISE EXCEPTION 'Only the reviewer, the person who assigned it or a manager can review this task.' USING ERRCODE = '42501';
  END IF;
  IF char_length(COALESCE(v_reason, '')) > 500 THEN
    RAISE EXCEPTION 'Keep the note under 500 characters.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('crewcore.task_review', 'on', true);
  IF p_action = 'approve' THEN
    UPDATE project_tasks SET review_status = 'Approved', reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = t.id;
  ELSIF p_action = 'send_back' THEN
    IF v_reason IS NULL THEN
      PERFORM set_config('crewcore.task_review', 'off', true);
      RAISE EXCEPTION 'Say what still needs doing when sending a task back.' USING ERRCODE = '22023';
    END IF;
    UPDATE project_tasks SET status = 'In Progress', status_note = v_reason,
           review_status = 'Sent back', reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = t.id;
  ELSE
    PERFORM set_config('crewcore.task_review', 'off', true);
    RAISE EXCEPTION 'Unknown review action.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('crewcore.task_review', 'off', true);

  INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, body, to_value)
  VALUES (t.tenant_id, t.id, auth.uid(), 'review', COALESCE(v_reason, ''),
          CASE p_action WHEN 'approve' THEN 'Approved' ELSE 'Sent back' END);
END;
$$;
GRANT EXECUTE ON FUNCTION task_review(uuid, text, text) TO authenticated;

-- ── 5. RLS: the named reviewer also sees the task ─────────────────────────
DROP POLICY IF EXISTS "project_tasks: involved people can select" ON project_tasks;
CREATE POLICY "project_tasks: involved people can select" ON project_tasks FOR SELECT USING (
  tenant_id = (SELECT my_tenant_id())
  AND (
    assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR reviewer_id = auth.uid()
    OR (SELECT my_role()) IN ('admin','superadmin')
    OR assigned_to = ANY ((SELECT my_team_ids())::uuid[])
    OR (project_id IS NOT NULL AND (
          (SELECT my_role()) = 'manager'
          OR EXISTS (SELECT 1 FROM project_members pm
                     WHERE pm.project_id = project_tasks.project_id AND pm.profile_id = auth.uid())))
  )
);

-- ── 6. Log, notify, repeat ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_project_tasks_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_due text;
  v_approver uuid;
  v_next date;
  f record;
BEGIN
  SELECT btrim(concat_ws(' ', first_name, last_name)) INTO v_actor_name FROM profiles WHERE id = v_actor;
  v_actor_name := COALESCE(NULLIF(v_actor_name, ''), 'Someone');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, to_value)
    VALUES (NEW.tenant_id, NEW.id, v_actor, 'created', NEW.status);
    v_due := CASE WHEN NEW.due_date IS NOT NULL THEN ' · due ' || to_char(NEW.due_date, 'DD Mon YYYY') ELSE '' END;
    PERFORM task_notify(NEW, ARRAY[NEW.assigned_to], 'task_assigned',
      CASE WHEN NEW.repeat_of IS NOT NULL THEN 'Recurring task' ELSE 'New task assigned' END,
      CASE WHEN NEW.repeat_of IS NOT NULL THEN format('"%s" is back%s.', NEW.title, v_due)
           ELSE format('%s assigned you "%s" (%s priority)%s.', v_actor_name, NEW.title, NEW.priority, v_due) END);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, body, from_value, to_value)
    VALUES (NEW.tenant_id, NEW.id, v_actor, 'status', COALESCE(NEW.status_note, ''), OLD.status, NEW.status);
    PERFORM task_notify(NEW, ARRAY[NEW.created_by, NEW.assigned_to], 'task_status',
      format('Task %s', CASE NEW.status WHEN 'Done' THEN 'completed' WHEN 'Cancelled' THEN 'cancelled'
                                        WHEN 'Blocked' THEN 'blocked' ELSE 'updated' END),
      format('%s moved "%s" from %s to %s.%s', v_actor_name, NEW.title, OLD.status, NEW.status,
             CASE WHEN NEW.status_note IS NOT NULL THEN ' ' || left(NEW.status_note, 140) ELSE '' END));
    IF NEW.status = 'Done' AND NEW.review_status = 'Pending' THEN
      v_approver := task_default_approver(NEW.assigned_to, NEW.created_by, NEW.reviewer_id);
      IF v_approver IS DISTINCT FROM NEW.created_by THEN
        PERFORM task_notify(NEW, ARRAY[v_approver], 'task_review', 'Task waiting for your review',
          format('%s marked "%s" done — approve it or send it back.', v_actor_name, NEW.title));
      END IF;
    END IF;
    -- Recurring: the next copy is created the first time this one is done.
    IF NEW.status = 'Done' AND NEW.repeat_rule <> 'none'
       AND NOT EXISTS (SELECT 1 FROM project_tasks c WHERE c.repeat_of = NEW.id) THEN
      v_next := COALESCE(NEW.due_date, task_today()) + CASE NEW.repeat_rule
                  WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END;
      PERFORM set_config('crewcore.task_system', 'on', true);
      INSERT INTO project_tasks (tenant_id, project_id, title, description, assigned_to, priority, due_date,
                                 created_by, source, reviewer_id, kpi_id, repeat_rule, repeat_of)
      VALUES (NEW.tenant_id, NEW.project_id, NEW.title, NEW.description, NEW.assigned_to, NEW.priority, v_next,
              NEW.created_by, 'system', NEW.reviewer_id, NEW.kpi_id, NEW.repeat_rule, NEW.id);
      PERFORM set_config('crewcore.task_system', 'off', true);
    END IF;
  END IF;

  -- A decision on a pending review (task_review) → tell the owner.
  IF OLD.review_status = 'Pending' AND NEW.review_status IN ('Approved','Sent back') THEN
    PERFORM task_notify(NEW, ARRAY[NEW.assigned_to], 'task_review',
      CASE NEW.review_status WHEN 'Approved' THEN 'Task approved' ELSE 'Task sent back' END,
      CASE NEW.review_status WHEN 'Approved' THEN format('%s approved "%s".', v_actor_name, NEW.title)
           ELSE format('%s sent "%s" back: %s', v_actor_name, NEW.title, left(COALESCE(NEW.status_note, ''), 160)) END);
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, from_value, to_value)
    VALUES (NEW.tenant_id, NEW.id, v_actor, 'assigned', OLD.assigned_to::text, NEW.assigned_to::text);
    PERFORM task_notify(NEW, ARRAY[NEW.assigned_to], 'task_assigned', 'Task assigned to you',
      format('%s assigned you "%s".', v_actor_name, NEW.title));
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, from_value, to_value)
    VALUES (NEW.tenant_id, NEW.id, v_actor, 'due_date', OLD.due_date::text, NEW.due_date::text);
    IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
      PERFORM task_notify(NEW, ARRAY[NEW.assigned_to], 'task_due_changed', 'Task due date changed',
        format('"%s" is now due %s.', NEW.title, COALESCE(to_char(NEW.due_date, 'DD Mon YYYY'), '— no due date')));
    END IF;
  END IF;

  IF NEW.revised_due_date IS DISTINCT FROM OLD.revised_due_date AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    PERFORM task_notify(NEW, ARRAY[NEW.assigned_to], 'task_due_changed', 'Task due date revised',
      format('"%s" is now due %s (originally %s).', NEW.title,
             COALESCE(to_char(NEW.revised_due_date, 'DD Mon YYYY'), to_char(NEW.due_date, 'DD Mon YYYY')),
             COALESCE(to_char(NEW.due_date, 'DD Mon YYYY'), '—')));
  END IF;

  -- Field-level change log: before → after, who and when.
  FOR f IN
    SELECT * FROM (VALUES
      ('title',            OLD.title,                       NEW.title),
      ('description',      left(OLD.description, 300),      left(NEW.description, 300)),
      ('priority',         OLD.priority,                    NEW.priority),
      ('reviewer',         OLD.reviewer_id::text,           NEW.reviewer_id::text),
      ('start_date',       OLD.start_date::text,            NEW.start_date::text),
      ('revised_due_date', OLD.revised_due_date::text,      NEW.revised_due_date::text),
      ('project',          OLD.project_id::text,            NEW.project_id::text),
      ('parent_task',      OLD.parent_task_id::text,        NEW.parent_task_id::text),
      ('waiting_on',       cardinality(OLD.waiting_on)::text, cardinality(NEW.waiting_on)::text),
      ('repeat',           OLD.repeat_rule,                 NEW.repeat_rule),
      ('kpi',              OLD.kpi_id::text,                NEW.kpi_id::text),
      ('deliverables',     jsonb_array_length(OLD.deliverables)::text, jsonb_array_length(NEW.deliverables)::text)
    ) AS x(field, before, after)
    WHERE before IS DISTINCT FROM after
      -- the automatic start date stamped on the first move out of To Do is not an edit
      AND NOT (field = 'start_date' AND OLD.start_date IS NULL AND NEW.status IS DISTINCT FROM OLD.status)
  LOOP
    INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, body, from_value, to_value)
    VALUES (NEW.tenant_id, NEW.id, v_actor, 'field', f.field, f.before, f.after);
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── 7. Reminders use the revised due date when there is one ───────────────
CREATE OR REPLACE FUNCTION task_send_due_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record;
  v_count int := 0;
BEGIN
  DROP TABLE IF EXISTS _due;
  CREATE TEMP TABLE _due ON COMMIT DROP AS
  SELECT t.id, t.tenant_id, t.title, COALESCE(t.revised_due_date, t.due_date) AS due_date, t.priority, t.assigned_to, t.created_by,
         CASE WHEN COALESCE(t.revised_due_date, t.due_date) < v_today THEN 'overdue'
              WHEN COALESCE(t.revised_due_date, t.due_date) = v_today THEN 'today' ELSE 'tomorrow' END AS bucket
  FROM project_tasks t
  JOIN profiles a ON a.id = t.assigned_to AND a.status = 'Active'
  WHERE t.status IN ('To Do','In Progress','Blocked')
    AND COALESCE(t.revised_due_date, t.due_date) IS NOT NULL
    AND COALESCE(t.revised_due_date, t.due_date) <= v_today + 1
    AND (t.last_reminded_on IS NULL OR t.last_reminded_on < v_today)
    AND NOT EXISTS (SELECT 1 FROM tenant_notification_channels c
                    WHERE c.tenant_id = t.tenant_id AND NOT c.daily_reminders);

  -- One digest per assignee.
  FOR r IN
    SELECT tenant_id, assigned_to,
           count(*) AS n,
           count(*) FILTER (WHERE bucket = 'overdue') AS n_over,
           count(*) FILTER (WHERE bucket = 'today') AS n_today,
           string_agg(format('• %s (%s)', title,
             CASE bucket WHEN 'overdue' THEN 'overdue since ' || to_char(due_date, 'DD Mon')
                         WHEN 'today' THEN 'due today' ELSE 'due tomorrow' END),
             E'\n' ORDER BY due_date, title) AS lines,
           jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date, 'bucket', bucket, 'priority', priority)
                     ORDER BY due_date) AS items
    FROM _due GROUP BY tenant_id, assigned_to
  LOOP
    INSERT INTO app_notifications (tenant_id, profile_id, type, title, body, link_key)
    VALUES (r.tenant_id, r.assigned_to, 'task_reminder',
      CASE WHEN r.n_over > 0 THEN format('%s task%s overdue', r.n_over, CASE WHEN r.n_over = 1 THEN '' ELSE 's' END)
           ELSE format('%s task%s due soon', r.n, CASE WHEN r.n = 1 THEN '' ELSE 's' END) END,
      left(r.lines, 600), 'tasks');
    PERFORM notification_enqueue(r.tenant_id, 'reminder_digest', NULL, ARRAY[r.assigned_to],
      jsonb_build_object('kind', 'assignee', 'items', r.items));
    v_count := v_count + 1;
  END LOOP;

  -- Assigners: overdue tasks they gave to someone else.
  FOR r IN
    SELECT d.tenant_id, d.created_by, count(*) AS n,
           string_agg(format('• %s — %s', d.title, btrim(concat_ws(' ', a.first_name, a.last_name))), E'\n' ORDER BY d.due_date) AS lines
    FROM _due d JOIN profiles a ON a.id = d.assigned_to
    JOIN profiles c ON c.id = d.created_by AND c.status = 'Active'
    WHERE d.bucket = 'overdue' AND d.created_by IS DISTINCT FROM d.assigned_to
    GROUP BY d.tenant_id, d.created_by
  LOOP
    INSERT INTO app_notifications (tenant_id, profile_id, type, title, body, link_key)
    VALUES (r.tenant_id, r.created_by, 'task_reminder_assigner',
      format('%s task%s you assigned %s overdue', r.n, CASE WHEN r.n = 1 THEN '' ELSE 's' END, CASE WHEN r.n = 1 THEN 'is' ELSE 'are' END),
      left(r.lines, 600), 'tasks');
  END LOOP;

  UPDATE project_tasks t SET last_reminded_on = v_today FROM _due d WHERE d.id = t.id;
  RETURN v_count;
END;
$$;

-- ── 8. KPI picker: PMS KPIs a task can be linked to ───────────────────────
-- Company / department / team KPIs of the current FY, plus personal KPIs of
-- the caller and their reporting tree (everyone's for HR). Read-only.
CREATE OR REPLACE FUNCTION task_linkable_kpis()
RETURNS TABLE (id uuid, title text, owner_type text, owner_label text, unit text, fy int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT p.id, p.tenant_id, p.role, my_team_ids() AS team FROM profiles p WHERE p.id = auth.uid())
  SELECT k.id, k.title, k.owner_type,
         CASE WHEN k.owner_type = 'Employee' THEN pms_person_name(k.employee_id) ELSE k.owner_id END,
         k.unit, k.fy
  FROM pms_kpis k, me
  WHERE k.tenant_id = me.tenant_id
    AND k.fy >= pms_current_fy() - 1
    AND (k.owner_type <> 'Employee' OR k.employee_id = me.id OR me.role IN ('admin','superadmin') OR k.employee_id = ANY (me.team))
  ORDER BY k.fy DESC, k.owner_type, k.title
  LIMIT 500;
$$;
GRANT EXECUTE ON FUNCTION task_linkable_kpis() TO authenticated;

REVOKE EXECUTE ON FUNCTION trg_project_tasks_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_project_tasks_after() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION task_send_due_reminders() FROM PUBLIC, anon, authenticated;
