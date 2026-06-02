import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  listEmployees, createEmployee, updateEmployee, updateEmployeeAdmin,
  setEmployeeStatus, removeEmployee, EMPLOYEE_PAGE_SIZE,
} from '@/services/employeeService';
import { listDepartments, listShifts } from '@/services/tenantService';
import { supabase } from '@/lib/supabase';
import { fmt, getInitials, getAvatarColor, todayStr } from '@/lib/helpers';

function TempPasswordModal({ show, onClose, empName, email, password }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal show={show} onClose={onClose} title="Employee Credentials" width="440px"
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 44, color: 'var(--success)', marginBottom: 12 }}>
          <i className="fas fa-user-shield" />
        </div>
        <h3 style={{ marginBottom: 6 }}>{empName}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Share these login credentials with the employee
        </p>
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: 16, position: 'relative' }}>
        <button
          onClick={copyToClipboard}
          style={{
            position: 'absolute', right: 10, top: 10, border: 'none', background: 'none',
            cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-muted)'
          }}
          title="Copy to clipboard"
        >
          <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} />
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Email</span>
          <strong>{email}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Temporary Password</span>
          <strong style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{password}</strong>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
        <i className="fas fa-info-circle" style={{ color: 'var(--primary)' }} />{' '}
        You can view these credentials anytime from the employee list.
      </p>
    </Modal>
  );
}

const EMPTY_FORM = {
  first_name: '', last_name: '', email: '', phone: '',
  department: '', designation: '', join_date: '', ctc: '',
  bank_acc: '', pan: '', aadhar: '', role: 'employee',
  weekly_holiday: 'Sunday', shift_id: '', leave_allocation: 0,
  country: 'India', passport_number: '', work_permit_number: '', work_permit_expiry: '',
};

const isIndia = (country) => !country || country.trim().toLowerCase() === 'india';

function getComplianceStatus(emp) {
  if (isIndia(emp.country)) {
    const hasPan = !!emp.pan;
    const hasAadhar = !!emp.aadhar;
    if (hasPan && hasAadhar) return 'compliant';
    if (hasPan || hasAadhar) return 'partial';
    return 'missing';
  }
  // International employee
  if (emp.passport_number) return 'compliant';
  return 'missing';
}

const COMPLIANCE_BADGE = {
  compliant: { label: 'Compliant', cls: 'badge-success' },
  partial:   { label: 'Partial',   cls: 'badge-warning' },
  missing:   { label: 'Docs Missing', cls: 'badge-danger' },
};

