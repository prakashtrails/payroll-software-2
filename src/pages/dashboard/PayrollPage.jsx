import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmt, monthLabel, monthKey, calcSalary, getInitials, getAvatarColor } from '@/lib/helpers';

export default function RunPayrollPage() {
  const { tenant } = useAuth();
  const [payrollMonth, setPayrollMonth] = useState(new Date().getMonth());
  const [payrollYear, setPayrollYear] = useState(new Date().getFullYear());
  const [employees, setEmployees] = useState([]);
  const [components, setComponents] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [processed, setProcessed] = useState(null); // existing payroll + payslips
  const [workDayOverrides, setWorkDayOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [detailSlip, setDetailSlip] = useState(null);

  const workDays = tenant?.work_days || 26;

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      // Fetch all data in parallel — reduces load time from ~4x to ~1x latency
      const [empsRes, compsRes, advsRes, payrollRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('tenant_id', tenant.id).eq('status', 'Active').in('role', ['employee', 'manager']),
        supabase.from('salary_components').select('*').eq('tenant_id', tenant.id),
        supabase.from('advances').select('*').eq('tenant_id', tenant.id).eq('status', 'Active'),
        supabase.from('payrolls').select('*, payslips(*)').eq('tenant_id', tenant.id).eq('month', payrollMonth + 1).eq('year', payrollYear).maybeSingle(),
      ]);

      setEmployees(empsRes.data || []);
      setComponents(compsRes.data || []);
      setAdvances(advsRes.data || []);
      setProcessed(payrollRes.data || null);
      setWorkDayOverrides({});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenant, payrollMonth, payrollYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const changeMonth = (delta) => {
    let m = payrollMonth + delta;
    let y = payrollYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    setPayrollMonth(m);
    setPayrollYear(y);
  };

  // ---- PROCESS PAYROLL ----
  const processPayroll = async () => {
    if (employees.length === 0) return showToast('No active employees to process', 'error');
    if (components.length === 0) return showToast('Configure salary components first', 'error');

    setProcessing(true);
    try {
      // 1. Create payroll record
      const { data: payroll, error: pErr } = await supabase
        .from('payrolls')
        .insert([{
          tenant_id: tenant.id,
          month: payrollMonth + 1,
          year: payrollYear,
          status: 'Processed'
        }])
        .select()
        .single();

      if (pErr) throw pErr;

      // 2. Generate payslips for each employee
      const slips = employees.map((emp) => {
        const actualDays = workDayOverrides[emp.id] !== undefined
          ? workDayOverrides[emp.id]
          : workDays;
        const sal = calcSalary(emp.ctc || 0, components, workDays, actualDays);

        // Calculate advance deduction
        let advDeduction = 0;
        const empAdvances = advances.filter((a) => a.profile_id === emp.id);
        empAdvances.forEach((a) => {
          const ded = Math.min(a.emi, a.balance);
          advDeduction += ded;
        });

        return {
          payroll_id: payroll.id,
          tenant_id: tenant.id,
          profile_id: emp.id,
          emp_name: `${emp.first_name} ${emp.last_name}`,
          department: emp.department || '',
          designation: emp.designation || '',
          ctc: emp.ctc || 0,
          work_days: actualDays,
          total_work_days: workDays,
          gross_earnings: sal.totalEarning,
          total_deductions: sal.totalDeduction,
          advance_deduction: advDeduction,
          net_pay: sal.net - advDeduction,
          breakdown: JSON.stringify({ earnings: sal.earnings, deductions: sal.deductions }),
        };
      });

      const { error: sErr } = await supabase.from('payslips').insert(slips);
      if (sErr) throw sErr;

      // 3. Update advance balances
      for (const emp of employees) {
        const empAdvances = advances.filter((a) => a.profile_id === emp.id);
        for (const adv of empAdvances) {
          const ded = Math.min(adv.emi, adv.balance);
          const newPaid = adv.paid + ded;
          const newBalance = adv.balance - ded;
          await supabase.from('advances').update({
            paid: newPaid,
            balance: newBalance,
            status: newBalance <= 0 ? 'Completed' : 'Active',
          }).eq('id', adv.id);
        }
      }

      showToast(`Payroll processed for ${monthLabel(payrollMonth, payrollYear)}!`, 'success');
      fetchData();
    } catch (err) {
      showToast('Processing failed: ' + err.message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  // ---- REVERT PAYROLL ----
  const revertPayroll = async () => {
    if (!processed || !confirm('Revert this payroll? All payslips will be deleted.')) return;
    try {
      await supabase.from('payslips').delete().eq('payroll_id', processed.id);
      await supabase.from('payrolls').delete().eq('id', processed.id);
      showToast('Payroll reverted', 'warning');
      fetchData();
    } catch (err) {
      showToast('Revert failed: ' + err.message, 'error');
    }
  };

  // ---- EXPORT CSV ----
  const exportCSV = () => {
    if (!processed?.payslips?.length) return showToast('Process payroll first', 'warning');
    let csv = 'Employee,Department,Working Days,Gross Earnings,Deductions,Advance Ded.,Net Salary\n';
    processed.payslips.forEach((p) => {
      csv += `"${p.emp_name}",${p.department},${p.work_days},${p.gross_earnings},${p.total_deductions},${p.advance_deduction},${p.net_pay}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payroll_${payrollYear}-${String(payrollMonth + 1).padStart(2, '0')}.csv`;
    a.click();
    showToast('CSV exported', 'success');
  };

  // ---- RENDER ----
  const slips = processed?.payslips || [];
  const totalGross = slips.reduce((s, p) => s + (p.gross_earnings || 0), 0);
  const totalDed = slips.reduce((s, p) => s + (p.total_deductions || 0) + (p.advance_deduction || 0), 0);
  const totalNet = slips.reduce((s, p) => s + (p.net_pay || 0), 0);

  return (
    <>
      <Header title="Run Payroll" breadcrumb={monthLabel(payrollMonth, payrollYear)} />
      <div className="page-content">
        {/* Controls */}
        <div className="filter-bar">
          <div className="month-selector">
            <button onClick={() => changeMonth(-1)}><i className="fas fa-chevron-left" /></button>
            <span>{monthLabel(payrollMonth, payrollYear)}</span>
            <button onClick={() => changeMonth(1)}><i className="fas fa-chevron-right" /></button>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={exportCSV}><i className="fas fa-file-csv" /> Export CSV</button>
            {processed ? (
              <button className="btn btn-danger" onClick={revertPayroll}><i className="fas fa-undo" /> Revert Payroll</button>
            ) : (
              <button className="btn btn-primary" onClick={processPayroll} disabled={processing}>
                {processing ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Processing...</> : <><i className="fas fa-play" /> Process Payroll</>}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading...</div>
        ) : (
          <>
            {/* Stats */}
            <div className="stats-row">
              <StatCard icon="fa-users" iconColor="blue" value={processed ? slips.length : employees.length} label={processed ? 'Employees Paid' : 'Employees to Process'} />
              <StatCard icon="fa-arrow-up" iconColor="green" value={processed ? fmt(totalGross) : fmt(employees.reduce((s, e) => s + (e.ctc || 0), 0))} label={processed ? 'Gross Earnings' : 'Total CTC'} />
              <StatCard icon="fa-arrow-down" iconColor="orange" value={processed ? fmt(totalDed) : fmt(advances.reduce((s, a) => s + a.emi, 0))} label={processed ? 'Total Deductions' : 'EMI Deductions'} />
              <StatCard icon="fa-money-bill" iconColor="purple" value={processed ? fmt(totalNet) : fmt(workDays)} label={processed ? 'Net Payroll' : 'Working Days'} />
            </div>

            {/* Status badge */}
            <div className="card">
              <div className="card-header">
                <h3>Payroll Details</h3>
                {processed ? (
                  <span className="badge badge-success"><i className="fas fa-check" /> Processed</span>
                ) : (
                  <span className="badge badge-warning">Not Processed</span>
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Working Days</th>
                      <th>Gross Earnings</th>
                      <th>Deductions</th>
                      <th>Advance Ded.</th>
                      <th>Net Salary</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processed ? (
                      slips.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="emp-cell">
                              <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(p.profile_id)})` }}>{getInitials(p.emp_name.split(' ')[0], p.emp_name.split(' ')[1])}</div>
                              <div><div className="emp-name">{p.emp_name}</div><div className="emp-role">{p.department}</div></div>
                            </div>
                          </td>
                          <td>{p.work_days}/{p.total_work_days}</td>
                          <td>{fmt(p.gross_earnings)}</td>
                          <td style={{ color: 'var(--danger)' }}>-{fmt(p.total_deductions)}</td>
                          <td style={{ color: 'var(--warning)' }}>{p.advance_deduction > 0 ? '-' + fmt(p.advance_deduction) : '—'}</td>
                          <td><strong>{fmt(p.net_pay)}</strong></td>
                          <td>
                            <button className="btn btn-outline btn-sm" onClick={() => setDetailSlip(p)}>
                              <i className="fas fa-eye" />
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      employees.map((e) => {
                        const sal = calcSalary(e.ctc || 0, components, workDays, workDayOverrides[e.id] ?? workDays);
                        const advDed = advances.filter((a) => a.profile_id === e.id).reduce((s, a) => s + Math.min(a.emi, a.balance), 0);
                        return (
                          <tr key={e.id}>
                            <td>
                              <div className="emp-cell">
                                <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(e.id)})` }}>{getInitials(e.first_name, e.last_name)}</div>
                                <div><div className="emp-name">{e.first_name} {e.last_name}</div><div className="emp-role">{e.department || ''}</div></div>
                              </div>
                            </td>
                            <td>
                              <input
                                className="form-input"
                                type="number"
                                min="0"
                                max={workDays}
                                value={workDayOverrides[e.id] ?? workDays}
                                onChange={(ev) => setWorkDayOverrides((prev) => ({ ...prev, [e.id]: parseInt(ev.target.value) || 0 }))}
                                style={{ width: 65, padding: '5px 8px', fontSize: 12 }}
                              />
                            </td>
                            <td>{fmt(sal.totalEarning)}</td>
                            <td style={{ color: 'var(--danger)' }}>-{fmt(sal.totalDeduction)}</td>
                            <td style={{ color: 'var(--warning)' }}>{advDed > 0 ? '-' + fmt(advDed) : '—'}</td>
                            <td><strong>{fmt(sal.net - advDed)}</strong></td>
                            <td><span className="badge badge-warning">Pending</span></td>
                          </tr>
                        );
                      })
                    )}
                    {!processed && employees.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No active employees found. Add employees first.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Salary Detail Modal */}
      <Modal show={!!detailSlip} onClose={() => setDetailSlip(null)} title="Salary Breakdown" width="620px"
        footer={<button className="btn btn-outline" onClick={() => setDetailSlip(null)}>Close</button>}
      >
        {detailSlip && <PayslipDetail slip={detailSlip} companyName={tenant?.company_name} />}
      </Modal>
    </>
  );
}

function PayslipDetail({ slip, companyName }) {
  let breakdown = { earnings: [], deductions: [] };
  try { breakdown = typeof slip.breakdown === 'string' ? JSON.parse(slip.breakdown) : slip.breakdown; } catch (e) { /* ignore */ }

  return (
    <div className="payslip">
      <div className="payslip-header">
        <div><strong style={{ fontSize: 16 }}>{companyName || 'Company'}</strong></div>
        <div style={{ textAlign: 'right' }}><strong>Payslip</strong></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 16 }}>
        <div><span style={{ color: 'var(--text-muted)' }}>Name:</span> <strong>{slip.emp_name}</strong></div>
        <div><span style={{ color: 'var(--text-muted)' }}>Department:</span> <strong>{slip.department || '—'}</strong></div>
        <div><span style={{ color: 'var(--text-muted)' }}>Working Days:</span> <strong>{slip.work_days}/{slip.total_work_days}</strong></div>
      </div>
      <div className="payslip-section-title" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>Earnings</div>
      {(breakdown.earnings || []).map((e, i) => (
        <div className="payslip-row" key={i}><span>{e.name}</span><span>{fmt(e.amount)}</span></div>
      ))}
      <div className="payslip-row" style={{ fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
        <span>Total Earnings</span><span>{fmt(slip.gross_earnings)}</span>
      </div>
      <div className="payslip-section-title" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>Deductions</div>
      {(breakdown.deductions || []).map((d, i) => (
        <div className="payslip-row" key={i}><span>{d.name}</span><span>{fmt(d.amount)}</span></div>
      ))}
      {slip.advance_deduction > 0 && (
        <div className="payslip-row"><span>Advance/Loan Recovery</span><span>{fmt(slip.advance_deduction)}</span></div>
      )}
      <div className="payslip-row" style={{ fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
        <span>Total Deductions</span><span>{fmt(slip.total_deductions + slip.advance_deduction)}</span>
      </div>
      <div className="payslip-row total"><span>Net Pay</span><span style={{ color: 'var(--success)' }}>{fmt(slip.net_pay)}</span></div>
    </div>
  );
}
