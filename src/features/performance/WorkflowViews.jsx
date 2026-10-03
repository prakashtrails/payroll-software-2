import { useState } from 'react';
import { MONTHS, measurement, achievement, employeeScore, kraGroups, resolveKpi, monthlyTarget, dueMonths, percent, periodMonths } from './model';
import { cardKey, cardRecord, readiness } from './workflow';

const APPROVER_ROLES = ['manager', 'hod', 'management', 'admin', 'superadmin'];
// Mirrors pms_employee_approver(): manager, else HOD, when that person can
// approve; otherwise any HR administrator other than the owner decides.
function designatedApprover(type, ownerId, kpis, directory) {
  if (type !== 'Employee') return kpis.find(k => k.approverId)?.approverId || null;
  const emp = directory.find(e => e.id === ownerId);
  return [emp?.managerId, emp?.hodId].map(id => directory.find(e => e.id === id))
    .find(p => p && p.id !== ownerId && APPROVER_ROLES.includes(p.role))?.id || null;
}

export function WorkflowPanel({ state, type = 'Employee', ownerId, actorId, canManage, isHr, directory, onAction, onExplain, busy }) {
  const key = cardKey(type, ownerId); const card = cardRecord(state, key);
  const kpis = state.kpis.filter(k => cardKey(k.ownerType, k.ownerId || k.employeeId) === key);
  const issues = readiness(kpis, state);
  const approverId = designatedApprover(type, ownerId, kpis, directory);
  // With no manager/HOD approver, another HR admin must decide; say so up front.
  const noIndependentApprover = !approverId && !directory.some(e => ['admin', 'superadmin'].includes(e.role) && e.id !== actorId && e.id !== ownerId);
  const owner = type === 'Employee' ? ownerId === actorId : kpis.some(k => k.submitterId === actorId);
  const context = { key, type, ownerId, approverId };
  const decide = canManage && (card.approverId ? actorId === card.approverId : isHr) && actorId !== card.submittedBy && !(type === 'Employee' && ownerId === actorId);
  return <section className="pms-panel pms-workflow" aria-label="Scorecard workflow">
    <div className="pms-panel-heading"><div><span className="pms-eyebrow">GOAL SETTING · REVISION {card.revision}</span><h3>{card.status}</h3></div><button className="btn btn-outline" disabled={!kpis.length} onClick={() => onExplain(kpis, card)}>Explain this score</button></div>
    <ol className="pms-workflow-steps" aria-label="Approval stages">{['Draft', 'Pending approval', 'Locked'].map(s => <li key={s} aria-current={s === card.status ? 'step' : undefined}>{s}</li>)}</ol>
    <p>{card.status === 'Locked' ? 'Goal definitions, targets and weights are locked. Monthly results can still be submitted. Request permission before revising the plan.' : card.status === 'Pending approval' ? 'Definitions are read-only while the designated manager reviews this scorecard.' : 'Align goals, phase targets and make both weight totals 100%, then submit for approval.'}</p>
    {card.revision > 1 && <div className="pms-notice">Revision changes recalculate provisional scores across this FY. Released review results stay frozen. Prior approval snapshots are available in the score explanation.</div>}
    <p>Designated approver: <strong>{directory.find(e => e.id === (card.approverId || approverId))?.name || 'Any other HR administrator'}</strong>. Approval must be independent of the owner and submitter.</p>
    {card.status === 'Draft' && noIndependentApprover && <div className="pms-notice pms-validation-error">No one independent can approve this scorecard yet. {type === 'Employee' ? 'Assign this employee a manager or HOD in People, or add another HR administrator.' : 'Choose an approver on the KPIs, or add another HR administrator.'}</div>}
    {issues.length > 0 && <details><summary>{issues.length} item(s) to resolve before approval</summary><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
    <div className="pms-row-actions">
      {card.status === 'Draft' && (owner || canManage) && <button className="btn btn-primary" disabled={busy || !!issues.length || noIndependentApprover || approverId === actorId || (type === 'Employee' && approverId === ownerId)} onClick={() => onAction({ ...context, action: 'submit' })}>Submit scorecard</button>}
      {card.status === 'Draft' && approverId === actorId && <small>The owner submits; you review and approve.</small>}
      {card.status === 'Pending approval' && decide && <><button className="btn btn-outline" disabled={busy} onClick={() => onAction({ ...context, action: 'return' })}>Return scorecard</button><button className="btn btn-primary" disabled={busy || !!issues.length} onClick={() => onAction({ ...context, action: 'approve' })}>Approve & lock</button></>}
      {card.status === 'Locked' && (owner || canManage) && actorId !== card.approverId && card.changeRequest?.status !== 'Pending' && <button className="btn btn-outline" onClick={() => onAction({ ...context, action: 'request' })}>Request changes</button>}
    </div>
    {card.changeRequest && <div className="pms-notice"><div><strong>Change request · {card.changeRequest.status}</strong><p>{card.changeRequest.reason}</p>{card.changeRequest.decision && <p>Decision: {card.changeRequest.decision}</p>}{card.changeRequest.status === 'Pending' && decide && actorId !== card.changeRequest.requestedBy && <div className="pms-row-actions"><button className="btn btn-outline" onClick={() => onAction({ ...context, action: 'reject-change' })}>Reject changes</button><button className="btn btn-primary" onClick={() => onAction({ ...context, action: 'allow-change' })}>Allow revision</button></div>}</div></div>}
    {!!card.history.length && <details><summary>Approval history ({card.history.length})</summary><ol>{card.history.map((event, i) => <li key={i}><strong>{event.action}</strong> · revision {event.revision} · {directory.find(e => e.id === event.actorId)?.name || 'Unknown'} · {new Date(event.at).toLocaleString()}{event.reason && <p>{event.reason}</p>}</li>)}</ol></details>}
  </section>;
}

const number = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const rule = k => ({ Rate: 'Total numerator ÷ total denominator × 100; target weighted by the same denominators.', 'Weighted average': 'Total measured amount ÷ total observations; target weighted by observations.', Snapshot: 'Last due closing value, not the sum of balances.', Milestone: 'Sum of completed milestone weights at the closing update.', Rubric: 'Average rating mapped to 60 / 85 / 100 / 110 / 120%.', 'Zero incidents': 'Total incidents: 0 → 100%, 1 → 70%, 2 → 40%, 3+ → 0%.' })[k.kind] || 'Sum confirmed actuals ÷ sum period targets × 100.';

export function ScoreExplanation({ kpis, allKpis, goals, policy, period, card, review }) {
  const [version, setVersion] = useState('current');
  const snapshot = version === 'released' ? review?.releasedSnapshot : card.versions?.find(v => String(v.revision) === version);
  const usedKpis = snapshot?.kpis || kpis; const all = snapshot?.allKpis || allKpis; const usedPolicy = snapshot?.policy || policy;
  const months = periodMonths(period); const score = employeeScore(usedKpis, months, usedPolicy.cap, all);
  const groups = kraGroups(usedKpis); const organisation = usedKpis[0]?.ownerType !== 'Employee';
  const component = organisation ? 100 : usedPolicy.kpiWeight;
  const ratings = (review?.questions || []).filter(q => q.type === 'Rating').map(q => Number(review?.managerAnswers?.[q.id])).filter(n => n >= 1 && n <= 5);
  const reviewScore = ratings.length ? ratings.reduce((n, v) => n + [0, 60, 85, 100, 110, 120][v], 0) / ratings.length : null;
  const final = score !== null && (component === 100 || reviewScore !== null) ? score * component / 100 + (reviewScore || 0) * (100 - component) / 100 : null;
  return <div className="pms-score-explanation">
    <label>Calculation version <select aria-label="Calculation version" value={version} onChange={e => setVersion(e.target.value)}><option value="current">Current provisional calculation</option>{review?.releasedSnapshot && <option value="released">Released review inputs</option>}{(card.versions || []).map(v => <option key={v.revision} value={v.revision}>Revision {v.revision} · as at approval</option>)}</select></label>
    <div className="pms-notice">{snapshot ? `Frozen inputs as at ${new Date(snapshot.at).toLocaleString()}; later monthly updates are excluded.` : 'Current provisional inputs. Only confirmed due updates contribute; missing or N/A inputs keep the score not rated.'}</div>
    <p><strong>{period} KPI achievement: {percent(score)}</strong> · floor 0% · cap {usedPolicy.cap}% per KPI. Annual calculations aggregate each KPI using its measurement rule; they do not average quarterly percentages.</p>
    {groups.map(group => { const scores = group.items.map(k => achievement(k, months, usedPolicy.cap, all)); const kraScore = scores.some(s => s === null) ? null : scores.reduce((n, s, i) => n + s * group.items[i].weight / 100, 0); return <section key={group.title} className="pms-explain-kra"><h3>{group.title} · {group.weight}% of scorecard</h3><p>KRA achievement: <strong>{percent(kraScore)}</strong> · contribution to scorecard: {number(kraScore === null ? null : kraScore * group.weight / 100)} points.</p>{group.items.map(k => {
      const source = resolveKpi(k, all); const result = measurement(k, months, all); const value = achievement(k, months, usedPolicy.cap, all);
      const contribution = value === null ? null : value * k.weight / 100 * group.weight / 100;
      return <details key={k.id} open><summary>{k.title} · {percent(value)}</summary><p>{rule(source)} {source.direction === 'Lower' && !['Rubric', 'Milestone', 'Zero incidents'].includes(source.kind) ? 'Lower-is-better: 100% at/below target; otherwise target ÷ actual × 100.' : ''}</p>{k.sharedSourceId && <p>Shared source: {all.find(s => s.id === k.sharedSourceId)?.title}. Actuals counted once at the source.</p>}
        <div className="pms-table-wrap"><table className="pms-table"><thead><tr><th>Month</th><th>Target</th><th>Actual</th><th>Underlying input</th><th>Status</th></tr></thead><tbody>{months.map(m => { const u = source.updates[m]; return <tr key={m}><td>{MONTHS[m]}</td><td>{number(monthlyTarget(source, m))}</td><td>{u?.applicability === 'N/A' ? 'N/A' : number(u?.actual)}</td><td>{['Rate', 'Weighted average'].includes(source.kind) ? `${number(u?.numerator)} / ${number(u?.denominator)}` : source.kind === 'Milestone' ? (u?.completed || []).map(id => source.milestones?.find(x => x.id === id)?.title).filter(Boolean).join(', ') || 'None' : source.unit}</td><td>{dueMonths(source, [m]).length ? u?.status || 'Missing' : 'Not due'}</td></tr>; })}</tbody></table></div>
        {period === 'FY' && <p>{['Q1', 'Q2', 'Q3', 'Q4'].map(q => `${q}: ${percent(achievement(k, periodMonths(q), usedPolicy.cap, all))}`).join(' · ')}. FY recomputes from annual inputs.</p>}<p>Aggregated result: {number(result.actual)} / {number(result.target)} {source.unit}. {result.reason}</p><p><strong>{percent(value)} × {k.weight}% KPI weight × {group.weight}% KRA weight = {number(contribution)} scorecard points.</strong> Final appraisal contribution: {number(contribution === null ? null : contribution * component / 100)} points ({component}% KPI component).</p>
      </details>})}</section>})}
    <section className="pms-notice"><div><strong>{organisation ? 'Business score' : 'Provisional appraisal'}: {percent(final)}</strong><p>KPI {percent(score)} × {component}%{!organisation && ` + manager ${percent(reviewScore)} × ${100 - component}%`}. Self-assessment is unscored.</p>{snapshot && version !== 'released' && <p>Manager assessment is current reference only; this approval snapshot is not a released appraisal.</p>}{review?.status === 'Released' && <p>Released result is frozen separately: KPI {percent(review.releasedKpi)} × {review.releasedPolicy.kpiWeight}% + manager {percent(reviewScore)} × {100 - review.releasedPolicy.kpiWeight}%. Later draft edits do not change the released result.</p>}</div></section>
  </div>;
}
