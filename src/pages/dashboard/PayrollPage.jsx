import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { fetchPayroll, processPayroll, revertPayroll, fetchApprovedOvertimeForMonth } from '@/services/payrollService';
import { listActiveEmployees } from '@/services/employeeService';
import { listComponents } from '@/services/salaryService';
import { listActiveAdvances } from '@/services/advanceService';
import { fetchAllTenantAttendance } from '@/services/attendanceService';
import { fmt, monthLabel, calcSalary, calcPfEsic, calcOtPay, calcPayableOvertimeHours, getInitials, getAvatarColor, getWeeklyOffDaysInMonth, calcWeeklyOffSettlement, HIGH_SALARY_THRESHOLD } from '@/lib/helpers';
import { fetchApprovedCompOffLeavesForMonth } from '@/services/leaveService';
import { settleWeeklyOffForMonth, fetchMonthlySettlements } from '@/services/compOffService';

function isCompliance(emp) {
  return !!(emp.pf_enabled || emp.esic_enabled);
}

export default function RunPayrollPage() {
  const { tenant, profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const [payrollMonth, setPayrollMonth]                     = useState(new Date().getMonth());
  const [payrollYear,  setPayrollYear]                      = useState(new Date().getFullYear());
  const [employees,    setEmployees]                        = useState([]);
  const [components,   setComponents]                       = useState([]);
  const [advances,     setAdvances]                         = useState([]);
  const [processedCompliance,    setProcessedCompliance]    = useState(null);
  const [processedNonCompliance, setProcessedNonCompliance] = useState(null);
  const [workDayOverrides, setWorkDayOverrides]             = useState({});
  const [overtimeRequests, setOvertimeRequests]             = useState([]);
  const [loading,             setLoading]             = useState(true);
  const [processingComp,      setProcessingComp]      = useState(false);
  const [processingNonComp,   setProcessingNonComp]   = useState(false);
  const [detailSlip,   setDetailSlip]   = useState(null);
  const [attendanceRaw, setAttendanceRaw] = useState([]);
  const [compOffLeaves, setCompOffLeaves] = useState({});
  const [settlements,   setSettlements]   = useState([]);

  const workDays          = tenant?.work_days || 30;
  const complianceEmps    = employees.filter(isCompliance);
  const nonComplianceEmps = employees.filter(e => !isCompliance(e));

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [empsRes, compsRes, advsRes, payCompRes, payNonCompRes, attRes, otRes, compOffRes, settleRes] = await Promise.all([
        listActiveEmployees(tenant.id),
        listComponents(tenant.id),
        listActiveAdvances(tenant.id),
        fetchPayroll(tenant.id, payrollMonth, payrollYear, 'Compliance'),
        fetchPayroll(tenant.id, payrollMonth, payrollYear, 'Non-Compliance'),
        fetchAllTenantAttendance(tenant.id, payrollYear, payrollMonth),
        fetchApprovedOvertimeForMonth(tenant.id, payrollMonth, payrollYear),
        fetchApprovedCompOffLeavesForMonth(tenant.id, payrollMonth, payrollYear),
        fetchMonthlySettlements(tenant.id, payrollMonth, payrollYear),
      ]);
      setEmployees(empsRes.data);
      setComponents(compsRes.data);
      setAdvances(advsRes.data);
      setProcessedCompliance(payCompRes.data);
      setProcessedNonCompliance(payNonCompRes.data);
      setOvertimeRequests(otRes.data || []);
      setCompOffLeaves(compOffRes.data || {});
      setSettlements(settleRes.data || []);

      const attendance = attRes.data || [];
      setAttendanceRaw(attendance);
      const overrides  = {};
      empsRes.data.forEach(emp => {
        const empAtt = attendance.filter(a => a.profile_id === emp.id);
        let days = 0;
        empAtt.forEach(a => {
          if (a.status === 'Present' || a.status === 'Late') days += 1;
          else if (a.status === 'Half Day') days += 0.5;
        });
        const joinDate = emp.join_date ? new Date(emp.join_date) : null;
        const monthEnd = new Date(payrollYear, payrollMonth + 1, 0);
        if (joinDate && joinDate > monthEnd) days = 0;
        overrides[emp.id] = days;
      });
      setWorkDayOverrides(overrides);
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
    if (m < 0)  { m = 11; y--; }
    setPayrollMonth(m);
    setPayrollYear(y);
  };

  const handleProcess = async (group) => {
    const emps = group === 'Compliance' ? complianceEmps : nonComplianceEmps;
    if (emps.length === 0) return showToast('No employees in this group to process', 'error');
    if (components.length === 0) return showToast('Configure salary components first', 'error');
    const setProc = group === 'Compliance' ? setProcessingComp : setProcessingNonComp;
    setProc(true);
    try {
      // Shift duration in hours
      const shiftHrs = (() => {
        if (!tenant?.shift_start || !tenant?.shift_end) return 8;
        const [sh, sm] = tenant.shift_start.split(':').map(Number);
        const [eh, em] = tenant.shift_end.split(':').map(Number);
        let from = sh * 60 + sm, to = eh * 60 + em;
        if (to <= from) to += 1440;
        return (to - from) / 60;
      })();

      // Auto-calculate overtime from attendance for employees below the salary threshold.
      // For each day where total_hours > shift_hours, accumulate the extra minutes
      // then convert to payable rounded hours.
      const autoOtRequests = [];
      emps.forEach(emp => {
        if ((emp.ctc || 0) >= HIGH_SALARY_THRESHOLD) return;
        const empAtt = attendanceRaw.filter(a => a.profile_id === emp.id);
        let totalOtMinutes = 0;
        empAtt.forEach(a => {
          if ((a.status === 'Present' || a.status === 'Late') && Number(a.total_hours) > shiftHrs) {
            totalOtMinutes += Math.round((Number(a.total_hours) - shiftHrs) * 60);
          }
        });
        const payableHours = calcPayableOvertimeHours(totalOtMinutes);
        if (payableHours > 0) {
          autoOtRequests.push({
            profile_id:     emp.id,
            overtime_hours: payableHours,
            overtime_pay:   calcOtPay(emp.ctc || 0, shiftHrs, payableHours),
          });
        }
      });

      await processPayroll({
        tenantId:         tenant.id,
        month:            payrollMonth,
        year:             payrollYear,
        countryGroup:     group,
        employees:        emps,
        components,
        advances,
        workDays,
        workDayOverrides,
        overtimeRequests: autoOtRequests,
        shiftHours:       shiftHrs,
      });

      // Run comp off settlement for high-salary employees in this group
      const weeklyOffDay = tenant?.weekly_off_day ?? 0;
      const woDays       = getWeeklyOffDaysInMonth(payrollYear, payrollMonth, weeklyOffDay);
      const highSalEmps  = emps.filter(e => (e.ctc || 0) >= HIGH_SALARY_THRESHOLD);
      if (highSalEmps.length > 0 && woDays.length > 0) {
        const settlementInput = highSalEmps.map(emp => {
          const empAtt     = attendanceRaw.filter(a => a.profile_id === emp.id);
          const workedWOs  = woDays.filter(d =>
            empAtt.some(a => a.date === d && (a.status === 'Present' || a.status === 'Late'))
          ).length;
          const compLeavesUsed = compOffLeaves[emp.id] || 0;
          return {
            profileId: emp.id,
            totalWOs:  woDays.length,
            workedWOs,
            compLeavesUsed,
            settlement: calcWeeklyOffSettlement(workedWOs, woDays.length, compLeavesUsed),
          };
        });
        await settleWeeklyOffForMonth(tenant.id, payrollMonth, payrollYear, settlementInput);
      }

      showToast(`${group} payroll processed for ${monthLabel(payrollMonth, payrollYear)}`, 'success');
      fetchData();
    } catch (err) {
      showToast('Processing failed: ' + err.message, 'error');
    } finally {
      setProc(false);
    }
  };

  const handleRevert = async (group) => {
    const processed = group === 'Compliance' ? processedCompliance : processedNonCompliance;
    if (!processed || !confirm(`Revert ${group} payroll? All payslips for this group will be deleted.`)) return;
    try {
      await revertPayroll(processed.id);
      showToast('Payroll reverted', 'warning');
      fetchData();
    } catch (err) {
      showToast('Revert failed: ' + err.message, 'error');
    }
  };

  const exportCSV = (group) => {
    const processed = group === 'Compliance' ? processedCompliance : processedNonCompliance;
    if (!processed?.payslips?.length) return showToast('Process payroll first', 'warning');
    let csv = 'Employee,Department,Working Days,Gross Earnings,Deductions,Advance Ded.,Net Salary\n';
    processed.payslips.forEach((p) => {
      csv += `"${p.emp_name}",${p.department},${p.work_days},${p.gross_earnings},${p.total_deductions},${p.advance_deduction},${p.net_pay}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `payroll_${group.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${payrollYear}-${String(payrollMonth + 1).padStart(2, '0')}.csv`;
    a.click();
    showToast('CSV exported', 'success');
  };

  return (
    <>
      <Header title="Run Payroll" breadcrumb={monthLabel(payrollMonth, payrollYear)} />
      <div className="page-content">

        <div className="filter-bar">
          <div className="month-selector">
            <button onClick={() => changeMonth(-1)}><i className="fas fa-chevron-left" /></button>
            <span>{monthLabel(payrollMonth, payrollYear)}</span>
            <button onClick={() => changeMonth(1)}><i className="fas fa-chevron-right" /></button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : (
          <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <PayrollSection
              title="Compliance Payroll"
              subtitle="Employees with PF / ESIC"
              group="Compliance"
              emps={complianceEmps}
              processed={processedCompliance}
              processing={processingComp}
              workDays={workDays}
              workDayOverrides={workDayOverrides}
              setWorkDayOverrides={setWorkDayOverrides}
              components={components}
              advances={advances}
              isManager={isManager}
              onProcess={() => handleProcess('Compliance')}
              onRevert={() => handleRevert('Compliance')}
              onExport={() => exportCSV('Compliance')}
              onViewSlip={setDetailSlip}
              month={payrollMonth}
              year={payrollYear}
            />
            <PayrollSection
              title="Non-Compliance Payroll"
              subtitle="Employees without PF / ESIC"
              group="Non-Compliance"
              emps={nonComplianceEmps}
              processed={processedNonCompliance}
              processing={processingNonComp}
              workDays={workDays}
              workDayOverrides={workDayOverrides}
              setWorkDayOverrides={setWorkDayOverrides}
              components={components}
              advances={advances}
              isManager={isManager}
              onProcess={() => handleProcess('Non-Compliance')}
              onRevert={() => handleRevert('Non-Compliance')}
              onExport={() => exportCSV('Non-Compliance')}
              onViewSlip={setDetailSlip}
              month={payrollMonth}
              year={payrollYear}
            />
          </div>

          {settlements.length > 0 && (
            <CompOffSettlementCard settlements={settlements} />
          )}
          </>
        )}
      </div>

      <Modal show={!!detailSlip} onClose={() => setDetailSlip(null)} title="Salary Breakdown" width="620px"
        footer={<button className="btn btn-outline" onClick={() => setDetailSlip(null)}>Close</button>}
      >
        {detailSlip && <PayslipDetail slip={detailSlip} companyName={tenant?.company_name} />}
      </Modal>
    </>
  );
}

function PayrollSection({
  title, subtitle, group, emps, processed, processing,
  workDays, workDayOverrides, setWorkDayOverrides,
  components, advances, isManager,
  onProcess, onRevert, onExport, onViewSlip,
}) {
  const slips      = processed?.payslips || [];
  const totalGross = slips.reduce((s, p) => s + (p.gross_earnings || 0), 0);
  const totalNet   = slips.reduce((s, p) => s + (p.net_pay || 0), 0);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {processed
            ? <span className="badge badge-success"><i className="fas fa-check" /> Processed</span>
            : <span className="badge badge-warning">Not Processed</span>}
          {processed && (
            <button className="btn btn-outline btn-sm" onClick={onExport}>
              <i className="fas fa-file-csv" /> CSV
            </button>
          )}
          {!isManager && (processed ? (
            <button className="btn btn-danger btn-sm" onClick={onRevert}>
              <i className="fas fa-undo" /> Revert
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={onProcess} disabled={processing || emps.length === 0}>
              {processing
                ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Processing…</>
                : <><i className="fas fa-play" /> Process Payroll</>}
            </button>
          ))}
        </div>
      </div>

      {processed && (
        <div style={{ display: 'flex', gap: 24, padding: '12px 20px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
          <span><strong>{slips.length}</strong> <span style={{ color: 'var(--text-muted)' }}>employees paid</span></span>
          <span><strong>{fmt(totalGross)}</strong> <span style={{ color: 'var(--text-muted)' }}>gross</span></span>
          <span><strong style={{ color: 'var(--success)' }}>{fmt(totalNet)}</strong> <span style={{ color: 'var(--text-muted)' }}>net</span></span>
        </div>
      )}

      {emps.length === 0 && !processed ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No {group === 'Compliance' ? 'compliance' : 'non-compliance'} employees found.
          {group === 'Compliance'
            ? ' Enable PF or ESIC on an employee to include them here.'
            : ' Employees with no PF/ESIC enabled will appear here.'}
        </div>
      ) : (
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
                        <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(p.profile_id)})` }}>
                          {getInitials(p.emp_name.split(' ')[0], p.emp_name.split(' ')[1])}
                        </div>
                        <div>
                          <div className="emp-name">{p.emp_name}</div>
                          <div className="emp-role">{p.department}</div>
                        </div>
                      </div>
                    </td>
                    <td>{p.work_days}/{p.total_work_days}</td>
                    <td>{fmt(p.gross_earnings)}</td>
                    <td style={{ color: 'var(--danger)' }}>-{fmt(p.total_deductions)}</td>
                    <td style={{ color: 'var(--warning)' }}>{p.advance_deduction > 0 ? '-' + fmt(p.advance_deduction) : '—'}</td>
                    <td><strong>{fmt(p.net_pay)}</strong></td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => onViewSlip(p)}>
                        <i className="fas fa-eye" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                emps.map((e) => {
                  const actualDays  = workDayOverrides[e.id] ?? workDays;
                  const sal         = calcSalary(e.ctc || 0, components, workDays, actualDays);
                  const pfEsicDeds  = calcPfEsic(e, e.ctc || 0, actualDays, workDays);
                  const pfEsicTotal = pfEsicDeds.reduce((s, d) => s + d.amount, 0);
                  const advDed      = advances.filter((a) => a.profile_id === e.id).reduce((s, a) => s + Math.min(a.emi, a.balance), 0);
                  return (
                    <tr key={e.id}>
                      <td>
                        <div className="emp-cell">
                          <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(e.id)})` }}>
                            {getInitials(e.first_name, e.last_name)}
                          </div>
                          <div>
                            <div className="emp-name">{e.first_name} {e.last_name}</div>
                            <div className="emp-role">{e.department || ''}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {isManager ? (
                          <span>{workDayOverrides[e.id] ?? workDays}/{workDays}</span>
                        ) : (
                          <input
                            className="form-input"
                            type="number" min="0" max={workDays}
                            value={workDayOverrides[e.id] ?? workDays}
                            onChange={(ev) => setWorkDayOverrides((prev) => ({ ...prev, [e.id]: parseInt(ev.target.value) || 0 }))}
                            style={{ width: 65, padding: '5px 8px', fontSize: 12 }}
                          />
                        )}
                      </td>
                      <td>{fmt(sal.totalEarning)}</td>
                      <td style={{ color: 'var(--danger)' }}>-{fmt(sal.totalDeduction + pfEsicTotal)}</td>
                      <td style={{ color: 'var(--warning)' }}>{advDed > 0 ? '-' + fmt(advDed) : '—'}</td>
                      <td><strong>{fmt(sal.net - pfEsicTotal - advDed)}</strong></td>
                      <td><span className="badge badge-warning">Pending</span></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PayslipDetail({ slip, companyName }) {
  let breakdown = { earnings: [], deductions: [] };
  try { breakdown = typeof slip.breakdown === 'string' ? JSON.parse(slip.breakdown) : slip.breakdown; } catch (_e) { /* ignore */ }

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

const SETTLEMENT_BADGE = {
  none:     { cls: 'badge-info',    icon: 'fa-minus-circle',  label: 'No Miss'   },
  balanced: { cls: 'badge-success', icon: 'fa-check-circle',  label: 'Balanced'  },
  credited: { cls: 'badge-purple',  icon: 'fa-gift',          label: 'Comp Off +'  },
  expired:  { cls: 'badge-warning', icon: 'fa-exclamation-triangle', label: 'Expired' },
};

function CompOffSettlementCard({ settlements }) {
  const credited = settlements.filter(s => s.settlement_type === 'credited').length;
  const expired  = settlements.filter(s => s.settlement_type === 'expired').length;

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-header">
        <div>
          <h3 style={{ margin: 0 }}>Weekly Off Comp Off Settlement</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Employees with CTC ≥ ₹30,000 · No overtime cash · Comp off credited when all weekly offs are worked
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
          {credited > 0 && (
            <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
              <i className="fas fa-gift" style={{ marginRight: 4 }} />{credited} credited
            </span>
          )}
          {expired > 0 && (
            <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
              <i className="fas fa-exclamation-triangle" style={{ marginRight: 4 }} />{expired} expired
            </span>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th style={{ textAlign: 'center' }}>Weekly Offs in Month</th>
              <th style={{ textAlign: 'center' }}>WOs Worked</th>
              <th style={{ textAlign: 'center' }}>Comp Leaves Used</th>
              <th>Outcome</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map(s => {
              const b = SETTLEMENT_BADGE[s.settlement_type] || SETTLEMENT_BADGE.none;
              return (
                <tr key={s.id}>
                  <td>
                    <div className="emp-cell">
                      <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(s.profile_id)})` }}>
                        {getInitials(s.profile?.first_name, s.profile?.last_name)}
                      </div>
                      <div>
                        <div className="emp-name">{s.profile?.first_name} {s.profile?.last_name}</div>
                        <div className="emp-role">{fmt(s.profile?.ctc)}/mo</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>{s.weekly_offs_in_month}</td>
                  <td style={{ textAlign: 'center' }}>{s.weekly_offs_worked}</td>
                  <td style={{ textAlign: 'center' }}>{s.comp_leaves_used}</td>
                  <td>
                    <span className={`badge ${b.cls}`}>
                      <i className={`fas ${b.icon}`} style={{ marginRight: 4 }} />{b.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {s.settlement_type === 'credited' && (
                      <span style={{ color: 'var(--primary)' }}>
                        +1 comp off added · expires {new Date(s.expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {s.settlement_type === 'balanced' && 'Leaves used offset missed weekly offs'}
                    {s.settlement_type === 'expired' && (
                      <span style={{ color: 'var(--warning)' }}>
                        {s.weekly_offs_worked - s.comp_leaves_used} unused comp off{s.weekly_offs_worked - s.comp_leaves_used > 1 ? 's' : ''} expired
                      </span>
                    )}
                    {s.settlement_type === 'none' && 'All weekly offs taken — no action'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
