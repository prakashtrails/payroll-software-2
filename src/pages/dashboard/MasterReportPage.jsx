import React, { useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listActiveEmployees } from '@/services/employeeService';
import { fetchAllAttendanceWithPunches } from '@/services/attendanceService';
import { fetchAllPayslipsForReport } from '@/services/payrollService';
import { listAllLeaveRequests } from '@/services/leaveService';
import { fmtTime12, dateStr } from '@/lib/helpers';

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

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const c = (n - 1) % 26;
    s = String.fromCharCode(65 + c) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function applySheetMeta(ws, colCount, dataRowCount) {
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  if (dataRowCount > 0) {
    ws['!autofilter'] = { ref: `A1:${colLetter(colCount)}1` };
  }
}

function setColWidths(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}

const REPORT_CONFIGS = [
  {
    id: 'employee_details',
    label: 'Employee Details',
    icon: 'fa-id-card',
    desc: 'Full employee profiles — department, designation, join date, CTC, PF/ESIC compliance, and leave allocation.',
    sheetName: 'Employee Details',
    filename: 'employee_details',
    iconBg: 'var(--primary-light)',
    iconFg: 'var(--primary)',
  },
  {
    id: 'attendance_log',
    label: 'Attendance Log',
    icon: 'fa-calendar-check',
    desc: 'Daily attendance records with punch-in/out times, status, and hours worked for all employees.',
    sheetName: 'Attendance Log',
    filename: 'attendance_log',
    iconBg: 'var(--success-light)',
    iconFg: 'var(--success)',
  },
  {
    id: 'monthly_payroll',
    label: 'Monthly Payroll',
    icon: 'fa-file-invoice',
    desc: 'Month-wise net pay breakdown per employee, sorted newest month first.',
    sheetName: 'Monthly Payroll',
    filename: 'monthly_payroll',
    iconBg: '#ede9fe',
    iconFg: '#7c3aed',
  },
  {
    id: 'leave_summary',
    label: 'Leave Summary',
    icon: 'fa-umbrella-beach',
    desc: 'Leave allocation vs. approved / pending / rejected counts for the current calendar year.',
    sheetName: 'Leave Summary',
    filename: 'leave_summary',
    iconBg: 'var(--warning-light)',
    iconFg: 'var(--warning)',
  },
];

