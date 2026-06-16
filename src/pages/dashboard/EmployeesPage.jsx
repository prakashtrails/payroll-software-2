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
  listEmployees, listBranches, createEmployee, updateEmployee, updateEmployeeAdmin,
  setEmployeeStatus, removeEmployee, EMPLOYEE_PAGE_SIZE,
} from '@/services/employeeService';
import { fetchGroupDashboard, transferEmployee, fetchTransferHistory } from '@/services/groupService';
import { listEmployeePromotions, recordPromotion } from '@/services/promotionService';
import { listDepartments, listShifts } from '@/services/tenantService';
import { supabase } from '@/lib/supabase';
import { fmt, getInitials, getAvatarColor, todayStr } from '@/lib/helpers';

const isIndia = (country) => {
  const c = (country || '').toLowerCase().trim();
  return !c || c === 'india' || c === 'in';
};

function buildNewEmployeeId(currentId, destLocationCode) {
  if (!currentId || currentId.length < 4) return currentId || '';
  const outletCode = currentId.slice(0, 2);
  const suffix     = currentId.slice(4);
  const locCode    = (destLocationCode || '').slice(0, 2).toUpperCase().padEnd(2, 'X');
  return outletCode + locCode + suffix;
}

function TransferModal({ show, onClose, employee, currentTenantId, groupCode, onTransferred }) {
  const [outlets,       setOutlets]       = useState([]);
  const [destId,        setDestId]        = useState('');
  const [newEmpId,      setNewEmpId]      = useState('');
  const [newLocation,   setNewLocation]   = useState('');
  const [notes,         setNotes]         = useState('');
  const [saving,        setSaving]        = useState(false);
  const [loadingOutlets, setLoadingOutlets] = useState(false);

  useEffect(() => {
    if (!show || !groupCode) return;
    setDestId(''); setNewEmpId(''); setNewLocation(''); setNotes('');
    setLoadingOutlets(true);
    fetchGroupDashboard(groupCode).then(({ data }) => {
      setOutlets((data?.outlets || []).filter(o => o.id !== currentTenantId));
      setLoadingOutlets(false);
    });
  }, [show, groupCode, currentTenantId]);

  const handleDestChange = (id) => {
    setDestId(id);
    const dest = outlets.find(o => o.id === id);
    if (dest) {
      setNewEmpId(buildNewEmployeeId(employee?.employee_id || '', dest.location_code));
      setNewLocation(dest.company_name || '');
    }
  };

  const handleSave = async () => {
    if (!destId) return showToast('Select destination branch', 'warning');
    setSaving(true);
    const { error } = await transferEmployee({
      profileId:      employee.id,
      fromTenantId:   currentTenantId,
      toTenantId:     destId,
      newEmployeeId:  newEmpId,
      outletLocation: newLocation,
      notes,
    });
    setSaving(false);
    if (error) return showToast('Transfer failed: ' + error.message, 'error');
    showToast(`${employee.first_name} transferred successfully`, 'success');
    onClose();
    onTransferred();
  };

  return (
    <Modal show={show} onClose={onClose} title="Transfer Employee" width="480px"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !destId}>
          {saving ? <><div className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} /> Transferring…</> : <><i className="fas fa-exchange-alt" /> Transfer</>}
        </button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>
            {getInitials(employee?.first_name, employee?.last_name)}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{employee?.first_name} {employee?.last_name}</div>
            {employee?.employee_id && (
              <code style={{ fontSize: 11, color: 'var(--primary)', background: 'var(--primary-light)', padding: '1px 6px', borderRadius: 4 }}>
                {employee.employee_id}
              </code>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Transfer To Branch *</label>
          {loadingOutlets ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, display: 'inline-block', marginRight: 6 }} />Loading branches…</div>
          ) : (
            <select className="form-select" value={destId} onChange={(e) => handleDestChange(e.target.value)}>
              <option value="">Select destination branch</option>
              {outlets.map(o => (
                <option key={o.id} value={o.id}>{o.company_name}{o.location_code ? ` (${o.location_code})` : ''}</option>
              ))}
            </select>
          )}
        </div>

        {destId && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">New Employee ID</label>
                <input className="form-input" value={newEmpId} onChange={e => setNewEmpId(e.target.value.toUpperCase())}
                  placeholder="Auto-computed from current ID + new location code"
                  style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}
                />
                <div className="form-hint">First 2 chars = outlet code, next 2 = location code, rest = original suffix.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Outlet Location Name</label>
                <input className="form-input" value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="e.g. Mumbai" />
              </div>
            </div>
          </>
        )}

        <div className="form-group">
          <label className="form-label">Transfer Notes</label>
          <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional reason for transfer" />
        </div>

        <div style={{ background: 'var(--warning-light)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 8 }}>
          <i className="fas fa-info-circle" style={{ marginTop: 1, flexShrink: 0 }} />
          Employee's historical attendance, payroll, and leaves remain in the current branch. All future records will be created under the new branch.
        </div>
      </div>
    </Modal>
  );
}

