-- =============================================================
-- Task reminders + external notification channels (pending-list item 12).
--
--   * Daily 09:00 IST reminder: one in-app digest per assignee with open tasks
--     due today / tomorrow / overdue (in-app rows also become mobile pushes via
--     the existing app_notifications -> push-app-notification webhook), plus a
--     digest to whoever assigned overdue tasks to someone else.
--   * Per-company channels (tenant_notification_channels): Slack incoming
--     webhook, email (existing SMTP), WhatsApp (MSG91 templates). Only
--     companies that switch a channel on generate outbox rows — zero extra load
--     for everyone else.
--   * Task events (assigned, status change) + reminder digests for enabled
--     companies go to notification_outbox; an AFTER INSERT statement trigger
--     pokes the notification-dispatch edge function once per statement
--     (pg_net, no polling). The daily cron also re-pokes it to retry failures.
--   * Idempotent by design: project_tasks.last_reminded_on stops double daily
--     reminders, and outbox rows are claimed with SKIP LOCKED, so extra calls
--     to the dispatcher (it is reachable with the public anon key) do nothing.
-- Re-runnable.
-- =============================================================

-- ── 1. Per-company channel settings ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_notification_channels (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  slack_enabled         boolean NOT NULL DEFAULT false,
  slack_webhook_url     text CHECK (slack_webhook_url IS NULL OR slack_webhook_url ~ '^https://hooks\.slack\.com/'),
  email_enabled         boolean NOT NULL DEFAULT false,
  whatsapp_enabled      boolean NOT NULL DEFAULT false,
  notify_status_changes boolean NOT NULL DEFAULT true,
  daily_reminders       boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE tenant_notification_channels ENABLE ROW LEVEL SECURITY;
-- The Slack webhook URL is a credential: HR/admin only, never employees.
DROP POLICY IF EXISTS "tenant_notification_channels: admin select" ON tenant_notification_channels;
CREATE POLICY "tenant_notification_channels: admin select" ON tenant_notification_channels FOR SELECT
  USING (tenant_id = (SELECT my_tenant_id()) AND (SELECT my_role()) IN ('admin','superadmin'));
DROP POLICY IF EXISTS "tenant_notification_channels: admin insert" ON tenant_notification_channels;
CREATE POLICY "tenant_notification_channels: admin insert" ON tenant_notification_channels FOR INSERT
  WITH CHECK (tenant_id = (SELECT my_tenant_id()) AND (SELECT my_role()) IN ('admin','superadmin'));
DROP POLICY IF EXISTS "tenant_notification_channels: admin update" ON tenant_notification_channels;
CREATE POLICY "tenant_notification_channels: admin update" ON tenant_notification_channels FOR UPDATE
  USING (tenant_id = (SELECT my_tenant_id()) AND (SELECT my_role()) IN ('admin','superadmin'))
  WITH CHECK (tenant_id = (SELECT my_tenant_id()));

CREATE OR REPLACE FUNCTION trg_tenant_notification_channels_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  -- Slack can't be on without a webhook.
  IF NEW.slack_webhook_url IS NULL OR btrim(NEW.slack_webhook_url) = '' THEN
    NEW.slack_webhook_url := NULL;
    NEW.slack_enabled := false;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tenant_notification_channels_stamp ON tenant_notification_channels;
CREATE TRIGGER tenant_notification_channels_stamp BEFORE INSERT OR UPDATE ON tenant_notification_channels
  FOR EACH ROW EXECUTE FUNCTION trg_tenant_notification_channels_stamp();

-- ── 2. Reminder bookkeeping ───────────────────────────────────────────────
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS last_reminded_on date;

-- ── 3. Outbox for external channels ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event        text NOT NULL CHECK (event IN ('task_assigned','task_status','reminder_digest')),
  task_id      uuid REFERENCES project_tasks(id) ON DELETE CASCADE,
  recipients   uuid[] NOT NULL DEFAULT '{}',
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at   timestamptz,
  processed_at timestamptz,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON notification_outbox(created_at) WHERE processed_at IS NULL;
-- Service role only (no policies): nobody reads or writes this from a client.
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;

-- Enqueue for external channels — a no-op unless the company enabled one.
CREATE OR REPLACE FUNCTION notification_enqueue(p_tenant uuid, p_event text, p_task uuid, p_recipients uuid[], p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c tenant_notification_channels;
BEGIN
  SELECT * INTO c FROM tenant_notification_channels WHERE tenant_id = p_tenant;
  IF NOT FOUND OR NOT (c.slack_enabled OR c.email_enabled OR c.whatsapp_enabled) THEN
    RETURN;
  END IF;
  IF p_event IN ('task_assigned','task_status') AND NOT c.notify_status_changes THEN
    RETURN;
  END IF;
  INSERT INTO notification_outbox (tenant_id, event, task_id, recipients, payload)
  VALUES (p_tenant, p_event, p_task, COALESCE(p_recipients, '{}'), COALESCE(p_payload, '{}'::jsonb));
END;
$$;

-- Task events -> outbox (separate trigger, leaves trg_project_tasks_after alone).
CREATE OR REPLACE FUNCTION trg_project_tasks_external()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_notification_channels c WHERE c.tenant_id = NEW.tenant_id
                 AND (c.slack_enabled OR c.email_enabled OR c.whatsapp_enabled) AND c.notify_status_changes) THEN
    RETURN NEW;
  END IF;

  SELECT btrim(concat_ws(' ', first_name, last_name)) INTO v_actor_name FROM profiles WHERE id = v_actor;
  v_payload := jsonb_build_object(
    'title', NEW.title, 'priority', NEW.priority, 'due_date', NEW.due_date,
    'status', NEW.status, 'actor_name', COALESCE(NULLIF(v_actor_name, ''), 'Someone'),
    'assignee_name', (SELECT btrim(concat_ws(' ', first_name, last_name)) FROM profiles WHERE id = NEW.assigned_to),
    'project_name', (SELECT name FROM projects WHERE id = NEW.project_id));

  IF TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM v_actor THEN
      PERFORM notification_enqueue(NEW.tenant_id, 'task_assigned', NEW.id, ARRAY[NEW.assigned_to], v_payload);
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM notification_enqueue(NEW.tenant_id, 'task_status', NEW.id,
      ARRAY(SELECT DISTINCT r FROM unnest(ARRAY[NEW.created_by, NEW.assigned_to]) r
            WHERE r IS NOT NULL AND r IS DISTINCT FROM v_actor),
      v_payload || jsonb_build_object('from_status', OLD.status));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_tasks_external ON project_tasks;
CREATE TRIGGER project_tasks_external AFTER INSERT OR UPDATE ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_project_tasks_external();

-- Poke the dispatcher once per INSERT statement (not per row).
CREATE OR REPLACE FUNCTION notification_dispatch_kick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://yxueywgrqrfgynqknsqs.supabase.co/functions/v1/notification-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Public anon key: only satisfies the Functions gateway (same as the ESSL crons).
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dWV5d2dycXJmZ3lucWtuc3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzMyMTEsImV4cCI6MjA5MjQ0OTIxMX0.HPddy4u4Qy4E1RHZXt3yUcrv8yO-ha5z1tYhNrH42J4'
    ),
    body := '{"mode":"process"}'::jsonb,
    timeout_milliseconds := 30000
  );
