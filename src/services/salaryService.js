import { supabase } from '@/lib/supabase';

export async function listComponents(tenantId) {
  const { data, error } = await supabase
    .from('salary_components')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

export async function saveComponent(tenantId, payload, editId = null) {
  const row = {
    tenant_id: tenantId,
    name:      payload.name.trim(),
    category:  payload.category,
    calc_type: payload.calc_type,
    percent:   parseFloat(payload.percent) || 0,
    fixed:     parseFloat(payload.fixed)   || 0,
  };

  if (editId) {
    const { error } = await supabase.from('salary_components').update(row).eq('id', editId);
    return { error };
  }
  const { error } = await supabase.from('salary_components').insert([row]);
  return { error };
}

export async function deleteComponent(id) {
  const { error } = await supabase.from('salary_components').delete().eq('id', id);
  return { error };
}