function TransferHistoryModal({ show, onClose, employee }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show || !employee?.id) return;
    setLoading(true);
    fetchTransferHistory(employee.id).then(({ data }) => {
      setHistory(data || []);
      setLoading(false);
    });
  }, [show, employee?.id]);

  return (
    <Modal show={show} onClose={onClose} title="Transfer History" width="560px"
      footer={<button className="btn btn-outline" onClick={onClose}>Close</button>}
    >
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading history…
        </div>
      ) : history.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <i className="fas fa-history" style={{ fontSize: 24, marginBottom: 10, display: 'block' }} />
          No transfer history for {employee?.first_name} {employee?.last_name}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {history.map((h, i) => (
            <div key={h.id || i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{h.from_branch}</span>
                  <i className="fas fa-arrow-right" style={{ color: 'var(--primary)', fontSize: 11 }} />
                  <span style={{ color: 'var(--primary)' }}>{h.to_branch}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(h.transferred_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                {h.from_employee_id && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Old ID: </span>
                    <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4 }}>{h.from_employee_id}</code>
                  </div>
                )}
                {h.to_employee_id && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>New ID: </span>
                    <code style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '1px 5px', borderRadius: 4 }}>{h.to_employee_id}</code>
                  </div>
                )}
              </div>
              {h.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>{h.notes}</div>}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>By {h.transferred_by}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

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
  compliance_enabled: false,
  pf_enabled: false, pf_number: '', pf_amount: '',
  esic_enabled: false, esic_number: '', esic_amount: '',
  employee_id: '', outlet_location: '', probation_months: 0,
};

function getComplianceStatus(emp) {
  if (!emp.compliance_enabled) return 'na';
  if (emp.pf_enabled && emp.pf_number) return 'compliant';
  return 'partial';
}

const COMPLIANCE_BADGE = {
  compliant: { label: 'PF Enrolled', cls: 'badge-success' },
  partial:   { label: 'Compliance',  cls: 'badge-warning' },
  na:        { label: 'N/A',         cls: 'badge-secondary' },
};

