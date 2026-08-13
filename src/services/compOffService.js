import { supabase } from '@/lib/supabase';

/**
 * Upserts the monthly comp off settlement records for a batch of employees
 * and increments comp_off_balance for those who earned a credit.
 *
 * records: Array of {
 *   profileId, totalWOs, workedWOs, compLeavesUsed,
 *   settlement: { type, credit }
 * }
 */
export async function settleWeeklyOffForMonth(tenantId, month, year, records) {
  if (!records.length) return;

  const now      = new Date().toISOString();
  const oneYear  = new Date();
  oneYear.setFullYear(oneYear.getFullYear() + 1);

  const payload = records.map(r => ({
    tenant_id:            tenantId,
    profile_id:           r.profileId,
    month:                month + 1,
    year,
    weekly_offs_in_month: r.totalWOs,
    weekly_offs_worked:   r.workedWOs,
    comp_leaves_used:     r.compLeavesUsed,
    settlement_type:      r.settlement.type,
    comp_offs_credited:   r.settlement.credit,
    settled_at:           now,
    expires_at:           r.settlement.credit > 0 ? oneYear.toISOString() : null,
  }));

  const { error } = await supabase
    .from('weekly_off_settlements')
    .upsert(payload, { onConflict: 'profile_id,month,year' });
  if (error) throw error;

  const credits = records
    .filter(r => r.settlement.credit > 0)
    .map(r => ({ profile_id: r.profileId, delta: r.settlement.credit }));

  if (credits.length > 0) {
    // One atomic bulk update instead of one RPC round-trip per employee —
    // same GREATEST(0, balance + delta) semantics as the single-row RPC.
    const { error: creditErr } = await supabase.rpc('bulk_adjust_comp_off_balance', { p_items: credits });
    if (creditErr) throw creditErr;
  }
}

/** Fetch monthly comp off settlements for all employees in a tenant. */
export async function fetchMonthlySettlements(tenantId, month, year) {
  const { data, error } = await supabase
    .from('weekly_off_settlements')
    .select('*, profile:profiles!weekly_off_settlements_profile_id_fkey(first_name, middle_name, last_name, ctc)')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year);
  return { data: data || [], error };
}
