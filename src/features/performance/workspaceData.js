import { employeeScore, periodMonths } from './model.js';
import { cardKey } from './workflow.js';

// Maps the pms_workspace() payload into the shapes the workspace views use.
export function fromWorkspace(ws) {
  const policy = { year: ws.settings.year, kpiWeight: Number(ws.settings.kpiWeight), cap: Number(ws.settings.cap), deadline: ws.settings.deadline, reminders: ws.settings.reminders };
  const scorecards = Object.fromEntries((ws.scorecards || []).map(c => [cardKey(c.type, c.ownerId), { ...c, versions: c.versions || [], history: c.history || [] }]));
  const reviews = (ws.reviews || []).map(r => {
    const snap = r.releasedSnapshot;
    const releasedKpi = snap ? employeeScore(snap.kpis || [], periodMonths(r.period), Number(snap.policy?.cap ?? policy.cap), snap.allKpis || snap.kpis || []) : null;
    return { ...r, releasedKpi, releasedPolicy: r.releasedPolicy ? { ...r.releasedPolicy, kpiWeight: Number(r.releasedPolicy.kpiWeight), cap: Number(r.releasedPolicy.cap) } : null };
  });
  return {
    fy: ws.fy,
    caller: ws.caller,
    features: ws.features,
    settings: ws.settings,
    policy,
    questions: ws.questions || [],
    scope: new Set(ws.scope || []),
    // An empty middle name leaves a double space in pms_person_name().
    directory: (ws.directory || []).map(p => ({ ...p, name: p.name.replace(/\s+/g, ' ').trim() })),
    data: { goals: (ws.goals || []).map(g => ({ ...g, unit: g.unit || '' })), kpis: ws.kpis || [], reviews, scorecards },
    hub: { templates: ws.templates || [], campaigns: ws.campaigns || [] },
  };
}
