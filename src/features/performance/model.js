// Scoring and measurement rules for the PMS workspace. Records are persisted
// by the pms_* RPCs (src/services/pmsService.js); these pure functions derive
// achievement, weights and allocations from that data for display. Released
// results are recomputed from the server-captured snapshot, never from
// client-supplied numbers.
export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
export function periodMonths(period) {
  return period === 'FY' ? MONTHS.map((_, i) => i) : Array.from({ length: 3 }, (_, i) => (Number(period.slice(1)) - 1) * 3 + i);
}
export const MEASUREMENT_TYPES = ['Volume', 'Rate', 'Weighted average', 'Snapshot', 'Milestone', 'Rubric', 'Zero incidents'];
export function resolveKpi(kpi, all = []) {
  if (!kpi.sharedSourceId) return kpi;
  const source = all.find(k => k.id === kpi.sharedSourceId && !k.sharedSourceId);
  return source ? { ...source, id: kpi.id, title: kpi.title, kra: kpi.kra, kraWeight: kpi.kraWeight, weight: kpi.weight, employeeId: kpi.employeeId, ownerType: kpi.ownerType, ownerId: kpi.ownerId, sharedSourceId: source.id } : { ...kpi, updates: {}, unresolved: true };
}
export function dueMonths(kpi, months) {
  const frequency = kpi.frequency || 'Monthly';
  const due = months.filter(m => frequency === 'Monthly' || (frequency === 'Quarterly' ? m % 3 === 2 : m === 11));
  return ['Snapshot', 'Milestone'].includes(kpi.kind) ? due.slice(-1) : due;
}
export function monthlyTarget(kpi, m) { return kpi.targets?.[m] ?? kpi.target; }
// Target for the due months from the plan alone, so people see what they are
// aiming for before any result is confirmed. Display only; scoring uses measurement().
export function plannedTarget(kpi, months, all = []) {
  const k = resolveKpi(kpi, all);
  const due = dueMonths(k, months);
  if (k.unresolved || !due.length) return null;
  if (k.kind === 'Milestone') return 100;
  const targets = due.map(m => Number(monthlyTarget(k, m)));
  if (targets.some(t => !Number.isFinite(t))) return null;
  const total = targets.reduce((a, b) => a + b, 0);
  return ['Rate', 'Weighted average', 'Rubric'].includes(k.kind) || k.aggregation === 'Average' ? total / targets.length : total;
}
export function measurement(kpi, months, all = []) {
  const k = resolveKpi(kpi, all);
  const due = dueMonths(k, months);
  if (k.unresolved || !due.length) return { actual: null, target: null, reason: 'Not due in this period' };
  const rows = due.map(m => k.updates[m]);
  if (rows.some(u => !u || u.status !== 'Confirmed' || u.applicability === 'N/A')) return { actual: null, target: null, reason: rows.some(u => u?.applicability === 'N/A') ? 'N/A requires an approved weight decision' : 'Waiting for confirmed inputs' };
  let actual;
  let target;
  if (['Rate', 'Weighted average'].includes(k.kind)) {
    const denominator = rows.reduce((n, u) => n + Number(u.denominator), 0);
    const numerator = rows.reduce((n, u) => n + Number(u.numerator), 0);
    actual = denominator > 0 ? numerator / denominator * (k.kind === 'Rate' ? 100 : 1) : null;
    // Targets are weighted by the same eligible volume as the actual rate.
    target = denominator > 0 ? rows.reduce((n, u, i) => n + Number(monthlyTarget(k, due[i])) * Number(u.denominator), 0) / denominator : null;
  } else if (k.kind === 'Milestone') {
    const milestones = k.milestones || [];
    if (Math.abs(milestones.reduce((n, m) => n + m.weight, 0) - 100) > .001) return { actual: null, target: 100, reason: 'Milestone weights must total 100%' };
    actual = milestones.reduce((n, m) => n + (rows.at(-1).completed?.includes(m.id) ? m.weight : 0), 0); target = 100;
  } else {
    const values = rows.map(u => Number(u.actual));
    actual = values.reduce((a, b) => a + b, 0);
    target = due.reduce((n, m) => n + Number(monthlyTarget(k, m)), 0);
    if (k.kind === 'Rubric' || k.aggregation === 'Average') { actual /= rows.length; target /= rows.length; }
  }
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return { actual: null, target: null, reason: 'Missing or invalid measurement inputs' };
  return { actual, target, reason: '', count: rows.length };
}
export function achievement(kpi, months, cap = 120, all = []) {
  const k = resolveKpi(kpi, all);
  const { actual, target } = measurement(kpi, months, all);
  if (actual === null) return null;
  let score;
  if (k.kind === 'Zero incidents') score = actual === 0 ? 100 : actual === 1 ? 70 : actual === 2 ? 40 : 0;
  else if (k.kind === 'Rubric') score = actual <= 1 ? 60 : actual >= 5 ? 120 : (() => { const floor = Math.floor(actual); const scale = [0, 60, 85, 100, 110, 120]; return scale[floor] + (scale[floor + 1] - scale[floor]) * (actual - floor); })();
  else if (!(target > 0)) return null;
  else score = k.direction === 'Lower' ? (actual <= target ? 100 : target / actual * 100) : actual / target * 100;
  return Math.max(0, Math.min(cap, score));
}
export function kraGroups(kpis) {
  return [...new Set(kpis.map(k => k.kra))].map(title => { const items = kpis.filter(k => k.kra === title); return { title, weight: items[0].kraWeight ?? 100, items }; });
}
export function weightIssues(kpis) {
  const groups = kraGroups(kpis); const errors = [];
  if (!groups.length) return ['No KRAs assigned'];
  if (Math.abs(groups.reduce((n, g) => n + g.weight, 0) - 100) > .001) errors.push('KRA weights must total 100%');
  groups.forEach(g => {
    if (g.weight <= 0 || g.items.some(k => (k.kraWeight ?? 100) !== g.weight)) errors.push(`${g.title}: inconsistent KRA weight`);
    if (g.items.some(k => !(k.weight > 0)) || Math.abs(g.items.reduce((n, k) => n + k.weight, 0) - 100) > .001) errors.push(`${g.title}: KPI weights must total 100%`);
  });
  return errors;
}
export function employeeScore(kpis, months, cap = 120, all = kpis) {
  if (weightIssues(kpis).length) return null;
  let score = 0;
  for (const group of kraGroups(kpis)) for (const k of group.items) {
    const value = achievement(k, months, cap, all);
    if (value === null) return null;
    score += value * k.weight / 100 * group.weight / 100;
  }
  return score;
}
export function allocationSummary(goal, goals) {
  const children = goals.filter(g => g.parentId === goal.id && g.allocation === 'Allocated');
  const allocated = children.reduce((n, g) => n + Number(g.annualTarget || 0), 0);
  const target = Number(goal.annualTarget || 0);
  return { allocated, remaining: target - allocated, target, invalid: children.some(g => g.unit !== goal.unit), status: allocated > target + .001 ? 'Overallocated' : Math.abs(allocated - target) < .001 ? 'Fully allocated' : 'Unallocated balance' };
}
export function goalPath(id, goals) {
  const path = []; const seen = new Set();
  while (id && !seen.has(id)) { seen.add(id); const goal = goals.find(g => g.id === id); if (!goal) break; path.unshift(goal.title); id = goal.parentId; }
  return path.join(' → ');
}
export const percent = n => n === null ? 'Not rated' : `${n.toFixed(1)}%`;
export function csvContent(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