END;
$$;

CREATE OR REPLACE FUNCTION trg_notification_outbox_kick()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notification_dispatch_kick();
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS notification_outbox_kick ON notification_outbox;
CREATE TRIGGER notification_outbox_kick AFTER INSERT ON notification_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION trg_notification_outbox_kick();

-- Dispatcher helpers (service role only).
CREATE OR REPLACE FUNCTION notification_outbox_claim(p_limit int DEFAULT 50)
RETURNS SETOF notification_outbox LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE notification_outbox o SET claimed_at = now(), attempts = o.attempts + 1
  WHERE o.id IN (
    SELECT id FROM notification_outbox
    WHERE processed_at IS NULL AND attempts < 5
      AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
    ORDER BY created_at
    LIMIT LEAST(GREATEST(p_limit, 1), 200)
    FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
$$;

CREATE OR REPLACE FUNCTION notification_outbox_complete(p_id uuid, p_error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE notification_outbox
  SET processed_at = CASE WHEN p_error IS NULL OR attempts >= 5 THEN now() END,
      claimed_at = CASE WHEN p_error IS NULL THEN claimed_at END,
      last_error = p_error
  WHERE id = p_id;
$$;

-- ── 4. Daily due/overdue reminders ────────────────────────────────────────
CREATE OR REPLACE FUNCTION task_send_due_reminders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record;
  v_count int := 0;
BEGIN
  DROP TABLE IF EXISTS _due;
  CREATE TEMP TABLE _due ON COMMIT DROP AS
  SELECT t.id, t.tenant_id, t.title, t.due_date, t.priority, t.assigned_to, t.created_by,
         CASE WHEN t.due_date < v_today THEN 'overdue'
              WHEN t.due_date = v_today THEN 'today' ELSE 'tomorrow' END AS bucket
  FROM project_tasks t
  JOIN profiles a ON a.id = t.assigned_to AND a.status = 'Active'
  WHERE t.status IN ('To Do','In Progress','Blocked')
    AND t.due_date IS NOT NULL AND t.due_date <= v_today + 1
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

REVOKE EXECUTE ON FUNCTION notification_enqueue(uuid, text, uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION notification_dispatch_kick()                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION notification_outbox_claim(int)                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION notification_outbox_complete(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION task_send_due_reminders()                             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION notification_outbox_claim(int)           TO service_role;
GRANT  EXECUTE ON FUNCTION notification_outbox_complete(uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION trg_project_tasks_external()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_notification_outbox_kick()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_tenant_notification_channels_stamp() FROM PUBLIC, anon, authenticated;

-- ── 5. Schedule: 09:00 IST = 03:30 UTC. Reminders, then retry any pending outbox rows.
SELECT cron.unschedule('task-due-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task-due-reminders');
SELECT cron.schedule('task-due-reminders', '30 3 * * *', $$
  SELECT task_send_due_reminders();
  SELECT notification_dispatch_kick()
  WHERE EXISTS (SELECT 1 FROM notification_outbox WHERE processed_at IS NULL AND attempts < 5);
$$);

-- Outbox retention: processed rows older than 30 days.
SELECT cron.unschedule('notification-outbox-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-outbox-cleanup');
SELECT cron.schedule('notification-outbox-cleanup', '45 3 * * 0', $$
  DELETE FROM notification_outbox WHERE processed_at < now() - interval '30 days';
$$);
