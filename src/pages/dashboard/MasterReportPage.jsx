import React, { useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listActiveEmployees } from '@/services/employeeService';
import { fetchAllAttendanceWithPunches } from '@/services/attendanceService';
import { fetchAllPayslipsForReport } from '@/services/payrollService';
import { listAllLeaveRequests } from '@/services/leaveService';
import { fmt, getInitials, getAvatarColor, fmtTime12, dateStr } from '@/lib/helpers';

function getFirstIn(punches) {
  return (punches || [])
    .filter(p => p.punch_type === 'in')
    .sort((a, b) => a.punch_time.localeCompare(b.punch_time))[0]?.punch_time || null;
}

function getLastOut(punches) {
  const outs = (punches || [])
    .filter(p => p.punch_type === 'out')
    .sort((a, b) => a.punch_time.localeCompare(b.punch_time));
  return outs[outs.length - 1]?.punch_time || null;
}

function monthLabel(key) {
  // key = "YYYY-M" (1-based month)
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function setColWidths(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}

export default function MasterReportPage() {
  const { tenant } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);
  const [summary,   setSummary]   = useState([]);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [empsRes, attRes, payRes, leaveRes] = await Promise.all([
        listActiveEmployees(tenant.id),
        fetchAllAttendanceWithPunches(tenant.id),
        fetchAllPayslipsForReport(tenant.id),
        listAllLeaveRequests(tenant.id),
      ]);

      const emps     = empsRes.data  || [];
      const attAll   = attRes.data   || [];
      const payrolls = payRes.data   || [];
      const leaves   = leaveRes.data || [];

      // attendance map: empId → date → record
      const attMap = {};
      attAll.forEach(r => {
        if (!attMap[r.profile_id]) attMap[r.profile_id] = {};
        attMap[r.profile_id][r.date] = r;
      });

      // payslip map: empId → "YYYY-M" → net_pay  (month is 1-based from DB)
      const payMap = {};
      payrolls.forEach(pr => {
        (pr.payslips || []).forEach(ps => {
          const key = `${pr.year}-${pr.month}`;
          if (!payMap[ps.profile_id]) payMap[ps.profile_id] = {};
          payMap[ps.profile_id][key] = ps.net_pay;
        });
      });

      // leave usage map: empId → days used (approved, current calendar year)
      const thisYear = new Date().getFullYear();
      const leaveUsed = {};
      leaves.forEach(lr => {
        if (lr.status !== 'Approved') return;
        const yr = lr.start_date ? parseInt(lr.start_date.split('-')[0], 10) : 0;
        if (yr !== thisYear) return;
        if (!leaveUsed[lr.profile_id]) leaveUsed[lr.profile_id] = 0;
        leaveUsed[lr.profile_id] += lr.days_count || lr.days || 1;
      });

      const rows = emps.map(emp => {
        const empAtt       = attMap[emp.id] || {};
        const attRecords   = Object.values(empAtt);
        const presentDays  = attRecords.filter(r => r.status === 'Present' || r.status === 'Late').length;
        const lateDays     = attRecords.filter(r => r.status === 'Late').length;
        const halfDays     = attRecords.filter(r => r.status === 'Half Day').length;
        const leaveDays    = attRecords.filter(r => r.status === 'Leave').length;
        const empPayMap    = payMap[emp.id] || {};
        const payValues    = Object.values(empPayMap);
        const totalNetPaid = payValues.reduce((s, v) => s + (v || 0), 0);
        const sortedKeys   = Object.keys(empPayMap).sort((a, b) => b.localeCompare(a));
        const lastPay      = sortedKeys.length ? empPayMap[sortedKeys[0]] : null;
        const usedThisYear = leaveUsed[emp.id] || 0;
        const leavesRemaining = Math.max(0, (emp.leave_allocation || 0) - usedThisYear);

        return {
          emp,
          presentDays, lateDays, halfDays, leaveDays,
          totalNetPaid, lastPay,
          usedThisYear, leavesRemaining,
          attMap: empAtt,
          payMap: empPayMap,
        };
      });

      setEmployees(emps);
      setSummary(rows);
    } catch (err) {
      showToast('Failed to load data: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = async () => {
    if (summary.length === 0) return showToast('No data to export', 'warning');
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      // ── Sheet 1: Employee Summary ──────────────────────────────────────────
      const s1Headers = [
        'Employee Name', 'Designation', 'Department', 'Join Date',
        'Compliance', 'PF Enabled', 'PF Amount (₹)', 'ESIC Enabled', 'ESIC Amount (₹)',
        'Leave Allocation', 'Leaves Used (This Year)', 'Leaves Remaining',
        'Total Present Days', 'Total Late Days', 'Total Half Days', 'Total Leave Days',
        'Months Paid', 'Total Net Paid (₹)', 'Last Month Net Pay (₹)',
      ];
      const s1Rows = [s1Headers];
      summary.forEach(({
        emp, presentDays, lateDays, halfDays, leaveDays,
        totalNetPaid, lastPay, usedThisYear, leavesRemaining, payMap: pm,
      }) => {
        s1Rows.push([
          `${emp.first_name} ${emp.last_name}`.trim(),
          emp.designation    || '',
          emp.department     || '',
          emp.join_date      || '',
          (emp.pf_enabled || emp.esic_enabled) ? 'Yes' : 'No',
          emp.pf_enabled   ? 'Yes' : 'No',
          emp.pf_amount    || 0,
          emp.esic_enabled ? 'Yes' : 'No',
          emp.esic_amount  || 0,
          emp.leave_allocation || 0,
          usedThisYear,
          leavesRemaining,
          presentDays,
          lateDays,
          halfDays,
          leaveDays,
          Object.keys(pm).length,
          totalNetPaid,
          lastPay ?? '',
        ]);
      });
      const ws1 = XLSX.utils.aoa_to_sheet(s1Rows);
      setColWidths(ws1, [22, 18, 16, 12, 12, 12, 14, 14, 16, 16, 20, 16, 16, 14, 14, 14, 12, 18, 20]);
      XLSX.utils.book_append_sheet(wb, ws1, 'Employee Summary');

      // ── Sheet 2: Monthly Payroll ───────────────────────────────────────────
      const s2Headers = ['Employee Name', 'Designation', 'Department', 'Month', 'Year', 'Net Pay (₹)'];
      const s2Rows = [s2Headers];
      summary.forEach(({ emp, payMap: pm }) => {
        const name = `${emp.first_name} ${emp.last_name}`.trim();
        // Sort months newest first
        Object.keys(pm).sort((a, b) => b.localeCompare(a)).forEach(key => {
          const [y, m] = key.split('-').map(Number);
          s2Rows.push([
            name,
            emp.designation || '',
            emp.department  || '',
            new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'long' }),
            y,
            pm[key] ?? 0,
          ]);
        });
      });
      const ws2 = XLSX.utils.aoa_to_sheet(s2Rows);
      setColWidths(ws2, [22, 18, 16, 14, 8, 16]);
      XLSX.utils.book_append_sheet(wb, ws2, 'Monthly Payroll');

      // ── Sheet 3: Attendance Log ────────────────────────────────────────────
      const s3Headers = [
        'Employee Name', 'Designation', 'Department',
        'Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours Worked',
      ];
      const s3Rows = [s3Headers];
      summary.forEach(({ emp, attMap: am }) => {
        const name = `${emp.first_name} ${emp.last_name}`.trim();
        // Sort dates oldest first for readability
        Object.keys(am).sort().forEach(dt => {
          const rec    = am[dt];
          const dayObj = new Date(dt + 'T00:00:00');
          const dayName = dayObj.toLocaleDateString('en-IN', { weekday: 'short' });
          const clockIn  = getFirstIn(rec.punches);
          const clockOut = getLastOut(rec.punches);
          s3Rows.push([
            name,
            emp.designation || '',
            emp.department  || '',
            dt,
            dayName,
            rec.status || '',
            clockIn  ? fmtTime12(clockIn)  : '',
            clockOut ? fmtTime12(clockOut) : '',
            rec.total_hours != null ? rec.total_hours : '',
          ]);
        });
      });
      const ws3 = XLSX.utils.aoa_to_sheet(s3Rows);
      setColWidths(ws3, [22, 18, 16, 13, 6, 10, 12, 12, 12]);
      XLSX.utils.book_append_sheet(wb, ws3, 'Attendance Log');

      // ── Sheet 4: Leave Summary ─────────────────────────────────────────────
      // Build from summary's leave data: show per-employee per-month leave counts
      const s4Headers = [
        'Employee Name', 'Department', 'Leave Allocation',
        'Leaves Used (This Year)', 'Leaves Remaining',
      ];
      const s4Rows = [s4Headers];
      summary.forEach(({ emp, leaveDays, usedThisYear, leavesRemaining }) => {
        s4Rows.push([
          `${emp.first_name} ${emp.last_name}`.trim(),
          emp.department || '',
          emp.leave_allocation || 0,
          usedThisYear,
          leavesRemaining,
        ]);
      });
      const ws4 = XLSX.utils.aoa_to_sheet(s4Rows);
      setColWidths(ws4, [22, 16, 18, 22, 18]);
      XLSX.utils.book_append_sheet(wb, ws4, 'Leave Summary');

      const today = dateStr(new Date());
      XLSX.writeFile(wb, `master_report_${today}.xlsx`);
      showToast('Master report exported successfully', 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Header
        title="Master Report"
        breadcrumb="Employee Calendar / Master Report"
        actions={
          <button className="btn btn-primary" onClick={handleExport} disabled={exporting || loading}>
            {exporting
              ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Generating…</>
              : <><i className="fas fa-file-excel" /> Export Excel Report</>}
          </button>
        }
      />

      <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading employee data…
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div className="stats-row" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                  <i className="fas fa-users" />
                </div>
                <div>
                  <div className="stat-value">{employees.length}</div>
                  <div className="stat-label">Active Employees</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
                  <i className="fas fa-shield-alt" />
                </div>
                <div>
                  <div className="stat-value">{employees.filter(e => e.pf_enabled || e.esic_enabled).length}</div>
                  <div className="stat-label">Compliance</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                  <i className="fas fa-times-circle" />
                </div>
                <div>
                  <div className="stat-value">{employees.filter(e => !e.pf_enabled && !e.esic_enabled).length}</div>
                  <div className="stat-label">Non-Compliance</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                  <i className="fas fa-calendar-times" />
                </div>
                <div>
                  <div className="stat-value">
                    {summary.length > 0
                      ? Math.round(summary.reduce((s, r) => s + r.leavesRemaining, 0) / summary.length)
                      : 0}
                  </div>
                  <div className="stat-label">Avg Leaves Remaining</div>
                </div>
              </div>
            </div>

            {/* Preview table */}
            <div className="card">
              <div className="card-header">
                <h3>Employee Overview</h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Exports a 4-sheet Excel file: Summary · Monthly Payroll · Attendance Log · Leave Summary
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Compliance</th>
                      <th>PF</th>
                      <th>ESIC</th>
                      <th>Join Date</th>
                      <th>Present Days</th>
                      <th>Late</th>
                      <th>Half Day</th>
                      <th>Leaves Remaining</th>
                      <th>Months Paid</th>
                      <th>Total Net Paid</th>
                      <th>Last Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.length === 0 ? (
                      <tr>
                        <td colSpan="12" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                          No active employees found.
                        </td>
                      </tr>
                    ) : summary.map(({ emp, presentDays, lateDays, halfDays, leavesRemaining, totalNetPaid, lastPay, payMap: pm }) => (
                      <tr key={emp.id}>
                        <td>
                          <div className="emp-cell">
                            <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(emp.id)})` }}>
                              {getInitials(emp.first_name, emp.last_name)}
                            </div>
                            <div>
                              <div className="emp-name">{emp.first_name} {emp.last_name}</div>
                              <div className="emp-role">{emp.designation || emp.department || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {(emp.pf_enabled || emp.esic_enabled)
                            ? <span className="badge badge-success">Yes</span>
                            : <span className="badge badge-warning">No</span>}
                        </td>
                        <td>
                          {emp.pf_enabled
                            ? <span className="badge badge-success">Yes</span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No</span>}
                        </td>
                        <td>
                          {emp.esic_enabled
                            ? <span className="badge badge-success">Yes</span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No</span>}
                        </td>
                        <td style={{ fontSize: 13 }}>{emp.join_date || '—'}</td>
                        <td><strong>{presentDays}</strong></td>
                        <td style={{ color: 'var(--warning)' }}>{lateDays}</td>
                        <td style={{ color: 'var(--accent)' }}>{halfDays}</td>
                        <td>
                          <span style={{ fontWeight: 600, color: leavesRemaining > 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {leavesRemaining}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> / {emp.leave_allocation || 0}</span>
                        </td>
                        <td>{Object.keys(pm).length}</td>
                        <td><strong>{totalNetPaid > 0 ? fmt(totalNetPaid) : '—'}</strong></td>
                        <td>{lastPay != null ? fmt(lastPay) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
