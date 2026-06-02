import { supabase } from '@/lib/supabase';
import { calcSalary } from '@/lib/helpers';

/** Fetch one payroll run (with all its payslips) for a given month/year and country group. */
export async function fetchPayroll(tenantId, month, year, countryGroup = 'India') {
  const { data, error } = await supabase
    .from('payrolls')
    .select('*, payslips(*)')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year)
    .eq('country_group', countryGroup)
    .maybeSingle();
  return { data: data || null, error };
}

/**
 * Process payroll for a month and country group.
 * Uses the process_payroll_by_country RPC for atomic insert.
 */
export async function processPayroll({ tenantId, month, year, countryGroup, employees, components, advances, workDays, workDayOverrides }) {
  const payrollMonth = month + 1;

  const payload = employees.map((emp) => {
    const actualDays = workDayOverrides[emp.id] !== undefined ? workDayOverrides[emp.id] : workDays;
    const sal        = calcSalary(emp.ctc || 0, components, workDays, actualDays);

    const empAdvances = advances
      .filter((a) => a.profile_id === emp.id && a.balance > 0)
      .map(a => ({ id: a.id, amount: Math.min(a.emi, a.balance) }));

    const totalAdvDed = empAdvances.reduce((sum, a) => sum + a.amount, 0);

    return {
      profile_id:        emp.id,
      emp_name:          `${emp.first_name} ${emp.last_name}`,
      department:        emp.department  || '',
      designation:       emp.designation || '',
      ctc:               emp.ctc         || 0,
      work_days:         actualDays,
      total_work_days:   workDays,
      gross_earnings:    sal.totalEarning,
      total_deductions:  sal.totalDeduction,
      advance_deduction: totalAdvDed,
      net_pay:           sal.net - totalAdvDed,
      breakdown:         { earnings: sal.earnings, deductions: sal.deductions },
      advances:          empAdvances,
    };
  });

  const { data, error } = await supabase.rpc('process_payroll_by_country', {
    p_tenant_id:     tenantId,
    p_month:         payrollMonth,
    p_year:          year,
    p_country_group: countryGroup,
    p_data:          payload,
  });

  if (error) throw error;
  return { payroll_id: data };
}

/** Delete a payroll run and all its payslips. */
export async function revertPayroll(payrollId) {
  const { error } = await supabase.rpc('revert_payroll_atomic', { p_payroll_id: payrollId });
  if (error) throw error;
}

/** Fetch payslips for a month (admin view). */
export async function fetchPayslipsByMonth(tenantId, month, year) {
  const { data: payroll, error } = await supabase
    .from('payrolls')
    .select('id, payslips(*)')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year)
    .maybeSingle();
  return { data: payroll?.payslips || [], error };
}

/** Fetch a single employee's payslip for a given month. */
export async function fetchMyPayslip(tenantId, profileId, month, year) {
  // There can now be two payroll records per month (India + International)
  // so we fetch all IDs for the month and search payslips across them.
  const { data: payrolls, error: pErr } = await supabase
    .from('payrolls')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year);
  if (pErr) return { data: null, error: pErr };
  if (!payrolls?.length) return { data: null, error: null };

  const { data, error } = await supabase
    .from('payslips')
    .select('*')
    .eq('profile_id', profileId)
    .in('payroll_id', payrolls.map(p => p.id))
    .maybeSingle();
  return { data: data || null, error };
}

/** Count of processed payrolls for a tenant. */
export async function fetchPayrollCount(tenantId) {
  const { count, error } = await supabase
    .from('payrolls')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'Processed');
  return { count: count || 0, error };
}
