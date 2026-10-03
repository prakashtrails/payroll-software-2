import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { REVIEW_TYPES, SUBJECT_TYPES, QUESTION_TYPES, newQuestion, validateTemplate, validateAnswers, reviewerRole, today } from './reviewModel';
import { archiveTemplate, campaignAction, createCampaign, saveTemplate as saveTemplateRpc } from '@/services/pmsService';

function Field({ label, children }) {
  const id = useId();
  return <div className="pms-field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>;
}
function Modal({ title, children, close }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => { const node = ref.current; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={ref} className="pms-dialog pms-review-dialog" aria-labelledby={id} onCancel={close}><div className="pms-dialog-heading"><h2 id={id}>{title}</h2><button type="button" className="btn btn-outline" aria-label="Close review dialog" onClick={close}>×</button></div>{children}</dialog>;
}
function Tag({ children }) { return <span className="pms-badge">{children}</span>; }

// perform(request, successMessage) runs one PMS RPC, applies the returned
// workspace and resolves to an error message (or null on success).
export default function ReviewHub({ view, hub, directory, actorId, isAdmin, perform, busy }) {
  const [tab, setTab] = useState('Campaigns');
  const [filter, setFilter] = useState('All types');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const show = value => { setError(''); setModal(value); };
  const close = () => { setModal(null); setError(''); };
  const DONE = { save: 'Response draft saved.', submit: 'Response submitted.', release: 'Results released to the recipient.', launch: 'Review launched. Reviewers have been notified.', return: 'Response returned to the reviewer.', extend: 'Deadline extended.', cancel: 'Review cancelled.' };
  const finish = (err, message) => { if (err) { setError(err); return; } close(); setNotice(message); };
  const run = async (c, action, extra = {}) => {
    if (action === 'submit') {
      try { validateAnswers(c.template, extra.answers || {}); } catch (e) { setError(e.message); return; }
    }
    finish(await perform(() => campaignAction(c.id, action, extra)), DONE[action]);
  };
  const editTemplate = template => {
    const copy = structuredClone(template);
    if (copy.status !== 'Draft') {
      copy.version = Math.max(...hub.templates.filter(t => t.family === copy.family).map(t => t.version)) + 1;
      copy.status = 'Draft';
    }
    show({ type: 'template', template: copy });
  };
  const saveTemplate = async (template, publish) => {
    try {
      if (publish) validateTemplate(template);
      else if (!template.title.trim()) throw new Error('Give the template a name.');
    } catch (e) { setError(e.message); return; }
    finish(await perform(() => saveTemplateRpc({ ...template, title: template.title.trim() }, publish)),
      publish ? 'Template published. Existing campaigns keep their original version.' : 'Template draft saved.');
  };
  const archive = async t => {
    const err = await perform(() => archiveTemplate(t.id));
    if (err) setError(err); else setNotice(`${t.title} v${t.version} archived. Existing campaigns are unaffected.`);
  };
  const campaigns = hub.campaigns;  // already filtered and redacted per caller by pms_workspace()
  const tasks = campaigns.flatMap(c => c.assignments.filter(a => a.own && !['Draft', 'Cancelled'].includes(c.status)).map(a => ({ c, a })));
  const results = campaigns.filter(c => c.status === 'Released' && (isAdmin || c.recipientId === actorId));
  const shownTemplates = hub.templates.filter(t => (filter === 'All types' || t.type === filter) && `${t.title} ${t.description}`.toLowerCase().includes(search.toLowerCase()));
  const name = id => directory.find(e => e.id === id)?.name || 'Former employee';
  const reviewerLabel = a => a.reviewerName || (a.reviewerId ? name(a.reviewerId) : 'Confidential reviewer');
  const activeCampaign = modal?.campaignId && hub.campaigns.find(c => c.id === modal.campaignId);

  return <div className="pms-review-hub">
    <div className="pms-panel-heading"><div><div className="pms-eyebrow">{view === 'Templates' ? 'REUSABLE QUESTIONNAIRES' : 'INDEPENDENT REVIEWS'}</div><h2>{view === 'Templates' ? 'Review template library' : 'Review centre'}</h2><p>{view === 'Templates' ? 'Build, publish and version questionnaires for different conversations.' : 'Collect feedback outside the appraisal cycle. Results do not change KPI or annual scores.'}</p></div>{isAdmin && <button className="btn btn-primary" disabled={busy} onClick={() => view === 'Templates' ? show({ type: 'template', template: { version: 1, status: 'Draft', title: '', description: '', type: 'Custom', scored: false, questions: [newQuestion()] } }) : show({ type: 'campaign' })}>{view === 'Templates' ? 'Create template' : 'Create independent review'}</button>}</div>
    {notice && <p className="pms-notice" role="status">{notice}</p>}
    {error && !modal && <p className="pms-notice" role="alert">{error}</p>}
    {view === 'Templates' ? <>
      <div className="pms-review-filters"><Field label="Find templates"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search template names" /></Field><Field label="Review type"><select value={filter} onChange={e => setFilter(e.target.value)}>{['All types', ...REVIEW_TYPES].map(x => <option key={x}>{x}</option>)}</select></Field></div>
      <div className="pms-template-grid">{shownTemplates.map(t => <article className="pms-panel pms-template-card" key={t.id}><div className="pms-row-actions"><Tag>{t.type}</Tag><Tag>{t.status} · v{t.version}</Tag></div><h3>{t.title}</h3><p>{t.description}</p><small>{t.questions.length} question{t.questions.length === 1 ? '' : 's'} · {t.scored ? 'Weighted rating score' : 'Feedback only'}</small><div className="pms-row-actions"><button className="btn btn-outline" onClick={() => show({ type: 'preview', template: t })}>Preview</button>{isAdmin && <><button className="btn btn-outline" onClick={() => editTemplate(t)}>{t.status === 'Draft' ? 'Edit draft' : 'Create revision'}</button>{t.status !== 'Archived' && <button className="btn btn-outline" disabled={busy} onClick={() => archive(t)}>Archive</button>}</>}</div></article>)}</div>{!shownTemplates.length && <p className="pms-empty">No templates match these filters.</p>}
    </> : <>
      <div className="pms-review-tabs" role="group" aria-label="Independent review views">{['Campaigns', 'My tasks', 'Results'].map(x => <button key={x} className={`btn ${tab === x ? 'btn-primary' : 'btn-outline'}`} aria-pressed={tab === x} onClick={() => setTab(x)}>{x}{x === 'My tasks' ? ` (${tasks.filter(t => t.a.status !== 'Submitted').length})` : ''}</button>)}</div>
      <p className="pms-review-help">This centre uses its own audience and dates; the appraisal filters above do not change these reviews. HR launches each review; reviewers are notified in CrewCore when it opens.</p>
      {tab === 'Campaigns' && <>{campaigns.map(c => <article key={c.id} className="pms-panel pms-campaign-card"><div><h3>{c.title}</h3><p>{c.subject.type}: {c.subject.name} · {c.template.type} · {c.template.title} v{c.template.version}</p><small>{c.start} → {c.end} · {c.assignments.filter(a => a.status === 'Submitted').length}/{c.assignments.length} submitted · {c.visibility} · {c.template.scored ? 'Separate review score' : 'Feedback only'}</small></div><div className="pms-row-actions"><Tag>{c.status === 'Active' && today() > c.end ? 'Overdue' : c.status}</Tag><button className="btn btn-outline" onClick={() => show({ type: 'detail', campaignId: c.id })}>View campaign</button>{isAdmin && c.status === 'Draft' && <button className="btn btn-primary" disabled={busy} onClick={() => run(c, 'launch')}>Launch review</button>}{isAdmin && c.status === 'Active' && <button className="btn btn-primary" disabled={busy || c.assignments.some(a => a.status !== 'Submitted') || c.recipientId === actorId} onClick={() => run(c, 'release')}>Release results</button>}</div></article>)}{!campaigns.length && <p className="pms-empty">No independent reviews yet. HR can create one from a published template.</p>}</>}
      {tab === 'My tasks' && <>{tasks.map(({ c, a }) => <article key={a.id} className="pms-panel pms-campaign-card"><div><h3>{c.title}</h3><p>Review {c.subject.name} · Your perspective: {a.role} · Due {c.end}</p><small>{c.visibility === 'Confidential' ? 'HR can identify you. Your name is hidden from the result recipient.' : 'Your name is visible alongside your response after release.'}</small>{a.reason && <p>Returned: {a.reason}</p>}</div><div className="pms-row-actions"><Tag>{a.status}</Tag><button className="btn btn-outline" onClick={() => show({ type: 'response', campaignId: c.id, assignmentId: a.id })}>{a.status === 'Submitted' ? 'View my response' : 'Open review'}</button></div></article>)}{!tasks.length && <p className="pms-empty">No review tasks assigned to you.</p>}</>}
      {tab === 'Results' && <>{results.map(c => <article key={c.id} className="pms-panel pms-campaign-card"><div><h3>{c.title}</h3><p>{c.subject.name} · Released {new Date(c.releasedAt).toLocaleDateString()} · {c.template.scored ? 'Separate review score' : 'Feedback only'}</p></div><button className="btn btn-outline" onClick={() => show({ type: 'results', campaignId: c.id })}>Read results</button></article>)}{!results.length && <p className="pms-empty">Results appear here after HR releases them to you.</p>}</>}
    </>}
    {modal && <Modal title={{ template: 'Template builder', preview: 'Template preview', campaign: 'Create independent review', response: 'Review response', detail: 'Campaign details', results: 'Released results', reason: 'Reason required' }[modal.type]} close={close}>
      {error && <p className="pms-notice" role="alert">{error}</p>}
      {modal.type === 'template' && <TemplateBuilder initial={modal.template} save={saveTemplate} busy={busy} />}
      {modal.type === 'preview' && <TemplatePreview template={modal.template} />}
      {modal.type === 'campaign' && <CampaignForm templates={hub.templates} directory={directory} busy={busy} save={async payload => finish(await perform(() => createCampaign(payload)), 'Campaign draft created. Launch it to open reviewer tasks.')} />}
      {modal.type === 'response' && activeCampaign && <ResponseForm campaign={activeCampaign} assignment={activeCampaign.assignments.find(a => a.id === modal.assignmentId)} busy={busy} act={(action, answers) => run(activeCampaign, action, { assignmentId: modal.assignmentId, answers })} />}
      {modal.type === 'results' && activeCampaign && <Results campaign={activeCampaign} />}
      {modal.type === 'detail' && activeCampaign && <><p>{activeCampaign.subject.type}: <strong>{activeCampaign.subject.name}</strong></p><p>Recipient: {name(activeCampaign.recipientId)} · {activeCampaign.visibility}. HR sees named responses; the recipient sees results after release.</p><p>{activeCampaign.template.scored ? 'Rating questions are weighted within each response; perspectives remain separate.' : 'Feedback only; no score is calculated.'}</p><p>No contribution to the quarterly or annual PMS score.</p>{activeCampaign.cancelReason && <p>Cancelled: {activeCampaign.cancelReason}</p>}
        {activeCampaign.assignments.filter(a => isAdmin || (activeCampaign.visibility === 'Named' && activeCampaign.status === 'Released') || a.reviewerId === actorId).map(a => <div className="pms-review-assignment" key={a.id}><span>{reviewerLabel(a)} · {a.role || 'Reviewer'} · {a.status}</span>{isAdmin && activeCampaign.status === 'Active' && a.status === 'Submitted' && a.reviewerId !== actorId && <button className="btn btn-outline" disabled={busy} onClick={() => show({ type: 'reason', campaignId: activeCampaign.id, assignmentId: a.id, action: 'return' })}>Return response</button>}</div>)}
        {isAdmin && <details><summary>Submitted responses (HR only)</summary><Results campaign={activeCampaign} /></details>}
        {isAdmin && ['Draft', 'Active'].includes(activeCampaign.status) && <button className="btn btn-outline" onClick={() => show({ type: 'reason', campaignId: activeCampaign.id, action: 'extend' })}>Extend deadline</button>}
        {isAdmin && ['Draft', 'Active'].includes(activeCampaign.status) && <button className="btn btn-outline" onClick={() => show({ type: 'reason', campaignId: activeCampaign.id, action: 'cancel' })}>Cancel campaign</button>}
        {isAdmin && <details><summary>Activity history ({activeCampaign.history.length})</summary>{activeCampaign.history.map((h, i) => <p key={i}>{new Date(h.at).toLocaleString()} · {name(h.actorId)} · {h.action}{h.reason ? ` · ${h.reason}` : ''}</p>)}</details>}
      </>}
      {modal.type === 'reason' && <form onSubmit={e => { e.preventDefault(); run(activeCampaign, modal.action, { assignmentId: modal.assignmentId, reason: new FormData(e.currentTarget).get('reason'), end: new FormData(e.currentTarget).get('end') }); }}><Field label="Reason"><textarea name="reason" required rows={3} maxLength={2000} /></Field>{modal.action === 'extend' && <Field label="New deadline"><input type="date" name="end" required min={activeCampaign.end} /></Field>}<div className="pms-dialog-footer"><button className="btn btn-primary" disabled={busy}>Confirm {modal.action}</button></div></form>}
    </Modal>}
  </div>;
}

function TemplateBuilder({ initial, save, busy }) {
  const [t, setT] = useState(initial);
  const patch = value => setT(x => ({ ...x, ...value }));
  const question = (id, value) => patch({ questions: t.questions.map(q => q.id === id ? { ...q, ...value } : q) });
  return <form onSubmit={e => { e.preventDefault(); save(t, true); }}>
    <p>Version {t.version} · Publishing freezes the questionnaire for new campaigns. Subsequent changes create a new version.</p>
    <div className="pms-form-grid"><Field label="Template name"><input required value={t.title} onChange={e => patch({ title: e.target.value })} /></Field><Field label="Template type"><select value={t.type} onChange={e => patch({ type: e.target.value })}>{REVIEW_TYPES.map(x => <option key={x}>{x}</option>)}</select></Field></div>
    <Field label="Description"><textarea value={t.description} onChange={e => patch({ description: e.target.value })} rows={2} /></Field>
    <label className="pms-review-check"><input type="checkbox" checked={t.scored} onChange={e => patch({ scored: e.target.checked })} />Calculate a separate review score</label>
    <p className="pms-review-help">Only rating questions contribute. 1 → 60%, 2 → 85%, 3 (meets) → 100%, 4 → 110%, 5 → 120%. Optional unanswered / N/A ratings are excluded and remaining weights renormalized. No rated answers means “Not rated”.</p>
    {t.questions.map((q, i) => <fieldset className="pms-question-editor" key={q.id}><legend>Question {i + 1}</legend><Field label={`Question ${i + 1} text`}><textarea required rows={2} value={q.text} onChange={e => question(q.id, { text: e.target.value })} /></Field><div className="pms-form-grid"><Field label={`Question ${i + 1} type`}><select value={q.type} onChange={e => question(q.id, { type: e.target.value, weight: e.target.value === 'Rating' ? 100 : 0 })}>{QUESTION_TYPES.map(x => <option key={x}>{x}</option>)}</select></Field>{t.scored && q.type === 'Rating' && <Field label={`Question ${i + 1} weight (%)`}><input type="number" min="0.01" max="100" step="0.01" value={q.weight} onChange={e => question(q.id, { weight: Number(e.target.value) })} /></Field>}</div>{q.type === 'Choice' && <Field label={`Question ${i + 1} options (one per line)`}><textarea value={q.options} onChange={e => question(q.id, { options: e.target.value })} /></Field>}<div className="pms-row-actions"><label className="pms-review-check"><input type="checkbox" checked={q.required} onChange={e => question(q.id, { required: e.target.checked })} />Required</label><button type="button" className="btn btn-outline" disabled={!i} onClick={() => { const next = [...t.questions]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; patch({ questions: next }); }}>Move up</button><button type="button" className="btn btn-outline" onClick={() => patch({ questions: t.questions.filter(x => x.id !== q.id) })}>Remove question</button></div></fieldset>)}
    <button type="button" className="btn btn-outline" onClick={() => patch({ questions: [...t.questions, newQuestion()] })}>Add template question</button><div className="pms-dialog-footer"><button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(t, false)}>Save draft</button><button className="btn btn-primary" disabled={busy}>Publish template</button></div>
  </form>;
}