export default function EmployeesPage() {
  const { tenant } = useAuth();

  // ---- filter state ----
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  // ---- pagination ----
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalCount / EMPLOYEE_PAGE_SIZE));

  // ---- data ----
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clockedInSet, setClockedInSet] = useState(new Set());

  // ---- modal ----
  const [showModal, setShowModal] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [tempCreds, setTempCreds] = useState(null);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, deptFilter, statusFilter]);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [empRes, deptRes, shiftRes, attRes] = await Promise.all([
      listEmployees(tenant.id, { page, search: debouncedSearch, department: deptFilter, status: statusFilter }),
      listDepartments(tenant.id),
      listShifts(tenant.id),
      supabase
        .from('attendance')
        .select('profile_id, punches(punch_type)')
        .eq('tenant_id', tenant.id)
        .eq('date', todayStr()),
    ]);
    setEmployees(empRes.data);
    setTotalCount(empRes.count);
    setDepartments((deptRes.data || []).map((d) => d.name));
    setShifts(shiftRes.data || []);

    // Build set of profile_ids who are currently clocked in (more ins than outs today)
    const working = new Set();
    (attRes.data || []).forEach((rec) => {
      const ins  = (rec.punches || []).filter((p) => p.punch_type === 'in').length;
      const outs = (rec.punches || []).filter((p) => p.punch_type === 'out').length;
      if (ins > outs) working.add(rec.profile_id);
    });
    setClockedInSet(working);

    setLoading(false);
  }, [tenant, page, debouncedSearch, deptFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (emp = null) => {
    setEditEmp(emp);
    setForm(emp ? {
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      email: emp.email || '',
      phone: emp.phone || '',
      department: emp.department || '',
      designation: emp.designation || '',
      join_date: emp.join_date || '',
      ctc: emp.ctc || '',
      bank_acc: emp.bank_acc || '',
      pan: emp.pan || '',
      aadhar: emp.aadhar || '',
      role: emp.role || 'employee',
      weekly_holiday: emp.weekly_holiday || 'Sunday',
      shift_id: emp.shift_id || '',
      leave_allocation: emp.leave_allocation || 0,
      country: emp.country || 'India',
      passport_number: emp.passport_number || '',
      work_permit_number: emp.work_permit_number || '',
      work_permit_expiry: emp.work_permit_expiry || '',
    } : EMPTY_FORM);
    setShowModal(true);
  };

  const downloadSampleCSV = () => {
    const csvContent =
      'first_name,last_name,email,phone,department,designation,join_date,ctc,bank_acc,country,pan,aadhar,passport_number,work_permit_number,work_permit_expiry,role,weekly_holiday,leave_allocation\n' +
      'Jane,Doe,jane.doe@example.com,9999999999,HR,Recruiter,2026-05-01,45000,123456789012,India,ABCDE1234F,999988887777,,,employee,Sunday,12\n' +
      'John,Smith,john.smith@example.com,+442012345678,Engineering,Developer,2026-05-01,80000,GB12345678,United Kingdom,,,,P12345678,WP-UK-9999,2027-12-31,employee,Saturday,15\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'employee_import_sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveEmployee = async () => {
    if (!form.first_name || !form.last_name) return showToast('First and last name required', 'error');
    if (!form.email) return showToast('Email is required', 'error');
    if (!form.department) return showToast('Department is mandatory', 'error');
    if (!form.join_date) return showToast('Joining date is mandatory', 'error');
    if (!form.bank_acc) return showToast('Bank account details are mandatory', 'error');
    if (!form.ctc || parseFloat(form.ctc) <= 0) return showToast('Valid Monthly CTC is required', 'error');

    const empCountry = (form.country || 'India').trim();
    if (isIndia(empCountry)) {
      if (!form.pan && !form.aadhar) {
        showToast('Compliance warning: PAN and Aadhar are missing for an India-based employee. Please add at least one document.', 'warning');
      }
    } else {
      if (!form.passport_number) {
        showToast('Compliance warning: Passport number is missing for an international employee.', 'warning');
      }
    }

    const profileData = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      department: form.department,
      designation: form.designation.trim(),
      join_date: form.join_date || null,
      ctc: parseFloat(form.ctc) || 0,
      bank_acc: form.bank_acc.trim(),
      pan: isIndia(empCountry) ? form.pan.trim() : '',
      aadhar: isIndia(empCountry) ? form.aadhar.trim() : '',
      country: empCountry,
      passport_number: !isIndia(empCountry) ? (form.passport_number || '').trim() : '',
      work_permit_number: !isIndia(empCountry) ? (form.work_permit_number || '').trim() : '',
      work_permit_expiry: !isIndia(empCountry) ? (form.work_permit_expiry || null) : null,
      role: form.role || 'employee',
      weekly_holiday: form.weekly_holiday,
      shift_id: form.shift_id || null,
      leave_allocation: parseInt(form.leave_allocation, 10) || 0,
    };

    setSaving(true);
    try {
      if (editEmp) {
        const { error } = await updateEmployee(editEmp.id, profileData);
        if (error) throw new Error('Update failed: ' + error.message);
        showToast('Employee updated', 'success');
        setShowModal(false);
      } else {
        const { tempPassword } = await createEmployee(tenant?.id, profileData);
        setShowModal(false);
        setTempCreds({ empName: `${profileData.first_name} ${profileData.last_name}`, email: profileData.email, password: tempPassword });
      }
      fetchData();
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.xlsm');

    const toDateStr = (val) => {
      if (!val && val !== 0) return '';
      // Excel serial number (e.g. 45839)
      if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        return date.toISOString().slice(0, 10);
      }
      // JS Date object (when cellDates:true is used)
      if (val instanceof Date) return val.toISOString().slice(0, 10);
      // Already a string — normalise DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD
      const s = String(val).trim();
      const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`;
      return s;
    };

    const parseRows = (buffer) => {
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { defval: '' });
    };

    const parseCsv = (text) => {
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return [];
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      return lines.slice(1).map(row => {
        const values = row.split(',').map(v => v.trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
        return obj;
      });
    };

    const reader = new FileReader();
    reader.onload = async (evt) => {
      let rows;
      try {
        if (isXlsx) {
          rows = parseRows(new Uint8Array(evt.target.result));
        } else {
          rows = parseCsv(evt.target.result);
        }
      } catch (parseErr) {
        showToast('Failed to parse file: ' + (parseErr.message || 'Unknown error'), 'error');
        e.target.value = '';
        return;
      }

      if (!rows.length) {
        showToast('No data rows found in file', 'error');
        e.target.value = '';
        return;
      }

      // Fetch existing profiles (id + email + name) to detect duplicates and incomplete records
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('id, email, first_name, last_name')
        .eq('tenant_id', tenant?.id);
      const existingProfileMap = new Map(
        (existingProfiles || []).map(p => [(p.email || '').toLowerCase(), p])
      );

      let successCount = 0;
      let updateCount = 0;
      let skipCount = 0;
      let failCount = 0;
      let failErrors = [];

      showToast(`Importing ${rows.length} employees...`, 'info');

      for (const data of rows) {
        // Normalize keys: lowercase + replace spaces/hyphens with underscores
        // Convert Date objects to YYYY-MM-DD before stringifying to avoid
        // locale timezone strings like "GMT+0530" reaching Postgres.
        const d = Object.fromEntries(Object.entries(data).map(([k, v]) => {
          const key = k.trim().toLowerCase().replace(/[\s\-]+/g, '_');
          const val = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim();
          return [key, val];
        }));

        const fullName = d.name || d.full_name || d.employee_name || '';
        const rowCountry = (d.country || d.country_of_residence || d.nationality || 'India').trim() || 'India';
        const rowIsIndia = isIndia(rowCountry);

        const profileData = {
          first_name: d.first_name || d.firstname || fullName.split(' ')[0] || 'Imported',
          last_name: d.last_name || d.lastname || d.surname || fullName.split(' ').slice(1).join(' ') || 'User',
          email: d.email || d.email_id || d.email_address || '',
          phone: d.phone || d.mobile || d.contact || d.phone_number || d.mobile_number || '',
          department: d.department || d.dept || '',
          designation: d.designation || d.position || d.job_title || d.title || '',
          join_date: toDateStr(d.join_date || d.joining_date || d.date_of_joining || d.doj) || todayStr(),
          ctc: parseFloat(d.ctc || d.salary || d.annual_ctc || d.gross_salary || 0) || 0,
          bank_acc: d.bank_acc || d.bank_account || d.account_number || d.acc_no || '',
          // India-only compliance docs — set empty for international employees
          pan:    rowIsIndia ? (d.pan || d.pan_number || d.pan_no || '') : '',
          aadhar: rowIsIndia ? (d.aadhar || d.aadhaar || d.aadhar_number || d.aadhaar_number || '') : '',
          // International compliance docs — only relevant for non-India employees
          country: rowCountry,
          passport_number:    !rowIsIndia ? (d.passport_number || d.passport || d.passport_no || '') : '',
          work_permit_number: !rowIsIndia ? (d.work_permit_number || d.work_permit || d.permit_number || '') : '',
          work_permit_expiry: !rowIsIndia ? toDateStr(d.work_permit_expiry || d.permit_expiry || d.visa_expiry || '') || null : null,
          role: d.role || d.user_role || 'employee',
          status: /^inactive$/i.test(d.status) ? 'Inactive' : 'Active',
          weekly_holiday: d.weekly_holiday || d.holiday || 'Sunday',
          leave_allocation: parseInt(d.leave_allocation || d.leaves || d.annual_leaves || 0, 10) || 0,
        };

        if (!profileData.email) { failCount++; continue; }

        const existing = existingProfileMap.get(profileData.email.toLowerCase());
        if (existing) {
          // Update only if name fields are missing/placeholder
          const nameMissing =
            !existing.first_name || existing.first_name === 'Imported' ||
            !existing.last_name || existing.last_name === 'User';
          if (!nameMissing) {
            skipCount++;
            continue;
          }
          try {
            const { error: updErr } = await updateEmployeeAdmin(existing.id, {
              first_name: profileData.first_name,
              last_name: profileData.last_name,
              phone: profileData.phone || '',
              department: profileData.department || '',
              designation: profileData.designation || '',
              join_date: toDateStr(profileData.join_date) || null,
              ctc: profileData.ctc || 0,
              bank_acc: profileData.bank_acc || '',
              pan: profileData.pan || '',
              aadhar: profileData.aadhar || '',
              country: profileData.country || 'India',
              passport_number: profileData.passport_number || '',
              work_permit_number: profileData.work_permit_number || '',
              work_permit_expiry: profileData.work_permit_expiry || null,
              weekly_holiday: profileData.weekly_holiday || 'Sunday',
              leave_allocation: profileData.leave_allocation || 0,
            });
            if (updErr) throw updErr;
            updateCount++;
          } catch (err) {
            failCount++;
            failErrors.push(`${profileData.email}: ${err.message || 'Update failed'}`);
          }
          continue;
        }

        try {
          await createEmployee(tenant?.id, profileData);
          existingProfileMap.set(profileData.email.toLowerCase(), { email: profileData.email });
          successCount++;
        } catch (err) {
          const msg = err.message || '';
          if (/already registered|already in use|already exists|user already/i.test(msg)) {
            skipCount++;
          } else if (/rate limit|too many requests|security purposes|after \d+ second/i.test(msg)) {
            failCount++;
            failErrors.push(`${profileData.email}: email rate limit — deploy the create-employee-user edge function (see docs)`);
          } else {
            console.error(`Import fail for ${profileData.email}:`, err);
            failCount++;
            failErrors.push(`${profileData.email}: ${msg || 'Unknown error'}`);
          }
        }
      }

      const parts = [`${successCount} imported`];
      if (updateCount > 0) parts.push(`${updateCount} updated`);
      if (skipCount > 0) parts.push(`${skipCount} skipped (already complete)`);
      if (failCount > 0) parts.push(`${failCount} failed`);
      const summary = parts.join(', ');

      if (failCount > 0) {
        showToast(`Import complete: ${summary}. Errors: ${failErrors.join(' | ')}`, 'error');
      } else {
        showToast(`Import complete: ${summary}`, successCount > 0 ? 'success' : 'info');
      }
      fetchData();
      e.target.value = '';
    };

    if (isXlsx) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  const toggleStatus = async (emp) => {
    const newStatus = emp.status === 'Active' ? 'Inactive' : 'Active';
    const { error } = await setEmployeeStatus(emp.id, newStatus);
    if (error) return showToast('Failed to update status', 'error');
    showToast(`Employee ${newStatus === 'Active' ? 'activated' : 'deactivated'}`, 'info');
    fetchData();
  };

  const deleteEmp = async (emp) => {
    if (!confirm(`Delete ${emp.first_name} ${emp.last_name}? This cannot be undone.`)) return;
    const { error } = await removeEmployee(emp.id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Employee deleted', 'success');
    if (employees.length === 1 && page > 1) setPage(page - 1);
    else fetchData();
  };

  const showCredentials = (emp) => {
    setTempCreds({
      empName: `${emp.first_name} ${emp.last_name}`,
      email: emp.email,
      password: emp.temp_password || '********'
    });
  };

  return (
    <>
      <Header title="Employees" breadcrumb={`${totalCount} employees`} />
      <div className="page-content">
        <div className="filter-bar">
          <select className="form-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <input
            className="form-input"
            placeholder="🔍 Search name, email, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-outline" onClick={() => document.getElementById('import-csv').click()}>
              <i className="fas fa-file-import" /> Import CSV / XLSX
            </button>
            <input id="import-csv" type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm" style={{ display: 'none' }} onChange={handleImport} />
            <button className="btn btn-outline" onClick={downloadSampleCSV}>
              <i className="fas fa-file-csv" /> Sample CSV
            </button>
            <button className="btn btn-primary" onClick={() => openModal()}>
              <i className="fas fa-plus" /> Add Employee
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading employees…
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th><th>Department</th><th>Designation</th><th>Leaves</th>
                    <th>Monthly CTC</th><th>Compliance</th><th>Status</th><th>Today</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                        {debouncedSearch || deptFilter || statusFilter
                          ? 'No employees match your filters.'
                          : 'No employees yet. Click "Add Employee" to get started.'}
                      </td>
                    </tr>
                  ) : employees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div className="emp-cell">
                          <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(e.id)})` }}>
                            {getInitials(e.first_name, e.last_name)}
                          </div>
                          <div>
                            <div className="emp-name">{e.first_name} {e.last_name}</div>
                            <div className="emp-role">{e.email || ''}</div>
                          </div>
                        </div>
                      </td>
                      <td>{e.department || '—'}</td>
                      <td>{e.designation || '—'}</td>
                      <td>{typeof e.leave_allocation === 'number' ? e.leave_allocation : (e.leave_allocation || 0)}</td>
                      <td>{fmt(e.ctc)}</td>
                      <td>
                        {(() => {
                          const cs = getComplianceStatus(e);
                          const { label, cls } = COMPLIANCE_BADGE[cs];
                          const tip = isIndia(e.country)
                            ? `India — PAN: ${e.pan || 'missing'}, Aadhar: ${e.aadhar || 'missing'}`
                            : `${e.country || 'International'} — Passport: ${e.passport_number || 'missing'}`;
                          return <span className={`badge ${cls}`} title={tip}>{label}</span>;
                        })()}
                      </td>
                      <td><span className={`badge ${e.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>{e.status}</span></td>
                      <td>
                        {clockedInSet.has(e.id)
                          ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />Working</span>
                          : <span className="badge badge-secondary" style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-outline btn-icon btn-sm" onClick={() => openModal(e)} title="Edit"><i className="fas fa-edit" /></button>
                          <button className="btn btn-outline btn-icon btn-sm" onClick={() => showCredentials(e)} title="Show Credentials"><i className="fas fa-key" /></button>
                          <button className="btn btn-outline btn-icon btn-sm" onClick={() => toggleStatus(e)} title="Toggle Status"><i className="fas fa-power-off" /></button>
                          <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteEmp(e)} title="Delete"><i className="fas fa-trash" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title={editEmp ? 'Edit Employee' : 'Add Employee'}
        width="600px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEmployee} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving…</> : <><i className="fas fa-check" /> Save</>}
          </button>
        </>}
      >
        <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 }}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">First Name *</label><input className="form-input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Last Name *</label><input className="form-input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email Address *</label>
              <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!editEmp} />
              {!editEmp && <div className="form-hint">Employee will use this to login</div>}
            </div>
            <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Department *</label>
              <select className="form-select" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">Select</option>
                {departments.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Designation</label><input className="form-input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Joining Date *</label><input className="form-input" type="date" value={form.join_date} onChange={(e) => setForm({ ...form, join_date: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Monthly CTC (₹) *</label><input className="form-input" type="number" min="0" value={form.ctc} onChange={(e) => setForm({ ...form, ctc: e.target.value })} /></div>
          </div>
          <div className="form-group">
            <label className="form-label">Bank Account Number *</label>
            <input className="form-input" value={form.bank_acc} onChange={(e) => setForm({ ...form, bank_acc: e.target.value })} placeholder="Enter bank account number" />
          </div>

          {/* Compliance Section */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
              <i className="fas fa-shield-alt" style={{ marginRight: 6, color: 'var(--primary)' }} />
              Compliance &amp; Identity Documents
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Country of Residence</label>
              <input
                className="form-input"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="e.g. India, United Kingdom, USA"
              />
              <div className="form-hint">Set to &quot;India&quot; for Indian employees — PAN &amp; Aadhar will be required. Other countries need Passport details.</div>
            </div>

            {isIndia(form.country) ? (
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">PAN Card</label>
                  <input className="form-input" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} placeholder="e.g. ABCDE1234F" />
                </div>
                <div className="form-group">
                  <label className="form-label">Aadhar Number</label>
                  <input className="form-input" value={form.aadhar} onChange={(e) => setForm({ ...form, aadhar: e.target.value })} placeholder="12-digit Aadhar" />
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 10px', background: 'rgba(var(--primary-rgb, 59,130,246), 0.08)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
                  <i className="fas fa-info-circle" style={{ color: 'var(--primary)' }} />
                  International employee — Aadhar &amp; PAN not applicable. Please provide passport details.
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Passport Number</label>
                    <input className="form-input" value={form.passport_number} onChange={(e) => setForm({ ...form, passport_number: e.target.value })} placeholder="e.g. P1234567" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Work Permit Number</label>
                    <input className="form-input" value={form.work_permit_number} onChange={(e) => setForm({ ...form, work_permit_number: e.target.value })} placeholder="Optional" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Work Permit Expiry Date</label>
                  <input className="form-input" type="date" value={form.work_permit_expiry} onChange={(e) => setForm({ ...form, work_permit_expiry: e.target.value })} />
                </div>
              </>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Weekly Holiday</label>
              <select className="form-select" value={form.weekly_holiday} onChange={(e) => setForm({ ...form, weekly_holiday: e.target.value })}>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Flexible'].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Default Shift</label>
              <select className="form-select" value={form.shift_id} onChange={(e) => setForm({ ...form, shift_id: e.target.value })}>
                <option value="">Company Default</option>
                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time}-{s.end_time})</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Annual Leave Allocation</label>
              <input className="form-input" type="number" min="0" value={form.leave_allocation}
                onChange={(e) => setForm({ ...form, leave_allocation: e.target.value })} />
              <div className="form-hint">Number of leaves assigned to this employee per year.</div>
            </div>
            <div className="form-group">
              <label className="form-label">User Role</label>
              <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
              </select>
              <div className="form-hint">Admin has full access. Manager can approve leaves and manage attendance.</div>
            </div>
          </div>
        </div>
      </Modal>

      <TempPasswordModal
        show={!!tempCreds}
        onClose={() => setTempCreds(null)}
        empName={tempCreds?.empName}
        email={tempCreds?.email}
        password={tempCreds?.password}
      />
    </>
  );
}
