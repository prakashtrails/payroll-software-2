-- =============================================================
-- Task Management: turns project_tasks into the single task table for the
-- whole company — standalone tasks (project_id NULL) as well as project
-- tasks — with priority, an activity/comment log, and DB-side assignment
-- rules + notifications so the CrewCore app and the website behave the same.
--
-- Re-runnable: every constraint/policy is dropped-if-exists first.
-- Additive: no column is dropped and the three existing statuses stay valid.
-- The app's listMyTasks/updateTaskStatus keep working unchanged (it already
-- renders `t.project?.name || 'No project'`).
--
-- Rules (agreed 2026-10-03):
--   Assign  — admin/superadmin: anyone in the tenant.
--             anyone else: themselves + their reporting tree (my_team_ids()).
--             Project tasks: admin/manager/superadmin, assignee must be a
--             project member (unchanged from the Projects module).
--   View    — assignee, creator, the assignee's managers up the chain,
--             admin/superadmin; project tasks also project members + managers.
--   Edit    — "task managers" (creator, admin, the assignee's managers, and
--             managers on project tasks) edit everything; the assignee may
--             only change status (and not to Cancelled).
--
-- App contract: write source = 'app' when creating tasks from the app
-- (default 'web'). Notifications use link_key = 'tasks'.
-- =============================================================

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE project_tasks ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS priority     text        NOT NULL DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source       text        NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_status_check;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_status_check
  CHECK (status IN ('To Do','In Progress','Blocked','Done','Cancelled'));
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_priority_check;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_priority_check
  CHECK (priority IN ('Low','Medium','High','Urgent'));
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_source_check;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_source_check
  CHECK (source IN ('web','app','ai','system'));
ALTER TABLE project_tasks DROP CONSTRAINT IF EXISTS project_tasks_title_len;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_title_len
  CHECK (char_length(title) BETWEEN 1 AND 200);

-- Existing project tasks: creator = the project's creator; Done ones get a completion stamp.
UPDATE project_tasks t SET created_by = p.created_by FROM projects p
 WHERE p.id = t.project_id AND t.created_by IS NULL;
UPDATE project_tasks SET completed_at = created_at WHERE status = 'Done' AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_tasks_created_by    ON project_tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_project_tasks_tenant_status ON project_tasks(tenant_id, status, due_date);

-- ── 2. Permission helpers ─────────────────────────────────────────────────
-- May the caller give a task (in this tenant/project) to p_assignee?
CREATE OR REPLACE FUNCTION task_can_assign(p_tenant uuid, p_project uuid, p_assignee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles me
    WHERE me.id = auth.uid() AND me.tenant_id = p_tenant
      AND CASE
        WHEN p_project IS NOT NULL THEN
          me.role IN ('admin','superadmin','manager')
          AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = p_project AND pr.tenant_id = p_tenant)
          AND (p_assignee IS NULL OR EXISTS (
                SELECT 1 FROM project_members pm WHERE pm.project_id = p_project AND pm.profile_id = p_assignee))
        ELSE
          p_assignee IS NOT NULL
          AND EXISTS (SELECT 1 FROM profiles a WHERE a.id = p_assignee AND a.tenant_id = p_tenant AND a.status = 'Active')
          AND (p_assignee = me.id OR me.role IN ('admin','superadmin') OR p_assignee = ANY (my_team_ids()))
      END
  );
$$;

