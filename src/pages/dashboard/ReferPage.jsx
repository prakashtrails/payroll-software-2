import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  REFERRAL_STATUSES, RESUME_ACCEPT, RESUME_MAX_BYTES,
  listJobPostings, listMyReferrals, listAllReferrals,
  createReferral, updateReferralStatus, uploadResume, getResumeUrl,
} from '@/services/hiringService';
import { fmt, fullName, timeAgo } from '@/lib/helpers';

const STATUS_BADGE = {
  Submitted: 'badge-warning', 'Under Review': 'badge-info', Shortlisted: 'badge-purple',
  Hired: 'badge-success', 'Not Selected': 'badge-danger',
};

const EMPTY_FORM = { job_posting_id: '', candidate_name: '', candidate_email: '', candidate_phone: '', resume_url: '', relationship: '', notes: '' };

/** Generates a short-lived signed link on click rather than storing/showing a permanent public URL. */
function ResumeLink({ path, label = 'CV ↗' }) {
  const [loading, setLoading] = useState(false);
  if (!path) return null;
  const handleClick = async () => {
    setLoading(true);
    const { url, error } = await getResumeUrl(path);
    setLoading(false);
    if (error || !url) return showToast('Failed to open CV: ' + (error?.message || 'not found'), 'error');
    window.open(url, '_blank', 'noopener');
  };
  return (
    <button
      onClick={handleClick} disabled={loading}
      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
    >
      {loading ? 'Opening…' : label}
    </button>
  );
}

