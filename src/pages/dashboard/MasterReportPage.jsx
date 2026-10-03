import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { useFeatures } from '@/context/FeatureContext';
import { listActiveEmployees } from '@/services/employeeService';
import { fetchAllAttendanceWithPunches, fetchAttendanceRangeWithPunches } from '@/services/attendanceService';
import { fetchAllPayslipsForReport } from '@/services/payrollService';
import { listAllLeaveRequests } from '@/services/leaveService';
import { fetchTurnoverTrend } from '@/services/offboardingService';
import { fmtTime12, fmtDuration, dateStr, fullName, scopedToOutlet, isRaniwalaTenant, toTitleCase, isFullPaidDayStatus } from '@/lib/helpers';
import ColumnPicker from '@/components/ColumnPicker';

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

// Every distinct "YYYY-MM" touched by [fromDate, toDate] — scales the
// repeat-offender highlight threshold: 3 per calendar month spanned by the
// range, so a 1-month view flags at >3 and a 3-month view flags at >9.
function monthsInRange(fromDate, toDate) {
  const months = new Set();
  const [fy, fm] = fromDate.split('-').map(Number);
  const [ty, tm] = toDate.split('-').map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.add(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months.size;
}

// Fill/font used to flag a Late day's row — same red used by AttendancePage's
// daily download for a single Late day, so the color means the same thing
// everywhere in the app.
const FLAG_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
const FLAG_FONT = { color: { argb: 'FF9C0006' }, bold: true };

function applySheetChrome(ws, colCount) {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
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
    desc: 'Daily attendance for the selected date range. Only the specific dates an employee was Late are highlighted — the rest of their rows are unmarked.',
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
  {
    id: 'late_comers',
    label: 'Late Comers Report',
    icon: 'fa-clock',
    desc: 'Every Late instance in the selected date range (Clock In/Out included), plus a Repeat Offenders summary sheet.',
    sheetName: 'Late Instances',
    filename: 'late_comers',
    iconBg: 'var(--danger-light)',
    iconFg: 'var(--danger)',
    featureKey: 'late_comers_report',
  },
];

export default function MasterReportPage() {
  const { tenant } = useAuth();
  const { outlets, selectedOutletId, selectedOutletName, outletProfileIds, selectOutlet } = useOutletView();
  const { isEnabled } = useFeatures();
  const raniwala = isRaniwalaTenant(tenant);
  // Late Comers Report keeps its own feature-toggle key (unchanged by the
  // move from its old standalone page into this one) — everything else here
  // is already gated at the route level by "master_report".
  const visibleConfigs = REPORT_CONFIGS.filter((c) => !c.featureKey || isEnabled(c.featureKey));
  // Raniwala's employee master (name/department/division) is maintained in
  // ALL CAPS on purpose (matches their HR system) — don't title-case it away.
  const cap = (s) => (raniwala ? (s || '') : toTitleCase(s));
  const [employees, setEmployees] = useState([]);
  const [managerById, setManagerById] = useState({});
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(null); // null | 'all' | reportId
  const [summary,   setSummary]   = useState([]);
  const [year,      setYear]      = useState(new Date().getFullYear());

  // Department/Division refine the outlet-scoped roster further — applied on
  // top of whatever outlet is selected above, so a report can be downloaded
  // for e.g. "Jaipur outlet, Sales department" in one go.
  const [deptFilter,     setDeptFilter]     = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');

  // Attendance Log has its own date range instead of following `year` —
  // it's the one report people repeatedly need for an arbitrary window
  // (a pay-cycle, a specific fortnight) rather than a full calendar year.
  const [attFrom, setAttFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return dateStr(d);
  });
  const [attTo, setAttTo] = useState(() => dateStr(new Date()));
  const [attRangeMap, setAttRangeMap] = useState({}); // { [profileId]: { [date]: record } }
  const [attRangeLoading, setAttRangeLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [empsRes, attRes, payRes, leaveRes] = await Promise.all([
        listActiveEmployees(tenant.id),
        fetchAllAttendanceWithPunches(tenant.id, year),
        fetchAllPayslipsForReport(tenant.id, year),
        listAllLeaveRequests(tenant.id),
      ]);

      // Managers may sit outside the currently-selected outlet, so resolve
      // manager_id -> name from the full tenant roster, not the scoped list.
      setManagerById(Object.fromEntries((empsRes.data || []).map((e) => [e.id, fullName(e)])));
      const emps     = scopedToOutlet(empsRes.data || [], outletProfileIds, 'id');
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

      const leaveUsed  = {};
      const leaveStats = {};

      leaves.forEach(lr => {
        const yr = lr.start_date ? parseInt(lr.start_date.split('-')[0], 10) : 0;
        if (yr !== year) return;
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
        const presentDays = attRecords.filter(r => isFullPaidDayStatus(r.status)).length;
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
  }, [tenant, year, outletProfileIds]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [turnover, setTurnover] = useState([]);
  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    fetchTurnoverTrend(tenant.id, 6, outletProfileIds).then(({ data }) => { if (!cancelled) setTurnover(data || []); });
    return () => { cancelled = true; };
  }, [tenant, outletProfileIds]);

  const fetchAttendanceRange = useCallback(async () => {
    if (!tenant || !attFrom || !attTo) return;
    setAttRangeLoading(true);
    try {
      const { data, error } = await fetchAttendanceRangeWithPunches(tenant.id, attFrom, attTo);
      if (error) throw error;
      const scoped = scopedToOutlet(data || [], outletProfileIds, 'profile_id');
      const map = {};
      scoped.forEach(r => {
        if (!map[r.profile_id]) map[r.profile_id] = {};
        map[r.profile_id][r.date] = r;
      });
      setAttRangeMap(map);
    } catch (err) {
      showToast('Failed to load attendance range: ' + err.message, 'error');
    } finally {
      setAttRangeLoading(false);
    }
  }, [tenant, attFrom, attTo, outletProfileIds]);

  useEffect(() => { fetchAttendanceRange(); }, [fetchAttendanceRange]);

  const divisions = useMemo(
    () => [...new Set(employees.map((e) => e.division).filter(Boolean))].sort(),
    [employees],
  );
  // Outlet -> Division -> Department cascade: department options narrow to
  // whichever division is also selected, not just the outlet-scoped roster,
  // so picking a division only ever offers departments that exist within it.
  const departments = useMemo(
    () => [...new Set(
      employees.filter((e) => !divisionFilter || e.division === divisionFilter).map((e) => e.department).filter(Boolean)
    )].sort(),
    [employees, divisionFilter],
  );

  // Outlet/division changed and the current selection no longer applies —
  // clear it back to "All" instead of silently filtering to zero rows.
  useEffect(() => {
    if (divisionFilter && !divisions.includes(divisionFilter)) setDivisionFilter('');
  }, [divisions, divisionFilter]);
  useEffect(() => {
    if (deptFilter && !departments.includes(deptFilter)) setDeptFilter('');
  }, [departments, deptFilter]);

  const matchesDeptDivision = useCallback((emp) => {
    if (deptFilter && emp.department !== deptFilter) return false;
    if (divisionFilter && emp.division !== divisionFilter) return false;
    return true;
  }, [deptFilter, divisionFilter]);

  // Every sheet builder + the row-count preview reads these instead of the
  // raw outlet-scoped `employees`/`summary` state, so the Department/Division
  // filters above apply to every report in one pass.
  const filteredEmployees = useMemo(() => employees.filter(matchesDeptDivision), [employees, matchesDeptDivision]);
  const filteredSummary   = useMemo(() => summary.filter((r) => matchesDeptDivision(r.emp)), [summary, matchesDeptDivision]);

  const yearOptions = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  // Leads every sheet's rows with the employee's own code instead of a
  // row-number serial — a serial renumbers itself whenever rows are
  // sorted/filtered in Excel, while the employee code stays a stable
  // per-employee identifier.
  const empCode = (emp) => ((emp.employee_id || emp.essl_employee_code || '')).toString().toUpperCase();

  // Single source of truth for each report's full column set — read by both
  // the sheet builders below (filtered down to whatever's ticked) and the
  // ColumnPicker UI (so the checklist always matches what actually gets
  // written). Raniwala-only columns (Division, extra Attendance Log/Late
  // Comers fields) only appear here when `raniwala` is true, exactly as they
  // did when hardcoded per-builder.
  function columnsFor(reportId) {
    switch (reportId) {
      case 'employee_details':
        return [
          { header: 'Employee Code', key: 'code', width: 12 },
          { header: 'Employee Name', key: 'name', width: 24 },
          { header: 'Department', key: 'department', width: 18 },
          { header: 'Designation', key: 'designation', width: 20 },
          ...(raniwala ? [{ header: 'Division', key: 'division', width: 16 }] : []),
          { header: 'Join Date', key: 'joinDate', width: 12 },
          { header: 'CTC (₹)', key: 'ctc', width: 14 },
          { header: 'PF Enabled', key: 'pfEnabled', width: 12 },
          { header: 'PF Amount (₹)', key: 'pfAmount', width: 15 },
          { header: 'ESIC Enabled', key: 'esicEnabled', width: 14 },
          { header: 'ESIC Amount (₹)', key: 'esicAmount', width: 16 },
          { header: 'Leave Allocation', key: 'leaveAllocation', width: 16 },
        ];
      case 'attendance_log':
        return raniwala
          ? [
              { header: 'EMP CODE', key: 'code', width: 10 },
              { header: 'EMPLOYEE NAME', key: 'name', width: 24 },
              { header: 'DESIGNATION', key: 'designation', width: 18 },
              { header: 'DIVISION', key: 'division', width: 16 },
              { header: 'DEPARTMENT', key: 'department', width: 16 },
              { header: 'STATUS', key: 'status', width: 12 },
              { header: 'MANAGER', key: 'manager', width: 20 },
              { header: 'CLOCK IN', key: 'clockIn', width: 12 },
              { header: 'DATE', key: 'date', width: 12 },
              { header: 'DAY', key: 'day', width: 6 },
              { header: 'CLOCK OUT', key: 'clockOut', width: 12 },
              { header: 'HOURS WORKED', key: 'hoursWorked', width: 16 },
            ]
          : [
              { header: 'ESSL Employee Code', key: 'code', width: 16 },
              { header: 'Employee Name', key: 'name', width: 24 },
              { header: 'Department', key: 'department', width: 18 },
              { header: 'Designation', key: 'designation', width: 20 },
              { header: 'Date', key: 'date', width: 12 },
              { header: 'Day', key: 'day', width: 6 },
              { header: 'Status', key: 'status', width: 12 },
              { header: 'Clock In', key: 'clockIn', width: 12 },
              { header: 'Clock Out', key: 'clockOut', width: 12 },
              { header: 'Hours Worked', key: 'hoursWorked', width: 16 },
            ];
      case 'monthly_payroll':
        return [
          { header: 'Employee Code', key: 'code', width: 12 },
          { header: 'Employee Name', key: 'name', width: 24 },
          { header: 'Department', key: 'department', width: 18 },
          { header: 'Designation', key: 'designation', width: 20 },
          ...(raniwala ? [{ header: 'Division', key: 'division', width: 16 }] : []),
          { header: 'Month', key: 'month', width: 14 },
          { header: 'Year', key: 'year', width: 8 },
          { header: 'Net Pay (₹)', key: 'netPay', width: 16 },
        ];
      case 'leave_summary':
        return [
          { header: 'Employee Code', key: 'code', width: 12 },
          { header: 'Employee Name', key: 'name', width: 24 },
          { header: 'Department', key: 'department', width: 18 },
          ...(raniwala ? [{ header: 'Division', key: 'division', width: 16 }] : []),
          { header: 'Leave Allocation', key: 'leaveAllocation', width: 17 },
          { header: 'Approved (This Year)', key: 'approved', width: 22 },
          { header: 'Pending', key: 'pending', width: 12 },
          { header: 'Rejected', key: 'rejected', width: 12 },
          { header: 'Leaves Remaining', key: 'remaining', width: 18 },
        ];
      case 'late_comers':
        return raniwala
          ? [
              { header: 'EMP CODE', key: 'code', width: 10 },
              { header: 'EMPLOYEE NAME', key: 'name', width: 24 },
              { header: 'DESIGNATION', key: 'designation', width: 18 },
              { header: 'DIVISION', key: 'division', width: 16 },
              { header: 'DEPARTMENT', key: 'department', width: 16 },
              { header: 'MANAGER', key: 'manager', width: 20 },
              { header: 'LOCATION', key: 'location', width: 14 },
              { header: 'DATE', key: 'date', width: 12 },
              { header: 'CLOCK IN', key: 'clockIn', width: 12 },
              { header: 'CLOCK OUT', key: 'clockOut', width: 12 },
              { header: 'HOURS', key: 'hours', width: 12 },
            ]
          : [
              { header: 'Employee Name', key: 'name', width: 24 },
              { header: 'Department', key: 'department', width: 18 },
              { header: 'Date', key: 'date', width: 12 },
              { header: 'Clock In', key: 'clockIn', width: 12 },
              { header: 'Clock Out', key: 'clockOut', width: 12 },
              { header: 'Hours', key: 'hours', width: 12 },
            ];
      default:
        return [];
    }
  }

  const [selectedColumns, setSelectedColumns] = useState({});
  const getSelectedKeys = (reportId) =>
    selectedColumns[reportId] || new Set(columnsFor(reportId).map((c) => c.key));
  const setSelectedKeys = (reportId, next) =>
    setSelectedColumns((s) => ({ ...s, [reportId]: next }));

  function addEmployeeDetailsSheet(wb, selectedKeys) {
    const ws = wb.addWorksheet('Employee Details');
    ws.columns = columnsFor('employee_details').filter((c) => selectedKeys.has(c.key));
    filteredSummary.forEach(({ emp }) => {
      ws.addRow({
        code: empCode(emp),
        name: cap(fullName(emp)),
        department: cap(emp.department),
        designation: cap(emp.designation),
        ...(raniwala ? { division: cap(emp.division) } : {}),
        joinDate: emp.join_date || '',
        ctc: emp.ctc || 0,
        pfEnabled: emp.pf_enabled ? 'Yes' : 'No',
        pfAmount: emp.pf_amount || 0,
        esicEnabled: emp.esic_enabled ? 'Yes' : 'No',
        esicAmount: emp.esic_amount || 0,
        leaveAllocation: emp.leave_allocation || 0,
      });
    });
    applySheetChrome(ws, ws.columns.length);
  }

  // Raniwala Jewellers' downloads follow the same column order as the
  // Attendance page's daily download: EMP CODE, EMPLOYEE NAME, DESIGNATION,
  // DIVISION, DEPARTMENT, STATUS, MANAGER, CLOCK IN — with DATE/DAY/CLOCK OUT/HOURS
  // WORKED appended since this report spans a date range instead of a single
  // day; other tenants keep the original layout. Only the row for a date an
  // employee was actually marked Late gets highlighted — an employee with,
  // say, 15 days of data in range has just their late day(s) flagged, not
  // every row.
  function addAttendanceLogSheet(wb, selectedKeys) {
    const ws = wb.addWorksheet('Attendance Log');
    ws.columns = columnsFor('attendance_log').filter((c) => selectedKeys.has(c.key));

    filteredEmployees.forEach(emp => {
      const am = attRangeMap[emp.id] || {};
      const name = fullName(emp);
      Object.keys(am).sort().forEach(dt => {
        const rec         = am[dt];
        const dayName     = new Date(dt + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
        const clockIn     = getFirstIn(rec.punches);
        const clockOut    = getLastOut(rec.punches);
        const hoursWorked = rec.total_hours != null ? fmtDuration(rec.total_hours) : '';
        const row = ws.addRow(raniwala
          ? {
              code: empCode(emp), name: cap(name), designation: cap(emp.designation), division: cap(emp.division), department: cap(emp.department),
              status: rec.status || '', manager: cap(managerById[emp.manager_id]),
              clockIn: clockIn ? fmtTime12(clockIn) : '',
              date: dt, day: dayName,
              clockOut: clockOut ? fmtTime12(clockOut) : '',
              hoursWorked,
            }
          : {
              code: empCode(emp), name: cap(name), department: cap(emp.department), designation: cap(emp.designation),
              date: dt, day: dayName, status: rec.status || '',
              clockIn: clockIn ? fmtTime12(clockIn) : '',
              clockOut: clockOut ? fmtTime12(clockOut) : '',
              hoursWorked,
            });
        if (rec.status === 'Late') {
          row.eachCell((cell) => {
            cell.fill = FLAG_FILL;
            cell.font = FLAG_FONT;
          });
        }
      });
    });
    applySheetChrome(ws, ws.columns.length);
  }

  function addMonthlyPayrollSheet(wb, selectedKeys) {
    const ws = wb.addWorksheet('Monthly Payroll');
    ws.columns = columnsFor('monthly_payroll').filter((c) => selectedKeys.has(c.key));
    filteredSummary.forEach(({ emp, payMap: pm }) => {
      const name = fullName(emp);
      Object.keys(pm).sort((a, b) => b.localeCompare(a)).forEach(key => {
        const [y, m] = key.split('-').map(Number);
        ws.addRow({
          code: empCode(emp),
          name: cap(name),
          department: cap(emp.department),
          designation: cap(emp.designation),
          ...(raniwala ? { division: cap(emp.division) } : {}),
          month: new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'long' }),
          year: y,
          netPay: pm[key] ?? 0,
        });
      });
    });
    applySheetChrome(ws, ws.columns.length);
  }

  function addLeaveSummarySheet(wb, selectedKeys) {
    const ws = wb.addWorksheet('Leave Summary');
    ws.columns = columnsFor('leave_summary').filter((c) => selectedKeys.has(c.key));
    filteredSummary.forEach(({ emp, leavesRemaining, leaveApproved, leavePending, leaveRejected }) => {
      ws.addRow({
        code: empCode(emp),
        name: cap(fullName(emp)),
        department: cap(emp.department),
        ...(raniwala ? { division: cap(emp.division) } : {}),
        leaveAllocation: emp.leave_allocation || 0,
        approved: leaveApproved,
        pending: leavePending,
        rejected: leaveRejected,
        remaining: leavesRemaining,
      });
    });
    applySheetChrome(ws, ws.columns.length);
  }

  // Late instances (status === 'Late') within the shared attFrom/attTo range —
  // reads the exact same attRangeMap the Attendance Log card already fetches,
  // so "Late Comers" is just a filtered view of the same range, not a second
  // date picker or a second fetch.
  function lateInstancesInRange() {
    const instances = [];
    filteredEmployees.forEach((emp) => {
      const am = attRangeMap[emp.id] || {};
      Object.keys(am).sort().forEach((dt) => {
        const rec = am[dt];
        if (rec.status !== 'Late') return;
        instances.push({ emp, date: dt, rec });
      });
    });
    return instances;
  }

  function addLateComersSheet(wb, selectedKeys) {
    const instances = lateInstancesInRange();

    const ws = wb.addWorksheet('Late Instances');
    ws.columns = columnsFor('late_comers').filter((c) => selectedKeys.has(c.key));
    instances.forEach(({ emp, date, rec }) => {
      const clockIn  = getFirstIn(rec.punches);
      const clockOut = getLastOut(rec.punches);
      const hours    = rec.total_hours != null ? fmtDuration(rec.total_hours) : '';
      ws.addRow(raniwala
        ? {
            code: empCode(emp), name: cap(fullName(emp)), designation: cap(emp.designation),
            division: cap(emp.division), department: cap(emp.department),
            manager: cap(managerById[emp.manager_id]), location: cap(emp.outlet_location),
            date, clockIn: clockIn ? fmtTime12(clockIn) : '', clockOut: clockOut ? fmtTime12(clockOut) : '', hours,
          }
        : {
            name: cap(fullName(emp)), department: cap(emp.department),
            date, clockIn: clockIn ? fmtTime12(clockIn) : '', clockOut: clockOut ? fmtTime12(clockOut) : '', hours,
          });
    });
    applySheetChrome(ws, ws.columns.length);

    // Repeat Offenders summary — a fixed small sheet, not part of the column
    // picker (same as how every other report here is a single configurable
    // sheet plus this one extra always-on summary).
    const counts = {};
    instances.forEach((r) => { counts[r.emp.id] = (counts[r.emp.id] || 0) + 1; });
    const threshold = 3 * monthsInRange(attFrom, attTo);
    const wsSummary = wb.addWorksheet('Repeat Offenders');
    wsSummary.columns = [
      { header: 'Employee Code', key: 'code', width: 12 },
      { header: 'Employee Name', key: 'name', width: 24 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Total Late', key: 'count', width: 12 },
      { header: `Exceeds Threshold (>${threshold})`, key: 'exceeds', width: 24 },
    ];
    Object.entries(counts)
      .map(([empId, count]) => ({ emp: filteredEmployees.find((e) => e.id === empId), count }))
      .filter((r) => r.emp)
      .sort((a, b) => b.count - a.count)
      .forEach(({ emp, count }) => {
        wsSummary.addRow({
          code: empCode(emp), name: cap(fullName(emp)), department: cap(emp.department),
          count, exceeds: count > threshold ? 'Yes' : 'No',
        });
      });
    applySheetChrome(wsSummary, wsSummary.columns.length);
  }

  const SHEET_BUILDERS = {
    employee_details: addEmployeeDetailsSheet,
    attendance_log:   addAttendanceLogSheet,
    monthly_payroll:  addMonthlyPayrollSheet,
    leave_summary:    addLeaveSummarySheet,
    late_comers:      addLateComersSheet,
  };

  // Attendance Log and Late Comers both read the same shared attFrom/attTo
  // range fetch instead of the `year` selector everything else uses.
  const usesDateRange = (reportId) => reportId === 'attendance_log' || reportId === 'late_comers';

  function getRowCount(reportId) {
    if (reportId === 'attendance_log') {
      return filteredEmployees.reduce((s, e) => s + Object.keys(attRangeMap[e.id] || {}).length, 0);
    }
    if (reportId === 'late_comers') {
      return lateInstancesInRange().length;
    }
    if (!filteredSummary.length) return 0;
    if (reportId === 'employee_details') return filteredSummary.length;
    if (reportId === 'monthly_payroll')  return filteredSummary.reduce((s, r) => s + Object.keys(r.payMap).length, 0);
    if (reportId === 'leave_summary')    return filteredSummary.length;
    return 0;
  }

  async function downloadWorkbook(wb, filename) {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Filenames carry the active Outlet/Department/Division filters so a batch
  // of per-outlet or per-department downloads doesn't collide or get mixed up.
  const filterSuffix = () => {
    const parts = [];
    if (selectedOutletName) parts.push(selectedOutletName);
    if (deptFilter) parts.push(deptFilter);
    if (divisionFilter) parts.push(divisionFilter);
    return parts.length ? `_${parts.join('_').replace(/\s+/g, '_')}` : '';
  };

  const handleDownload = async (reportId) => {
    if (getRowCount(reportId) === 0) return showToast('No data to export', 'warning');
    setExporting(reportId);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const config = REPORT_CONFIGS.find(r => r.id === reportId);
      const wb = new ExcelJS.Workbook();
      SHEET_BUILDERS[reportId](wb, getSelectedKeys(reportId));
      const suffix = usesDateRange(reportId) ? `${attFrom}_to_${attTo}` : dateStr(new Date());
      await downloadWorkbook(wb, `${config.filename}${filterSuffix()}_${suffix}.xlsx`);
      showToast(`${config.label} downloaded`, 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      setExporting(null);
    }
  };

  const handleExportAll = async () => {
    if (!filteredSummary.length) return showToast('No data to export', 'warning');
    setExporting('all');
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      visibleConfigs.forEach(config => SHEET_BUILDERS[config.id](wb, getSelectedKeys(config.id)));
      await downloadWorkbook(wb, `master_report${filterSuffix()}_${dateStr(new Date())}.xlsx`);
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={loading || exporting !== null}
              title="Report year — payroll and leave data is scoped to this year (Attendance Log uses its own date range below)"
            >
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              className="btn btn-primary"
              onClick={handleExportAll}
              disabled={exporting !== null || loading}
            >
              {exporting === 'all'
                ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Generating…</>
                : <><i className="fas fa-file-excel" /> Export All Sheets</>}
            </button>
          </div>
        }
      />

      <div className="page-content">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading employee data…
          </div>
        ) : (
          <>
            {/* Outlet -> Division -> Department -> Date, applied to every report below.
                Outlet persists across the whole app (OutletViewContext, localStorage-backed),
                so it's already set once and carried between this page, Late Comers Report, etc. */}
            <div className="filter-bar" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
              {outlets.length > 0 && (
                <select
                  className="form-select"
                  value={selectedOutletId || ''}
                  onChange={(e) => selectOutlet(e.target.value || null)}
                  disabled={exporting !== null}
                  title="Location (Outlet)"
                >
                  <option value="">All Outlets (Combined)</option>
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              )}
              {raniwala && divisions.length > 0 && (
                <select
                  className="form-select"
                  value={divisionFilter}
                  onChange={(e) => setDivisionFilter(e.target.value)}
                  disabled={exporting !== null}
                >
                  <option value="">All Divisions</option>
                  {divisions.map((d) => <option key={d}>{d}</option>)}
                </select>
              )}
              <select
                className="form-select"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                disabled={exporting !== null}
              >
                <option value="">All Departments</option>
                {departments.map((d) => <option key={d}>{d}</option>)}
              </select>
              <input
                type="date"
                className="form-input"
                style={{ maxWidth: 150 }}
                value={attFrom}
                max={attTo}
                disabled={exporting !== null}
                onChange={(e) => setAttFrom(e.target.value)}
                title="Attendance Log: from date"
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                className="form-input"
                style={{ maxWidth: 150 }}
                value={attTo}
                min={attFrom}
                max={dateStr(new Date())}
                disabled={exporting !== null}
                onChange={(e) => setAttTo(e.target.value)}
                title="Attendance Log: to date"
              />
            </div>

            {/* Stats row */}
            <div className="stats-row" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                  <i className="fas fa-users" />
                </div>
                <div>
                  <div className="stat-value">{filteredEmployees.length}</div>
                  <div className="stat-label">Active Employees</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
                  <i className="fas fa-shield-alt" />
                </div>
                <div>
                  <div className="stat-value">{filteredEmployees.filter(e => e.pf_enabled || e.esic_enabled).length}</div>
                  <div className="stat-label">With Compliance</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                  <i className="fas fa-times-circle" />
                </div>
                <div>
                  <div className="stat-value">{filteredEmployees.filter(e => !e.pf_enabled && !e.esic_enabled).length}</div>
                  <div className="stat-label">Non-Compliance</div>
                </div>
              </div>
              <div className="stat-card" style={{ alignItems: 'flex-start' }}>
                <div className="stat-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                  <i className="fas fa-arrow-right-from-bracket" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="stat-value">
                    {turnover.length ? `${turnover[turnover.length - 1].rate}%` : '—'}
                  </div>
                  <div className="stat-label">Employee Turnover (this month)</div>
                  {turnover.length > 0 && (() => {
                    const max = Math.max(1, ...turnover.map((t) => t.leavers));
                    return (
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 44, marginTop: 8 }}>
                        {turnover.map((t) => (
                          <div key={t.label} title={`${t.label}: ${t.leavers} left, ${t.joiners} joined · ${t.rate}% turnover`}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <div style={{
                              width: '100%', maxWidth: 16, borderRadius: 3,
                              height: Math.max(3, Math.round((t.leavers / max) * 30)),
                              background: t.leavers ? 'var(--danger)' : 'var(--border)',
                            }} />
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{t.label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
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
                {visibleConfigs.map(config => {
                  const count      = getRowCount(config.id);
                  const isExporting = exporting === config.id;
                  const busy        = exporting !== null;
                  const isAttendance = usesDateRange(config.id);
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
                            {attRangeLoading && isAttendance
                              ? 'Loading…'
                              : count > 0
                                ? <>{count.toLocaleString()} row{count !== 1 ? 's' : ''}</>
                                : <span style={{ color: 'var(--warning)' }}>No data</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, flexGrow: 1 }}>
                        {config.desc}
                      </div>
                      {isAttendance && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="date"
                            className="form-input"
                            style={{ fontSize: 12, padding: '4px 6px' }}
                            value={attFrom}
                            max={attTo}
                            disabled={busy}
                            onChange={(e) => setAttFrom(e.target.value)}
                            title="From date"
                          />
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                          <input
                            type="date"
                            className="form-input"
                            style={{ fontSize: 12, padding: '4px 6px' }}
                            value={attTo}
                            min={attFrom}
                            max={dateStr(new Date())}
                            disabled={busy}
                            onChange={(e) => setAttTo(e.target.value)}
                            title="To date"
                          />
                        </div>
                      )}
                      <ColumnPicker
                        columns={columnsFor(config.id).map((c) => ({ key: c.key, label: c.header }))}
                        selected={getSelectedKeys(config.id)}
                        onChange={(next) => setSelectedKeys(config.id, next)}
                        disabled={busy}
                      />
                      <button
                        className="btn btn-outline btn-block btn-sm"
                        style={{ marginTop: 2 }}
                        onClick={() => handleDownload(config.id)}
                        disabled={busy || count === 0 || (isAttendance && attRangeLoading)}
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
