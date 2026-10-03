import { supabase } from '@/lib/supabase';
import { notifyTenant } from './notificationService';

/** List announcements for a tenant, newest first. `limit` caps the rows fetched (e.g. the Home dashboard). */
export async function listAnnouncements(tenantId, { limit } = {}) {
  let query = supabase
    .from('announcements')
    .select('*, author:profile_directory!announcements_created_by_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  return { data: data || [], error };
}

/** Admin-only: create a new announcement, visible to the whole tenant. Notifies every other tenant member. */
export async function createAnnouncement({ tenantId, createdBy, title, body }) {
  const { data: inserted, error } = await supabase
    .from('announcements')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, body }])
    .select('id')
    .single();

  if (!error && inserted?.id) {
    await notifyTenant(tenantId, {
      type: 'announcement',
      title: 'New announcement',
      body: title,
      linkKey: 'announcements',
      actorId: createdBy,
      relatedId: inserted.id,
    }, createdBy);
  }

  return { error };
}

/** Admin-only: delete an announcement. */
export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  return { error };
}

/** Records that a user has read & acknowledged an announcement. Idempotent — re-acknowledging is a silent no-op. */
export async function acknowledgeAnnouncement(announcementId, profileId, tenantId) {
  const { error } = await supabase
    .from('announcement_acknowledgements')
    .upsert([{ announcement_id: announcementId, profile_id: profileId, tenant_id: tenantId }], {
      onConflict: 'announcement_id,profile_id',
      ignoreDuplicates: true,
    });
  return { error };
}

/** Map of announcementId -> acknowledged_at for the current user's own acknowledgements. */
export async function listMyAcknowledgements(tenantId, profileId) {
  const { data, error } = await supabase
    .from('announcement_acknowledgements')
    .select('announcement_id, acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId);

  const map = {};
  (data || []).forEach((row) => { map[row.announcement_id] = row.acknowledged_at; });
  return { data: map, error };
}

/** Map of announcementId -> acknowledgement count, for the admin view. */
export async function countAcknowledgements(tenantId) {
  const { data, error } = await supabase
    .from('announcement_acknowledgements')
    .select('announcement_id')
    .eq('tenant_id', tenantId);

  const map = {};
  (data || []).forEach((row) => { map[row.announcement_id] = (map[row.announcement_id] || 0) + 1; });
  return { data: map, error };
}
