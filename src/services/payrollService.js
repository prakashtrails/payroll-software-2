import { supabase } from '@/lib/supabase';
import { calcSalary } from '@/lib/helpers';

/** Fetch one payroll run (with all its payslips) for a given month/year. */
export async function fetchPayroll(tenantId, month, year) {
  const { data, error } = await supabase
    .from('payrolls')
    .select('*, payslips(*)')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year)
    .maybeSingle();
  return { data: data || null, error };
}

/**
 * Process payroll for a month.
 * Inserts the payroll record, generates all payslips, and deducts advance EMIs.
 */
export async function processPayroll({ tenantId, month, year, employees, components, advances, workDays, workDayOverrides }) {
  // 1. Check if payroll already exists
  const { data: existing } = await fetchPayroll(tenantId, month, year);
  if (existing) throw new Error('Payroll for this month is already processed. Revert it first to re-process.');

  // 2. Create payroll record
  const { data: payroll, error: pErr } = await supabase
    .from('payrolls')
    .insert([{ tenant_id: tenantId, month: month + 1, year, status: 'Processed' }])
    .select()
    .single();
  if (pErr) throw pErr;

  // 2. Generate payslips
  const slips = employees.map((emp) => {
    const actualDays = workDayOverrides[emp.id] !== undefined ? workDayOverrides[emp.id] : workDays;
    const sal        = calcSalary(emp.ctc || 0, components, workDays, actualDays);

    const advDeduction = advances
      .filter((a) => a.profile_id === emp.id)
      .reduce((sum, a) => sum + Math.min(a.emi, a.balance), 0);

    return {
      payroll_id:        payroll.id,
      tenant_id:         tenantId,
      profile_id:        emp.id,
      emp_name:          `${emp.first_name} ${emp.last_name}`,
      department:        emp.department   || '',
      designation:       emp.designation  || '',
      ctc:               emp.ctc          || 0,
      work_days:         actualDays,
      total_work_days:   workDays,
      gross_earnings:    sal.totalEarning,
      total_deductions:  sal.totalDeduction,
      advance_deduction: advDeduction,
      net_pay:           sal.net - advDeduction,
      breakdown:         JSON.stringify({ earnings: sal.earnings, deductions: sal.deductions }),
    };
  });

  const { error: sErr } = await supabase.from('payslips').insert(slips);
  if (sErr) throw sErr;

  // 3. Update advance balances
  for (const emp of employees) {
    const empAdvances = advances.filter((a) => a.profile_id === emp.id);
    for (const adv of empAdvances) {
      const ded        = Math.min(adv.emi, adv.balance);
      const newPaid    = adv.paid + ded;
      const newBalance = adv.balance - ded;
      await supabase.from('advances').update({
        paid:    newPaid,
        balance: newBalance,
        status:  newBalance <= 0 ? 'Completed' : 'Active',
      }).eq('id', adv.id);
    }
  }

  return { payroll };
}

/** Delete a payroll run and all its payslips. */
export async function revertPayroll(payrollId) {
  await supabase.from('payslips').delete().eq('payroll_id', payrollId);
  const { error } = await supabase.from('payrolls').delete().eq('id', payrollId);
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
  const { data: payroll, error: pErr } = await supabase
    .from('payrolls')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year)
    .maybeSingle();
  if (pErr) return { data: null, error: pErr };
  if (!payroll) return { data: null, error: null };

  const { data, error } = await supabase
    .from('payslips')
    .select('*')
    .eq('payroll_id', payroll.id)
    .eq('profile_id', profileId)
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
