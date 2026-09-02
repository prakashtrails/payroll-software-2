import { supabase } from '@/lib/supabase';
import { notifyProfiles, notifyRoles } from './notificationService';

/** Own grievances (employee) — admin/superadmin also see everything via the same RLS-scoped query. */
export async function listMyGrievances(profileId) {
  const { data, error } = await supabase
    .from('grievances')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** All grievances for a tenant — RLS already restricts this to admin/superadmin callers. */
export async function listTenantGrievances(tenantId) {
  const { data, error } = await supabase
    .from('grievances')
    .select('*, profile:profiles!grievances_profile_id_fkey(first_name, middle_name, last_name, department)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function fileGrievance(tenantId, profileId, payload) {
  const { data: inserted, error } = await supabase.from('grievances').insert([{
    tenant_id: tenantId, profile_id: profileId, type: payload.type, description: payload.description,
  }]).select('id').single();

  if (!error && inserted?.id) {
    await notifyRoles(tenantId, ['admin'], {
      type: 'grievance_submitted',
      title: 'New grievance filed',
      body: `A new ${payload.type || ''} grievance needs your attention.`,
      linkKey: 'grievances',
      actorId: profileId,
      relatedId: inserted.id,
    }, profileId);
  }

  return { error };
}

export async function updateGrievance(id, payload) {
  // Only fetched when the update includes a status change, to notify the
  // employee who filed it — resolution-notes-only patches don't need this.
  const req = payload.status
    ? (await supabase.from('grievances').select('tenant_id, profile_id').eq('id', id).single()).data
    : null;

  const { error } = await supabase.from('grievances').update(payload).eq('id', id);

  if (!error && req?.tenant_id && req?.profile_id) {
    await notifyProfiles(req.tenant_id, [req.profile_id], {
      type: `grievance_${payload.status.toLowerCase().replace(/\s+/g, '_')}`,
      title: `Grievance ${payload.status}`,
      body: `Your grievance status was updated to ${payload.status}.`,
      linkKey: 'grievances',
      relatedId: id,
    });
  }
  return { error };
}
