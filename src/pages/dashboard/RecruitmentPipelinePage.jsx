import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listHeadcountRequests, listJobPostings, listAllReferrals, listOfferLetters,
  listInterviewsForReferral, getPiqFormUrl,
  advanceReferralStage, updateBgvStatus, updatePoliceVerificationStatus,
  RECRUITMENT_STAGES, TERMINAL_STAGES, BGV_STATUSES, POLICE_VERIFICATION_STATUSES,
} from '@/services/hiringService';
import { fullName, fmt } from '@/lib/helpers';

const STAGE_BADGE = (stage) => stage === 'Rejected' ? 'badge-danger' : stage === 'Withdrawn' ? 'badge-secondary' : 'badge-info';
const HC_STATUS_BADGE = { Pending: 'badge-warning', Approved: 'badge-success', Rejected: 'badge-danger' };

export default function RecruitmentPipelinePage() {
  const { tenant } = useAuth();
  const navigate = useNavigate();

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

  const closeModal = () => { setPipelineFor(null); setDrillInto(null); };
  const backToCandidates = () => setDrillInto(null);

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
      <Header title="Recruitment Pipeline" breadcrumb="Requisition to onboarding hand-off, in one place — mapped to the recruitment SOP" />
      <div className="page-content">
        {loading ? (
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
        show={!!pipelineFor}
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
            <button className="btn btn-outline btn-sm" style={{ marginBottom: 12 }} onClick={backToCandidates}>← Back to candidates</button>

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
    </>
  );
}
