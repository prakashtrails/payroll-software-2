import { supabase } from '@/lib/supabase';

export const PLATFORM_EMPLOYEE_PAGE_SIZE = 25;

/**
 * Cross-tenant employee listing for superadmin — same shape as
 * employeeService.listEmployees but not scoped to a single tenant, with the
 * owning company and branch joined in for display.
 */
export async function listAllEmployees({ page = 1, search = '', tenantId = '', outletId = '', status = '' } = {}) {
  let q = supabase
    .from('profiles')
    .select('*, tenants(company_name), outlets(name)', { count: 'exact' })
    .neq('role', 'superadmin')
    .order('first_name');

  if (tenantId) q = q.eq('tenant_id', tenantId);
  if (outletId) q = q.eq('outlet_id', outletId);
  if (status)   q = q.eq('status', status);
  if (search) {
    q = q.or(
      `first_name.ilike.%${search}%,middle_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,department.ilike.%${search}%`
    );
  }

  const from = (page - 1) * PLATFORM_EMPLOYEE_PAGE_SIZE;
  q = q.range(from, from + PLATFORM_EMPLOYEE_PAGE_SIZE - 1);

  const { data, error, count } = await q;
  return { data: data || [], error, count: count || 0 };
}

/**
 * All members of a single tenant — for the superadmin "Manage Company" panel.
 * Embeds employee_current_passwords, which only superadmin can read (RLS) —
 * populated once a member sets their own password after first login.
 */
export async function listTenantMembers(tenantId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, employee_current_passwords(password, updated_at)')
    .eq('tenant_id', tenantId)
    .neq('role', 'superadmin')
    .order('first_name');
  return { data: data || [], error };
}

/**
 * Employees who are still on their original temp password (must_change_password
 * is only cleared once they log in and set their own) — feeds the superadmin
 * bulk credentials export. Scoped to a tenant, optionally narrowed to one
 * outlet; unlike listAllEmployees this doesn't need pagination since it's
 * bounded to "still pending first login" rather than every employee.
 */
export async function listPendingCredentials(tenantId, outletId = '') {
  let q = supabase
    .from('profiles')
    .select('employee_id, first_name, middle_name, last_name, email, temp_password, outlets(name)')
    .eq('tenant_id', tenantId)
    .eq('must_change_password', true)
    .neq('role', 'superadmin')
    .order('first_name');
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  return { data: data || [], error };
}

/**
 * Platform-wide analytics for the Master Dashboard — one pre-aggregated jsonb
 * blob (companies, employees, attendance today, payroll this month, pending
 * requests, top companies, recent signups, 6-month growth trend), computed
 * server-side by the platform_analytics_summary() SECURITY DEFINER function.
 * Deliberately not a set of direct table queries: attendance/payrolls/leave_requests
 * only have a tenant_id = my_tenant_id() SELECT policy (not a superadmin
 * bypass like tenants/profiles/outlets have), so a direct query as superadmin
 * would silently return just their own home tenant, not the whole platform.
 */
export async function fetchPlatformAnalytics() {
  const { data, error } = await supabase.rpc('platform_analytics_summary');
  return { data, error };
}

export const PLATFORM_TICKET_PAGE_SIZE = 20;

/**
 * Cross-tenant support ticket listing for the superadmin Helpdesk console —
 * relies on the "support_tickets: superadmin full access" RLS policy rather
 * than an edge function, since tickets (unlike payroll/attendance) aren't
 * sensitive enough to warrant routing through a service-role aggregate.
 */
export async function listAllTickets({ page = 1, status = '', tenantId = '', search = '' } = {}) {
  let q = supabase
    .from('support_tickets')
    .select('*, tenants(company_name), created_by_profile:profiles!support_tickets_created_by_fkey(first_name, last_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (status)   q = q.eq('status', status);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  if (search)   q = q.ilike('subject', `%${search}%`);

  const from = (page - 1) * PLATFORM_TICKET_PAGE_SIZE;
  q = q.range(from, from + PLATFORM_TICKET_PAGE_SIZE - 1);

  const { data, error, count } = await q;
  return { data: data || [], error, count: count || 0 };
}
