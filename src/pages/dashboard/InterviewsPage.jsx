import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listAllReferrals, listInterviewsForReferral, listMyInterviews,
  scheduleInterview, updateInterviewStatus, submitInterviewFeedback,
} from '@/services/hiringService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName } from '@/lib/helpers';

const SKILLS = ['communication', 'technical', 'culture_fit'];
const RECOMMENDATIONS = ['Strong Yes', 'Yes', 'Neutral', 'No', 'Strong No'];

export default function InterviewsPage() {
  const { tenant, profile } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'superadmin';
  const [tab, setTab] = useState(canManage ? 'pipeline' : 'mine');
  const [referrals, setReferrals] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [myInterviews, setMyInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scheduleFor, setScheduleFor] = useState(null); // referral
  const [scheduleForm, setScheduleForm] = useState({ round_name: 'Round 1', interviewer_id: '', scheduled_at: '' });
  const [viewFor, setViewFor] = useState(null); // referral — shows its interview list
  const [interviewList, setInterviewList] = useState([]);
  const [feedbackFor, setFeedbackFor] = useState(null); // interview
  const [feedbackForm, setFeedbackForm] = useState({ ratings: {}, recommendation: 'Neutral', comments: '' });

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    setLoading(true);
    try {
      if (canManage) {
        const [refRes, empRes] = await Promise.all([listAllReferrals(tenant.id), listActiveEmployees(tenant.id)]);
        setReferrals(refRes.data);
        setEmployees(empRes.data);
      }
      const { data } = await listMyInterviews(profile.id);
      setMyInterviews(data);
    } finally {
      setLoading(false);
    }
  }, [tenant, profile, canManage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openSchedule = (referral) => { setScheduleFor(referral); setScheduleForm({ round_name: 'Round 1', interviewer_id: '', scheduled_at: '' }); };

  const doSchedule = async () => {
    if (!scheduleForm.interviewer_id) return showToast('Select an interviewer', 'error');
    const { error } = await scheduleInterview(tenant.id, profile.id, { ...scheduleForm, referral_id: scheduleFor.id });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Interview scheduled', 'success');
    setScheduleFor(null);
    fetchData();
  };

  const openView = async (referral) => {
    setViewFor(referral);
    const { data } = await listInterviewsForReferral(referral.id);
    setInterviewList(data);
  };

  const openFeedback = (interview) => {
    setFeedbackFor(interview);
    const mine = interview.feedback?.find((f) => f.interviewer_id === profile.id);
    setFeedbackForm(mine ? { ratings: mine.ratings, recommendation: mine.recommendation, comments: mine.comments } : { ratings: {}, recommendation: 'Neutral', comments: '' });
  };

  const doSubmitFeedback = async () => {
    const { error } = await submitInterviewFeedback(feedbackFor.id, profile.id, feedbackForm);
    if (error) return showToast('Failed: ' + error.message, 'error');
    await updateInterviewStatus(feedbackFor.id, 'Completed');
    showToast('Feedback submitted', 'success');
    setFeedbackFor(null);
    fetchData();
  };

  return (
    <>
      <Header title="Interviews" breadcrumb="Schedule interview rounds and collect structured feedback per candidate" />
      <div className="page-content">
        <div className="filter-bar">
          {canManage && <button className={`btn btn-sm ${tab === 'pipeline' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('pipeline')}>Pipeline</button>}
          <button className={`btn btn-sm ${tab === 'mine' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('mine')}>My Interviews</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : tab === 'pipeline' ? (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Candidate</th><th>Position</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {referrals.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No candidates yet</td></tr>
                  ) : referrals.map((r) => (
                    <tr key={r.id}>
                      <td>{r.candidate_name}</td>
                      <td>{r.job_postings?.title || '—'}</td>
                      <td><span className="badge badge-info">{r.status}</span></td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => openSchedule(r)}>Schedule</button>{' '}
                        <button className="btn btn-outline btn-sm" onClick={() => openView(r)}>View Interviews</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Candidate</th><th>Position</th><th>Round</th><th>When</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {myInterviews.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No interviews assigned to you</td></tr>
                  ) : myInterviews.map((i) => (
                    <tr key={i.id}>
                      <td>{i.referral?.candidate_name}</td>
                      <td>{i.referral?.job_postings?.title || '—'}</td>
                      <td>{i.round_name}</td>
                      <td>{i.scheduled_at ? new Date(i.scheduled_at).toLocaleString('en-IN') : '—'}</td>
                      <td><span className="badge badge-info">{i.status}</span></td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => openFeedback(i)}>{i.status === 'Completed' ? 'View/Edit Feedback' : 'Give Feedback'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal show={!!scheduleFor} onClose={() => setScheduleFor(null)} title={`Schedule Interview — ${scheduleFor?.candidate_name || ''}`} width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setScheduleFor(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={doSchedule}>Schedule</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Round Name</label>
          <input className="form-input" value={scheduleForm.round_name} onChange={(e) => setScheduleForm({ ...scheduleForm, round_name: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Interviewer *</label>
          <select className="form-select" value={scheduleForm.interviewer_id} onChange={(e) => setScheduleForm({ ...scheduleForm, interviewer_id: e.target.value })}>
            <option value="">Select Interviewer</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Date &amp; Time</label>
          <input className="form-input" type="datetime-local" value={scheduleForm.scheduled_at} onChange={(e) => setScheduleForm({ ...scheduleForm, scheduled_at: e.target.value })} />
        </div>
      </Modal>

      <Modal show={!!viewFor} onClose={() => setViewFor(null)} title={`Interviews — ${viewFor?.candidate_name || ''}`} width="480px"
        footer={<button className="btn btn-outline" onClick={() => setViewFor(null)}>Close</button>}
      >
        {interviewList.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No interviews scheduled yet</div>
        ) : interviewList.map((i) => (
          <div key={i.id} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{i.round_name}</strong>
              <span className="badge badge-info">{i.status}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fullName(i.interviewer)} — {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString('en-IN') : 'not yet scheduled'}</div>
            {(i.feedback || []).map((f) => (
              <div key={f.id} style={{ fontSize: 12, marginTop: 4 }}>
                <span className="badge badge-secondary">{f.recommendation}</span> {f.comments}
              </div>
            ))}
          </div>
        ))}
      </Modal>

      <Modal show={!!feedbackFor} onClose={() => setFeedbackFor(null)} title="Interview Feedback" width="440px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setFeedbackFor(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={doSubmitFeedback}>Submit</button>
        </>}
      >
        {SKILLS.map((s) => (
          <div className="form-group" key={s}>
            <label className="form-label" style={{ textTransform: 'capitalize' }}>{s.replace('_', ' ')} (1–5)</label>
            <input className="form-input" type="number" min="1" max="5" value={feedbackForm.ratings[s] || ''}
              onChange={(e) => setFeedbackForm({ ...feedbackForm, ratings: { ...feedbackForm.ratings, [s]: parseInt(e.target.value) || 0 } })} />
          </div>
        ))}
        <div className="form-group">
          <label className="form-label">Recommendation</label>
          <select className="form-select" value={feedbackForm.recommendation} onChange={(e) => setFeedbackForm({ ...feedbackForm, recommendation: e.target.value })}>
            {RECOMMENDATIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Comments</label>
          <textarea className="form-input" rows={3} value={feedbackForm.comments} onChange={(e) => setFeedbackForm({ ...feedbackForm, comments: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
