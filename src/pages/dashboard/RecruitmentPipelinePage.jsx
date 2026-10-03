import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listHeadcountRequests, listJobPostings, listAllReferrals, listOfferLetters,
  listInterviewsForReferral, getPiqFormUrl, getResumeUrl, addCandidate,
  advanceReferralStage, updateBgvStatus, updatePoliceVerificationStatus,
  RECRUITMENT_STAGES, TERMINAL_STAGES, ALL_STAGES, BGV_STATUSES, POLICE_VERIFICATION_STATUSES,
  CANDIDATE_SOURCES, MANUAL_SOURCES, RESUME_ACCEPT, RESUME_MAX_BYTES,
} from '@/services/hiringService';
import { fullName, fmt } from '@/lib/helpers';

const STAGE_BADGE = (stage) => stage === 'Rejected' ? 'badge-danger' : stage === 'Withdrawn' ? 'badge-secondary' : 'badge-info';
const HC_STATUS_BADGE = { Pending: 'badge-warning', Approved: 'badge-success', Rejected: 'badge-danger' };
const SOURCE_BADGE = { Referral: 'badge-purple', Direct: 'badge-info', 'Careers Page': 'badge-success', 'Job Portal': 'badge-teal', Agency: 'badge-warning', 'Walk-in': 'badge-secondary' };
const EMPTY_CANDIDATE = { job_posting_id: '', candidate_name: '', candidate_email: '', candidate_phone: '', source: 'Direct', notes: '' };

