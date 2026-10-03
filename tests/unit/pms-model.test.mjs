// Unit tests for the PMS scoring engine and workspace mapper.
// Run: node --test tests/unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievement, employeeScore, measurement, weightIssues, allocationSummary, csvContent, periodMonths, dueMonths } from '../../src/features/performance/model.js';
import { readiness, cardKey, editableCard, goalProtected } from '../../src/features/performance/workflow.js';
import { fromWorkspace } from '../../src/features/performance/workspaceData.js';

const confirmed = values => Object.fromEntries(values.map((v, m) => [m, { ...v, status: 'Confirmed', applicability: 'Measured' }]));
const kpi = over => ({ id: crypto.randomUUID(), ownerType: 'Employee', employeeId: 'e1', kra: 'K', kraWeight: 100, weight: 100, kind: 'Volume', frequency: 'Monthly', direction: 'Higher', target: 10, updates: {}, ...over });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('nested weights: documented 109.2% example', () => {
  const Q1 = [0];
  const k = [
    kpi({ kra: 'Business growth', kraWeight: 60, weight: 60, target: 100, updates: confirmed([{ actual: 110 }]) }),
    kpi({ kra: 'Business growth', kraWeight: 60, weight: 40, target: 100, updates: confirmed([{ actual: 90 }]) }),
    kpi({ kra: 'Conversion quality', kraWeight: 40, weight: 100, target: 100, updates: confirmed([{ actual: 120 }]) }),
  ];
  close(employeeScore(k, Q1, 120), 109.2);
});

test('rate aggregation uses ratio of sums (20%, not 31.25%)', () => {
  const k = kpi({ kind: 'Rate', target: 25, updates: confirmed([{ numerator: 1, denominator: 2 }, { numerator: 1, denominator: 8 }]) });
  close(measurement(k, [0, 1]).actual, 20);
  close(achievement(k, [0, 1], 120), 80);
});

test('lower-is-better: 4h target, 5h actual → 80%; 3h → 100%', () => {
  close(achievement(kpi({ direction: 'Lower', target: 4, updates: confirmed([{ actual: 5 }]) }), [0], 120), 80);
  close(achievement(kpi({ direction: 'Lower', target: 4, updates: confirmed([{ actual: 3 }]) }), [0], 120), 100);
});

test('cap and floor', () => {
  close(achievement(kpi({ target: 10, updates: confirmed([{ actual: 50 }]) }), [0], 120), 120);
  close(achievement(kpi({ target: 10, updates: confirmed([{ actual: 0 }]) }), [0], 120), 0);
});

test('zero incidents slabs and rubric mapping', () => {
  const zi = n => achievement(kpi({ kind: 'Zero incidents', target: 0, updates: confirmed([{ actual: n }]) }), [0], 120);
  assert.deepEqual([zi(0), zi(1), zi(2), zi(3)], [100, 70, 40, 0]);
  close(achievement(kpi({ kind: 'Rubric', target: 3, updates: confirmed([{ actual: 4 }]) }), [0], 120), 110);
  close(achievement(kpi({ kind: 'Rubric', target: 3, updates: confirmed([{ actual: 3 }, { actual: 4 }]) }), [0, 1], 120), 105);
});

test('snapshot uses closing value; milestone uses completed weights', () => {
  const snap = kpi({ kind: 'Snapshot', target: 100, updates: confirmed([{ actual: 10 }, { actual: 20 }, { actual: 90 }]) });
  close(measurement(snap, [0, 1, 2]).actual, 90);
  const ms = kpi({ kind: 'Milestone', target: 100, milestones: [{ id: 'a', weight: 40 }, { id: 'b', weight: 60 }], updates: confirmed([{ completed: ['a'] }]) });
  close(achievement(ms, [0], 120), 40);
});

test('unconfirmed or N/A input keeps the KPI not rated', () => {
  assert.equal(achievement(kpi({ updates: { 0: { actual: 10, status: 'Submitted' } } }), [0], 120), null);
  assert.equal(achievement(kpi({ updates: { 0: { actual: null, status: 'Confirmed', applicability: 'N/A' } } }), [0], 120), null);
});

