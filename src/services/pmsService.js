import { supabase } from '@/lib/supabase';

// Performance Management (PMS). Every call is a SECURITY DEFINER RPC that
// checks tenant, role, reporting line and workflow state on the server
// (supabase/migrations/20260928_2_pms_rpc.sql). Reads return the whole
// workspace in one request and every mutation returns the refreshed
// workspace, so the UI never needs a follow-up fetch.
async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  return { data, error };
}

export const getWorkspace = (fy = null) => call('pms_workspace', { p_fy: fy });

export const saveSettings = (fy, { kpiWeight, cap, deadline, reminders }, expectedVersion) =>
  call('pms_save_settings', {
    p_fy: fy, p_kpi_weight: kpiWeight, p_cap: cap, p_deadline: deadline || null,
    p_reminders: reminders, p_expected_version: expectedVersion ?? null,
  });
export const saveQuestions = (fy, questions) => call('pms_save_questions', { p_fy: fy, p_questions: questions });

export const createGoal = (fy, goal) => call('pms_create_goal', { p_fy: fy, p: goal });
export const updateGoal = (goalId, goal, expectedVersion) =>
  call('pms_update_goal', { p_goal: goalId, p: goal, p_expected_version: expectedVersion });
export const updateGoalTarget = (goalId, target, expectedVersion) =>
  call('pms_update_goal_target', { p_goal: goalId, p_target: target, p_expected_version: expectedVersion });
export const deleteGoal = goalId => call('pms_delete_goal', { p_goal: goalId });

export const createKpi = (fy, kpi) => call('pms_create_kpi', { p_fy: fy, p: kpi });
export const updateKpi = (kpiId, kpi, expectedVersion) =>
  call('pms_update_kpi', { p_kpi: kpiId, p: kpi, p_expected_version: expectedVersion });
export const updateKpiWeights = items => call('pms_update_kpi_weights', { p_items: items });
export const updateKpiTargets = (kpiId, targets, expectedVersion) =>
  call('pms_update_kpi_targets', { p_kpi: kpiId, p_targets: targets, p_expected_version: expectedVersion });
export const deleteKpi = kpiId => call('pms_delete_kpi', { p_kpi: kpiId });

export const submitUpdate = (kpiId, month, input) => call('pms_submit_update', { p_kpi: kpiId, p_month: month, p: input });
export const decideUpdate = (kpiId, month, action, reason = null) =>
  call('pms_decide_update', { p_kpi: kpiId, p_month: month, p_action: action, p_reason: reason });

export const scorecardAction = (fy, ownerType, ownerId, action, reason = null) =>
  call('pms_scorecard_action', { p_fy: fy, p_type: ownerType, p_owner: String(ownerId), p_action: action, p_reason: reason });

export const launchCycleReviews = (fy, period, employeeIds) =>
  call('pms_launch_cycle_reviews', { p_fy: fy, p_period: period, p_employee_ids: employeeIds });
export const submitCycleAssessment = (reviewId, answers) =>
  call('pms_submit_cycle_assessment', { p_review: reviewId, p_answers: answers });
export const releaseCycleReview = reviewId => call('pms_release_cycle_review', { p_review: reviewId });

export const saveTemplate = (template, publish) => call('pms_save_template', { p: template, p_publish: publish });
export const archiveTemplate = templateId => call('pms_archive_template', { p_template: templateId });
export const createCampaign = campaign => call('pms_create_campaign', { p: campaign });
export const campaignAction = (campaignId, action, { assignmentId = null, answers = null, reason = null, end = null } = {}) =>
  call('pms_campaign_action', {
    p_campaign: campaignId, p_action: action, p_assignment: assignmentId,
    p_answers: answers, p_reason: reason, p_end: end || null,
  });
