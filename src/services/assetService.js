import { supabase } from '@/lib/supabase';
import { notifyProfiles } from './notificationService';

// ── Inventory ────────────────────────────────────────────────────────────
export async function listAssets(tenantId) {
  const { data, error } = await supabase
    .from('assets')
    .select('*, outlet:outlets(name)')
    .eq('tenant_id', tenantId)
    .order('name');
  return { data: data || [], error };
}
export async function createAsset(tenantId, payload) {
  const { error } = await supabase.from('assets').insert([{
    tenant_id: tenantId, name: payload.name.trim(), category: payload.category || 'General',
    serial_number: payload.serial_number || '', purchase_date: payload.purchase_date || null, notes: payload.notes || '',
    outlet_id: payload.outlet_id || null,
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
    .select('*, asset:assets(name, category, serial_number), profile:profile_directory!asset_assignments_profile_id_fkey(first_name, middle_name, last_name, department)')
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
  // 23505 = unique_violation on idx_asset_assignments_one_active_per_asset —
  // this asset already has an active (unreturned) assignment, most likely a
  // duplicate submit (e.g. a double-click) rather than a real second assign.
  if (error?.code === '23505') return { error: { message: 'This asset is already assigned to someone — refresh and try again.' } };
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

// ── Presets ──────────────────────────────────────────────────────────────
// A tenant-scoped catalog admins can seed once HR sends the standard
// equipment list, so "Add Asset" can offer autocomplete instead of pure
// free text — see listAssetPresets() consumers in AssetsPage.jsx.
export async function listAssetPresets(tenantId) {
  const { data, error } = await supabase
    .from('asset_presets')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  return { data: data || [], error };
}

/** Admin-only: add one preset. Silently ignores an exact-name duplicate. */
export async function createAssetPreset(tenantId, createdBy, name, category = 'General') {
  const { error } = await supabase.from('asset_presets').insert([{
    tenant_id: tenantId, created_by: createdBy, name: name.trim(), category: category.trim() || 'General',
  }]);
  return { error };
}

/**
 * Admin-only: bulk-add presets from pasted text, one per line, as
 * "Name" or "Name, Category". Skips blank lines. Returns how many rows
 * were inserted.
 */
export async function bulkCreateAssetPresets(tenantId, createdBy, text) {
  const rows = (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, category] = line.split(',').map((s) => s.trim());
      return { tenant_id: tenantId, created_by: createdBy, name, category: category || 'General' };
    })
    .filter((r) => r.name);

  if (rows.length === 0) return { count: 0, error: null };
  const { error } = await supabase.from('asset_presets').insert(rows);
  return { count: rows.length, error };
}

export async function deleteAssetPreset(id) {
  const { error } = await supabase.from('asset_presets').delete().eq('id', id);
  return { error };
}
