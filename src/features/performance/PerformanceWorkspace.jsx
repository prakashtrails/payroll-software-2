import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { MONTHS, periodMonths, achievement, employeeScore, percent, csvContent, dueMonths, weightIssues } from './model';
import './performance.css';
import ReviewHub from './ReviewHub';
import { fromWorkspace } from './workspaceData';
import { cardKey, kpiCardKey, cardRecord, editableCard, goalProtected } from './workflow';
import { WorkflowPanel, ScoreExplanation } from './WorkflowViews';
import { AlignmentView, GoalFields, KpiFields, MeasurementFields, ScorecardDetails, WeightFields, OrganisationScorecards, TargetPlanning } from './PlanningViews';
import * as pms from '@/services/pmsService';

const SECTIONS = ['Overview', 'Goals', 'Organisation', 'Target planning', 'Scorecards', 'Monthly updates', 'Reviews', 'Templates', 'Approvals', 'Analytics', 'Settings'];
function Badge({ children }) { return <span className={`pms-badge ${['Confirmed', 'Released', 'On track'].includes(children) ? 'positive' : children === 'Returned' ? 'negative' : ''}`}>{children}</span>; }
function Empty({ title, children }) { return <div className="pms-empty"><span className="pms-empty-mark" aria-hidden="true">◎</span><h3>{title}</h3><p>{children}</p></div>; }
function Meter({ value }) { return <div className="pms-meter" role="meter" aria-label="Achievement" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={120}><span style={{ width: `${Math.min(value ?? 0, 120) / 1.2}%` }} /></div>; }
function Field({ label, children }) {
  const id = useId();
  const items = Array.isArray(children) ? children : [children];
  return <div className="pms-field"><label htmlFor={id}>{label}</label>{items.map((child, i) => isValidElement(child) && ['input', 'select', 'textarea'].includes(child.type) ? cloneElement(child, { id, key: i }) : child)}</div>;
}
function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const node = ref.current; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={ref} className="pms-dialog" aria-labelledby="pms-dialog-title" onCancel={onClose}><div className="pms-dialog-heading"><h2 id="pms-dialog-title">{title}</h2><button className="btn btn-outline" onClick={onClose} aria-label="Close dialog">×</button></div>{children}</dialog>;
}
const errorText = error => (/fetch|network/i.test(error?.message || '') ? 'Could not reach CrewCore. Check your connection and try again.' : error?.message || 'Something went wrong. Please try again.');