export default function EmployeesPage() {
  const { tenant, profile } = useAuth();
  const isManager = profile?.role === 'manager';

  // ---- filter state ----
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  // ---- pagination ----
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalCount / EMPLOYEE_PAGE_SIZE));

  // ---- data ----
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clockedInSet, setClockedInSet] = useState(new Set());

  // ---- modal ----
  const [showModal, setShowModal] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [tempCreds, setTempCreds] = useState(null);

  // ---- transfer ----
  const [transferEmp,   setTransferEmp]   = useState(null);
  const [historyEmp,    setHistoryEmp]    = useState(null);

  // ---- promotion history ----
  const [promotionEmp,  setPromotionEmp]  = useState(null);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, deptFilter, statusFilter, branchFilter]);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const [empRes, deptRes, branchRes, shiftRes, attRes] = await Promise.all([
        listEmployees(tenant.id, { page, search: debouncedSearch, department: deptFilter, status: statusFilter, branch: branchFilter }),
        listDepartments(tenant.id),
        listBranches(tenant.id),
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
      setBranches(branchRes.data || []);
      setShifts(shiftRes.data || []);

      // Build set of profile_ids who are currently clocked in (more ins than outs today)
      const working = new Set();
      (attRes.data || []).forEach((rec) => {
        const ins  = (rec.punches || []).filter((p) => p.punch_type === 'in').length;
        const outs = (rec.punches || []).filter((p) => p.punch_type === 'out').length;
        if (ins > outs) working.add(rec.profile_id);
      });
      setClockedInSet(working);
    } finally {
      setLoading(false);
    }
  }, [tenant, page, debouncedSearch, deptFilter, statusFilter, branchFilter]);

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
      compliance_enabled: emp.compliance_enabled || false,
      pf_enabled:  emp.pf_enabled  || false,
      pf_number:   emp.pf_number   || '',
      pf_amount:   emp.pf_amount   || '',
      esic_enabled: emp.esic_enabled || false,
      esic_number:  emp.esic_number  || '',
      esic_amount:  emp.esic_amount  || '',
      employee_id:      emp.employee_id      || '',
      outlet_location:  emp.outlet_location  || '',
      probation_months: emp.probation_months ?? 0,
    } : EMPTY_FORM);
    setShowModal(true);
  };

  const downloadSampleCSV = () => {
    const csvContent =
      'employee_id,first_name,last_name,email,phone,department,designation,join_date,ctc,bank_acc,outlet_location,country,pan,aadhar,passport_number,work_permit_number,work_permit_expiry,role,weekly_holiday,leave_allocation\n' +
      'MCMU1001,Jane,Doe,jane.doe@example.com,9999999999,HR,Recruiter,2026-05-01,45000,123456789012,Mumbai,India,ABCDE1234F,999988887777,,,employee,Sunday,12\n' +
      'MCDL2001,John,Smith,john.smith@example.com,+442012345678,Engineering,Developer,2026-05-01,80000,GB12345678,Delhi,United Kingdom,,,,P12345678,WP-UK-9999,2027-12-31,employee,Saturday,15\n';
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
      pan: form.pan.trim(),
      aadhar: form.aadhar.trim(),
      country: (form.country || 'India').trim(),
      passport_number: (form.passport_number || '').trim(),
      work_permit_number: (form.work_permit_number || '').trim(),
      work_permit_expiry: form.work_permit_expiry || null,
      role: form.role || 'employee',
      weekly_holiday: form.weekly_holiday,
      shift_id: form.shift_id || null,
      leave_allocation: parseInt(form.leave_allocation, 10) || 0,
      compliance_enabled: form.compliance_enabled || false,
      pf_enabled:  form.compliance_enabled ? (form.pf_enabled || false) : false,
      pf_number:   form.compliance_enabled && form.pf_enabled ? form.pf_number.trim() : '',
      pf_amount:   form.compliance_enabled && form.pf_enabled ? (parseFloat(form.pf_amount) || 0) : 0,
      esic_enabled: form.compliance_enabled && form.pf_enabled ? (form.esic_enabled || false) : false,
      esic_number:  form.compliance_enabled && form.pf_enabled && form.esic_enabled ? form.esic_number.trim() : '',
      esic_amount:  form.compliance_enabled && form.pf_enabled && form.esic_enabled ? (parseFloat(form.esic_amount) || 0) : 0,
      employee_id:      (form.employee_id || '').trim().toUpperCase() || null,
      outlet_location:  (form.outlet_location || '').trim(),
      probation_months: parseInt(form.probation_months, 10) || 0,
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
          employee_id:     (d.employee_id || d.emp_id || d.staff_id || '').trim().toUpperCase() || null,
          outlet_location: (d.outlet_location || d.location || d.branch_location || '').trim(),
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
          {branches.length > 0 && (
            <select className="form-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All Branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <input
            className="form-input"
            placeholder="🔍 Search name, email, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
          />
          {!isManager && (
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
          )}
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
                    <th>Employee</th><th>Department</th><th>Designation</th>
                    {!isManager && <th>Leaves</th>}
                    {!isManager && <th>Monthly CTC</th>}
                    {!isManager && <th>Compliance</th>}
                    <th>Status</th><th>Today</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={isManager ? 6 : 9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
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
                            {e.employee_id && (
                              <code style={{ fontSize: 10, color: 'var(--primary)', background: 'var(--primary-light)', padding: '0 5px', borderRadius: 3, marginTop: 2, display: 'inline-block' }}>
                                {e.employee_id}
                              </code>
                            )}
                            {e.outlet_location && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{e.outlet_location}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{e.department || '—'}</td>
                      <td>{e.designation || '—'}</td>
                      {!isManager && <td>{typeof e.leave_allocation === 'number' ? e.leave_allocation : (e.leave_allocation || 0)}</td>}
                      {!isManager && <td>{fmt(e.ctc)}</td>}
                      {!isManager && (
                        <td>
                          {(() => {
                            const cs = getComplianceStatus(e);
                            const { label, cls } = COMPLIANCE_BADGE[cs];
                            const tip = !e.compliance_enabled
                              ? 'Compliance not enabled'
                              : `PF: ${e.pf_enabled ? (e.pf_number || 'no number') : 'N/A'} | ESIC: ${e.esic_enabled ? (e.esic_number || 'no number') : 'N/A'}`;
                            return <span className={`badge ${cls}`} title={tip}>{label}</span>;
                          })()}
                        </td>
                      )}
                      <td><span className={`badge ${e.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>{e.status}</span></td>
                      <td>
                        {clockedInSet.has(e.id)
                          ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />Working</span>
                          : <span className="badge badge-secondary" style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {!isManager && <button className="btn btn-outline btn-icon btn-sm" onClick={() => openModal(e)} title="Edit"><i className="fas fa-edit" /></button>}
                          {!isManager && <button className="btn btn-outline btn-icon btn-sm" onClick={() => setPromotionEmp(e)} title="Promotion / Increment History" style={{ color: 'var(--primary)' }}><i className="fas fa-level-up-alt" /></button>}
                          <button className="btn btn-outline btn-icon btn-sm" onClick={() => showCredentials(e)} title="Show Credentials"><i className="fas fa-key" /></button>
                          {!isManager && tenant?.group_code && (
                            <button className="btn btn-outline btn-icon btn-sm" onClick={() => setTransferEmp(e)} title="Transfer to another branch" style={{ color: 'var(--primary)' }}>
                              <i className="fas fa-exchange-alt" />
                            </button>
                          )}
                          {tenant?.group_code && (
                            <button className="btn btn-outline btn-icon btn-sm" onClick={() => setHistoryEmp(e)} title="Transfer history" style={{ color: 'var(--text-muted)' }}>
                              <i className="fas fa-history" />
                            </button>
                          )}
                          {!isManager && <button className="btn btn-outline btn-icon btn-sm" onClick={() => toggleStatus(e)} title="Toggle Status"><i className="fas fa-power-off" /></button>}
                          {!isManager && <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteEmp(e)} title="Delete"><i className="fas fa-trash" /></button>}
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
            <div className="form-group">
              <label className="form-label">Employee ID</label>
              <input
                className="form-input"
                value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value.toUpperCase() })}
                placeholder="e.g. MCMU1042"
                style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}
              />
              <div className="form-hint">Outlet(2) + Location(2) + Number · e.g. MCMU1042</div>
            </div>
            <div className="form-group">
              <label className="form-label">Branch Name</label>
              <input
                className="form-input"
                value={form.outlet_location}
                onChange={(e) => setForm({ ...form, outlet_location: e.target.value })}
                placeholder="e.g. Mumbai Bandra, Delhi CP"
              />
            </div>
          </div>
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
          <div className="form-group" style={{ marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={form.compliance_enabled}
                onChange={(e) => setForm({ ...form, compliance_enabled: e.target.checked, pf_enabled: false, esic_enabled: false })}
              />
              <span className="form-label" style={{ margin: 0 }}>Compliance</span>
            </label>
          </div>

          {form.compliance_enabled && (
            <div className="form-group" style={{ marginLeft: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={form.pf_enabled}
                  onChange={(e) => setForm({ ...form, pf_enabled: e.target.checked, esic_enabled: e.target.checked ? form.esic_enabled : false })}
                />
                <span className="form-label" style={{ margin: 0 }}>PF Account</span>
              </label>

              {form.pf_enabled && (
                <>
                  <div className="form-row" style={{ marginTop: 10 }}>
                    <div className="form-group">
                      <label className="form-label">PF Amount (₹)</label>
                      <input
                        className="form-input"
                        type="number" min="0"
                        value={form.pf_amount}
                        onChange={(e) => setForm({ ...form, pf_amount: e.target.value })}
                        placeholder="e.g. 1800"
                      />
                      <div className="form-hint">Auto at payroll: 12% if CTC ≤ ₹15,000, else ₹1,800</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">PF Number</label>
                      <input
                        className="form-input"
                        value={form.pf_number}
                        onChange={(e) => setForm({ ...form, pf_number: e.target.value })}
                        placeholder="e.g. MH/BAN/1234567/000/0000001"
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginLeft: 20 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={form.esic_enabled}
                        onChange={(e) => setForm({ ...form, esic_enabled: e.target.checked })}
                      />
                      <span className="form-label" style={{ margin: 0 }}>ESIC</span>
                    </label>

                    {form.esic_enabled && (
                      <div className="form-row" style={{ marginTop: 10 }}>
                        <div className="form-group">
                          <label className="form-label">ESIC Amount (₹)</label>
                          <input
                            className="form-input"
                            type="number" min="0"
                            value={form.esic_amount}
                            onChange={(e) => setForm({ ...form, esic_amount: e.target.value })}
                            placeholder="e.g. 325"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">ESIC Number</label>
                          <input
                            className="form-input"
                            value={form.esic_number}
                            onChange={(e) => setForm({ ...form, esic_number: e.target.value })}
                            placeholder="ESIC registration number"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

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
              <label className="form-label">Probation Period (months)</label>
              <input className="form-input" type="number" min="0" max="24" value={form.probation_months}
                onChange={(e) => setForm({ ...form, probation_months: e.target.value })} />
              <div className="form-hint">Set 0 if no probation. Employee earns 1 leave per full-attendance month during probation.</div>
            </div>
            <div className="form-group">
              <label className="form-label">User Role</label>
              <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="employee">Employee</option>
                <option value="admin">HR</option>
                <option value="manager">Manager</option>
              </select>
              <div className="form-hint">HR has full access. Manager can approve leaves and manage attendance.</div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Annual Leave Allocation</label>
              <input className="form-input" type="number" min="0" value={form.leave_allocation}
                onChange={(e) => setForm({ ...form, leave_allocation: e.target.value })} />
              <div className="form-hint">Annual leaves (post-probation). Set 0 if using earned-leave only.</div>
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

      <TransferModal
        show={!!transferEmp}
        onClose={() => setTransferEmp(null)}
        employee={transferEmp}
        currentTenantId={tenant?.id}
        groupCode={tenant?.group_code}
        onTransferred={fetchData}
      />

      <TransferHistoryModal
        show={!!historyEmp}
        onClose={() => setHistoryEmp(null)}
        employee={historyEmp}
      />

      <PromotionModal
        show={!!promotionEmp}
        onClose={() => setPromotionEmp(null)}
        employee={promotionEmp}
        tenantId={tenant?.id}
        currentUserId={profile?.id}
        onSaved={fetchData}
      />
    </>
  );
}

// ── Promotion / Increment History Modal ─────────────────────────────────────

function PromotionModal({ show, onClose, employee, tenantId, currentUserId, onSaved }) {
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [saving,   setSaving]     = useState(false);
  const [form, setForm] = useState({
    effectiveDate:  '',
    newDesignation: '',
    newCtc:         '',
    notes:          '',
  });

  useEffect(() => {
    if (!show || !employee) return;
    setShowForm(false);
    setLoading(true);
    listEmployeePromotions(employee.id)
      .then(({ data }) => setHistory(data || []))
      .finally(() => setLoading(false));
  }, [show, employee]);

  const handleSave = async () => {
    if (!form.effectiveDate) return showToast('Effective date is required', 'error');
    if (!form.newDesignation && !form.newCtc) return showToast('Enter new designation and/or new CTC', 'error');
    setSaving(true);
    try {
      const { error } = await recordPromotion(tenantId, employee.id, {
        effectiveDate:  form.effectiveDate,
        oldDesignation: employee.designation,
        newDesignation: form.newDesignation || employee.designation,
        oldCtc:         employee.ctc,
        newCtc:         parseFloat(form.newCtc) || employee.ctc,
        notes:          form.notes,
        createdBy:      currentUserId,
      });
      if (error) throw error;
      showToast('Promotion recorded and profile updated', 'success');
      setShowForm(false);
      setForm({ effectiveDate: '', newDesignation: '', newCtc: '', notes: '' });
      const { data } = await listEmployeePromotions(employee.id);
      setHistory(data || []);
      onSaved();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onClose={onClose} title={`Promotions — ${employee?.first_name} ${employee?.last_name}`} width="580px"
      footer={
        showForm
          ? <>
              <button className="btn btn-outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving…</> : <><i className="fas fa-check" /> Record Promotion</>}
              </button>
            </>
          : <>
              <button className="btn btn-outline" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                <i className="fas fa-plus" /> New Promotion / Increment
              </button>
            </>
      }
    >
      {showForm ? (
        <div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Effective Date *</label>
              <input type="date" className="form-input" value={form.effectiveDate}
                onChange={e => setForm({ ...form, effectiveDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">New Designation</label>
              <input className="form-input" placeholder={employee?.designation || ''}
                value={form.newDesignation}
                onChange={e => setForm({ ...form, newDesignation: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Current CTC</label>
              <input className="form-input" disabled value={`₹${Number(employee?.ctc || 0).toLocaleString('en-IN')}`} />
            </div>
            <div className="form-group">
              <label className="form-label">New Monthly CTC (₹)</label>
              <input type="number" className="form-input" placeholder="Enter new CTC"
                value={form.newCtc} onChange={e => setForm({ ...form, newCtc: e.target.value })} />
              {form.newCtc && employee?.ctc && (
                <div className="form-hint" style={{ color: 'var(--success)' }}>
                  Increment: ₹{Number(parseFloat(form.newCtc) - employee.ctc).toLocaleString('en-IN')}
                  {' '}({((parseFloat(form.newCtc) - employee.ctc) / employee.ctc * 100).toFixed(1)}%)
                </div>
              )}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={2} style={{ resize: 'none', fontSize: 13 }}
              placeholder="e.g. Annual appraisal, promoted to Senior Engineer…"
              value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : history.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
          <i className="fas fa-level-up-alt" style={{ fontSize: 28, marginBottom: 8, display: 'block' }} />
          No promotion history yet. Click "New Promotion / Increment" to record one.
        </div>
      ) : (
        <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          {history.map((p, i) => (
            <div key={p.id} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px',
              marginBottom: 10, background: i === 0 ? 'var(--primary-light, #eff6ff)' : 'var(--bg-card)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong style={{ fontSize: 14 }}>
                  {new Date(p.effective_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {i === 0 && <span className="badge badge-success" style={{ marginLeft: 8, fontSize: 10 }}>Latest</span>}
                </strong>
                {p.increment_amount > 0 && (
                  <span style={{ color: 'var(--success)', fontWeight: 700 }}>
                    +₹{Number(p.increment_amount).toLocaleString('en-IN')}
                  </span>
                )}
              </div>
              {p.old_designation !== p.new_designation && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{p.old_designation}</span>
                  {' → '}
                  <strong>{p.new_designation}</strong>
                </div>
              )}
              {p.old_ctc && p.new_ctc && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  CTC: ₹{Number(p.old_ctc).toLocaleString('en-IN')} → <strong>₹{Number(p.new_ctc).toLocaleString('en-IN')}</strong>
                </div>
              )}
              {p.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{p.notes}</div>}
              {p.created_by_profile && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Recorded by: {p.created_by_profile.first_name} {p.created_by_profile.last_name}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
