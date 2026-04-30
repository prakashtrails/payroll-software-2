import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import {
  listEmployees, createEmployee, updateEmployee,
  setEmployeeStatus, removeEmployee, EMPLOYEE_PAGE_SIZE,
} from '@/services/employeeService';
import { listDepartments, listShifts } from '@/services/tenantService';
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
  weekly_holiday: 'Sunday', shift_id: '',
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
    const [empRes, deptRes, shiftRes] = await Promise.all([
      listEmployees(tenant.id, { page, search: debouncedSearch, department: deptFilter, status: statusFilter }),
      listDepartments(tenant.id),
      listShifts(tenant.id),
    ]);
    setEmployees(empRes.data);
    setTotalCount(empRes.count);
    setDepartments((deptRes.data || []).map((d) => d.name));
    setShifts(shiftRes.data || []);
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
    } : EMPTY_FORM);
    setShowModal(true);
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
      role: form.role || 'employee',
      weekly_holiday: form.weekly_holiday,
      shift_id: form.shift_id || null,
    };

    setSaving(true);
    try {
      if (editEmp) {
        const { error } = await updateEmployee(editEmp.id, profileData);
        if (error) throw new Error('Update failed: ' + error.message);
        showToast('Employee updated', 'success');
        setShowModal(false);
      } else {
        const { tempPassword } = await createEmployee(profileData);
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
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const rows = lines.slice(1);

      let successCount = 0;
      let failCount = 0;

      showToast(`Importing ${rows.length} employees...`, 'info');

      for (const row of rows) {
        const values = row.split(',').map(v => v.trim());
        const data = {};
        headers.forEach((h, i) => { data[h] = values[i]; });

        const profileData = {
          first_name: data.first_name || data.name?.split(' ')[0] || 'Imported',
          last_name: data.last_name || data.name?.split(' ').slice(1).join(' ') || 'User',
          email: data.email,
          phone: data.phone || '',
          department: data.department || '',
          designation: data.designation || '',
          join_date: data.join_date || todayStr(),
          ctc: parseFloat(data.ctc) || 0,
          bank_acc: data.bank_acc || '',
          pan: data.pan || '',
          aadhar: data.aadhar || '',
          role: data.role || 'employee',
          weekly_holiday: data.weekly_holiday || 'Sunday',
        };

        if (!profileData.email) { failCount++; continue; }

        try {
          await createEmployee(profileData);
          successCount++;
        } catch (err) {
          console.error('Import fail:', err);
          failCount++;
        }
      }
      showToast(`Import complete: ${successCount} success, ${failCount} failed`, successCount > 0 ? 'success' : 'error');
      fetchData();
      e.target.value = '';
    };
    reader.readAsText(file);
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => document.getElementById('import-csv').click()}>
              <i className="fas fa-file-import" /> Import
            </button>
            <input id="import-csv" type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
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
                    <th>Employee</th><th>Department</th><th>Designation</th>
                    <th>Monthly CTC</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
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
                      <td>{fmt(e.ctc)}</td>
                      <td><span className={`badge ${e.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>{e.status}</span></td>
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
          <div className="form-row">
            <div className="form-group"><label className="form-label">PAN Card</label><input className="form-input" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Aadhar Number</label><input className="form-input" value={form.aadhar} onChange={(e) => setForm({ ...form, aadhar: e.target.value })} /></div>
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
          <div className="form-group">
            <label className="form-label">User Role</label>
            <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            <div className="form-hint">Managers can approve leaves. Admins have full access.</div>
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
