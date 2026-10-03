import { allocationSummary, resolveKpi, weightIssues } from './model.js';

export const cardKey = (type, id) => JSON.stringify([type || 'Employee', id]);
export const kpiCardKey = k => cardKey(k.ownerType, k.ownerId || k.employeeId);
export const cardRecord = (state, key) => state.scorecards?.[key] || { status: 'Draft', revision: 1, history: [], versions: [] };
export const editableCard = (state, key) => cardRecord(state, key).status === 'Draft';

export function goalProtected(state, goalId) {
  return state.kpis.some(k => {
    if (editableCard(state, kpiCardKey(k))) return false;
    let id = k.goalId; const seen = new Set();
    while (id && !seen.has(id)) {
      if (id === goalId) return true;
      seen.add(id); id = state.goals.find(g => g.id === id)?.parentId;
    }
    return false;
  });
}

// Mirrors pms_card_issues() so the UI can explain why Submit/Approve is
// disabled; the server re-checks every rule on submit and approve.
export function readiness(kpis, state) {
  const errors = [...weightIssues(kpis)];
  for (const kpi of kpis) {
    const k = resolveKpi(kpi, state.kpis);
    if (k.unresolved) errors.push(`${kpi.title}: shared source is missing`);
    if (!state.goals.some(g => g.id === kpi.goalId)) errors.push(`${kpi.title}: choose an aligned goal`);
    if (!k.submitterId || !k.approverId || k.submitterId === k.approverId) errors.push(`${kpi.title}: separate submitter and approver required`);
    if (!['Zero incidents', 'Milestone', 'Rubric'].includes(k.kind) && (!Number.isFinite(k.target) || k.target <= 0)) errors.push(`${kpi.title}: a positive target is required`);
    if (k.targets && (k.targets.length !== 12 || k.targets.some(t => !Number.isFinite(t) || t <= 0))) errors.push(`${kpi.title}: all 12 phased targets must be positive`);
    if (k.kind === 'Milestone' && Math.abs((k.milestones || []).reduce((n, m) => n + m.weight, 0) - 100) > .001) errors.push(`${kpi.title}: milestone weights must total 100%`);
    let id = kpi.goalId; const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id); const goal = state.goals.find(g => g.id === id); if (!goal) break;
      const a = allocationSummary(goal, state.goals);
      if (a.invalid || a.remaining < -.001) errors.push(`${goal.title}: correct target allocation before approval`);
      id = goal.parentId;
    }
  }
  return [...new Set(errors)];
}