-- May the caller edit/delete this task (beyond the assignee's status-only rights)?
CREATE OR REPLACE FUNCTION task_can_manage(p_tenant uuid, p_project uuid, p_assignee uuid, p_creator uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles me
    WHERE me.id = auth.uid() AND me.tenant_id = p_tenant
      AND (me.role IN ('admin','superadmin')
           OR p_creator = me.id
           OR (p_project IS NOT NULL AND me.role = 'manager')
           OR (p_assignee IS NOT NULL AND p_assignee <> me.id AND p_assignee = ANY (my_team_ids())))
  );
$$;

-- People the caller may assign a standalone task to (self + team, or everyone
-- for admin) — one call for the assignee picker on web and app. is_team marks
-- people in the caller's reporting tree (drives the "Team" tab).
CREATE OR REPLACE FUNCTION task_assignable_people()
RETURNS TABLE (id uuid, first_name text, middle_name text, last_name text, department text, employee_id text, is_team boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT p.id, p.tenant_id, p.role, my_team_ids() AS team FROM profiles p WHERE p.id = auth.uid())
  SELECT p.id, p.first_name, p.middle_name, p.last_name, p.department, p.employee_id, p.id = ANY (me.team)
  FROM profiles p, me
  WHERE p.tenant_id = me.tenant_id AND p.status = 'Active'
    AND (p.id = me.id OR me.role IN ('admin','superadmin') OR p.id = ANY (me.team))
  ORDER BY p.first_name, p.last_name;
$$;

GRANT EXECUTE ON FUNCTION task_can_assign(uuid, uuid, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION task_can_manage(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION task_assignable_people()                TO authenticated;

-- ── 3. Guard trigger (defaults + rules, raises readable errors) ───────────
CREATE OR REPLACE FUNCTION trg_project_tasks_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN NEW.created_by := v_uid; END IF;
    -- A standalone task with no assignee is a personal task.
    IF NEW.project_id IS NULL AND NEW.assigned_to IS NULL THEN
      NEW.assigned_to := NEW.created_by;
    END IF;
  ELSE
    NEW.tenant_id  := OLD.tenant_id;
    NEW.created_by := OLD.created_by;
    NEW.source     := OLD.source;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.title := btrim(NEW.title);
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.completed_at := CASE WHEN NEW.status = 'Done' THEN now() END;
  ELSE
    NEW.completed_at := OLD.completed_at;
  END IF;

  -- Service role / cron / future AI jobs (no JWT) are trusted.
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND NOT task_can_manage(OLD.tenant_id, OLD.project_id, OLD.assigned_to, OLD.created_by) THEN
    -- Only the assignee reaches here (RLS USING already filtered everyone else).
    IF (NEW.title, NEW.description, NEW.assigned_to, NEW.due_date, NEW.priority, NEW.project_id)
       IS DISTINCT FROM (OLD.title, OLD.description, OLD.assigned_to, OLD.due_date, OLD.priority, OLD.project_id) THEN
      RAISE EXCEPTION 'You can only change the status of a task assigned to you.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' THEN
      RAISE EXCEPTION 'Only the person who assigned this task (or a manager) can cancel it.' USING ERRCODE = '42501';
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_tasks_guard ON project_tasks;
CREATE TRIGGER project_tasks_guard BEFORE INSERT OR UPDATE ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_project_tasks_guard();

-- ── 4. RLS on project_tasks ───────────────────────────────────────────────
DROP POLICY IF EXISTS "project_tasks: tenant members can select"       ON project_tasks;
DROP POLICY IF EXISTS "project_tasks: admin/manager can insert"        ON project_tasks;
DROP POLICY IF EXISTS "project_tasks: own or admin/manager can update" ON project_tasks;
DROP POLICY IF EXISTS "project_tasks: admin/manager can delete"        ON project_tasks;

DROP POLICY IF EXISTS "project_tasks: involved people can select" ON project_tasks;
CREATE POLICY "project_tasks: involved people can select" ON project_tasks FOR SELECT USING (
  tenant_id = (SELECT my_tenant_id())
  AND (
    assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR (SELECT my_role()) IN ('admin','superadmin')
    OR assigned_to = ANY ((SELECT my_team_ids())::uuid[])
    OR (project_id IS NOT NULL AND (
          (SELECT my_role()) = 'manager'
          OR EXISTS (SELECT 1 FROM project_members pm
                     WHERE pm.project_id = project_tasks.project_id AND pm.profile_id = auth.uid())))
  )
);
-- Who may assign to whom is checked by trg_project_tasks_guard (clear error messages).
DROP POLICY IF EXISTS "project_tasks: tenant members can insert" ON project_tasks;
CREATE POLICY "project_tasks: tenant members can insert" ON project_tasks FOR INSERT
  WITH CHECK (tenant_id = (SELECT my_tenant_id()));
DROP POLICY IF EXISTS "project_tasks: assignee or task manager can update" ON project_tasks;
CREATE POLICY "project_tasks: assignee or task manager can update" ON project_tasks FOR UPDATE
  USING (tenant_id = (SELECT my_tenant_id())
         AND (assigned_to = auth.uid() OR task_can_manage(tenant_id, project_id, assigned_to, created_by)))
  WITH CHECK (tenant_id = (SELECT my_tenant_id()));
DROP POLICY IF EXISTS "project_tasks: task manager can delete" ON project_tasks;
CREATE POLICY "project_tasks: task manager can delete" ON project_tasks FOR DELETE
  USING (tenant_id = (SELECT my_tenant_id()) AND task_can_manage(tenant_id, project_id, assigned_to, created_by));

-- ── 5. Activity log + comments ────────────────────────────────────────────
-- One small row per comment / status / reassignment / due-date change.
-- Field edits (title, description, priority) are not logged to keep it lean.
CREATE TABLE IF NOT EXISTS task_activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind       text NOT NULL CHECK (kind IN ('created','comment','status','assigned','due_date')),
  body       text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  from_value text,
  to_value   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id, created_at);

ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;

-- The EXISTS runs under project_tasks' own RLS, so activity is visible exactly
-- when its task is.
DROP POLICY IF EXISTS "task_activity: visible with its task" ON task_activity;
CREATE POLICY "task_activity: visible with its task" ON task_activity FOR SELECT USING (
  tenant_id = (SELECT my_tenant_id())
  AND EXISTS (SELECT 1 FROM project_tasks t WHERE t.id = task_activity.task_id)
);
DROP POLICY IF EXISTS "task_activity: comment on visible task" ON task_activity;
CREATE POLICY "task_activity: comment on visible task" ON task_activity FOR INSERT WITH CHECK (
  tenant_id = (SELECT my_tenant_id())
  AND kind = 'comment'
  AND actor_id = auth.uid()
  AND char_length(btrim(body)) > 0
  AND EXISTS (SELECT 1 FROM project_tasks t WHERE t.id = task_activity.task_id AND t.tenant_id = task_activity.tenant_id)
);

-- ── 6. Log + notify (DB-side so app and web both get it) ──────────────────
CREATE OR REPLACE FUNCTION task_notify(p_task project_tasks, p_recipients uuid[], p_type text, p_title text, p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO app_notifications (tenant_id, profile_id, actor_id, type, title, body, link_key, related_id)
  SELECT p_task.tenant_id, r, auth.uid(), p_type, p_title, p_body, 'tasks', p_task.id
  FROM (SELECT DISTINCT unnest(p_recipients) AS r) x
  WHERE r IS NOT NULL AND r IS DISTINCT FROM auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION task_notify(project_tasks, uuid[], text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trg_project_tasks_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_due text;
BEGIN
  SELECT btrim(concat_ws(' ', first_name, last_name)) INTO v_actor_name FROM profiles WHERE id = v_actor;
  v_actor_name := COALESCE(NULLIF(v_actor_name, ''), 'Someone');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, to_value)
    VALUES (NEW.tenant_id, NEW.id, v_actor, 'created', NEW.status);
    v_due := CASE WHEN NEW.due_date IS NOT NULL THEN ' · due ' || to_char(NEW.due_date, 'DD Mon YYYY') ELSE '' END;
    PERFORM task_notify(NEW, ARRAY[NEW.assigned_to], 'task_assigned', 'New task assigned',
      format('%s assigned you "%s" (%s priority)%s.', v_actor_name, NEW.title, NEW.priority, v_due));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, from_value, to_value)
    VALUES (NEW.tenant_id, NEW.id, v_actor, 'status', OLD.status, NEW.status);
    PERFORM task_notify(NEW, ARRAY[NEW.created_by, NEW.assigned_to], 'task_status',
      format('Task %s', CASE NEW.status WHEN 'Done' THEN 'completed' WHEN 'Cancelled' THEN 'cancelled'
                                        WHEN 'Blocked' THEN 'blocked' ELSE 'updated' END),
      format('%s moved "%s" from %s to %s.', v_actor_name, NEW.title, OLD.status, NEW.status));
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_tasks_after ON project_tasks;
CREATE TRIGGER project_tasks_after AFTER INSERT OR UPDATE ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_project_tasks_after();

CREATE OR REPLACE FUNCTION trg_task_comment_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task project_tasks;
  v_actor_name text;
BEGIN
  IF NEW.kind <> 'comment' THEN RETURN NEW; END IF;
  SELECT * INTO v_task FROM project_tasks WHERE id = NEW.task_id;
  SELECT btrim(concat_ws(' ', first_name, last_name)) INTO v_actor_name FROM profiles WHERE id = NEW.actor_id;
  PERFORM task_notify(v_task, ARRAY[v_task.created_by, v_task.assigned_to], 'task_comment',
    format('New comment on "%s"', v_task.title),
    format('%s: %s', COALESCE(NULLIF(v_actor_name, ''), 'Someone'), left(NEW.body, 140)));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_activity_comment_notify ON task_activity;
CREATE TRIGGER task_activity_comment_notify AFTER INSERT ON task_activity
  FOR EACH ROW EXECUTE FUNCTION trg_task_comment_notify();

REVOKE EXECUTE ON FUNCTION trg_project_tasks_guard()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_project_tasks_after()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_task_comment_notify()  FROM PUBLIC, anon, authenticated;
