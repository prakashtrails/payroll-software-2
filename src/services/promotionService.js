import { supabase } from '@/lib/supabase';

/** List all promotions for an employee. */
export async function listEmployeePromotions(profileId) {
  const { data, error } = await supabase
    .from('employee_promotions')
    .select('*, created_by_profile:profiles!employee_promotions_created_by_fkey(first_name, middle_name, last_name)')
    .eq('profile_id', profileId)
    .order('effective_date', { ascending: false });
  return { data: data || [], error };
}

/**
 * Record a promotion/increment.
 * Also updates the employee's current designation and CTC.
 */
export async function recordPromotion(tenantId, profileId, {
  effectiveDate, oldDesignation, newDesignation, oldCtc, newCtc, notes, createdBy,
}) {
  const { error: histErr } = await supabase
    .from('employee_promotions')
    .insert([{
      tenant_id:       tenantId,
      profile_id:      profileId,
      effective_date:  effectiveDate,
      old_designation: oldDesignation || null,
      new_designation: newDesignation || null,
      old_ctc:         oldCtc  || null,
      new_ctc:         newCtc  || null,
      notes:           notes   || null,
      created_by:      createdBy,
    }]);
  if (histErr) return { error: histErr };

  const updates = {};
  if (newDesignation) updates.designation = newDesignation;
  if (newCtc)         updates.ctc         = newCtc;

  if (Object.keys(updates).length > 0) {
    const { error: profErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profileId);
    if (profErr) return { error: profErr };
  }

  return { error: null };
}
