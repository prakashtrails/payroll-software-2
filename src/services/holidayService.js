import { supabase } from '@/lib/supabase';

export async function fetchHolidays(tenantId, year, month) {
  let query = supabase
    .from('holidays')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('date', { ascending: true });

  if (year) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    query = query.gte('date', start).lte('date', end);
  }

  const { data, error } = await query;
  if (error) {
    console.error('fetchHolidays err:', error);
    return { data: [], error };
  }
  return { data, error: null };
}

export async function addHoliday(tenantId, name, date, type = 'Public Holiday') {
  const { data, error } = await supabase
    .from('holidays')
    .insert([{ tenant_id: tenantId, name, date, type }])
    .select()
    .single();
  return { data, error };
}

export async function deleteHoliday(id) {
  const { error } = await supabase.from('holidays').delete().eq('id', id);
  return { error };
}

// Optional Holidays
export async function fetchMyOptionalHolidays(profileId) {
  const { data, error } = await supabase
    .from('employee_optional_holidays')
    .select('id, holiday_id')
    .eq('profile_id', profileId);
  return { data: data || [], error };
}

export async function addMyOptionalHoliday(tenantId, profileId, holidayId) {
  const { data, error } = await supabase
    .from('employee_optional_holidays')
    .insert([{ tenant_id: tenantId, profile_id: profileId, holiday_id: holidayId }])
    .select()
    .single();
  return { data, error };
}

export async function removeMyOptionalHoliday(id) {
  const { error } = await supabase.from('employee_optional_holidays').delete().eq('id', id);
  return { error };
}
