import { supabase } from '@/lib/supabase';

const BUCKET = 'policy-pdfs';

/** List policy roll-outs for a tenant, newest first. */
export async function listPolicies(tenantId) {
  const { data, error } = await supabase
    .from('policies')
    .select('*, author:profiles!policies_created_by_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Admin-only: upload a policy PDF and create the policy record.
 * pdfFile may be null if the admin only wants to post text.
 */
export async function createPolicy({ tenantId, createdBy, title, body, pdfFile }) {
  let pdf_url = '';
  let pdf_name = '';

  if (pdfFile) {
    const path = `${tenantId}/${Date.now()}-${pdfFile.name}`;
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, pdfFile, { contentType: 'application/pdf' });
    if (uploadErr) return { error: uploadErr };

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    pdf_url = pub.publicUrl;
    pdf_name = pdfFile.name;
  }

  const { error } = await supabase
    .from('policies')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, body, pdf_url, pdf_name }]);
  return { error };
}

/** Admin-only: delete a policy roll-out. */
export async function deletePolicy(id) {
  const { error } = await supabase.from('policies').delete().eq('id', id);
  return { error };
}
