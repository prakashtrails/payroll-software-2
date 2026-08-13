import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listReviewCycles, createReviewCycle, listReviewQuestions, addReviewQuestion, deleteReviewQuestion,
  listMyReviews, listReviewsGivenToOthers, listAllReviews, startReview, bulkStartReviews, getReviewDetail,
  submitReviewAnswer, submitReviewKraRating, completeReview,
} from '@/services/reviewService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName } from '@/lib/helpers';

function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div style={{ background: 'var(--border)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--success)' : 'var(--primary)' }} />
    </div>
  );
}

function ReviewRow({ r, onOpen }) {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => onOpen(r)}>
      <div>
        <strong>{r.cycle?.name}</strong>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fullName(r.employee)} · Manager: {r.reporting_manager ? fullName(r.reporting_manager) : '—'}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {r.overall_rating != null && <span><i className="fas fa-star" style={{ color: '#f5a623' }} /> {Number(r.overall_rating).toFixed(2)}/5</span>}
        <span className={`badge ${r.status === 'Completed' ? 'badge-success' : r.status === 'In Progress' ? 'badge-info' : 'badge-secondary'}`}>{r.status}</span>
        <button className="btn btn-outline btn-sm">View review form</button>
      </div>
    </div>
  );
}

export function ReviewsContent() {
  const { tenant, profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin';
  const canManageReview = (r) => isAdmin || r.reporting_manager_id === profile.id;

  const [topTab, setTopTab] = useState('my');
  const [myReviews, setMyReviews] = useState([]);
  const [givenReviews, setGivenReviews] = useState([]);
  const [allReviews, setAllReviews] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showCycleModal, setShowCycleModal] = useState(false);
  const [cycleForm, setCycleForm] = useState({ name: '', start_date: '', end_date: '' });
  const [savingCycle, setSavingCycle] = useState(false);

  const [expandedCycle, setExpandedCycle] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [startForm, setStartForm] = useState({ profile_id: '', reporting_manager_id: '' });

  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('questions');
  const [answerDraft, setAnswerDraft] = useState({});
  const [kraRatingDraft, setKraRatingDraft] = useState({});
  const [overallRating, setOverallRating] = useState('');

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    setLoading(true);
    try {
      const [myRes, givenRes, cycleRes] = await Promise.all([
        listMyReviews(tenant.id, profile.id),
        listReviewsGivenToOthers(tenant.id, profile.id),
        listReviewCycles(tenant.id),
      ]);
      setMyReviews(myRes.data || []);
      setGivenReviews(givenRes.data || []);
      setCycles(cycleRes.data || []);
      if (isAdmin) {
        const [{ data: allData }, { data: empData }] = await Promise.all([
          listAllReviews(tenant.id),
          listActiveEmployees(tenant.id),
        ]);
        setAllReviews(allData || []);
        setEmployees(empData || []);
      }
    } finally {
      setLoading(false);
    }
  }, [tenant, profile, isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveCycle = async () => {
    if (!cycleForm.name.trim()) return showToast('Cycle name is required', 'error');
    if (!cycleForm.start_date || !cycleForm.end_date) return showToast('Start and end dates are required', 'error');
    setSavingCycle(true);
    try {
      const { error } = await createReviewCycle({
        tenantId: tenant.id, name: cycleForm.name.trim(),
        startDate: cycleForm.start_date, endDate: cycleForm.end_date, createdBy: profile.id,
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Review cycle created', 'success');
      setShowCycleModal(false);
      setCycleForm({ name: '', start_date: '', end_date: '' });
      fetchData();
    } finally {
      setSavingCycle(false);
    }
  };

  const openCycle = async (cycle) => {
    setExpandedCycle(cycle);
    setStartForm({ profile_id: '', reporting_manager_id: '' });
    const { data } = await listReviewQuestions(cycle.id);
    setQuestions(data || []);
  };

  const saveQuestion = async () => {
    if (!newQuestion.trim()) return;
    const { error } = await addReviewQuestion({ tenantId: tenant.id, cycleId: expandedCycle.id, questionText: newQuestion.trim(), orderIndex: questions.length });
    if (error) return showToast('Failed: ' + error.message, 'error');
    setNewQuestion('');
    const { data } = await listReviewQuestions(expandedCycle.id);
    setQuestions(data || []);
  };

  const removeQuestion = async (id) => {
    const { error } = await deleteReviewQuestion(id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    const { data } = await listReviewQuestions(expandedCycle.id);
    setQuestions(data || []);
  };

  const doStartReview = async () => {
    if (!startForm.profile_id) return showToast('Select an employee', 'error');
    const { error } = await startReview({
      tenantId: tenant.id, cycleId: expandedCycle.id,
      profileId: startForm.profile_id, reportingManagerId: startForm.reporting_manager_id || null,
    });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Review started', 'success');
    setStartForm({ profile_id: '', reporting_manager_id: '' });
    fetchData();
  };

  const doBulkStart = async () => {
    if (!confirm(`Start this review cycle for all ${employees.length} employees?`)) return;
    const { count, error } = await bulkStartReviews({
      tenantId: tenant.id, cycleId: expandedCycle.id,
      profiles: employees.map((e) => ({ profile_id: e.id, manager_id: e.manager_id })),
    });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast(`Cycle applied to ${count} employees`, 'success');
    fetchData();
  };

  const openReview = async (r) => {
    setDetailTab('questions');
    setAnswerDraft({});
    setKraRatingDraft({});
    setOverallRating(r.overall_rating ?? '');
    const { data, error } = await getReviewDetail(r.id);
    if (error) return showToast('Failed to load review', 'error');
    setDetail(data);
  };

  const refreshDetail = async () => {
    const { data } = await getReviewDetail(detail.review.id);
    setDetail(data);
    fetchData();
  };

  const iAmSelf = detail && detail.review.profile_id === profile.id;
  const iAmManager = detail && (detail.review.reporting_manager_id === profile.id || isAdmin);
  const readOnly = detail && detail.review.status === 'Completed';

  const saveAnswer = async (questionId, who) => {
    const key = `${questionId}_${who}`;
    const draft = answerDraft[key] || {};
    const answeredBy = who === 'self' ? detail.review.profile_id : detail.review.reporting_manager_id;
    if (!answeredBy) return showToast('No reporting manager set for this review', 'error');
    const { error } = await submitReviewAnswer({
      reviewId: detail.review.id, questionId, answeredBy,
      rating: draft.rating ?? existingAnswer(questionId, who)?.rating,
      comment: draft.comment ?? existingAnswer(questionId, who)?.comment,
    });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Saved', 'success');
    refreshDetail();
  };

  const existingAnswer = (questionId, who) => {
    if (!detail) return null;
    const answeredBy = who === 'self' ? detail.review.profile_id : detail.review.reporting_manager_id;
    return (detail.answers || []).find((a) => a.question_id === questionId && a.answered_by === answeredBy);
  };

  const saveKraRating = async (kraId) => {
    const draft = kraRatingDraft[kraId] || {};
    const existing = (detail.kraRatings || []).find((r) => r.kra_id === kraId && r.rated_by === profile.id);
    const { error } = await submitReviewKraRating({
      reviewId: detail.review.id, kraId, ratedBy: profile.id,
      rating: draft.rating ?? existing?.rating,
      feedbackText: draft.feedback_text ?? existing?.feedback_text,
    });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Saved', 'success');
    refreshDetail();
  };

  const finishReview = async () => {
    if (!confirm('Complete this review? It becomes read-only afterward.')) return;
    const { error } = await completeReview(detail.review.id, overallRating ? parseFloat(overallRating) : null);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Review completed', 'success');
    setDetail(null);
    fetchData();
  };

  return (
    <>
      <div className="page-content">
        <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${topTab === 'my' ? 'btn-primary' : 'btn-outline'}`} style={{ borderRadius: '6px 6px 0 0' }} onClick={() => setTopTab('my')}>My performance reviews</button>
          <button className={`btn btn-sm ${topTab === 'given' ? 'btn-primary' : 'btn-outline'}`} style={{ borderRadius: '6px 6px 0 0' }} onClick={() => setTopTab('given')}>Reviews given to others</button>
          {isAdmin && <button className={`btn btn-sm ${topTab === 'admin' ? 'btn-primary' : 'btn-outline'}`} style={{ borderRadius: '6px 6px 0 0' }} onClick={() => setTopTab('admin')}>Manage Cycles</button>}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : topTab === 'my' ? (
          myReviews.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No reviews yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {myReviews.map((r) => <ReviewRow key={r.id} r={r} onOpen={openReview} />)}
            </div>
          )
        ) : topTab === 'given' ? (
          givenReviews.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No reviews given to others yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {givenReviews.map((r) => <ReviewRow key={r.id} r={r} onOpen={openReview} />)}
            </div>
          )
        ) : (
          <>
            <div className="filter-bar">
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn btn-primary" onClick={() => setShowCycleModal(true)}>
                  <i className="fas fa-plus" /> New Review Cycle
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {cycles.map((c) => (
                <div className="card" key={c.id} style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => openCycle(expandedCycle?.id === c.id ? null : c)}>
                    <div>
                      <strong>{c.name}</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.start_date} → {c.end_date}</div>
                    </div>
                    <span className={`badge ${c.status === 'Active' ? 'badge-info' : 'badge-secondary'}`}>{c.status}</span>
                  </div>

                  {expandedCycle?.id === c.id && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                      <h4>Questions</h4>
                      {questions.map((q) => (
                        <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span style={{ fontSize: 14 }}>{q.question_text}</span>
                          <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeQuestion(q.id)}>
                            <i className="fas fa-times" />
                          </button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <input className="form-input" style={{ flex: 1 }} placeholder="New question" value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} />
                        <button className="btn btn-outline btn-sm" onClick={saveQuestion}>Add</button>
                      </div>

                      <h4 style={{ marginTop: 20 }}>Start a Review</h4>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <select className="form-select" style={{ flex: 1, minWidth: 160 }} value={startForm.profile_id} onChange={(e) => setStartForm({ ...startForm, profile_id: e.target.value })}>
                          <option value="">Employee</option>
                          {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
                        </select>
                        <select className="form-select" style={{ flex: 1, minWidth: 160 }} value={startForm.reporting_manager_id} onChange={(e) => setStartForm({ ...startForm, reporting_manager_id: e.target.value })}>
                          <option value="">Reporting Manager</option>
                          {employees.filter((e) => e.role === 'manager' || e.role === 'admin').map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
                        </select>
                        <button className="btn btn-primary btn-sm" onClick={doStartReview}>Start</button>
                        <button className="btn btn-outline btn-sm" onClick={doBulkStart} title="Apply this cycle to every employee at once">
                          <i className="fas fa-users" /> Bulk Start for All
                        </button>
                      </div>

                      <h4 style={{ marginTop: 20 }}>Reviews in this cycle</h4>
                      {allReviews.filter((r) => r.cycle_id === c.id).map((r) => <ReviewRow key={r.id} r={r} onOpen={openReview} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Modal show={showCycleModal} onClose={() => setShowCycleModal(false)} title="New Review Cycle" width="480px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowCycleModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveCycle} disabled={savingCycle}>
            <i className="fas fa-check" /> {savingCycle ? 'Creating…' : 'Create'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input className="form-input" placeholder="e.g. Q4 2025 (Jan-Mar)" value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date *</label>
            <input className="form-input" type="date" value={cycleForm.start_date} onChange={(e) => setCycleForm({ ...cycleForm, start_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">End Date *</label>
            <input className="form-input" type="date" value={cycleForm.end_date} onChange={(e) => setCycleForm({ ...cycleForm, end_date: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal show={!!detail} onClose={() => setDetail(null)} title={detail ? `Review Form (${detail.review.cycle?.name})` : ''} width="760px">
        {detail && (
          <>
            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              <span>{fullName(detail.review.employee)}</span>
              <span>Manager: {detail.review.reporting_manager ? fullName(detail.review.reporting_manager) : '—'}</span>
              <span className={`badge ${detail.review.status === 'Completed' ? 'badge-success' : 'badge-info'}`}>{detail.review.status}</span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
              <button className={`btn btn-sm ${detailTab === 'questions' ? 'btn-primary' : 'btn-outline'}`} style={{ borderRadius: '6px 6px 0 0' }} onClick={() => setDetailTab('questions')}>
                Questions ({detail.questions.length})
              </button>
              <button className={`btn btn-sm ${detailTab === 'kras' ? 'btn-primary' : 'btn-outline'}`} style={{ borderRadius: '6px 6px 0 0' }} onClick={() => setDetailTab('kras')}>
                KRAs ({detail.kras.length})
              </button>
            </div>

            {detailTab === 'questions' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {detail.questions.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No questions defined for this cycle.</p>
                ) : detail.questions.map((q) => {
                  const selfAns = existingAnswer(q.id, 'self');
                  const mgrAns = existingAnswer(q.id, 'manager');
                  return (
                    <div key={q.id} className="card" style={{ padding: 16 }}>
                      <strong style={{ fontSize: 14 }}>{q.question_text}</strong>

                      <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-secondary, rgba(0,0,0,0.02))', borderRadius: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Self</div>
                        {iAmSelf && !readOnly ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input type="number" min="1" max="5" className="form-input" style={{ width: 70 }}
                                placeholder="1-5"
                                defaultValue={selfAns?.rating ?? ''}
                                onChange={(e) => setAnswerDraft({ ...answerDraft, [`${q.id}_self`]: { ...answerDraft[`${q.id}_self`], rating: e.target.value ? parseFloat(e.target.value) : null } })}
                              />
                              <textarea className="form-input" rows={2} style={{ flex: 1 }}
                                defaultValue={selfAns?.comment ?? ''}
                                onChange={(e) => setAnswerDraft({ ...answerDraft, [`${q.id}_self`]: { ...answerDraft[`${q.id}_self`], comment: e.target.value } })}
                              />
                            </div>
                            <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => saveAnswer(q.id, 'self')}>Save</button>
                          </>
                        ) : (
                          <div style={{ fontSize: 14 }}>
                            {selfAns ? <>{selfAns.rating != null && <span className="badge badge-secondary" style={{ marginRight: 8 }}>{selfAns.rating}/5</span>}{selfAns.comment}</> : <span style={{ color: 'var(--text-muted)' }}>No self-answer yet</span>}
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-secondary, rgba(0,0,0,0.02))', borderRadius: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Manager</div>
                        {iAmManager && !readOnly ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input type="number" min="1" max="5" className="form-input" style={{ width: 70 }}
                                placeholder="1-5"
                                defaultValue={mgrAns?.rating ?? ''}
                                onChange={(e) => setAnswerDraft({ ...answerDraft, [`${q.id}_manager`]: { ...answerDraft[`${q.id}_manager`], rating: e.target.value ? parseFloat(e.target.value) : null } })}
                              />
                              <textarea className="form-input" rows={2} style={{ flex: 1 }}
                                defaultValue={mgrAns?.comment ?? ''}
                                onChange={(e) => setAnswerDraft({ ...answerDraft, [`${q.id}_manager`]: { ...answerDraft[`${q.id}_manager`], comment: e.target.value } })}
                              />
                            </div>
                            <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => saveAnswer(q.id, 'manager')}>Save</button>
                          </>
                        ) : (
                          <div style={{ fontSize: 14 }}>
                            {mgrAns ? <>{mgrAns.rating != null && <span className="badge badge-secondary" style={{ marginRight: 8 }}>{mgrAns.rating}/5</span>}{mgrAns.comment}</> : <span style={{ color: 'var(--text-muted)' }}>No manager answer yet</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {detail.kras.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>This employee has no KRAs defined.</p>
                ) : detail.kras.map((k) => {
                  const rating = (detail.kraRatings || []).find((r) => r.kra_id === k.id);
                  return (
                    <div key={k.id} className="card" style={{ padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>{k.title}</strong>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{k.weight}%</span>
                      </div>
                      <div style={{ margin: '8px 0' }}><ProgressBar value={k.progress_percent} /></div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>KPIs ({(k.kra_kpis || []).length})</div>

                      <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-secondary, rgba(0,0,0,0.02))', borderRadius: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Others' feedback</div>
                        {iAmManager && !readOnly ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input type="number" min="1" max="5" className="form-input" style={{ width: 70 }}
                                placeholder="1-5"
                                defaultValue={rating?.rating ?? ''}
                                onChange={(e) => setKraRatingDraft({ ...kraRatingDraft, [k.id]: { ...kraRatingDraft[k.id], rating: e.target.value ? parseFloat(e.target.value) : null } })}
                              />
                              <textarea className="form-input" rows={2} style={{ flex: 1 }}
                                defaultValue={rating?.feedback_text ?? ''}
                                onChange={(e) => setKraRatingDraft({ ...kraRatingDraft, [k.id]: { ...kraRatingDraft[k.id], feedback_text: e.target.value } })}
                              />
                            </div>
                            <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => saveKraRating(k.id)}>Save</button>
                          </>
                        ) : (
                          <div style={{ fontSize: 14 }}>
                            {rating ? <>{rating.rating != null && <span className="badge badge-secondary" style={{ marginRight: 8 }}>{rating.rating}/5</span>}{rating.feedback_text}</> : <span style={{ color: 'var(--text-muted)' }}>No feedback yet</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {iAmManager && !readOnly && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="form-label" style={{ margin: 0 }}>Overall Rating</label>
                <input type="number" min="1" max="5" step="0.01" className="form-input" style={{ width: 90 }} value={overallRating} onChange={(e) => setOverallRating(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={finishReview}>Complete Review</button>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

export default function ReviewsPage() {
  return (
    <>
      <Header title="Reviews" breadcrumb="Performance review cycles and forms" />
      <ReviewsContent />
    </>
  );
}