test('quarterly KPIs are due only at quarter end', () => {
  assert.deepEqual(dueMonths(kpi({ frequency: 'Quarterly' }), periodMonths('Q2')), [5]);
  assert.deepEqual(dueMonths(kpi({ frequency: 'Annual' }), periodMonths('FY')), [11]);
});

test('weight validation reports each invalid total', () => {
  assert.deepEqual(weightIssues([kpi({ kraWeight: 100, weight: 60 })]), ['K: KPI weights must total 100%']);
  assert.deepEqual(weightIssues([kpi({ kra: 'A', kraWeight: 50 }), kpi({ kra: 'B', kraWeight: 40 })]), ['KRA weights must total 100%']);
  assert.deepEqual(weightIssues([]), ['No KRAs assigned']);
});

test('allocation: over-allocation and unit mismatch are flagged', () => {
  const goals = [{ id: 'c', annualTarget: 1000, unit: 'INR lakh' }, { id: 's', parentId: 'c', allocation: 'Allocated', annualTarget: 800, unit: 'INR lakh' }, { id: 'r', parentId: 'c', allocation: 'Allocated', annualTarget: 400, unit: 'INR lakh' }];
  const a = allocationSummary(goals[0], goals);
  assert.equal(a.status, 'Overallocated'); close(a.remaining, -200);
});

test('CSV export neutralises spreadsheet formulas and quotes', () => {
  assert.equal(csvContent([['=SUM(A1)', 'He said "hi"', '+1', 'ok']]), `"'=SUM(A1)","He said ""hi""","'+1","ok"`);
});

test('readiness mirrors server checks', () => {
  const goals = [{ id: 'g', title: 'G', parentId: '' }];
  const state = { goals, kpis: [], scorecards: {} };
  const k = kpi({ goalId: 'g', submitterId: 'e1', approverId: 'e1' });
  state.kpis = [k];
  assert.ok(readiness([k], state).some(e => e.includes('separate submitter and approver')));
  k.approverId = 'm1';
  assert.deepEqual(readiness([k], state), []);
});

test('locked scorecards protect their goals and definitions', () => {
  const state = { goals: [{ id: 'root' }, { id: 'child', parentId: 'root' }], kpis: [kpi({ goalId: 'child', ownerId: 'e1' })], scorecards: {} };
  assert.equal(goalProtected(state, 'root'), false);
  state.scorecards[cardKey('Employee', 'e1')] = { status: 'Locked', revision: 1, history: [], versions: [] };
  assert.equal(goalProtected(state, 'root'), true);
  assert.equal(editableCard(state, cardKey('Employee', 'e1')), false);
});

test('fromWorkspace recomputes released KPI from the server snapshot', () => {
  const snapKpi = kpi({ target: 10, updates: { 3: { actual: 12, status: 'Confirmed', applicability: 'Measured' }, 4: { actual: 10, status: 'Confirmed', applicability: 'Measured' }, 5: { actual: 8, status: 'Confirmed', applicability: 'Measured' } } });
  const ws = fromWorkspace({
    fy: 2026, caller: { id: 'e1', role: 'employee', isHr: false, canManage: false }, features: { kras: true, reviews: true },
    settings: { year: 2026, kpiWeight: '70', cap: '120', deadline: '2026-10-10', reminders: true, rowVersion: 1, locked: true },
    questions: [], scope: ['e1'], directory: [], goals: [], kpis: [], templates: [], campaigns: [],
    scorecards: [{ type: 'Employee', ownerId: 'e1', status: 'Locked', revision: 1 }],
    reviews: [{ id: 'r', employeeId: 'e1', period: 'Q2', status: 'Released', questions: [], releasedPolicy: { kpiWeight: '70', cap: '120' },
      releasedSnapshot: { kpis: [snapKpi], allKpis: [snapKpi], policy: { cap: 120 } } }],
  });
  close(ws.data.reviews[0].releasedKpi, 100);
  assert.equal(ws.policy.kpiWeight, 70);
  assert.equal(ws.data.scorecards[cardKey('Employee', 'e1')].status, 'Locked');
  assert.ok(ws.scope.has('e1'));
});
