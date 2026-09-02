import { supabase } from '@/lib/supabase';
import { notifyProfiles } from './notificationService';

// ── Inventory ────────────────────────────────────────────────────────────
export async function listAssets(tenantId) {
  const { data, error } = await supabase.from('assets').select('*').eq('tenant_id', tenantId).order('name');
  return { data: data || [], error };
}
export async function createAsset(tenantId, payload) {
  const { error } = await supabase.from('assets').insert([{
    tenant_id: tenantId, name: payload.name.trim(), category: payload.category || 'General',
    serial_number: payload.serial_number || '', purchase_date: payload.purchase_date || null, notes: payload.notes || '',
  }]);
  return { error };
}
export async function updateAsset(id, payload) {
  const { error } = await supabase.from('assets').update(payload).eq('id', id);
  return { error };
}
export async function deleteAsset(id) {
  const { error } = await supabase.from('assets').delete().eq('id', id);
  return { error };
}

// ── Assignments ──────────────────────────────────────────────────────────
export async function listAssignments(tenantId) {
  const { data, error } = await supabase
    .from('asset_assignments')
    .select('*, asset:assets(name, category, serial_number), profile:profiles!asset_assignments_profile_id_fkey(first_name, middle_name, last_name, department)')
    .eq('tenant_id', tenantId)
    .order('assigned_at', { ascending: false });
  return { data: data || [], error };
}

/** Assets currently (and previously) assigned to one employee. */
export async function listMyAssignments(profileId) {
  const { data, error } = await supabase
    .from('asset_assignments')
    .select('*, asset:assets(name, category, serial_number)')
    .eq('profile_id', profileId)
    .order('assigned_at', { ascending: false });
  return { data: data || [], error };
}

export async function assignAsset(tenantId, assetId, profileId, createdBy) {
  const { error } = await supabase.from('asset_assignments').insert([{
    tenant_id: tenantId, asset_id: assetId, profile_id: profileId, created_by: createdBy,
  }]);
  if (error) return { error };

  await supabase.from('assets').update({ status: 'Assigned' }).eq('id', assetId);

  await notifyProfiles(tenantId, [profileId], {
    type: 'asset_assigned',
    title: 'Asset assigned to you',
    body: 'A company asset has been assigned to you — check My Assets for details.',
    linkKey: 'my-assets',
  });

  return { error: null };
}

export async function returnAsset(tenantId, assignmentId, assetId, conditionNotes = '') {
  const { error } = await supabase.from('asset_assignments').update({
    returned_at: new Date().toISOString().slice(0, 10), condition_notes: conditionNotes,
  }).eq('id', assignmentId);
  if (error) return { error };

  await supabase.from('assets').update({ status: 'Available' }).eq('id', assetId);
  return { error: null };
}
