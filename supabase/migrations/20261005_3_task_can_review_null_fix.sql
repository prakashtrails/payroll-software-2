-- =============================================================
-- Security fix for 20261005_2_task_register_rules.sql (already live).
-- task_can_review() returned NULL (not false) for a task with no named
-- reviewer when the caller could not manage it — `auth.uid() = NULL` is NULL
-- and NULL OR false is NULL — so task_review()'s `IF NOT task_can_review(...)`
-- let any employee of the company approve or send back the task.
-- Found by supabase/tests/task_register_rules_rollback_test.sql
-- ("outsider cannot review"). Re-runnable.
-- =============================================================
CREATE OR REPLACE FUNCTION task_can_review(p_tenant uuid, p_project uuid, p_assignee uuid, p_creator uuid, p_reviewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_assignee
     AND (auth.uid() = p_reviewer OR task_can_manage(p_tenant, p_project, p_assignee, p_creator)), false);
$$;
GRANT EXECUTE ON FUNCTION task_can_review(uuid, uuid, uuid, uuid, uuid) TO authenticated;