// Persistent PMS workspace. All records come from pms_workspace() and every
// change goes through a server-checked pms_* RPC that returns the refreshed
// workspace (src/services/pmsService.js).
export default function PerformanceWorkspace({ requestedSection, onSectionChange, enabledSections = SECTIONS }) {
  const [ws, setWs] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [localSection, setLocalSection] = useState('Overview');
  const setSection = value => { setLocalSection(value); onSectionChange?.(value); };
  const [period, setPeriod] = useState(() => { const m = (new Date().getMonth() + 9) % 12; return `Q${Math.floor(m / 3) + 1}`; });
  const [month, setMonth] = useState(() => (new Date().getMonth() + 9) % 12);
  const [department, setDepartment] = useState('All departments');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');

  const apply = useCallback((raw, { hubOnly = false } = {}) => {
    const next = fromWorkspace(raw);
    setWs(current => (hubOnly && current && current.fy !== next.fy ? { ...current, hub: next.hub } : next));
  }, []);
  const load = useCallback(async fy => {
    setLoadError('');
    const { data, error } = await pms.getWorkspace(fy);
    if (error) setLoadError(errorText(error)); else apply(data);
  }, [apply]);
  useEffect(() => { load(null); }, [load]);

  // Runs one RPC at a time; resolves to an error message or null.
  const perform = useCallback(async (request, success, options) => {
    if (busyRef.current) return 'Please wait for the previous action to finish.';
    busyRef.current = true; setBusy(true);
    try {
      const { data, error } = await request();
      if (error) return errorText(error);
      apply(data, options);
      if (success) setMessage(success);
      return null;
    } catch (error) {
      return errorText(error);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }, [apply]);
  const act = async (request, success) => { const err = await perform(request, success); if (err) setMessage(err); return !err; };

  if (!ws) {
    return <div className="pms-workspace">{loadError
      ? <div className="pms-notice" role="alert">Performance could not be loaded: {loadError} <button className="pms-text-button" onClick={() => load(null)}>Try again</button></div>
      : <p role="status">Loading performance workspace…</p>}</div>;
  }

  const { data: state, policy, questions, directory, hub, caller, settings, fy } = ws;
  const role = caller.role;
  const isAdmin = caller.isHr;
  const canManage = caller.canManage;
  const actorId = caller.id;
  const scoped = directory.filter(e => isAdmin || ws.scope.has(e.id));
  const people = scoped.filter(e => (department === 'All departments' || e.department === department) && `${e.name} ${e.code} ${e.designation}`.toLowerCase().includes(query.toLowerCase()));
  const employee = people.find(e => e.id === selected) || people[0];
  const employeeKpis = state.kpis.filter(k => k.employeeId === employee?.id);
  const months = periodMonths(period);
  const visibleReviews = state.reviews.filter(r => people.some(e => e.id === r.employeeId) && r.period === period);
  const sourceKpis = state.kpis.filter(k => !k.sharedSourceId && (people.some(e => e.id === k.employeeId) || (canManage && k.ownerType !== 'Employee' && (isAdmin || scoped.some(e => e.department === k.ownerId)))));
  const submitted = sourceKpis.flatMap(k => Object.entries(k.updates).filter(([, u]) => u.status === 'Submitted').map(([m, u]) => ({ kpi: k, month: Number(m), ...u })));
  const designatedDecider = u => u.kpi.approverId ? u.kpi.approverId === actorId : isAdmin;
  const pending = submitted.filter(u => canManage && u.submittedBy !== actorId && designatedDecider(u));
  const canConfigure = isAdmin;
  const sections = SECTIONS.filter(s => enabledSections.includes(s) && (canManage || !['Approvals', 'Goals', 'Target planning'].includes(s)) && (canConfigure || !['Templates', 'Settings'].includes(s)));
  const desiredSection = requestedSection || localSection;
  const section = sections.includes(desiredSection) ? desiredSection : (sections[0] || 'Overview');
  const name = id => directory.find(e => e.id === id)?.name || 'Unassigned';
  const notify = text => setMessage(text);
  const reviewFor = id => state.reviews.find(r => r.employeeId === id && r.period === period);
  const scoreFor = id => employeeScore(state.kpis.filter(k => k.employeeId === id), months, policy.cap, state.kpis);
  const visibleGoals = state.goals;
  const coverage = people.filter(e => state.kpis.some(k => k.employeeId === e.id)).length;
  const confirmed = sourceKpis.reduce((n, k) => n + dueMonths(k, months).filter(m => k.updates[m]?.status === 'Confirmed').length, 0);
  const expected = sourceKpis.reduce((n, k) => n + dueMonths(k, months).length, 0);
  const fyLabel = `FY ${fy}–${String(fy + 1).slice(2)}`;

  const editableKpi = k => editableCard(state, kpiCardKey(k)) && !state.kpis.some(ref => ref.sharedSourceId === k.id && !editableCard(state, kpiCardKey(ref)));
  const policyLocked = settings.locked;
  const workflowInbox = Object.entries(state.scorecards || {}).filter(([, c]) => (c.approverId ? c.approverId === actorId : isAdmin && c.submittedBy !== actorId && !(c.type === 'Employee' && c.ownerId === actorId)) && (c.status === 'Pending approval' || c.changeRequest?.status === 'Pending'));
  const WORKFLOW_DONE = { submit: 'Scorecard submitted for approval.', approve: 'Scorecard approved and locked. A snapshot of this plan was saved.', return: 'Scorecard returned to draft.', request: 'Change request sent to the approver.', 'allow-change': 'Revision opened as a new draft.', 'reject-change': 'Change request rejected.' };
  const runWorkflow = async action => {
    const err = await perform(() => pms.scorecardAction(fy, action.type, action.ownerId, action.action, action.reason || null), WORKFLOW_DONE[action.action]);
    if (!err) { setModal(null); setFormError(''); } else if (modal) setFormError(err); else notify(err);
  };
  const workflowAction = action => {
    if (['submit', 'approve'].includes(action.action)) runWorkflow(action);
    else setModal({ type: 'workflow', title: ({ request: 'Request scorecard changes', return: 'Return scorecard', 'allow-change': 'Allow scorecard revision', 'reject-change': 'Reject scorecard changes' })[action.action], action });
  };
  const workflowPanel = (type, ownerId) => <WorkflowPanel state={state} type={type} ownerId={ownerId} actorId={actorId} canManage={canManage} isHr={isAdmin} directory={directory} busy={busy} onAction={workflowAction} onExplain={(kpis, card) => setModal({ type: 'explain', title: 'Explain this score', kpis, card, ownerId, ownerType: type })} />;
  const editKpi = k => setModal({ type: 'editKpi', title: `Edit KPI: ${k.title}`, kpi: k });
  const askRemoveKpi = k => setModal({ type: 'confirm', title: 'Remove KPI', text: `Remove “${k.title}” from this draft scorecard? Weights will need to total 100% again before submission.`, run: () => pms.deleteKpi(k.id), done: 'KPI removed from the draft scorecard.' });
  const askDeleteGoal = g => setModal({ type: 'confirm', title: 'Delete goal', text: `Delete “${g.title}”? Only goals with no child goals or linked KPIs can be deleted.`, run: () => pms.deleteGoal(g.id), done: 'Goal deleted.' });
  const changeYear = async next => { setSelected(''); await load(next); };

  function exportReport() {
    const rows = [[`CrewCore performance report · ${fyLabel} · ${period}`], ['Employee code', 'Employee', 'Department', 'Period', 'Confirmed KPI achievement', 'Review status'], ...people.map(e => [e.code, e.name, e.department, period, percent(scoreFor(e.id)), reviewFor(e.id)?.status || 'Not started'])];
    const url = URL.createObjectURL(new Blob([csvContent(rows)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `performance-${fy}-${period}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Report exported.');
  }
  async function submitForm(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setFormError('');
    let request = null; let done = '';
    if (modal.type === 'workflow') { runWorkflow({ ...modal.action, reason: data.reason }); return; }
    if (modal.type === 'confirm') { request = modal.run; done = modal.done; }
    if (modal.type === 'goal') {
      const parent = state.goals.find(g => g.id === data.parentId);
      if (parent && goalProtected(state, parent.id)) return setFormError('This goal supports a submitted or locked scorecard. Open a revision before changing its allocation.');
      if (data.scope !== 'Company' && !parent) return setFormError('Choose a parent objective.');
      if (parent?.department && parent.department !== data.department) return setFormError('The child department must match its parent department.');
      request = () => pms.createGoal(fy, data);
      done = 'Goal added to the alignment tree. Check target allocation in Target planning.';
    }
    if (modal.type === 'kpi') {
      if (!canManage) return setFormError('Only managers and HR can assign KPIs.');
      const shared = state.kpis.find(k => k.id === data.sharedSourceId && !k.sharedSourceId);
      const milestones = data.milestones ? JSON.parse(data.milestones) : [];
      if (!shared && data.submitterId === data.approverId) return setFormError('Choose an approver different from the data submitter.');
      if (data.kind === 'Milestone' && Math.abs(milestones.reduce((n, m) => n + m.weight, 0) - 100) > .001) return setFormError('Milestone weights must total 100%.');
      request = () => pms.createKpi(fy, { ...data, milestones });
      done = 'KPI assigned. Validate KRA and KPI weights before submitting the scorecard.';
    }
    if (modal.type === 'editGoal') {
      request = () => pms.updateGoal(modal.goal.id, data, modal.goal.rowVersion);
      done = 'Goal updated. Check allocation balances in Target planning.';
    }
    if (modal.type === 'editKpi') {
      const milestones = data.milestones ? JSON.parse(data.milestones) : [];
      if (!modal.kpi.sharedSourceId && data.submitterId === data.approverId) return setFormError('Choose an approver different from the data submitter.');
      if (data.kind === 'Milestone' && Math.abs(milestones.reduce((n, m) => n + m.weight, 0) - 100) > .001) return setFormError('Milestone weights must total 100%.');
      request = () => pms.updateKpi(modal.kpi.id, { ...data, milestones }, modal.kpi.rowVersion);
      done = 'KPI updated. Check that KRA and KPI weights still total 100% before submitting the scorecard.';
    }
    if (modal.type === 'weights') {
      const weights = JSON.parse(data.weights);
      const errors = weightIssues(modal.kpis.map(k => ({ ...k, ...weights.find(w => w.id === k.id) })));
      if (errors.length) return setFormError(errors.join('; '));
      request = () => pms.updateKpiWeights(weights);
      done = 'KRA and KPI weights saved. Effective contributions recalculated.';
    }
    if (modal.type === 'update') {
      const completed = Object.keys(data).filter(key => key.startsWith('milestone:')).map(key => key.slice(10));
      request = () => pms.submitUpdate(modal.kpi.id, modal.month, { applicability: data.applicability, actual: data.actual, numerator: data.numerator, denominator: data.denominator, completed, note: data.note });
      done = 'Result submitted. Your approver has been notified to confirm it.';
    }
    if (modal.type === 'return') {
      request = () => pms.decideUpdate(modal.kpi.id, modal.month, 'return', data.reason);
      done = 'Update returned with your comment.';
    }
    if (modal.type === 'review') {
      request = () => pms.submitCycleAssessment(modal.reviewId, data);
      done = modal.employeeId === actorId ? 'Self-assessment submitted.' : 'Manager assessment submitted.';
    }
    if (modal.type === 'question') {
      request = () => pms.saveQuestions(fy, [...questions, { id: crypto.randomUUID(), text: data.text, type: data.type, required: data.required === 'on' }]);
      done = 'Question added. Reviews already launched keep their questionnaire.';
    }
    if (!request) return;
    const err = await perform(request, done);
    if (err) return setFormError(err);
    setModal(null);
    // Show the scorecard the KPI was just assigned to, even if the dropdown
    // was on someone else or the filters hide that person.
    if (modal.type === 'kpi' && data.employeeId && data.ownerType === 'Employee') {
      if (!people.some(e => e.id === data.employeeId)) { setQuery(''); setDepartment('All departments'); }
      setSelected(data.employeeId);
    }
  }
  async function launchReviews() {
    let created = 0;
    const ok = await act(async () => {
      const result = await pms.launchCycleReviews(fy, period, people.map(e => e.id));
      created = result.data?.result?.created ?? 0;
      return result;
    });
    if (ok) notify(created ? `${created} ${period} review${created === 1 ? '' : 's'} launched. Employees have been notified.` : `Everyone in this filter already has a ${period} review.`);
  }
  const openReview = r => setModal({ type: 'review', reviewId: r.id, employeeId: r.employeeId, title: r.status === 'Released' ? `${r.period} result · ${name(r.employeeId)}` : `${r.employeeId === actorId ? 'Self' : 'Manager'} assessment · ${name(r.employeeId)}` });

  return <div className="pms-workspace">
    <div className="pms-heading"><div><div className="pms-eyebrow">CREWCORE / PERFORMANCE</div><h1>Make progress meaningful.</h1><p>Align goals, recognise contributions, and make every review count.</p></div><button className="btn btn-outline" onClick={exportReport}>Export report ↗</button></div>
    <div className="pms-cycle-strip"><div className="pms-fy-switch"><button className="pms-text-button" aria-label="Previous financial year" disabled={busy} onClick={() => changeYear(fy - 1)}>‹</button><span><span className="pms-dot" /> {fyLabel}</span><button className="pms-text-button" aria-label="Next financial year" disabled={busy} onClick={() => changeYear(fy + 1)}>›</button><span className="pms-muted"> / Performance workspace</span></div><div className="pms-periods" aria-label="Reporting period">{['Q1', 'Q2', 'Q3', 'Q4', 'FY'].map(p => <button key={p} aria-pressed={p === period} onClick={() => { setPeriod(p); setMonth(periodMonths(p)[0]); }}>{p}</button>)}</div></div>
    <nav className="pms-navigation" aria-label="Performance sections">{sections.map(s => <button key={s} aria-current={section === s ? 'page' : undefined} onClick={() => { setSection(s); setMessage(''); }}>{s}{s === 'Approvals' && pending.length + workflowInbox.length > 0 && <span>{pending.length + workflowInbox.length}</span>}</button>)}</nav>
    <div className="pms-toolbar"><div><h2>{section}</h2><span>{period === 'FY' ? 'Full financial year' : `${MONTHS[months[0]]} – ${MONTHS[months.at(-1)]}`} · {fyLabel}</span></div><div className="pms-filters"><input aria-label="Search employees" placeholder="Search employees…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Filter department" value={department} onChange={e => setDepartment(e.target.value)}><option>All departments</option>{[...new Set(scoped.map(e => e.department))].sort().map(d => <option key={d}>{d}</option>)}</select></div></div>
    {message && <div className="pms-notice" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss notification">×</button></div>}
    {busy && <p className="pms-saving" role="status">Saving…</p>}

    {section === 'Overview' && <>
      <div className="pms-stats">{[['Scorecard coverage', `${coverage} / ${people.length}`, 'Employees with assigned KPIs'], ['Confirmed updates', `${confirmed} / ${expected}`, 'For the selected period'], ['Awaiting confirmation', submitted.length, 'Submitted monthly updates'], ['Released reviews', visibleReviews.filter(r => r.status === 'Released').length, 'Results shared with employees']].map(([label, value, detail]) => <div className="pms-stat" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</div>
      <div className="pms-two-columns"><section className="pms-panel"><div className="pms-panel-heading"><h3>Company priorities</h3><button className="pms-text-button" onClick={() => setSection(canManage ? 'Goals' : 'Scorecards')}>View goals →</button></div>{visibleGoals.some(g => g.scope === 'Company') ? visibleGoals.filter(g => g.scope === 'Company').map((g, i) => <div className="pms-goal-row" key={g.id}><span className="pms-index">{String(i + 1).padStart(2, '0')}</span><div><h4>{g.title}</h4><p>{g.description}</p><small>{g.scope} · {name(g.ownerId)}</small></div></div>) : <Empty title="Your goals start here">{isAdmin ? 'Define a company priority, then assign employee KPIs aligned to it.' : 'HR has not published company priorities for this year yet.'}</Empty>}</section>
      <section className="pms-panel pms-next"><div className="pms-eyebrow">NEXT CHECKPOINT</div><h3>{period} performance review</h3><p>Give every conversation a clear picture of progress.</p><ol><li><span>01</span> Confirm monthly KPI updates</li><li><span>02</span> Complete self and manager assessments</li><li><span>03</span> Approve and release results</li></ol>{sections.includes('Reviews') && <button className="btn btn-primary" onClick={() => setSection('Reviews')}>Open reviews →</button>}<small>Review deadline: {policy.deadline || 'not set'}</small></section></div>
      <section className="pms-panel"><div className="pms-panel-heading"><h3>People & progress</h3><button className="pms-text-button" onClick={() => setSection('Scorecards')}>Open scorecards →</button></div><PeopleTable people={people} scoreFor={scoreFor} reviewFor={reviewFor} onOpen={e => { setSelected(e.id); setSection('Scorecards'); }} /></section>
    </>}

    {section === 'Goals' && <AlignmentView goals={visibleGoals} kpis={state.kpis} name={name} canManage={canManage} busy={busy} onCreate={() => setModal({ type: 'goal', title: 'Create goal' })} onEdit={g => setModal({ type: 'editGoal', title: 'Edit goal', goal: g })} goalEditable={id => !goalProtected(state, id)} onDelete={askDeleteGoal} />}
    {section === 'Organisation' && <OrganisationScorecards goals={visibleGoals} allKpis={state.kpis} people={scoped} months={months} month={month} policy={policy} canManage={canManage} actorId={actorId} busy={busy} onMonthChange={setMonth} renderWorkflow={workflowPanel} editableKpi={editableKpi} isEditable={(type, id) => editableCard(state, cardKey(type, id))} onAssign={(ownerType, ownerId) => setModal({ type: 'kpi', title: `Assign ${ownerType.toLowerCase()} KPI`, ownerType, ownerId })} onUpdate={(kpi, m) => setModal({ type: 'update', title: `${MONTHS[m]} update: ${kpi.title}`, kpi, month: m })} onWeights={kpis => setModal({ type: 'weights', title: 'Edit scorecard weights', kpis, organisational: true })} onEdit={editKpi} onRemove={askRemoveKpi} name={name} />}
    {section === 'Target planning' && <TargetPlanning goals={visibleGoals} allKpis={state.kpis} name={name} busy={busy} editableKpi={editableKpi} goalEditable={id => !goalProtected(state, id) && !goalProtected(state, state.goals.find(g => g.id === id)?.parentId)} onGoalTarget={(g, target) => act(() => pms.updateGoalTarget(g.id, target, g.rowVersion), 'Goal target updated. Check allocation balances before approval.')} onPhase={(k, targets) => act(() => pms.updateKpiTargets(k.id, targets, k.rowVersion), 'Monthly targets saved. Draft achievement recalculated; released results stay frozen.')} />}

    {['Scorecards', 'Monthly updates'].includes(section) && <>
      <div className="pms-person-selector"><Field label="Employee"><select value={employee?.id || ''} onChange={e => setSelected(e.target.value)}><option value="" disabled>Select employee</option>{people.map(e => <option key={e.id} value={e.id}>{e.name} · {e.code}</option>)}</select></Field>{section === 'Monthly updates' && <Field label="Reporting month"><select value={month} onChange={e => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i}>{m} {i < 9 ? fy : fy + 1}</option>)}</select></Field>}{canManage && <button className="btn btn-primary" disabled={busy || !employee || employee.id === actorId && !isAdmin || !visibleGoals.length || !editableCard(state, cardKey('Employee', employee.id))} title={!visibleGoals.length ? 'Create a goal first — every KPI aligns to a goal.' : undefined} onClick={() => setModal({ type: 'kpi', title: 'Assign KPI' })}>+ Assign KPI</button>}</div>
      {employee ? <><div className="pms-person-card"><div className="pms-avatar">{employee.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</div><div><h3>{employee.name}</h3><p>{employee.designation} · {employee.department} · {employee.outlet}</p><small>Manager: {name(employee.managerId)} · {employee.code}</small></div><div className="pms-person-score"><strong>{percent(scoreFor(employee.id))}</strong><span>Confirmed KPI achievement</span></div></div>
      {workflowPanel('Employee', employee.id)}
      <ScorecardDetails kpis={employeeKpis} allKpis={state.kpis} goals={state.goals} months={months} month={month} policy={policy} canManage={canManage && employee.id !== actorId && employeeKpis.every(editableKpi)} mode={section} name={name} busy={busy} onEdit={editKpi} onRemove={askRemoveKpi} onWeights={() => setModal({ type: 'weights', title: 'Edit scorecard weights', kpis: employeeKpis })} onUpdate={(kpi, m) => setModal({ type: 'update', title: `${MONTHS[m]} update: ${kpi.title}`, kpi, month: m })} /></> : <Empty title="No employees to display">No active employees match these filters.</Empty>}
    </>}

    {['Reviews', 'Templates'].includes(section) && <ReviewHub key={actorId} view={section} hub={hub} directory={directory} actorId={actorId} isAdmin={isAdmin} busy={busy} perform={request => perform(request, null, { hubOnly: true })} />}
    {section === 'Reviews' && <><h2 className="pms-cycle-heading">Cycle appraisals</h2><div className="pms-section-intro"><p>Self reflection → manager assessment → HR release.</p>{canConfigure && <button className="btn btn-primary" disabled={busy || !people.length || !questions.length} onClick={launchReviews}>Launch {period} reviews ({people.length})</button>}</div>{visibleReviews.length ? visibleReviews.map(r => { const locked = cardRecord(state, cardKey('Employee', r.employeeId)).status === 'Locked'; return <section key={r.id} className="pms-panel pms-review-row"><div><h3>{name(r.employeeId)}</h3><p>{period} review · {r.questions.length} questions · Due {policy.deadline || 'not set'}</p></div><Badge>{r.status}</Badge><div className="pms-row-actions"><button className="btn btn-outline" onClick={() => openReview(r)}>{r.status === 'Released' ? 'View result' : 'Open assessment'}</button>{canConfigure && r.employeeId !== actorId && r.status === 'Manager submitted' && <button className="btn btn-primary" disabled={busy || !r.selfAnswers || scoreFor(r.employeeId) === null || !locked} title="A locked scorecard, self assessment and complete confirmed KPIs are required" onClick={() => act(() => pms.releaseCycleReview(r.id), 'Review released. The employee has been notified.')}>Release result</button>}</div></section>; }) : <Empty title="No reviews in this period">{canConfigure ? 'Launch reviews for the employees in the current filter.' : 'Reviews appear here once HR launches them.'}</Empty>}</>}

    {section === 'Templates' && <section className="pms-panel"><div className="pms-panel-heading"><div><div className="pms-eyebrow">SELF + MANAGER ASSESSMENT</div><h3>Quarterly performance conversation</h3><p>Cycle appraisal questionnaire: self + manager, using the PMS scoring policy. Independent reviews use the template library above. Reviews launched later receive a copy of this questionnaire.</p></div><button className="btn btn-primary" disabled={busy} onClick={() => setModal({ type: 'question', title: 'Add review question' })}>+ Add question</button></div>{questions.map((q, i) => <div className="pms-question-row" key={q.id}><span className="pms-index">{String(i + 1).padStart(2, '0')}</span><div><h4>{q.text}</h4><small>{q.type}{q.type === 'Rating' ? ' · 1–5 scale' : ''} · {q.required ? 'Required' : 'Optional'}</small></div><button className="btn btn-outline" disabled={busy || questions.length === 1} aria-label={`Remove question ${i + 1}`} onClick={() => act(() => pms.saveQuestions(fy, questions.filter(x => x.id !== q.id)), 'Question removed.')}>Remove</button></div>)}</section>}

    {section === 'Approvals' && <>{workflowInbox.map(([key, c]) => <div key={key}><h3>{c.type === 'Employee' ? name(c.ownerId) : c.ownerId} scorecard</h3>{workflowPanel(c.type, c.ownerId)}</div>)}{pending.length ? pending.map(item => <section className="pms-panel pms-review-row" key={`${item.kpi.id}-${item.month}`}><div><div className="pms-eyebrow">MONTHLY UPDATE · {MONTHS[item.month]}</div><h3>{item.kpi.title}</h3><p>{item.kpi.employeeId ? name(item.kpi.employeeId) : item.kpi.ownerId} · {item.applicability === 'N/A' ? 'N/A' : item.actual ?? '—'} / {item.kpi.target} {item.kpi.unit}</p><p>{item.note}</p><small>Submitted by {name(item.submittedBy)}</small></div><div className="pms-row-actions"><button className="btn btn-outline" disabled={busy} onClick={() => setModal({ type: 'return', title: 'Return update', kpi: item.kpi, month: item.month })}>Return</button><button className="btn btn-primary" disabled={busy} onClick={() => act(() => pms.decideUpdate(item.kpi.id, item.month, 'confirm'), 'Update confirmed. Achievement has been recalculated.')}>Confirm update</button></div></section>) : workflowInbox.length ? null : <Empty title="You’re all caught up">Submitted scorecards, change requests and monthly updates appear here. Your own records need another approver.</Empty>}</>}

    {section === 'Analytics' && <><div className="pms-notice">Analytics show confirmed KPI achievement, not final appraisal ratings. Missing inputs remain “Not rated”.</div><div className="pms-two-columns"><section className="pms-panel"><h3>Average employee achievement by department</h3>{[...new Set(people.map(e => e.department))].map(d => { const scores = people.filter(e => e.department === d).map(e => scoreFor(e.id)).filter(s => s !== null); const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null; return <div className="pms-chart-row" key={d}><div><span>{d}</span><strong>{percent(avg)}</strong></div><Meter value={avg} /><small>{scores.length} rated / {people.filter(e => e.department === d).length} employees</small></div>; })}</section><section className="pms-panel"><h3>Monthly confirmation coverage</h3><div className="pms-bar-chart">{MONTHS.map((m, i) => { const count = sourceKpis.filter(k => dueMonths(k, [i]).length && k.updates[i]?.status === 'Confirmed').length; const pct = sourceKpis.length ? count / sourceKpis.length * 100 : 0; return <div key={m}><span>{count}</span><div className="pms-bar-track"><div style={{ height: `${pct}%` }} /></div><small>{m}</small></div>; })}</div><p>Number of confirmed KPI updates. Empty months are not scored as zero.</p></section></div><section className="pms-panel"><h3>Employee breakdown</h3><PeopleTable people={people} scoreFor={scoreFor} reviewFor={reviewFor} onOpen={e => { setSelected(e.id); setSection('Scorecards'); }} /></section></>}

    {section === 'Settings' && <form className="pms-panel" onSubmit={async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget)); const year = Number(d.year); const ok = await act(() => pms.saveSettings(year, { kpiWeight: Number(d.kpiWeight), cap: Number(d.cap), deadline: d.deadline, reminders: d.reminders === 'on' }, settings.rowVersion), 'Performance policy saved.'); if (ok && year !== fy) changeYear(year); }}><div className="pms-panel-heading"><div><h3>Cycle & scoring policy</h3><p>Applies to every scorecard and review in {fyLabel}.</p></div><Badge>{policyLocked ? 'Frozen' : 'Editable'}</Badge></div><div className="pms-form-grid"><Field label="Default financial year (starts April)"><input name="year" type="number" min="2000" max="2100" required defaultValue={settings.savedYear ?? fy} /></Field><Field label="Review deadline"><input name="deadline" type="date" defaultValue={policy.deadline || ''} /></Field><Field label="KPI component weight (%)"><input name="kpiWeight" type="number" min="0" max="100" required disabled={policyLocked} defaultValue={policy.kpiWeight} /></Field><Field label="KPI achievement cap (%)"><input name="cap" type="number" min="100" max="200" required disabled={policyLocked} defaultValue={policy.cap} /></Field></div>{policyLocked && <><input type="hidden" name="kpiWeight" value={policy.kpiWeight} /><input type="hidden" name="cap" value={policy.cap} /></>}<label className="pms-checkbox"><input name="reminders" type="checkbox" defaultChecked={policy.reminders} /> Notify people in CrewCore when reviews open and results are released</label><div className="pms-policy-explain"><h4>How achievement is calculated</h4><p>Higher-is-better: actual ÷ target. Lower-is-better: 100% at or below target; otherwise target ÷ actual. Each KPI is capped, weighted within its KRA, then multiplied by the KRA scorecard weight. KRA weights and each KRA's KPI weights must total 100%. Only confirmed due periods count. Rates and averages aggregate underlying totals; snapshots use closing values.</p><p>Review mapping: ratings 1–5 → 60, 85, 100, 110, 120%. Self assessment is reference-only. Final result = {policy.kpiWeight}% KPI + {100 - policy.kpiWeight}% manager assessment.</p></div><p>{policyLocked ? 'Scoring weights are frozen for this year because a scorecard has been submitted or approved. The deadline and default year can still change.' : 'Scoring weights freeze once the first scorecard is submitted.'}</p><button className="btn btn-primary" type="submit" disabled={busy}>Save policy</button></form>}

    {modal && <Dialog title={modal.title} onClose={() => { setModal(null); setFormError(''); }}><form onSubmit={submitForm} className="pms-form">
      {formError && <div role="alert" className="pms-validation-error">{formError}</div>}
      {modal.type === 'confirm' && <p>{modal.text}</p>}
      {modal.type === 'workflow' && <><p>{modal.action.action === 'request' ? 'Describe the proposed target, weight or goal changes. The scorecard stays locked until the approver allows a revision. The revised plan must be submitted and approved again.' : 'Record the reason for this decision. Prior approval snapshots and released reviews are retained.'}</p><Field label="Reason for scorecard action"><textarea name="reason" required minLength={modal.action.action === 'request' ? 10 : 5} maxLength={2000} rows="4" autoFocus /></Field></>}
      {modal.type === 'explain' && <ScoreExplanation kpis={modal.kpis} allKpis={state.kpis} goals={state.goals} policy={policy} period={period} card={modal.card} review={modal.ownerType === 'Employee' ? reviewFor(modal.ownerId) : null} />}
      {modal.type === 'goal' && <GoalFields goals={visibleGoals} people={isAdmin ? directory : scoped} isAdmin={isAdmin} />}
      {modal.type === 'editGoal' && <GoalFields goals={visibleGoals} people={isAdmin ? directory : scoped} isAdmin={isAdmin} goal={modal.goal} />}
      {modal.type === 'editKpi' && <KpiFields people={people} directory={directory} goals={visibleGoals} allKpis={state.kpis} ownerType={modal.kpi.ownerType || 'Employee'} ownerId={modal.kpi.ownerId || modal.kpi.employeeId} kpi={modal.kpi} policy={modal.kpi.ownerType && modal.kpi.ownerType !== 'Employee' ? { ...policy, kpiWeight: 100 } : policy} />}
      {modal.type === 'kpi' && <KpiFields people={people.filter(p => isAdmin || p.id !== actorId)} directory={directory} employee={employee} goals={visibleGoals} allKpis={state.kpis} ownerType={modal.ownerType || 'Employee'} ownerId={modal.ownerId} policy={modal.ownerType && modal.ownerType !== 'Employee' ? { ...policy, kpiWeight: 100 } : policy} />}
      {modal.type === 'weights' && <WeightFields kpis={modal.kpis} policy={modal.organisational ? { ...policy, kpiWeight: 100 } : policy} />}
      {modal.type === 'update' && <MeasurementFields kpi={modal.kpi} month={modal.month} />}
      {modal.type === 'return' && <Field label="Reason for returning"><textarea name="reason" required minLength="5" maxLength="2000" rows="4" autoFocus /></Field>}
      {modal.type === 'question' && <><Field label="Question"><textarea name="text" required maxLength="500" rows="3" autoFocus /></Field><Field label="Answer type"><select name="type"><option>Rating</option><option>Text</option><option>Number</option><option>Yes / No</option></select></Field><label className="pms-checkbox"><input type="checkbox" name="required" defaultChecked /> Required answer</label></>}
      {modal.type === 'review' && <ReviewForm review={reviewFor(modal.employeeId)} self={modal.employeeId === actorId} kpiScore={scoreFor(modal.employeeId)} policy={policy} />}
      <div className="pms-dialog-footer"><button type="button" className="btn btn-outline" onClick={() => { setModal(null); setFormError(''); }}>Close</button>{modal.type !== 'explain' && !(modal.type === 'review' && reviewLocked(reviewFor(modal.employeeId), modal.employeeId === actorId)) && <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : modal.type === 'confirm' ? 'Confirm' : ['review', 'update'].includes(modal.type) ? 'Submit' : 'Save'}</button>}</div>
    </form></Dialog>}
  </div>;
}

function PeopleTable({ people, scoreFor, reviewFor, onOpen }) {
  return people.length ? <div className="pms-table-wrap"><table className="pms-table"><thead><tr><th>Employee</th><th>Department</th><th>KPI achievement</th><th>Review</th><th><span className="pms-sr-only">Action</span></th></tr></thead><tbody>{people.map(e => <tr key={e.id}><td><strong>{e.name}</strong><small>{e.designation} · {e.code}</small></td><td>{e.department}</td><td>{percent(scoreFor(e.id))}</td><td><Badge>{reviewFor(e.id)?.status || 'Not started'}</Badge></td><td><button className="pms-text-button" onClick={() => onOpen(e)} aria-label={`Open scorecard for ${e.name}`}>View →</button></td></tr>)}</tbody></table></div> : <Empty title="No matching employees">Try another search or department filter.</Empty>;
}

// Self → manager → HR release, enforced by pms_submit_cycle_assessment.
function reviewLocked(review, self) {
  if (!review || review.status === 'Released') return true;
  return self ? review.status === 'Manager submitted' : !review.selfAnswers;
}
const RATING_LABELS = { 1: 'Below expectations', 2: 'Developing', 3: 'Meets expectations', 4: 'Exceeds expectations', 5: 'Exceptional' };

function ReviewForm({ review, self, kpiScore, policy }) {
  if (!review) return <p>This review is no longer available. Close and reload the page.</p>;
  const released = review.status === 'Released';
  const locked = reviewLocked(review, self);
  const qs = review.questions;
  const answers = (self ? review.selfAnswers : review.managerAnswers) || {};
  const ratings = qs.filter(q => q.type === 'Rating').map(q => Number(review.managerAnswers?.[q.id])).filter(n => n >= 1 && n <= 5);
  const reviewScore = ratings.length ? ratings.reduce((n, r) => n + [0, 60, 85, 100, 110, 120][r], 0) / ratings.length : null;
  const usedPolicy = released && review.releasedPolicy ? review.releasedPolicy : policy;
  const usedKpi = released ? review.releasedKpi : kpiScore;
  const final = usedKpi !== null && reviewScore !== null ? usedKpi * usedPolicy.kpiWeight / 100 + reviewScore * (100 - usedPolicy.kpiWeight) / 100 : null;
  return <><div className="pms-notice">{released ? `Released result: ${percent(final)}` : self ? (locked ? 'Your manager has assessed this review, so your answers are locked. Your final result appears here once HR releases it.' : 'Your self-assessment is shared with your manager. Your final result appears here once HR releases it.') : locked ? 'Waiting for the employee’s self-assessment. You can submit the manager assessment once it arrives.' : 'Manager assessment. Final results require confirmed KPI inputs and HR release.'}</div>{qs.map(q => <Field key={q.id} label={`${q.text}${q.required ? ' *' : ''}`}>{q.type === 'Text' ? <textarea name={q.id} rows="3" maxLength="4000" required={q.required} defaultValue={answers[q.id] || ''} disabled={locked} /> : q.type === 'Number' ? <input name={q.id} type="number" step="any" required={q.required} defaultValue={answers[q.id] || ''} disabled={locked} /> : <select name={q.id} required={q.required} defaultValue={answers[q.id] || ''} disabled={locked}><option value="">Select answer</option>{(q.type === 'Rating' ? ['1', '2', '3', '4', '5'] : ['Yes', 'No']).map(v => <option key={v} value={v}>{RATING_LABELS[v] ? `${v} · ${RATING_LABELS[v]}` : v}</option>)}</select>}{!self && review.selfAnswers?.[q.id] && <small>Self assessment: {review.selfAnswers[q.id]}</small>}{self && released && review.managerAnswers?.[q.id] && <small>Manager assessment: {review.managerAnswers[q.id]}{RATING_LABELS[review.managerAnswers[q.id]] && q.type === 'Rating' ? ` · ${RATING_LABELS[review.managerAnswers[q.id]]}` : ''}</small>}</Field>)}{released && <p>KPI {percent(usedKpi)} × {usedPolicy.kpiWeight}% + manager {percent(reviewScore)} × {100 - usedPolicy.kpiWeight}%.</p>}</>;
}