function TemplatePreview({ template }) {
  return <><h3>{template.title} · v{template.version}</h3><p>{template.description}</p><Tag>{template.scored ? 'Separate rating score' : 'Feedback only'}</Tag>{template.questions.map((q, i) => <div className="pms-review-answer" key={q.id}><h4>{i + 1}. {q.text}</h4><p>{q.type} · {q.required ? 'Required' : 'Optional'}{template.scored && q.type === 'Rating' ? ` · ${q.weight}% weight` : ''}</p>{q.type === 'Choice' && <p>{q.options.split('\n').join(' / ')}</p>}</div>)}</>;
}

function CampaignForm({ templates, directory, save, busy }) {
  const published = templates.filter(t => t.status === 'Published');
  const [templateId, setTemplateId] = useState(published[0]?.id || '');
  const [subjectType, setSubjectType] = useState('Employee');
  const [subjectId, setSubjectId] = useState(directory[0]?.id || '');
  const [reviewers, setReviewers] = useState([]);
  const template = published.find(t => t.id === templateId);
  const departments = [...new Set(directory.map(e => e.department).filter(Boolean))];
  const subjectEmployee = directory.find(e => e.id === subjectId);
  return <form onSubmit={e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget));
    const subject = subjectType === 'Employee' ? { ...subjectEmployee, type: subjectType } : { type: subjectType, id: d.subjectName, name: d.subjectName?.trim(), department: subjectType === 'Department' ? d.subjectName : d.subjectDepartment };
    save({ title: d.campaignTitle, templateId: template?.id, subject: { type: subject.type, id: subject.id, name: subject.name, department: subject.department }, reviewerIds: reviewers, recipientId: subjectType === 'Employee' ? subjectId : d.recipientId, start: d.start, end: d.end, visibility: d.visibility });
  }}>
    <div className="pms-form-grid"><Field label="Review name"><input name="campaignTitle" required placeholder="e.g. Sales and Operations handoff" /></Field><Field label="Published template"><select value={templateId} onChange={e => setTemplateId(e.target.value)} required>{published.map(t => <option key={t.id} value={t.id}>{t.title} · v{t.version}</option>)}</select></Field><Field label="Subject type"><select value={subjectType} onChange={e => { setSubjectType(e.target.value); setReviewers([]); }}>{SUBJECT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
      {subjectType === 'Employee' ? <Field label="Employee being reviewed"><select value={subjectId} onChange={e => { setSubjectId(e.target.value); setReviewers([]); }} required>{directory.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field> : <><Field label={`${subjectType} name`}>{subjectType === 'Department' ? <select name="subjectName" required>{departments.map(d => <option key={d}>{d}</option>)}</select> : <input name="subjectName" required />}</Field>{subjectType !== 'Department' && <Field label="Owning department"><select name="subjectDepartment" required>{departments.map(d => <option key={d}>{d}</option>)}</select></Field>}<Field label="Result recipient"><select name="recipientId" required>{directory.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field></>}
      <Field label="Start date"><input type="date" name="start" required defaultValue={today()} /></Field><Field label="End date"><input type="date" name="end" required defaultValue={`${new Date().getFullYear()}-12-31`} /></Field><Field label="Response visibility"><select name="visibility"><option>Named</option><option>Confidential</option></select></Field>
    </div><p>{template?.description}</p><p className="pms-review-help">{template?.scored ? 'This template calculates a separate review score.' : 'Feedback only.'} HR can see reviewer identities. Confidential hides names from the recipient; wording and small groups may still identify someone. This is not anonymous collection.</p>
    <fieldset className="pms-question-editor"><legend>Assign reviewers ({reviewers.length})</legend><p>Select people with the appropriate relationship. 360 reviews keep each perspective separate.</p><div className="pms-review-people">{directory.map(e => <label className="pms-review-check" key={e.id}><input type="checkbox" checked={reviewers.includes(e.id)} onChange={event => setReviewers(ids => event.target.checked ? [...ids, e.id] : ids.filter(id => id !== e.id))} />{e.name} <small>{e.department}{subjectType === 'Employee' && subjectEmployee && template ? ` · ${reviewerRole(template.type, { ...subjectEmployee, type: 'Employee' }, e)}` : ''}</small></label>)}</div></fieldset>
    <div className="pms-dialog-footer"><button className="btn btn-primary" disabled={busy || !published.length || !directory.length}>Create review draft</button></div>
  </form>;
}

function ResponseForm({ campaign, assignment, act, busy }) {
  const [answers, setAnswers] = useState(assignment.answers || {});
  const readOnly = assignment.status === 'Submitted' || campaign.status !== 'Active' || today() < campaign.start || today() > campaign.end;
  return <form onSubmit={e => { e.preventDefault(); act('submit', answers); }}><h3>{campaign.title}</h3><p>About {campaign.subject.name} · {assignment.role} perspective · {campaign.template.title} v{campaign.template.version}</p><p>{campaign.visibility === 'Confidential' ? 'Confidential: HR knows your identity. Your name is hidden from the recipient after release.' : 'Named: the recipient can see your name and answers after release.'}</p>{readOnly && <p className="pms-notice">This response is read-only.</p>}{campaign.template.questions.map(q => <Field label={`${q.text}${q.required ? ' *' : ' (optional)'}`} key={q.id}>{q.type === 'Text' ? <textarea rows={3} required={q.required} disabled={readOnly} value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} /> : q.type === 'Number' ? <input type="number" step="any" required={q.required} disabled={readOnly} value={answers[q.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} /> : <select required={q.required} disabled={readOnly} value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}><option value="">Choose an answer</option>{(q.type === 'Rating' ? ['1', '2', '3', '4', '5', ...(!q.required ? ['N/A'] : [])] : q.options.split('\n').map(x => x.trim()).filter(Boolean)).map(x => <option key={x}>{x}</option>)}</select>}</Field>)}{assignment.reason && assignment.status === 'Returned' && <p className="pms-return-reason">Returned by HR: {assignment.reason}</p>}{!readOnly && <div className="pms-dialog-footer"><button type="button" className="btn btn-outline" disabled={busy} onClick={() => act('save', answers)}>Save response draft</button><button className="btn btn-primary" disabled={busy}>Submit response</button></div>}</form>;
}

function Results({ campaign }) {
  const submitted = campaign.assignments.filter(a => a.status === 'Submitted');
  return <><h3>{campaign.title}</h3><p>{campaign.subject.name} · {campaign.template.scored ? 'Separate review scores; no effect on PMS totals.' : 'Feedback only; no performance score.'}</p>{!submitted.length && <p>No submitted responses yet.</p>}{submitted.map((a, i) => <section className="pms-review-answer" key={a.id}><h4>{a.reviewerName ? `${a.reviewerName} · ${a.role}` : `Confidential response ${i + 1}`}</h4>{campaign.template.scored && <p>Review score: <strong>{a.score == null ? 'Not rated' : `${Number(a.score).toFixed(2)}%`}</strong></p>}{campaign.template.questions.map(q => <div key={q.id}><strong>{q.text}</strong><p className="pms-review-response-text">{a.answers?.[q.id] || 'No response'}</p></div>)}</section>)}</>;
}
