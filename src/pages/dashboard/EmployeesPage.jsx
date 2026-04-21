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
import { listDepartments } from '@/services/tenantService';
import { fmt, getInitials, getAvatarColor } from '@/lib/helpers';

function TempPasswordModal({ show, onClose, empName, email, password }) {
  return (
    <Modal show={show} onClose={onClose} title="Employee Created!" width="440px"
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 44, color: 'var(--success)', marginBottom: 12 }}>
          <i className="fas fa-user-check" />
        </div>
        <h3 style={{ marginBottom: 6 }}>{empName}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Share these login credentials with the employee
        </p>
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: 16 }}>
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
        <i className="fas fa-exclamation-triangle" style={{ color: 'var(--warning)' }} />{' '}
        Note this down — the password won&apos;t be shown again.
      </p>
    </Modal>
  );
}

const EMPTY_FORM = {
  first_name: '', last_name: '', email: '', phone: '',
  department: '', designation: '', join_date: '', ctc: '',
  bank_acc: '', pan: '', aadhar: '', role: 'employee',
};

export default function EmployeesPage() {
  const { tenant } = useAuth();

  // ---- filter state ----
  const [search, setSearch]         = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  // ---- pagination ----
  const [page, setPage]       = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalCount / EMPLOYEE_PAGE_SIZE));

  // ---- data ----
  const [employees, setEmployees]     = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading]         = useState(true);

  // ---- modal ----
  const [showModal, setShowModal] = useState(false);
  const [editEmp, setEditEmp]     = useState(null);
  const [saving, setSaving]       = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [tempCreds, setTempCreds] = useState(null);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, deptFilter, statusFilter]);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [empRes, deptRes] = await Promise.all([
      listEmployees(tenant.id, { page, search: debouncedSearch, department: deptFilter, status: statusFilter }),
      listDepartments(tenant.id),
    ]);
    setEmployees(empRes.data);
    setTotalCount(empRes.count);
    setDepartments((deptRes.data || []).map((d) => d.name));
    setLoading(false);
  }, [tenant, page, debouncedSearch, deptFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (emp = null) => {
    setEditEmp(emp);
    setForm(emp ? {
      first_name:  emp.first_name  || '',
      last_name:   emp.last_name   || '',
      email:       emp.email       || '',
      phone:       emp.phone       || '',
      department:  emp.department  || '',
      designation: emp.designation || '',
      join_date:   emp.join_date   || '',
      ctc:         emp.ctc         || '',
      bank_acc:    emp.bank_acc    || '',
      pan:         emp.pan         || '',
      aadhar:      emp.aadhar      || '',
      role:        emp.role        || 'employee',
    } : EMPTY_FORM);
    setShowModal(true);
  };

  const saveEmployee = async () => {
    if (!form.first_name || !form.last_name) return showToast('First and last name required', 'error');
    if (!form.ctc || parseFloat(form.ctc) <= 0) return showToast('Valid CTC is required', 'error');
    if (!editEmp && !form.email) return showToast('Email is required for new employees', 'error');

    const profileData = {
      first_name:  form.first_name.trim(),
      last_name:   form.last_name.trim(),
      email:       form.email.trim(),
      phone:       form.phone.trim(),
      department:  form.department,
      designation: form.designation.trim(),
      join_date:   form.join_date || null,
      ctc:         parseFloat(form.ctc) || 0,
      bank_acc:    form.bank_acc.trim(),
      pan:         form.pan.trim(),
      aadhar:      form.aadhar.trim(),
      role:        form.role || 'employee',
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
          <div style={{ marginLeft: 'auto' }}>
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
                        <button className="btn btn-outline btn-icon btn-sm" onClick={() => openModal(e)} title="Edit"><i className="fas fa-edit" /></button>{' '}
                        <button className="btn btn-outline btn-icon btn-sm" onClick={() => toggleStatus(e)} title="Toggle Status"><i className="fas fa-power-off" /></button>{' '}
                        <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteEmp(e)} title="Delete"><i className="fas fa-trash" /></button>
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
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEmployee} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving…</> : <><i className="fas fa-check" /> Save</>}
          </button>
        </>}
      >
        <div className="form-row">
          <div className="form-group"><label className="form-label">First Name *</label><input className="form-input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Last Name *</label><input className="form-input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Email {!editEmp && '*'}</label>
            <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!editEmp} />
            {!editEmp && <div className="form-hint">Employee will use this to login</div>}
          </div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Department</label>
            <select className="form-select" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              <option value="">Select</option>
              {departments.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="form-label">Designation</label><input className="form-input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Joining Date</label><input className="form-input" type="date" value={form.join_date} onChange={(e) => setForm({ ...form, join_date: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Monthly CTC (₹) *</label><input className="form-input" type="number" min="0" value={form.ctc} onChange={(e) => setForm({ ...form, ctc: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">Bank Account Number</label><input className="form-input" value={form.bank_acc} onChange={(e) => setForm({ ...form, bank_acc: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">PAN</label><input className="form-input" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Aadhar</label><input className="form-input" value={form.aadhar} onChange={(e) => setForm({ ...form, aadhar: e.target.value })} /></div>
        </div>
        <div className="form-group">
          <label className="form-label">Role</label>
          <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
          </select>
          <div className="form-hint">Managers can add employees and process payroll</div>
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
