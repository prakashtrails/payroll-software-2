import { supabase } from '@/lib/supabase';
import { escapeHtml } from '@/lib/helpers';
import { notifyProfiles, notifyRoles, withHrRole } from './notificationService';

export const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
export const REFERRAL_STATUSES = ['Submitted', 'Under Review', 'Shortlisted', 'Hired', 'Not Selected'];

const RESUME_BUCKET = 'referral-resumes';
export const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const RESUME_ACCEPT = '.pdf,.doc,.docx';

/**
 * Ordered pipeline stages mirroring Raniwala's recruitment SOP. `stage`
 * lives on `referrals` and is the single source of truth the Recruitment
 * Pipeline page drives; `status` (the older, flatter field ReferPage.jsx's
 * employee-facing view still reads) is kept in sync from `stage` via
 * STAGE_TO_STATUS below, exclusively through advanceReferralStage() — no
 * other code path should write `referrals.status` for a pipeline-tracked
 * candidate.
 */
export const RECRUITMENT_STAGES = [
  'Applied', 'Shortlisted', 'PI Round', 'Technical Interview', 'Final Interview',
  'Document Collection', 'Background Verification', 'LOI & Police Verification',
  'Offer Sent', 'Offer Accepted', 'Sent to Induction',
];
export const TERMINAL_STAGES = ['Rejected', 'Withdrawn'];
export const ALL_STAGES = [...RECRUITMENT_STAGES, ...TERMINAL_STAGES];

export const STAGE_TO_STATUS = {
  Applied: 'Submitted',
  Shortlisted: 'Shortlisted',
  'PI Round': 'Under Review',
  'Technical Interview': 'Under Review',
  'Final Interview': 'Under Review',
  'Document Collection': 'Under Review',
  'Background Verification': 'Under Review',
  'LOI & Police Verification': 'Under Review',
  'Offer Sent': 'Under Review',
  'Offer Accepted': 'Under Review',
  'Sent to Induction': 'Hired',
  Rejected: 'Not Selected',
  Withdrawn: 'Not Selected',
};

export const BGV_STATUSES = ['Not Started', 'In Progress', 'Consent Pending', 'Verified', 'Discrepancy Found'];
export const POLICE_VERIFICATION_STATUSES = ['Not Started', 'LOI Shared', 'In Progress', 'Completed'];

const PIQ_BUCKET = 'piq-forms';

/**
 * Uploads a candidate's CV to a private bucket and returns the storage path
 * to save on the referral row — never a public URL, since a resume is
 * personal data about someone who isn't even an app user. Path is
 * {tenant}/{referrer}/... so the storage RLS policies (in
 * 20260812_referral_resume_upload.sql) can authorize purely from the path,
 * no lookup back to the referrals table needed.
 */
