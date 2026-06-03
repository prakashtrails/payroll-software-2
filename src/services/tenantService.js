import { supabase } from '@/lib/supabase';

const normalizeHoliday = (holiday) => {
  const dateValue = holiday.holiday_date || holiday.date;
  return {
    ...holiday,
    holiday_date: dateValue,
    date: dateValue,
    description: holiday.description || holiday.type || '',
    status: holiday.status || 'Approved',
    requested_by: holiday.requested_by || null,
    approved_by: holiday.approved_by || null,
    approved_at: holiday.approved_at || null,
    updated_at: holiday.updated_at || holiday.created_at || null,
  };
};

export async function updateTenant(tenantId, payload) {
  const { error } = await supabase.from('tenants').update(payload).eq('id', tenantId);
  return { error };
}

export async function listDepartments(tenantId) {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  return { data: data || [], error };
}

export async function addDepartment(tenantId, name) {
  const { error } = await supabase
    .from('departments')
    .insert([{ tenant_id: tenantId, name: name.trim() }]);
  return { error };
}

export async function removeDepartment(id) {
  const { error } = await supabase.from('departments').delete().eq('id', id);
  return { error };
}

export async function listShifts(tenantId) {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  return { data: data || [], error };
}

export async function addShift(tenantId, shift) {
  const { error } = await supabase
    .from('shifts')
    .insert([{ ...shift, tenant_id: tenantId }]);
  return { error };
}

export async function listHolidays(tenantId) {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('date', { ascending: true });

  return { data: (data || []).map(normalizeHoliday), error };
}

export async function addHoliday(tenantId, holiday) {
  const { error } = await supabase
    .from('holidays')
    .insert([{
      tenant_id: tenantId,
      name: holiday.name,
      date: holiday.date || holiday.holiday_date,
      type: holiday.type || holiday.description || 'Public Holiday',
    }]);
  return { error };
}

export async function importHolidays(tenantId, holidays) {
  const rows = holidays.map((h) => ({
    tenant_id: tenantId,
    name: h.name,
    date: h.date || h.holiday_date,
    type: h.type || h.description || 'Public Holiday',
  }));
  const { error } = await supabase
    .from('holidays')
    .upsert(rows, { onConflict: 'tenant_id,date', ignoreDuplicates: true });
  return { error };
}

export async function updateHolidayStatus(holidayId, status) {
  const { error } = await supabase
    .from('holidays')
    .update({ status })
    .eq('id', holidayId);
  return { error };
}

export async function initializeMajorHolidays(tenantId) {
  // The initialize_major_holidays RPC does not exist in the DB — insert directly.
  const year = new Date().getFullYear();
  const rows = [
    { tenant_id: tenantId, name: 'Republic Day',    date: `${year}-01-26`, type: 'Public Holiday' },
    { tenant_id: tenantId, name: 'Holi',            date: `${year}-03-14`, type: 'Festival of colors' },
    { tenant_id: tenantId, name: 'Labour Day',      date: `${year}-05-01`, type: "International Workers' Day" },
    { tenant_id: tenantId, name: 'Independence Day',date: `${year}-08-15`, type: 'National holiday' },
    { tenant_id: tenantId, name: 'Gandhi Jayanti',  date: `${year}-10-02`, type: 'National holiday' },
    { tenant_id: tenantId, name: 'Diwali',          date: `${year}-10-31`, type: 'Festival of lights' },
    { tenant_id: tenantId, name: 'Christmas Day',   date: `${year}-12-25`, type: 'Major festival' },
  ];
  const { error } = await supabase
    .from('holidays')
    .upsert(rows, { onConflict: 'tenant_id,date', ignoreDuplicates: true });
  return { error };
}

export async function removeShift(id) {
  const { error } = await supabase.from('shifts').delete().eq('id', id);
  return { error };
}

/** Aggregate dashboard stats — all queries run in parallel. */
export async function fetchDashboardStats(tenantId) {
  const [empsRes, payrollRes, advRes] = await Promise.all([
    supabase.from('profiles').select('ctc').eq('tenant_id', tenantId).eq('role', 'employee').eq('status', 'Active'),
    supabase.from('payrolls').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'Processed'),
    supabase.from('advances').select('balance').eq('tenant_id', tenantId).eq('status', 'Active'),
  ]);

  const activeEmployees     = empsRes.data?.length || 0;
  const totalCTC            = empsRes.data?.reduce((s, e) => s + (e.ctc || 0), 0) || 0;
  const processedPayrolls   = payrollRes.count || 0;
  const outstandingAdvances = advRes.data?.reduce((s, a) => s + (a.balance || 0), 0) || 0;
  const error               = empsRes.error || payrollRes.error || advRes.error;

  return { activeEmployees, totalCTC, processedPayrolls, outstandingAdvances, error };
}

/** All tenants — superadmin only. */
export async function listAllTenants() {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Returns the company name for a given org code, or null if not found.
 * Callable before login (anon) — used for the join-company preview.
 */
export async function lookupOrgCode(orgCode) {
  if (!orgCode || orgCode.trim().length < 4) return { companyName: null, error: null };
  const { data, error } = await supabase.rpc('lookup_org', { p_org_code: orgCode.trim() });
  return { companyName: data || null, error };
}

/**
 * Called after supabase.auth.signUp() during employee self-signup.
 * Finds the tenant by org code and creates the employee profile.
 */
export async function employeeJoinWorkspace(orgCode, firstName, lastName, userId) {
  const { data, error } = await supabase.rpc('employee_join_workspace', {
    p_org_code:   orgCode.trim().toUpperCase(),
    p_first_name: firstName.trim(),
    p_last_name:  lastName.trim(),
    p_user_id:    userId || null,
  });
  if (error) throw error;
  return data; // 'ok'
}