export default function MasterReportPage() {
  const { tenant } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(null); // null | 'all' | reportId
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

      const attMap = {};
      attAll.forEach(r => {
        if (!attMap[r.profile_id]) attMap[r.profile_id] = {};
        attMap[r.profile_id][r.date] = r;
      });

      const payMap = {};
      payrolls.forEach(pr => {
        (pr.payslips || []).forEach(ps => {
          const key = `${pr.year}-${pr.month}`;
          if (!payMap[ps.profile_id]) payMap[ps.profile_id] = {};
          payMap[ps.profile_id][key] = ps.net_pay;
        });
      });

      const thisYear = new Date().getFullYear();
      const leaveUsed  = {};
      const leaveStats = {};

      leaves.forEach(lr => {
        const yr = lr.start_date ? parseInt(lr.start_date.split('-')[0], 10) : 0;
        if (yr !== thisYear) return;
        const days   = lr.days_count || lr.days || 1;
        const empId  = lr.profile_id;
        const status = (lr.status || '').toLowerCase();
        if (!leaveStats[empId]) leaveStats[empId] = { approved: 0, pending: 0, rejected: 0 };
        if (status === 'approved') {
          if (!leaveUsed[empId]) leaveUsed[empId] = 0;
          leaveUsed[empId] += days;
          leaveStats[empId].approved += days;
        } else if (status === 'pending') {
          leaveStats[empId].pending += days;
        } else if (status === 'rejected') {
          leaveStats[empId].rejected += days;
        }
      });

      const rows = emps.map(emp => {
        const empAtt      = attMap[emp.id] || {};
        const attRecords  = Object.values(empAtt);
        const presentDays = attRecords.filter(r => r.status === 'Present' || r.status === 'Late').length;
        const lateDays    = attRecords.filter(r => r.status === 'Late').length;
        const halfDays    = attRecords.filter(r => r.status === 'Half Day').length;
        const leaveDays   = attRecords.filter(r => r.status === 'Leave').length;
        const empPayMap   = payMap[emp.id] || {};
        const payValues   = Object.values(empPayMap);
        const totalNetPaid = payValues.reduce((s, v) => s + (v || 0), 0);
        const sortedKeys   = Object.keys(empPayMap).sort((a, b) => b.localeCompare(a));
        const lastPay      = sortedKeys.length ? empPayMap[sortedKeys[0]] : null;
        const usedThisYear = leaveUsed[emp.id] || 0;
        const leavesRemaining = Math.max(0, (emp.leave_allocation || 0) - usedThisYear);
        const ls = leaveStats[emp.id] || { approved: 0, pending: 0, rejected: 0 };

        return {
          emp,
          presentDays, lateDays, halfDays, leaveDays,
          totalNetPaid, lastPay,
          usedThisYear, leavesRemaining,
          leaveApproved: ls.approved,
          leavePending:  ls.pending,
          leaveRejected: ls.rejected,
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

  function buildSheet(reportId) {
    if (reportId === 'employee_details') {
      const headers = [
        '#', 'Employee Name', 'Department', 'Designation', 'Join Date',
        'CTC (₹)', 'PF Enabled', 'PF Amount (₹)', 'ESIC Enabled', 'ESIC Amount (₹)',
        'Leave Allocation',
      ];
      const dataRows = summary.map(({ emp }, i) => [
        i + 1,
        `${emp.first_name} ${emp.last_name}`.trim(),
        emp.department    || '',
        emp.designation   || '',
        emp.join_date     || '',
        emp.ctc           || 0,
        emp.pf_enabled    ? 'Yes' : 'No',
        emp.pf_amount     || 0,
        emp.esic_enabled  ? 'Yes' : 'No',
        emp.esic_amount   || 0,
        emp.leave_allocation || 0,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      setColWidths(ws, [5, 24, 18, 20, 12, 14, 12, 15, 14, 16, 16]);
      applySheetMeta(ws, headers.length, dataRows.length);
      return ws;
    }

    if (reportId === 'attendance_log') {
      const headers = [
        '#', 'Employee Name', 'Department', 'Designation',
        'Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours Worked',
      ];
      const dataRows = [];
      summary.forEach(({ emp, attMap: am }) => {
        const name = `${emp.first_name} ${emp.last_name}`.trim();
        Object.keys(am).sort().forEach(dt => {
          const rec      = am[dt];
          const dayName  = new Date(dt + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
          const clockIn  = getFirstIn(rec.punches);
          const clockOut = getLastOut(rec.punches);
          dataRows.push([
            dataRows.length + 1,
            name,
            emp.department  || '',
            emp.designation || '',
            dt,
            dayName,
            rec.status || '',
            clockIn  ? fmtTime12(clockIn)  : '',
            clockOut ? fmtTime12(clockOut) : '',
            rec.total_hours != null ? rec.total_hours : '',
          ]);
        });
      });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      setColWidths(ws, [5, 24, 18, 20, 12, 6, 12, 12, 12, 13]);
      applySheetMeta(ws, headers.length, dataRows.length);
      return ws;
    }

    if (reportId === 'monthly_payroll') {
      const headers = ['#', 'Employee Name', 'Department', 'Designation', 'Month', 'Year', 'Net Pay (₹)'];
      const dataRows = [];
      summary.forEach(({ emp, payMap: pm }) => {
        const name = `${emp.first_name} ${emp.last_name}`.trim();
        Object.keys(pm).sort((a, b) => b.localeCompare(a)).forEach(key => {
          const [y, m] = key.split('-').map(Number);
          dataRows.push([
            dataRows.length + 1,
            name,
            emp.department  || '',
            emp.designation || '',
            new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'long' }),
            y,
            pm[key] ?? 0,
          ]);
        });
      });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      setColWidths(ws, [5, 24, 18, 20, 14, 8, 16]);
      applySheetMeta(ws, headers.length, dataRows.length);
      return ws;
    }

    if (reportId === 'leave_summary') {
      const headers = [
        '#', 'Employee Name', 'Department',
        'Leave Allocation', 'Approved (This Year)', 'Pending', 'Rejected', 'Leaves Remaining',
      ];
      const dataRows = summary.map(({ emp, leavesRemaining, leaveApproved, leavePending, leaveRejected }, i) => [
        i + 1,
        `${emp.first_name} ${emp.last_name}`.trim(),
        emp.department || '',
        emp.leave_allocation || 0,
        leaveApproved,
        leavePending,
        leaveRejected,
        leavesRemaining,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      setColWidths(ws, [5, 24, 18, 17, 22, 12, 12, 18]);
      applySheetMeta(ws, headers.length, dataRows.length);
      return ws;
    }

    return null;
  }

  function getRowCount(reportId) {
    if (!summary.length) return 0;
    if (reportId === 'employee_details') return summary.length;
    if (reportId === 'attendance_log')   return summary.reduce((s, r) => s + Object.keys(r.attMap).length, 0);
    if (reportId === 'monthly_payroll')  return summary.reduce((s, r) => s + Object.keys(r.payMap).length, 0);
    if (reportId === 'leave_summary')    return summary.length;
    return 0;
  }

  const handleDownload = async (reportId) => {
    if (!summary.length) return showToast('No data to export', 'warning');
    setExporting(reportId);
    try {
      const config = REPORT_CONFIGS.find(r => r.id === reportId);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildSheet(reportId), config.sheetName);
      XLSX.writeFile(wb, `${config.filename}_${dateStr(new Date())}.xlsx`);
      showToast(`${config.label} downloaded`, 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      setExporting(null);
    }
  };

  const handleExportAll = async () => {
    if (!summary.length) return showToast('No data to export', 'warning');
    setExporting('all');
    try {
      const wb = XLSX.utils.book_new();
      REPORT_CONFIGS.forEach(config => {
        XLSX.utils.book_append_sheet(wb, buildSheet(config.id), config.sheetName);
      });
      XLSX.writeFile(wb, `master_report_${dateStr(new Date())}.xlsx`);
      showToast('Master report exported successfully', 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <Header
        title="Master Report"
        breadcrumb="Dashboard / Master Report"
        actions={
          <button
            className="btn btn-primary"
            onClick={handleExportAll}
            disabled={exporting !== null || loading}
          >
            {exporting === 'all'
              ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Generating…</>
              : <><i className="fas fa-file-excel" /> Export All Sheets</>}
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
                  <div className="stat-label">With Compliance</div>
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

            {/* Individual Report Download Cards */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <h3>Download Reports</h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Download each report individually, or use <strong>Export All Sheets</strong> above for a combined workbook
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 16,
                padding: '4px 20px 20px',
              }}>
                {REPORT_CONFIGS.map(config => {
                  const count      = getRowCount(config.id);
                  const isExporting = exporting === config.id;
                  const busy        = exporting !== null;
                  return (
                    <div
                      key={config.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: '16px 18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        background: 'var(--card-bg)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                          background: config.iconBg, color: config.iconFg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 18,
                        }}>
                          <i className={`fas ${config.icon}`} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                            {config.label}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {count > 0
                              ? <>{count.toLocaleString()} row{count !== 1 ? 's' : ''}</>
                              : <span style={{ color: 'var(--warning)' }}>No data</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, flexGrow: 1 }}>
                        {config.desc}
                      </div>
                      <button
                        className="btn btn-outline btn-block btn-sm"
                        style={{ marginTop: 2 }}
                        onClick={() => handleDownload(config.id)}
                        disabled={busy || count === 0}
                      >
                        {isExporting
                          ? <><div className="spinner" style={{ width: 11, height: 11, borderWidth: 2 }} /> Downloading…</>
                          : <><i className="fas fa-download" /> Download .xlsx</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

          </>
        )}
      </div>
    </>
  );
}
