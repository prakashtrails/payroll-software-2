import { supabase } from '@/lib/supabase';

/** List announcements for a tenant, newest first. */
export async function listAnnouncements(tenantId) {
  const { data, error } = await supabase
    .from('announcements')
    .select('*, author:profiles!announcements_created_by_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Admin-only: create a new announcement, visible to the whole tenant. */
export async function createAnnouncement({ tenantId, createdBy, title, body }) {
  const { error } = await supabase
    .from('announcements')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, body }]);
  return { error };
}

/** Admin-only: delete an announcement. */
export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  return { error };
}
