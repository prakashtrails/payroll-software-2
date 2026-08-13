import { supabase } from '@/lib/supabase';
import { escapeHtml } from '@/lib/helpers';

export const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
export const REFERRAL_STATUSES = ['Submitted', 'Under Review', 'Shortlisted', 'Hired', 'Not Selected'];

const RESUME_BUCKET = 'referral-resumes';
export const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const RESUME_ACCEPT = '.pdf,.doc,.docx';

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

// ── Headcount requests ──────────────────────────────────────────────────────
export async function listHeadcountRequests(tenantId) {
  const { data, error } = await supabase
    .from('headcount_requests')
    .select('*, outlet:outlets(name), requester:profiles!headcount_requests_requested_by_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createHeadcountRequest(tenantId, requestedBy, payload) {
  const { error } = await supabase.from('headcount_requests').insert([{
    tenant_id: tenantId, requested_by: requestedBy,
    outlet_id: payload.outlet_id || null, designation: payload.designation,
    count: parseInt(payload.count) || 1, justification: payload.justification || '',
    budget_amount: parseFloat(payload.budget_amount) || 0,
  }]);
  return { error };
}

export async function updateHeadcountRequestStatus(id, status, approvedBy) {
  const { error } = await supabase.from('headcount_requests').update({ status, approved_by: approvedBy }).eq('id', id);
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
    ctc_offered: parseFloat(payload.ctc_offered) || 0, joining_date: payload.joining_date || null,
    designation: payload.designation || '', rendered_html: payload.rendered_html || '', created_by: createdBy,
  }]);
  return { error };
}

export async function updateOfferLetterStatus(id, status) {
  const { error } = await supabase.from('offer_letters').update({ status }).eq('id', id);
  return { error };
}