export async function uploadResume(tenantId, profileId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${tenantId}/${profileId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(path, file);
  return { path: error ? null : path, error };
}

/** Short-lived signed link so HR (or the original referrer) can view/download a CV. */
export async function getResumeUrl(path) {
  if (!path) return { url: null, error: null };
  const { data, error } = await supabase.storage.from(RESUME_BUCKET).createSignedUrl(path, 3600);
  return { url: data?.signedUrl || null, error };
}

/**
 * Job postings visible to the caller — RLS already does the filtering (everyone
 * sees Open postings, admin additionally sees On Hold/Closed), so this is just
 * a plain select with no role branching needed client-side.
 */
export async function listJobPostings(tenantId) {
  const { data, error } = await supabase
    .from('job_postings')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createJobPosting(payload) {
  const { data, error } = await supabase.from('job_postings').insert([payload]).select().single();
  return { data, error };
}

export async function updateJobPosting(id, payload) {
  const { error } = await supabase.from('job_postings').update(payload).eq('id', id);
  return { error };
}

export async function deleteJobPosting(id) {
  const { error } = await supabase.from('job_postings').delete().eq('id', id);
  return { error };
}

/** An employee's own submitted referrals, across every posting. */
export async function listMyReferrals(profileId) {
  const { data, error } = await supabase
    .from('referrals')
    .select('*, job_postings(title, department)')
    .eq('referred_by', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** HR-side view — every referral in the tenant, optionally narrowed by status or posting. */
export async function listAllReferrals(tenantId, { status = '', jobPostingId = '' } = {}) {
  let q = supabase
    .from('referrals')
    .select('*, job_postings(title, department), referred_by_profile:profiles!referrals_referred_by_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (jobPostingId) q = q.eq('job_posting_id', jobPostingId);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function createReferral(payload) {
  const { data, error } = await supabase.from('referrals').insert([payload]).select().single();
  return { data, error };
}

export async function updateReferralStatus(id, status, hrNotes) {
  const { error } = await supabase.from('referrals').update({ status, hr_notes: hrNotes ?? '' }).eq('id', id);
  return { error };
}

// ── Recruitment pipeline (stage-driven) ─────────────────────────────────────

/** Every candidate under one requisition, via job_postings.headcount_request_id. */
export async function listReferralsForHeadcountRequest(headcountRequestId) {
  const { data, error } = await supabase
    .from('referrals')
    .select('*, job_postings!inner(id, title, headcount_request_id)')
    .eq('job_postings.headcount_request_id', headcountRequestId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Moves a candidate to `newStage`, keeping the legacy `status` field in sync
 * via STAGE_TO_STATUS in the same update — this is the only place
 * `referrals.status` should change for a pipeline-tracked candidate, so
 * ReferPage.jsx's status-only "my referrals" view keeps working unmodified.
 */
export async function advanceReferralStage(referralId, newStage, extra = {}) {
  const { data: before } = await supabase.from('referrals').select('tenant_id, candidate_name').eq('id', referralId).maybeSingle();

  const { error } = await supabase
    .from('referrals')
    .update({ stage: newStage, status: STAGE_TO_STATUS[newStage], ...extra })
    .eq('id', referralId);
  if (error) return { error };

  // HR should hear about the two checkpoints that matter most: an offer
  // going out, and a rejection — same "HR always hears about it" pattern
  // notifyRoles/withHrRole already use elsewhere in this file.
  if (before?.tenant_id && (newStage === 'Offer Accepted' || newStage === 'Rejected')) {
    await notifyRoles(before.tenant_id, withHrRole(['manager']), {
      type: newStage === 'Rejected' ? 'candidate_rejected' : 'offer_accepted',
      title: newStage === 'Rejected' ? 'Candidate rejected' : 'Offer accepted',
      body: `${before.candidate_name} — stage moved to "${newStage}".`,
      linkKey: 'recruitment_pipeline',
      relatedId: referralId,
    });
  }

  return { error: null };
}

export async function updateBgvStatus(referralId, status, notes) {
  const { error } = await supabase.from('referrals').update({ bgv_status: status, bgv_notes: notes ?? '' }).eq('id', referralId);
  return { error };
}

export async function updatePoliceVerificationStatus(referralId, status, notes) {
  const { error } = await supabase.from('referrals').update({ police_verification_status: status, police_verification_notes: notes ?? '' }).eq('id', referralId);
  return { error };
}

/**
 * Rejects a candidate at a specific interview round: logs the reason on
 * both the interview (round-specific) and the referral (roll-up, since a
 * candidate can also be rejected with no interview at all), then cascades
 * the referral into the terminal 'Rejected' stage in the same flow.
 */
export async function rejectInterview(interviewId, referralId, reason) {
  const { error: ivErr } = await supabase.from('interviews').update({ status: 'Rejected', rejection_reason: reason }).eq('id', interviewId);
  if (ivErr) return { error: ivErr };
  return advanceReferralStage(referralId, 'Rejected', { rejection_reason: reason });
}

/** PI Round's collected PIQ Form — mirrors uploadResume/getResumeUrl. */
export async function uploadPiqForm(tenantId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${tenantId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(PIQ_BUCKET).upload(path, file);
  return { path: error ? null : path, error };
}

export async function getPiqFormUrl(path) {
  if (!path) return { url: null, error: null };
  const { data, error } = await supabase.storage.from(PIQ_BUCKET).createSignedUrl(path, 3600);
  return { url: data?.signedUrl || null, error };
}

export async function attachPiqForm(interviewId, path) {
  const { error } = await supabase.from('interviews').update({ piq_form_path: path }).eq('id', interviewId);
  return { error };
}

/** "HR Manager assigns the position to a Recruiter" — SOP step 1. */
export async function assignRecruiter(tenantId, headcountRequestId, recruiterId, actorId) {
  const { error } = await supabase.from('headcount_requests').update({ assigned_recruiter_id: recruiterId }).eq('id', headcountRequestId);
  if (!error) {
    await notifyProfiles(tenantId, [recruiterId], {
      type: 'headcount_request_assigned',
      title: 'You were assigned a requisition',
      body: 'A headcount requisition was assigned to you as recruiter.',
      linkKey: 'recruitment_pipeline',
      actorId,
      relatedId: headcountRequestId,
    });
  }
  return { error };
}

// ── Headcount requests ──────────────────────────────────────────────────────
export async function listHeadcountRequests(tenantId) {
  const { data, error } = await supabase
    .from('headcount_requests')
    .select('*, outlet:outlets(name), requester:profiles!headcount_requests_requested_by_fkey(first_name, middle_name, last_name), recruiter:profiles!headcount_requests_assigned_recruiter_id_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createHeadcountRequest(tenantId, requestedBy, payload) {
  const { data: inserted, error } = await supabase.from('headcount_requests').insert([{
    tenant_id: tenantId, requested_by: requestedBy,
    outlet_id: payload.outlet_id || null, designation: payload.designation,
    count: parseInt(payload.count) || 1, justification: payload.justification || '',
    budget_amount: parseFloat(payload.budget_amount) || 0,
  }]).select('id').single();

  if (!error && inserted?.id) {
    await notifyRoles(tenantId, ['admin'], {
      type: 'headcount_request_submitted',
      title: 'New headcount request',
      body: `A new headcount request for ${payload.designation || 'a role'} needs your review.`,
      linkKey: 'headcount_requests',
      actorId: requestedBy,
      relatedId: inserted.id,
    }, requestedBy);
  }

  return { error };
}

export async function updateHeadcountRequestStatus(id, status, approvedBy) {
  const { data: req } = await supabase.from('headcount_requests').select('tenant_id, requested_by, designation').eq('id', id).single();

  const { error } = await supabase.from('headcount_requests').update({ status, approved_by: approvedBy }).eq('id', id);

  if (!error && req?.tenant_id && req?.requested_by) {
    await notifyProfiles(req.tenant_id, [req.requested_by], {
      type: `headcount_request_${status.toLowerCase()}`,
      title: `Headcount request ${status}`,
      body: `Your headcount request for ${req.designation || 'a role'} was ${status.toLowerCase()}.`,
      linkKey: 'headcount_requests',
      actorId: approvedBy,
      relatedId: id,
    });
  }
  return { error };
}

/** Approved-but-not-yet-fully-posted headcount requests — used to gate posting creation with a soft warning. */
export async function listApprovedOpenHeadcount(tenantId) {
  const { data, error } = await supabase
    .from('headcount_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'Approved');
  return { data: data || [], error };
}

// ── Interviews & feedback ───────────────────────────────────────────────────
export async function listInterviewsForReferral(referralId) {
  const { data, error } = await supabase
    .from('interviews')
    .select('*, interviewer:profiles!interviews_interviewer_id_fkey(first_name, middle_name, last_name), feedback:interview_feedback(*)')
    .eq('referral_id', referralId)
    .order('scheduled_at');
  return { data: data || [], error };
}

/** Interviews assigned to the calling interviewer, upcoming first — used for "My Interviews". */
export async function listMyInterviews(interviewerId) {
  const { data, error } = await supabase
    .from('interviews')
    .select('*, referral:referrals(candidate_name, job_postings(title))')
    .eq('interviewer_id', interviewerId)
    .order('scheduled_at');
  return { data: data || [], error };
}

export async function scheduleInterview(tenantId, createdBy, payload) {
  const { error } = await supabase.from('interviews').insert([{
    tenant_id: tenantId, referral_id: payload.referral_id, round_name: payload.round_name || 'Round 1',
    interviewer_id: payload.interviewer_id || null, scheduled_at: payload.scheduled_at || null, created_by: createdBy,
  }]);
  return { error };
}

export async function updateInterviewStatus(id, status) {
  const { error } = await supabase.from('interviews').update({ status }).eq('id', id);
  return { error };
}

export async function submitInterviewFeedback(interviewId, interviewerId, payload) {
  const { error } = await supabase.from('interview_feedback').upsert([{
    interview_id: interviewId, interviewer_id: interviewerId,
    ratings: payload.ratings || {}, recommendation: payload.recommendation, comments: payload.comments || '',
  }], { onConflict: 'interview_id,interviewer_id' });
  return { error };
}

// ── Offer letters ────────────────────────────────────────────────────────────
export async function listLetterTemplates(tenantId, type = null) {
  let q = supabase.from('letter_templates').select('*').eq('tenant_id', tenantId).order('name');
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function saveLetterTemplate(tenantId, payload, editId = null) {
  const row = { tenant_id: tenantId, type: payload.type, name: payload.name.trim(), body_html: payload.body_html };
  if (editId) {
    const { error } = await supabase.from('letter_templates').update(row).eq('id', editId);
    return { error };
  }
  const { error } = await supabase.from('letter_templates').insert([row]);
  return { error };
}

export async function deleteLetterTemplate(id) {
  const { error } = await supabase.from('letter_templates').delete().eq('id', id);
  return { error };
}

export async function listOfferLetters(tenantId) {
  const { data, error } = await supabase
    .from('offer_letters')
    .select('*, referral:referrals(candidate_name, candidate_email)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Simple {{placeholder}} string-replace — no templating engine needed for
 * this scale. Substituted values are HTML-escaped (the template body itself
 * is admin-authored and trusted, but fields like candidate_name come from a
 * referral an ordinary employee submitted, so they can't be trusted raw when
 * the result is rendered with dangerouslySetInnerHTML).
 */
export function renderLetter(bodyHtml, fields) {
  return (bodyHtml || '').replace(/\{\{(\w+)\}\}/g, (_, key) => (fields[key] != null ? escapeHtml(fields[key]) : ''));
}

export async function createOfferLetter(tenantId, createdBy, payload) {
  const { error } = await supabase.from('offer_letters').insert([{
    tenant_id: tenantId, referral_id: payload.referral_id, template_id: payload.template_id || null,
    letter_type: payload.letter_type || 'Offer',
    ctc_offered: parseFloat(payload.ctc_offered) || 0, joining_date: payload.joining_date || null,
    designation: payload.designation || '', rendered_html: payload.rendered_html || '', created_by: createdBy,
  }]);
  return { error };
}

export async function updateOfferLetterStatus(id, status) {
  const { error } = await supabase.from('offer_letters').update({ status }).eq('id', id);
  return { error };
}
