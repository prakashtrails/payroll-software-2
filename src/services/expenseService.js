import { supabase } from '@/lib/supabase';

const RECEIPT_BUCKET = 'expense-receipts';
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const EXPENSE_CATEGORIES = ['Travel', 'Meals', 'Accommodation', 'Supplies', 'Client Entertainment', 'Other'];

export async function uploadReceipt(tenantId, profileId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${tenantId}/${profileId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file);
  return { path: error ? null : path, error };
}

export async function getReceiptUrl(path) {
  if (!path) return { url: null, error: null };
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 3600);
  return { url: data?.signedUrl || null, error };
}

export async function listMyExpenseClaims(profileId) {
  const { data, error } = await supabase
    .from('expense_claims')
    .select('*, items:expense_claim_items(*)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function listTenantExpenseClaims(tenantId) {
  const { data, error } = await supabase
    .from('expense_claims')
    .select('*, items:expense_claim_items(*), profile:profiles!expense_claims_profile_id_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Creates the claim + its line items in one call (items already have amount/category/description/receipt_path). */
export async function createExpenseClaim(tenantId, profileId, advanceId, items) {
  const totalAmount = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const { data: claim, error } = await supabase.from('expense_claims').insert([{
    tenant_id: tenantId, profile_id: profileId, advance_id: advanceId || null, total_amount: totalAmount,
  }]).select().single();
  if (error) return { error };

  const rows = items.map((i) => ({ claim_id: claim.id, category: i.category, amount: Number(i.amount) || 0, description: i.description || '', receipt_path: i.receipt_path || '' }));
  const { error: itemErr } = await supabase.from('expense_claim_items').insert(rows);
  return { error: itemErr, claimId: claim.id };
}

export async function rejectExpenseClaim(id) {
  const { error } = await supabase.from('expense_claims').update({ status: 'Rejected' }).eq('id', id);
  return { error };
}

/** Approves and either nets against the linked advance or adds a reimbursement to this month's one-off pay items. */
export async function approveExpenseClaim(id, month, year) {
  const { error } = await supabase.rpc('approve_expense_claim', { p_claim_id: id, p_month: month, p_year: year });
  return { error };
}

export async function deleteExpenseClaim(id) {
  const { error } = await supabase.from('expense_claims').delete().eq('id', id);
  return { error };
}
