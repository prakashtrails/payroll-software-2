import { supabase } from '@/lib/supabase';
import { DEFAULT_INDIA_NEW_REGIME_SLABS, currentFinancialYear } from '@/lib/helpers';

/** All tax slab configs for a tenant (any financial year), newest first. */
export async function listTaxSlabs(tenantId) {
  const { data, error } = await supabase
    .from('tax_slabs')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('financial_year', { ascending: false });
  return { data: data || [], error };
}

/** The active slab row for a given financial year, seeding a default India new-regime row on first use. */
export async function fetchActiveTaxSlab(tenantId, financialYear = currentFinancialYear()) {
  const { data, error } = await supabase
    .from('tax_slabs')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('financial_year', financialYear)
    .eq('is_active', true)
    .maybeSingle();
  if (error || data) return { data: data || null, error };

  // Lazily seed a default so payroll never blocks on missing config.
  const { data: seeded, error: seedErr } = await supabase
    .from('tax_slabs')
    .insert([{
      tenant_id: tenantId,
      regime: 'New',
      financial_year: financialYear,
      slabs: DEFAULT_INDIA_NEW_REGIME_SLABS,
    }])
    .select()
    .single();
  return { data: seeded || null, error: seedErr };
}

export async function saveTaxSlab(tenantId, payload, editId = null) {
  const row = {
    tenant_id: tenantId,
    regime: payload.regime,
    financial_year: payload.financial_year.trim(),
    standard_deduction: parseFloat(payload.standard_deduction) || 0,
    rebate_threshold: parseFloat(payload.rebate_threshold) || 0,
    cess_percent: parseFloat(payload.cess_percent) || 0,
    slabs: payload.slabs,
    is_active: payload.is_active !== false,
  };
  if (editId) {
    const { error } = await supabase.from('tax_slabs').update(row).eq('id', editId);
    return { error };
  }
  const { error } = await supabase.from('tax_slabs').insert([row]);
  return { error };
}

export async function deleteTaxSlab(id) {
  const { error } = await supabase.from('tax_slabs').delete().eq('id', id);
  return { error };
}

/** One employee's own declarations for a financial year. */
export async function listMyDeclarations(profileId, financialYear = currentFinancialYear()) {
  const { data, error } = await supabase
    .from('tax_declarations')
    .select('*')
    .eq('profile_id', profileId)
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Every employee's declarations for a tenant/FY, grouped by profile_id — used by payroll processing. */
export async function fetchDeclarationsForTenant(tenantId, financialYear = currentFinancialYear()) {
  const { data, error } = await supabase
    .from('tax_declarations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('financial_year', financialYear);

  const byProfile = {};
  (data || []).forEach((d) => {
    (byProfile[d.profile_id] ||= []).push(d);
  });
  return { data: byProfile, error };
}

export async function saveDeclaration(tenantId, profileId, payload, editId = null) {
  const row = {
    tenant_id: tenantId,
    profile_id: profileId,
    financial_year: payload.financial_year || currentFinancialYear(),
    category: payload.category,
    sub_category: payload.sub_category || '',
    declared_amount: parseFloat(payload.declared_amount) || 0,
    proof_url: payload.proof_url || '',
  };
  if (editId) {
    const { error } = await supabase.from('tax_declarations').update(row).eq('id', editId);
    return { error };
  }
  const { error } = await supabase.from('tax_declarations').insert([row]);
  return { error };
}

export async function deleteDeclaration(id) {
  const { error } = await supabase.from('tax_declarations').delete().eq('id', id);
  return { error };
}
