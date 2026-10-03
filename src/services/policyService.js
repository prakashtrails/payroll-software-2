import { supabase } from '@/lib/supabase';
import { notifyTenant, notifyRoles } from './notificationService';
import { fullName } from '@/lib/helpers';

const BUCKET = 'policy-pdfs';

/** List policy roll-outs for a tenant, newest first. */
export async function listPolicies(tenantId) {
  const { data, error } = await supabase
    .from('policies')
    .select('*, author:profile_directory!policies_created_by_fkey(first_name, middle_name, last_name)')
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
      .upload(path, pdfFile, { contentType: pdfFile.type || 'application/octet-stream' });
    if (uploadErr) return { error: uploadErr };

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    pdf_url = pub.publicUrl;
    pdf_name = pdfFile.name;
  }

  const { data: inserted, error } = await supabase
    .from('policies')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, body, pdf_url, pdf_name }])
    .select('id')
    .single();

  if (!error && inserted?.id) {
    await notifyTenant(tenantId, {
      type: 'policy',
      title: 'New policy published',
      body: title,
      linkKey: 'policies',
      actorId: createdBy,
      relatedId: inserted.id,
    }, createdBy);
  }

  return { error };
}

/** Admin-only: delete a policy roll-out. */
export async function deletePolicy(id) {
  const { error } = await supabase.from('policies').delete().eq('id', id);
  return { error };
}

/**
 * Records that a user has read & acknowledged a policy. Idempotent —
 * re-acknowledging is a silent no-op. Notifies HR/admins of who
 * acknowledged, and when, so they don't have to go check.
 */
export async function acknowledgePolicy(policyId, profile, tenantId, policyTitle) {
  const { error } = await supabase
    .from('policy_acknowledgements')
    .upsert([{ policy_id: policyId, profile_id: profile.id, tenant_id: tenantId, source: 'web' }], {
      onConflict: 'policy_id,profile_id',
      ignoreDuplicates: true,
    });

  if (!error) {
    await notifyRoles(tenantId, ['admin'], {
      type: 'policy_ack',
      title: 'Policy acknowledged',
      body: `${fullName(profile)} acknowledged "${policyTitle}"`,
      linkKey: 'policies',
      actorId: profile.id,
      relatedId: policyId,
    }, profile.id);
  }

  return { error };
}

/** Map of policyId -> acknowledged_at for the current user's own acknowledgements. */
export async function listMyAcknowledgements(tenantId, profileId) {
  const { data, error } = await supabase
    .from('policy_acknowledgements')
    .select('policy_id, acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId);

  const map = {};
  (data || []).forEach((row) => { map[row.policy_id] = row.acknowledged_at; });
  return { data: map, error };
}

/** Map of policyId -> acknowledgement count, for the admin summary badge. */
export async function countAcknowledgements(tenantId) {
  const { data, error } = await supabase
    .from('policy_acknowledgements')
    .select('policy_id')
    .eq('tenant_id', tenantId);

  const map = {};
  (data || []).forEach((row) => { map[row.policy_id] = (map[row.policy_id] || 0) + 1; });
  return { data: map, error };
}

/**
 * Logs that the current user downloaded/opened a policy's attachment
 * (policy_downloads keeps one row per download — table owned by the app
 * team's policy_ack_source_and_downloads migration). Fire-and-forget: a
 * failure never blocks the download itself.
 */
export async function recordPolicyDownload(policyId, profileId, tenantId) {
  const { error } = await supabase
    .from('policy_downloads')
    .insert([{ policy_id: policyId, profile_id: profileId, tenant_id: tenantId, source: 'web' }]);
  return { error };
}

/**
 * Admin-only: per-employee status for one policy — who acknowledged and/or
 * downloaded it, when, and from which device (web or mobile app). Returns
 * two maps keyed by profile_id; the page joins them onto the employee list
 * so HR also sees who has NOT done either yet.
 */
export async function fetchPolicyAudit(policyId) {
  const [acks, downloads] = await Promise.all([
    supabase.from('policy_acknowledgements').select('profile_id, acknowledged_at, source').eq('policy_id', policyId),
    // Ascending, so toMap's last-write-wins keeps each person's latest download.
    supabase.from('policy_downloads').select('profile_id, downloaded_at, source').eq('policy_id', policyId).order('downloaded_at'),
  ]);
  const toMap = (rows) => Object.fromEntries((rows || []).map((r) => [r.profile_id, r]));
  return {
    acks: toMap(acks.data),
    downloads: toMap(downloads.data),
    error: acks.error || downloads.error,
  };
}
