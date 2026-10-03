-- =============================================================
-- Supabase advisor fixes for today's tables + PMS QA (item 3):
--   * auth_rls_initplan: wrap auth.uid() in (SELECT ...) so it is evaluated
--     once per query, not once per row (project_tasks, task_activity,
--     meeting_notes, ai_usage_daily). Logic unchanged.
--   * anon could EXECUTE security-definer helpers that only make sense for a
--     signed-in user (they returned nothing for anon, but lock them anyway).
--   * Covering indexes for new foreign keys / hot PMS lookups.
-- Re-runnable.
-- =============================================================

-- ── project_tasks ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "project_tasks: involved people can select" ON project_tasks;
CREATE POLICY "project_tasks: involved people can select" ON project_tasks FOR SELECT USING (
  tenant_id = (SELECT my_tenant_id())
  AND (
    assigned_to = (SELECT auth.uid())
    OR created_by = (SELECT auth.uid())
    OR (SELECT my_role()) IN ('admin','superadmin')
    OR assigned_to = ANY ((SELECT my_team_ids())::uuid[])
    OR (project_id IS NOT NULL AND (
          (SELECT my_role()) = 'manager'
          OR EXISTS (SELECT 1 FROM project_members pm
                     WHERE pm.project_id = project_tasks.project_id AND pm.profile_id = (SELECT auth.uid()))))
  )
);
DROP POLICY IF EXISTS "project_tasks: assignee or task manager can update" ON project_tasks;
CREATE POLICY "project_tasks: assignee or task manager can update" ON project_tasks FOR UPDATE
  USING (tenant_id = (SELECT my_tenant_id())
         AND (assigned_to = (SELECT auth.uid()) OR task_can_manage(tenant_id, project_id, assigned_to, created_by)))
  WITH CHECK (tenant_id = (SELECT my_tenant_id()));

-- ── task_activity ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_activity: comment on visible task" ON task_activity;
CREATE POLICY "task_activity: comment on visible task" ON task_activity FOR INSERT WITH CHECK (
  tenant_id = (SELECT my_tenant_id())
  AND kind = 'comment'
  AND actor_id = (SELECT auth.uid())
  AND char_length(btrim(body)) > 0
  AND EXISTS (SELECT 1 FROM project_tasks t WHERE t.id = task_activity.task_id AND t.tenant_id = task_activity.tenant_id)
);

-- ── ai_usage_daily ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ai_usage_daily: own or admin select" ON ai_usage_daily;
CREATE POLICY "ai_usage_daily: own or admin select" ON ai_usage_daily FOR SELECT USING (
  profile_id = (SELECT auth.uid())
  OR (tenant_id = (SELECT my_tenant_id()) AND (SELECT my_role()) IN ('admin','superadmin'))
);

-- ── meeting_notes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "meeting_notes: involved select" ON meeting_notes;
CREATE POLICY "meeting_notes: involved select" ON meeting_notes FOR SELECT USING (
  tenant_id = (SELECT my_tenant_id())
  AND (created_by = (SELECT auth.uid())
       OR (SELECT my_role()) IN ('admin','superadmin')
       OR action_items @> jsonb_build_array(jsonb_build_object('assignee_id', (SELECT auth.uid())::text)))
);
DROP POLICY IF EXISTS "meeting_notes: member insert own" ON meeting_notes;
CREATE POLICY "meeting_notes: member insert own" ON meeting_notes FOR INSERT
  WITH CHECK (tenant_id = (SELECT my_tenant_id()) AND created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "meeting_notes: owner or admin update" ON meeting_notes;
CREATE POLICY "meeting_notes: owner or admin update" ON meeting_notes FOR UPDATE
  USING (tenant_id = (SELECT my_tenant_id()) AND (created_by = (SELECT auth.uid()) OR (SELECT my_role()) IN ('admin','superadmin')))
  WITH CHECK (tenant_id = (SELECT my_tenant_id()));
DROP POLICY IF EXISTS "meeting_notes: owner or admin delete" ON meeting_notes;
CREATE POLICY "meeting_notes: owner or admin delete" ON meeting_notes FOR DELETE
  USING (tenant_id = (SELECT my_tenant_id()) AND (created_by = (SELECT auth.uid()) OR (SELECT my_role()) IN ('admin','superadmin')));

-- ── Signed-in-only helpers ────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION task_assignable_people()               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION task_can_assign(uuid, uuid, uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION task_can_manage(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION pms_can_approve(uuid, uuid)             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION task_assignable_people()               TO authenticated;
GRANT  EXECUTE ON FUNCTION task_can_assign(uuid, uuid, uuid)       TO authenticated;
GRANT  EXECUTE ON FUNCTION task_can_manage(uuid, uuid, uuid, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION pms_can_approve(uuid, uuid)             TO authenticated;

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meeting_notes_created_by     ON meeting_notes(created_by);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_task     ON notification_outbox(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pms_goals_owner              ON pms_goals(owner_id);
CREATE INDEX IF NOT EXISTS idx_pms_cycle_reviews_employee   ON pms_cycle_reviews(employee_id);