export default function RecruitmentPipelinePage() {
  const { tenant, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('candidate') ? 'candidates' : 'requisitions');
  const [filters, setFilters] = useState({ q: '', stage: 'active', source: '', posting: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [candidateForm, setCandidateForm] = useState(EMPTY_CANDIDATE);
  const [candidateResume, setCandidateResume] = useState(null);
  const [savingCandidate, setSavingCandidate] = useState(false);

  const [headcountRequests, setHeadcountRequests] = useState([]);
  const [jobPostings, setJobPostings] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [offerLetters, setOfferLetters] = useState([]);
  const [loading, setLoading] = useState(true);

  const [pipelineFor, setPipelineFor] = useState(null); // headcount_request row
  const [drillInto, setDrillInto] = useState(null);      // referral row
  const [candidateInterviews, setCandidateInterviews] = useState([]);
  const [bgvNotesDraft, setBgvNotesDraft] = useState('');
  const [policeNotesDraft, setPoliceNotesDraft] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [hcRes, jpRes, refRes, olRes] = await Promise.all([
        listHeadcountRequests(tenant.id), listJobPostings(tenant.id), listAllReferrals(tenant.id), listOfferLetters(tenant.id),
      ]);
      setHeadcountRequests(hcRes.data);
      setJobPostings(jpRes.data);
      setReferrals(refRes.data);
      setOfferLetters(olRes.data);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Notification deep link: /recruitment-pipeline?candidate=<id>
  useEffect(() => {
    const id = searchParams.get('candidate');
    if (!id || drillInto || !referrals.length) return;
    const r = referrals.find((x) => x.id === id);
    if (r) openCandidate(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrals, searchParams]);

  // Re-sync open modals with fresh data after any mutation.
  useEffect(() => {
    if (pipelineFor) { const fresh = headcountRequests.find((h) => h.id === pipelineFor.id); if (fresh) setPipelineFor(fresh); }
    if (drillInto) { const fresh = referrals.find((r) => r.id === drillInto.id); if (fresh) { setDrillInto(fresh); setBgvNotesDraft(fresh.bgv_notes || ''); setPoliceNotesDraft(fresh.police_verification_notes || ''); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headcountRequests, referrals]);

  const jobPostingIdsFor = (hcId) => jobPostings.filter((jp) => jp.headcount_request_id === hcId).map((jp) => jp.id);
  const candidatesFor = (hcId) => { const ids = jobPostingIdsFor(hcId); return referrals.filter((r) => ids.includes(r.job_posting_id)); };

  const openPipeline = (hc) => { setPipelineFor(hc); setDrillInto(null); };

  const openCandidate = async (referral) => {
    setDrillInto(referral);
    setBgvNotesDraft(referral.bgv_notes || '');
    setPoliceNotesDraft(referral.police_verification_notes || '');
    setRejecting(false);
    const { data } = await listInterviewsForReferral(referral.id);
    setCandidateInterviews(data);
  };

  const closeModal = () => { setPipelineFor(null); setDrillInto(null); if (searchParams.get('candidate')) setSearchParams({}); };
  const backToCandidates = () => (pipelineFor ? setDrillInto(null) : closeModal());

  const filteredCandidates = referrals.filter((r) => {
    if (filters.stage === 'active' && TERMINAL_STAGES.includes(r.stage)) return false;
    if (filters.stage && filters.stage !== 'active' && r.stage !== filters.stage) return false;
    if (filters.source && (r.source || 'Referral') !== filters.source) return false;
    if (filters.posting && r.job_posting_id !== filters.posting) return false;
    const q = filters.q.trim().toLowerCase();
    return !q || `${r.candidate_name} ${r.candidate_email} ${r.candidate_phone} ${r.job_postings?.title || ''}`.toLowerCase().includes(q);
  });

  const handleAddCandidate = async () => {
    const f = candidateForm;
    if (!f.job_posting_id) return showToast('Choose the job posting', 'error');
    if (f.candidate_name.trim().length < 2) return showToast('Enter the candidate name', 'error');
    if (!f.candidate_email.trim() && !f.candidate_phone.trim()) return showToast('Enter an email or phone number', 'error');
    if (candidateResume && candidateResume.size > RESUME_MAX_BYTES) return showToast('Resume must be 5 MB or smaller', 'error');
    setSavingCandidate(true);
    const { error } = await addCandidate(tenant.id, profile.id, f, candidateResume);
    setSavingCandidate(false);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Candidate added', 'success');
    setShowAdd(false);
    setCandidateForm(EMPTY_CANDIDATE);
    setCandidateResume(null);
    setTab('candidates');
    fetchData();
  };

  const openResume = async (path) => {
    const { url, error } = await getResumeUrl(path);
    if (error || !url) return showToast('Could not open resume', 'error');
    window.open(url, '_blank', 'noopener');
  };

  const currentStageIndex = drillInto ? RECRUITMENT_STAGES.indexOf(drillInto.stage) : -1;
  const isTerminal = drillInto && TERMINAL_STAGES.includes(drillInto.stage);
  const nextStage = currentStageIndex >= 0 && currentStageIndex < RECRUITMENT_STAGES.length - 1 ? RECRUITMENT_STAGES[currentStageIndex + 1] : null;

  const handleAdvance = async () => {
    if (!nextStage) return;
    const { error } = await advanceReferralStage(drillInto.id, nextStage);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast(`Moved to "${nextStage}"`, 'success');
    fetchData();
  };

  const handleTerminal = async (stage) => {
    if (stage === 'Rejected' && !rejectReason.trim()) return showToast('A rejection reason is required', 'error');
    const { error } = await advanceReferralStage(drillInto.id, stage, stage === 'Rejected' ? { rejection_reason: rejectReason.trim() } : {});
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast(`Candidate ${stage.toLowerCase()}`, 'success');
    setRejecting(false);
    setRejectReason('');
    fetchData();
  };

  const handleSaveBgv = async (status) => {
    const { error } = await updateBgvStatus(drillInto.id, status, bgvNotesDraft);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('BGV status updated', 'success');
    fetchData();
  };

  const handleSavePolice = async (status) => {
    const { error } = await updatePoliceVerificationStatus(drillInto.id, status, policeNotesDraft);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Police verification status updated', 'success');
    fetchData();
  };

  const downloadPiq = async (path) => {
    const { url, error } = await getPiqFormUrl(path);
    if (error || !url) return showToast('Could not open PIQ form', 'error');
    window.open(url, '_blank', 'noopener');
  };

  const convertToEmployee = () => {
    const [first_name, ...rest] = (drillInto.candidate_name || '').replace(/^TEST - /, '').replace(/\s*\([^)]*\)\s*$/, '').trim().split(/\s+/);
    const latestOffer = offerLetters.find((o) => o.referral_id === drillInto.id && o.letter_type === 'Offer');
    const jobPosting = jobPostings.find((jp) => jp.id === drillInto.job_posting_id);
    navigate('/employees', {
      state: {
        prefillFromReferral: {
          referral_id: drillInto.id,
          first_name: first_name || '',
          last_name: rest.join(' ') || '',
          email: drillInto.candidate_email || '',
          phone: drillInto.candidate_phone || '',
          department: jobPosting?.department || '',
          designation: latestOffer?.designation || jobPosting?.title || '',
          ctc: latestOffer?.ctc_offered || '',
          join_date: latestOffer?.joining_date || '',
        },
      },
    });
  };

  const candidateOffers = drillInto ? offerLetters.filter((o) => o.referral_id === drillInto.id) : [];

  return (
    <>
      <Header title="Recruitment Pipeline" breadcrumb="Requisition to onboarding hand-off, in one place — mapped to the recruitment SOP"
        actions={<button className="btn btn-primary" onClick={() => { setCandidateForm(EMPTY_CANDIDATE); setCandidateResume(null); setShowAdd(true); }}><i className="fas fa-user-plus" style={{ marginRight: 6 }} />Add Candidate</button>}
      />
      <div className="tab-bar-wrap">
        <div className="tabs">
          <button className={`tab-btn ${tab === 'requisitions' ? 'active' : ''}`} onClick={() => setTab('requisitions')}>Requisitions</button>
          <button className={`tab-btn ${tab === 'candidates' ? 'active' : ''}`} onClick={() => setTab('candidates')}>All Candidates ({referrals.filter((r) => !TERMINAL_STAGES.includes(r.stage)).length})</button>
        </div>
      </div>
      <div className="page-content">
        {!loading && tab === 'candidates' ? (
          <>
            <div className="filter-bar">
              <input className="form-input" placeholder="Search name, email, phone, role…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
              <select className="form-select" value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })}>
                <option value="active">Active candidates</option>
                <option value="">All stages</option>
                {ALL_STAGES.map((st) => <option key={st}>{st}</option>)}
              </select>
              <select className="form-select" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
                <option value="">All sources</option>
                {CANDIDATE_SOURCES.map((src) => <option key={src}>{src}</option>)}
              </select>
              <select className="form-select" value={filters.posting} onChange={(e) => setFilters({ ...filters, posting: e.target.value })}>
                <option value="">All job postings</option>
                {jobPostings.map((jp) => <option key={jp.id} value={jp.id}>{jp.title}</option>)}
              </select>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Candidate</th><th>Role</th><th>Source</th><th>Stage</th><th>Added</th><th></th></tr></thead>
                  <tbody>
                    {filteredCandidates.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No candidates match these filters.</td></tr>
                    ) : filteredCandidates.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.candidate_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[r.candidate_email, r.candidate_phone].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>{r.job_postings?.title || '—'}</td>
                        <td>
                          <span className={`badge ${SOURCE_BADGE[r.source || 'Referral']}`}>{r.source || 'Referral'}</span>
                          {(r.source || 'Referral') === 'Referral' && r.referred_by_profile && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>by {fullName(r.referred_by_profile)}</div>}
                        </td>
                        <td><span className={`badge ${STAGE_BADGE(r.stage)}`}>{r.stage}</span></td>
                        <td style={{ fontSize: 12 }}>{fmt.date(r.created_at)}</td>
                        <td><button className="btn btn-outline btn-sm" onClick={() => openCandidate(r)}>Manage</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>RR Number</th><th>Designation</th><th>Outlet</th><th>Recruiter</th><th>Approval</th><th>Candidates</th><th>Actions</th></tr></thead>
                <tbody>
                  {headcountRequests.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No requisitions yet — start one from Headcount Requests.</td></tr>
                  ) : headcountRequests.map((hc) => (
                    <tr key={hc.id}>
                      <td>{hc.rr_number ? <code style={{ fontSize: 11 }}>{hc.rr_number}</code> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td><strong>{hc.designation}</strong></td>
                      <td>{hc.outlet?.name || '—'}</td>
                      <td>{hc.assigned_recruiter_id ? fullName(hc.recruiter) : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                      <td><span className={`badge ${HC_STATUS_BADGE[hc.status]}`}>{hc.status}</span></td>
                      <td>{candidatesFor(hc.id).length}</td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => openPipeline(hc)}>View Pipeline</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal
        show={!!pipelineFor || !!drillInto}
        onClose={closeModal}
        title={drillInto ? `Candidate — ${drillInto.candidate_name}` : pipelineFor ? `Candidates — ${pipelineFor.designation}` : ''}
        width="640px"
        footer={<button className="btn btn-outline" onClick={closeModal}>Close</button>}
      >
        {pipelineFor && !drillInto && (
          candidatesFor(pipelineFor.id).length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No candidates yet for this requisition.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Candidate</th><th>Stage</th><th></th></tr></thead>
                <tbody>
                  {candidatesFor(pipelineFor.id).map((r) => (
                    <tr key={r.id}>
                      <td>{r.candidate_name}</td>
                      <td><span className={`badge ${STAGE_BADGE(r.stage)}`}>{r.stage}</span></td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => openCandidate(r)}>Manage</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {drillInto && (
          <>
            <button className="btn btn-outline btn-sm" style={{ marginBottom: 12 }} onClick={backToCandidates}>{pipelineFor ? '← Back to candidates' : '← Close'}</button>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`badge ${SOURCE_BADGE[drillInto.source || 'Referral']}`}>{drillInto.source || 'Referral'}</span>
              {drillInto.job_postings?.title && <span><i className="fas fa-briefcase" style={{ marginRight: 4 }} />{drillInto.job_postings.title}</span>}
              {drillInto.candidate_email && <a href={`mailto:${drillInto.candidate_email}`}>{drillInto.candidate_email}</a>}
              {drillInto.candidate_phone && <a href={`tel:${drillInto.candidate_phone}`}>{drillInto.candidate_phone}</a>}
              {drillInto.resume_file_path && <button className="btn btn-outline btn-sm" onClick={() => openResume(drillInto.resume_file_path)}><i className="fas fa-file-lines" style={{ marginRight: 4 }} />Resume</button>}
            </div>
            {drillInto.notes && <p style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: 'var(--bg)', padding: 10, borderRadius: 8, margin: '0 0 12px' }}>{drillInto.notes}</p>}

            {isTerminal ? (
              <div style={{ marginBottom: 16 }}>
                <span className={`badge ${STAGE_BADGE(drillInto.stage)}`} style={{ fontSize: 13 }}>{drillInto.stage}</span>
                {drillInto.rejection_reason && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{drillInto.rejection_reason}</p>}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {RECRUITMENT_STAGES.map((s, i) => (
                  <span key={s} className={`badge ${i === currentStageIndex ? 'badge-info' : i < currentStageIndex ? 'badge-success' : 'badge-secondary'}`} style={{ fontSize: 10 }}>
                    {s}
                  </span>
                ))}
              </div>
            )}

            {!isTerminal && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {nextStage && <button className="btn btn-primary btn-sm" onClick={handleAdvance}>Advance to "{nextStage}" →</button>}
                {rejecting ? (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="form-input" style={{ fontSize: 12, padding: '4px 8px' }} placeholder="Rejection reason…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    <button className="btn btn-danger btn-sm" onClick={() => handleTerminal('Rejected')}>Confirm Reject</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setRejecting(false)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setRejecting(true)}>Reject</button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleTerminal('Withdrawn')}>Withdrawn</button>
                  </>
                )}
                {drillInto.stage === 'Offer Accepted' && (
                  <button className="btn btn-success btn-sm" onClick={convertToEmployee}><i className="fas fa-user-plus" /> Convert to Employee →</button>
                )}
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Background Verification</label>
                <select className="form-select" style={{ fontSize: 12 }} value={drillInto.bgv_status} onChange={(e) => handleSaveBgv(e.target.value)}>
                  {BGV_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <textarea className="form-input" style={{ fontSize: 12, marginTop: 6 }} rows={2} placeholder="Notes…" value={bgvNotesDraft}
                  onChange={(e) => setBgvNotesDraft(e.target.value)} onBlur={() => handleSaveBgv(drillInto.bgv_status)} />
              </div>
              <div className="form-group">
                <label className="form-label">Police Verification</label>
                <select className="form-select" style={{ fontSize: 12 }} value={drillInto.police_verification_status} onChange={(e) => handleSavePolice(e.target.value)}>
                  {POLICE_VERIFICATION_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <textarea className="form-input" style={{ fontSize: 12, marginTop: 6 }} rows={2} placeholder="Notes…" value={policeNotesDraft}
                  onChange={(e) => setPoliceNotesDraft(e.target.value)} onBlur={() => handleSavePolice(drillInto.police_verification_status)} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="form-label">Interviews</label>
              {candidateInterviews.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>None scheduled yet.</p>
              ) : candidateInterviews.map((i) => (
                <div key={i.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{i.round_name} — <span className="badge badge-secondary">{i.status}</span></span>
                  {i.piq_form_path && <button className="btn btn-outline btn-sm" onClick={() => downloadPiq(i.piq_form_path)}>PIQ Form</button>}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="form-label">Letters</label>
              {candidateOffers.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>None created yet.</p>
              ) : candidateOffers.map((o) => (
                <div key={o.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{o.letter_type} — {fmt(o.ctc_offered)}</span>
                  <span className="badge badge-secondary">{o.status}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>

      <Modal show={showAdd} onClose={() => setShowAdd(false)} title="Add Candidate" width="560px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddCandidate} disabled={savingCandidate}>{savingCandidate ? 'Saving…' : 'Add Candidate'}</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Job posting *</label>
          <select className="form-select" value={candidateForm.job_posting_id} onChange={(e) => setCandidateForm({ ...candidateForm, job_posting_id: e.target.value })}>
            <option value="">Choose…</option>
            {jobPostings.filter((jp) => jp.status !== 'Closed').map((jp) => <option key={jp.id} value={jp.id}>{jp.title}{jp.department ? ` · ${jp.department}` : ''}</option>)}
          </select>
          {jobPostings.length === 0 && <div className="form-hint">Create a job posting first (Recruitment → Job Postings).</div>}
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Full name *</label>
            <input className="form-input" maxLength={100} value={candidateForm.candidate_name} onChange={(e) => setCandidateForm({ ...candidateForm, candidate_name: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Source</label>
            <select className="form-select" value={candidateForm.source} onChange={(e) => setCandidateForm({ ...candidateForm, source: e.target.value })}>
              {MANUAL_SOURCES.map((src) => <option key={src}>{src}</option>)}
            </select></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Email</label>
            <input className="form-input" type="email" value={candidateForm.candidate_email} onChange={(e) => setCandidateForm({ ...candidateForm, candidate_email: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Phone</label>
            <input className="form-input" type="tel" value={candidateForm.candidate_phone} onChange={(e) => setCandidateForm({ ...candidateForm, candidate_phone: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">Resume (PDF/Word, max 5 MB)</label>
          <input className="form-input" type="file" accept={RESUME_ACCEPT} onChange={(e) => setCandidateResume(e.target.files?.[0] || null)} /></div>
        <div className="form-group"><label className="form-label">Notes</label>
          <textarea className="form-input" rows={3} value={candidateForm.notes} onChange={(e) => setCandidateForm({ ...candidateForm, notes: e.target.value })} placeholder="Current CTC, notice period, agency name…" /></div>
      </Modal>
    </>
  );
}