function ReferModal({ show, onClose, openPostings, initialJobId, onSaved }) {
  const { tenant, profile } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [resumeFile, setResumeFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (show) {
      setForm({ ...EMPTY_FORM, job_posting_id: initialJobId || openPostings[0]?.id || '' });
      setResumeFile(null);
    }
  }, [show, initialJobId, openPostings]);

  const selectedPosting = openPostings.find((p) => p.id === form.job_posting_id);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && file.size > RESUME_MAX_BYTES) {
      showToast('CV must be under 5 MB', 'error');
      e.target.value = '';
      return;
    }
    setResumeFile(file);
  };

  const handleSave = async () => {
    if (!form.job_posting_id) return showToast('Select which role you\'re referring them for', 'error');
    if (!form.candidate_name.trim()) return showToast("Candidate's name is required", 'error');
    if (!form.candidate_email.trim() && !form.candidate_phone.trim()) return showToast('Add an email or phone number to reach the candidate', 'error');
    setSaving(true);

    let resumeFilePath = '';
    if (resumeFile) {
      const { path, error: uploadError } = await uploadResume(tenant.id, profile.id, resumeFile);
      if (uploadError) {
        setSaving(false);
        return showToast('Failed to upload CV: ' + uploadError.message, 'error');
      }
      resumeFilePath = path;
    }

    const { error } = await createReferral({
      tenant_id: tenant.id,
      job_posting_id: form.job_posting_id,
      referred_by: profile.id,
      candidate_name: form.candidate_name.trim(),
      candidate_email: form.candidate_email.trim(),
      candidate_phone: form.candidate_phone.trim(),
      resume_url: form.resume_url.trim(),
      resume_file_path: resumeFilePath,
      relationship: form.relationship.trim(),
      notes: form.notes.trim(),
    });
    setSaving(false);
    if (error) return showToast('Failed to submit referral: ' + error.message, 'error');
    showToast('Referral submitted — HR can now see the details' + (resumeFilePath ? ' and CV' : '') + '.', 'success');
    onSaved();
    onClose();
  };

  return (
    <Modal show={show} onClose={onClose} title="Refer a Candidate" width="520px"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Submitting…</> : <><i className="fas fa-paper-plane" /> Submit Referral</>}
        </button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Role *</label>
          <select className="form-select" value={form.job_posting_id} onChange={(e) => setForm({ ...form, job_posting_id: e.target.value })}>
            <option value="">Select an open role</option>
            {openPostings.map((p) => <option key={p.id} value={p.id}>{p.title}{p.department ? ` — ${p.department}` : ''}</option>)}
          </select>
        </div>
        {selectedPosting?.referral_bonus > 0 && (
          <div style={{ background: 'var(--success-light)', color: 'var(--success)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
            <i className="fas fa-gift" /> Earn {fmt(selectedPosting.referral_bonus)} if this candidate is hired.
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Candidate Name *</label>
            <input className="form-input" value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Relationship</label>
            <input className="form-input" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} placeholder="e.g. Ex-colleague" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.candidate_email} onChange={(e) => setForm({ ...form, candidate_email: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-input" value={form.candidate_phone} onChange={(e) => setForm({ ...form, candidate_phone: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Upload CV</label>
          <input className="form-input" type="file" accept={RESUME_ACCEPT} onChange={handleFileChange} />
          <div className="form-hint">PDF or Word, up to 5 MB. Only you and HR can access it — {resumeFile ? `"${resumeFile.name}" ready to upload.` : 'not shared anywhere else.'}</div>
        </div>
        <div className="form-group">
          <label className="form-label">Resume Link (optional)</label>
          <input className="form-input" value={form.resume_url} onChange={(e) => setForm({ ...form, resume_url: e.target.value })} placeholder="Google Drive / LinkedIn / etc. — instead of or alongside an uploaded CV" />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why would they be a good fit?" />
        </div>
      </div>
    </Modal>
  );
}

export default function ReferPage() {
  const { tenant, profile } = useAuth();
  const canManage = profile?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const jobParam = searchParams.get('job');

  // HR lands on the full referral pipeline first; everyone else lands on their own.
  const [tab, setTab] = useState(canManage ? 'all' : 'mine');
  const [openPostings, setOpenPostings] = useState([]);
  const [myReferrals, setMyReferrals] = useState([]);
  const [allReferrals, setAllReferrals] = useState([]);
  const [referralStatusFilter, setReferralStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showReferModal, setShowReferModal] = useState(false);

  const fetchPostings = useCallback(async () => {
    if (!tenant) return;
    const { data, error } = await listJobPostings(tenant.id);
    if (!error) setOpenPostings(data.filter((p) => p.status === 'Open'));
  }, [tenant]);

  const fetchMyReferrals = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyReferrals(profile.id);
    if (error) showToast('Failed to load your referrals: ' + error.message, 'error');
    else setMyReferrals(data);
  }, [profile]);

  const fetchAllReferrals = useCallback(async () => {
    if (!tenant || !canManage) return;
    const { data, error } = await listAllReferrals(tenant.id, { status: referralStatusFilter });
    if (error) showToast('Failed to load referrals: ' + error.message, 'error');
    else setAllReferrals(data);
  }, [tenant, canManage, referralStatusFilter]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchPostings(), fetchMyReferrals()]).finally(() => setLoading(false));
  }, [fetchPostings, fetchMyReferrals]);

  useEffect(() => { if (tab === 'all') fetchAllReferrals(); }, [tab, fetchAllReferrals]);

  // Arriving from a Hiring page's "Refer a Candidate" link (?job=<id>) opens the modal pre-selected.
  useEffect(() => {
    if (jobParam) setShowReferModal(true);
  }, [jobParam]);

  const closeReferModal = () => {
    setShowReferModal(false);
    if (jobParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('job');
      setSearchParams(next);
    }
  };

  const handleReferralStatus = async (referral, status) => {
    const { error } = await updateReferralStatus(referral.id, status, referral.hr_notes);
    if (error) return showToast('Failed to update: ' + error.message, 'error');
    fetchAllReferrals();
  };

  const handleHrNotes = async (referral, hrNotes) => {
    const { error } = await updateReferralStatus(referral.id, referral.status, hrNotes);
    if (error) return showToast('Failed to save notes: ' + error.message, 'error');
  };

  const TABS = canManage
    ? [{ id: 'all', label: 'All Referrals' }, { id: 'mine', label: 'My Referrals' }]
    : [{ id: 'mine', label: 'My Referrals' }];

  return (
    <>
      <Header
        title="Refer"
        breadcrumb="Refer candidates and track their status"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: tab === t.id ? 'var(--primary)' : 'transparent',
                    color: tab === t.id ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {canManage && <Link to="/hiring" className="btn btn-outline btn-sm"><i className="fas fa-briefcase" /> Manage Postings</Link>}
            <button className="btn btn-primary btn-sm" onClick={() => setShowReferModal(true)} disabled={openPostings.length === 0}>
              <i className="fas fa-plus" /> Refer a Candidate
            </button>
          </div>
        }
      />

      <div className="page-content">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : (
          <>
            {tab === 'mine' && (
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Position</th><th>Candidate</th><th>CV</th><th>Status</th><th>Submitted</th></tr></thead>
                    <tbody>
                      {myReferrals.length === 0 ? (
                        <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>You haven't referred anyone yet.</td></tr>
                      ) : myReferrals.map((r) => (
                        <tr key={r.id}>
                          <td>{r.job_postings?.title || '—'}</td>
                          <td>{r.candidate_name}</td>
                          <td>
                            <ResumeLink path={r.resume_file_path} />
                            {r.resume_url && <a href={r.resume_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, marginLeft: r.resume_file_path ? 8 : 0 }}>Link ↗</a>}
                            {!r.resume_file_path && !r.resume_url && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge'}`}>{r.status}</span></td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'all' && canManage && (
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0 }}>All Referrals</h3>
                  <select className="form-select" value={referralStatusFilter} onChange={(e) => setReferralStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Candidate</th><th>Position</th><th>Referred By</th><th>Status</th><th>HR Notes</th><th>Submitted</th></tr></thead>
                    <tbody>
                      {allReferrals.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No referrals match this filter.</td></tr>
                      ) : allReferrals.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{r.candidate_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.candidate_email || r.candidate_phone}</div>
                            <div style={{ marginTop: 2 }}>
                              {r.resume_file_path && <ResumeLink path={r.resume_file_path} label="Download CV ↗" />}
                              {r.resume_url && (
                                <a href={r.resume_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, marginLeft: r.resume_file_path ? 8 : 0 }}>
                                  Resume Link ↗
                                </a>
                              )}
                            </div>
                          </td>
                          <td>{r.job_postings?.title || '—'}</td>
                          <td style={{ fontSize: 12 }}>{fullName(r.referred_by_profile) || '—'}</td>
                          <td>
                            <select className="form-select" style={{ fontSize: 12, padding: '4px 8px' }} value={r.status} onChange={(e) => handleReferralStatus(r, e.target.value)}>
                              {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td>
                            <input
                              className="form-input" style={{ fontSize: 12, padding: '4px 8px', minWidth: 140 }}
                              defaultValue={r.hr_notes} placeholder="Internal notes…"
                              onBlur={(e) => handleHrNotes(r, e.target.value)}
                            />
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ReferModal
        show={showReferModal}
        onClose={closeReferModal}
        openPostings={openPostings}
        initialJobId={jobParam}
        onSaved={fetchMyReferrals}
      />
    </>
  );
}
