import { supabase } from '@/lib/supabase';

// ---- Review cycles ----
export async function listReviewCycles(tenantId) {
  const { data, error } = await supabase
    .from('review_cycles')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('start_date', { ascending: false });
  return { data: data || [], error };
}

export async function createReviewCycle({ tenantId, name, startDate, endDate, createdBy }) {
  const { data, error } = await supabase
    .from('review_cycles')
    .insert([{ tenant_id: tenantId, name, start_date: startDate, end_date: endDate, created_by: createdBy }])
    .select()
    .single();
  return { data, error };
}

export async function updateReviewCycleStatus(id, status) {
  const { error } = await supabase.from('review_cycles').update({ status }).eq('id', id);
  return { error };
}

// ---- Review questions (per cycle) ----
export async function listReviewQuestions(cycleId) {
  const { data, error } = await supabase
    .from('review_questions')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('order_index');
  return { data: data || [], error };
}

export async function addReviewQuestion({ tenantId, cycleId, questionText, orderIndex }) {
  const { error } = await supabase
    .from('review_questions')
    .insert([{ tenant_id: tenantId, cycle_id: cycleId, question_text: questionText, order_index: orderIndex || 0 }]);
  return { error };
}

export async function deleteReviewQuestion(id) {
  const { error } = await supabase.from('review_questions').delete().eq('id', id);
  return { error };
}

// ---- Reviews (per-employee instance of a cycle) ----
const REVIEW_LIST_SELECT = `
  *,
  cycle:review_cycles(*),
  employee:profiles!reviews_profile_id_fkey(first_name, middle_name, last_name),
  reporting_manager:profiles!reviews_reporting_manager_id_fkey(first_name, middle_name, last_name)
`;

export async function listMyReviews(tenantId, profileId) {
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_LIST_SELECT)
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function listReviewsGivenToOthers(tenantId, profileId) {
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_LIST_SELECT)
    .eq('tenant_id', tenantId)
    .eq('reporting_manager_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function listAllReviews(tenantId) {
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_LIST_SELECT)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Admin: start a review instance for an employee within a cycle (idempotent on cycle+employee). */
export async function startReview({ tenantId, cycleId, profileId, reportingManagerId }) {
  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      [{ tenant_id: tenantId, cycle_id: cycleId, profile_id: profileId, reporting_manager_id: reportingManagerId || null }],
      { onConflict: 'cycle_id,profile_id', ignoreDuplicates: true }
    )
    .select()
    .maybeSingle();
  return { data, error };
}

/**
 * Bulk-apply a cycle to every employee in `profiles` (each { profile_id,
 * manager_id }) in one call, instead of starting reviews one by one — same
 * idempotent upsert as startReview, just batched.
 */
export async function bulkStartReviews({ tenantId, cycleId, profiles }) {
  if (!profiles?.length) return { count: 0, error: null };
  const rows = profiles.map((p) => ({
    tenant_id: tenantId, cycle_id: cycleId, profile_id: p.profile_id, reporting_manager_id: p.manager_id || null,
  }));
  const { error } = await supabase.from('reviews').upsert(rows, { onConflict: 'cycle_id,profile_id', ignoreDuplicates: true });
  return { count: rows.length, error };
}

/** Full detail for the review form: questions, answers, and the employee's KRAs with any ratings. */
export async function getReviewDetail(reviewId) {
  const { data: review, error: reviewErr } = await supabase
    .from('reviews')
    .select(REVIEW_LIST_SELECT)
    .eq('id', reviewId)
    .single();
  if (reviewErr) return { error: reviewErr };

  const [{ data: questions }, { data: answers }, { data: kras }, { data: kraRatings }] = await Promise.all([
    supabase.from('review_questions').select('*').eq('cycle_id', review.cycle_id).order('order_index'),
    supabase.from('review_answers').select('*, answerer:profiles!review_answers_answered_by_fkey(first_name, middle_name, last_name)').eq('review_id', reviewId),
    supabase.from('kras').select('*, kra_kpis(*)').eq('profile_id', review.profile_id),
    supabase.from('review_kra_ratings').select('*, rater:profiles!review_kra_ratings_rated_by_fkey(first_name, middle_name, last_name)').eq('review_id', reviewId),
  ]);

  return {
    data: {
      review,
      questions: questions || [],
      answers: answers || [],
      kras: kras || [],
      kraRatings: kraRatings || [],
    },
    error: null,
  };
}

export async function submitReviewAnswer({ reviewId, questionId, answeredBy, rating, comment }) {
  const { error } = await supabase
    .from('review_answers')
    .upsert(
      [{ review_id: reviewId, question_id: questionId, answered_by: answeredBy, rating: rating ?? null, comment: comment || '' }],
      { onConflict: 'review_id,question_id,answered_by' }
    );
  if (!error) await supabase.from('reviews').update({ status: 'In Progress' }).eq('id', reviewId).eq('status', 'Not Started');
  return { error };
}

export async function submitReviewKraRating({ reviewId, kraId, ratedBy, rating, feedbackText }) {
  const { error } = await supabase
    .from('review_kra_ratings')
    .upsert(
      [{ review_id: reviewId, kra_id: kraId, rated_by: ratedBy, rating: rating ?? null, feedback_text: feedbackText || '' }],
      { onConflict: 'review_id,kra_id,rated_by' }
    );
  return { error };
}

export async function completeReview(id, overallRating) {
  const { error } = await supabase.from('reviews').update({ status: 'Completed', overall_rating: overallRating ?? null }).eq('id', id);
  return { error };
}
