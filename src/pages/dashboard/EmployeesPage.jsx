import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmt, getInitials, getAvatarColor } from '@/lib/helpers';

// Temp password shown to manager after creating employee
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

export default function EmployeesPage() {
  const { tenant } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tempCreds, setTempCreds] = useState(null); // { empName, email, password }
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    department: '', designation: '', join_date: '', ctc: '',
    bank_acc: '', pan: '', aadhar: '',
  });

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);

    const [empsRes, deptsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('tenant_id', tenant.id).neq('role', 'superadmin').order('first_name'),
      supabase.from('departments').select('name').eq('tenant_id', tenant.id).order('name'),
    ]);

    setEmployees(empsRes.data || []);
    setDepartments((deptsRes.data || []).map((d) => d.name));
    setLoading(false);
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter
  let filtered = employees;
  if (deptFilter) filtered = filtered.filter((e) => e.department === deptFilter);
  if (statusFilter) filtered = filtered.filter((e) => e.status === statusFilter);
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((e) =>
      `${e.first_name} ${e.last_name} ${e.email} ${e.department}`.toLowerCase().includes(s)
    );
  }

  const openModal = (emp = null) => {
    setEditEmp(emp);
    setForm({
      first_name: emp?.first_name || '',
      last_name: emp?.last_name || '',
      email: emp?.email || '',
      phone: emp?.phone || '',
      department: emp?.department || '',
      designation: emp?.designation || '',
      join_date: emp?.join_date || '',
      ctc: emp?.ctc || '',
      bank_acc: emp?.bank_acc || '',
      pan: emp?.pan || '',
      aadhar: emp?.aadhar || '',
    });
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
    };

    setSaving(true);
    try {
      if (editEmp) {
        // UPDATE existing profile directly (manager updating their tenant's employee)
        const { error } = await supabase.from('profiles').update(profileData).eq('id', editEmp.id);
        if (error) throw new Error('Update failed: ' + error.message);
        showToast('Employee updated successfully', 'success');
        setShowModal(false);
        fetchData();
      } else {
        // CREATE: 1. Create auth user via signUp
        const tempPassword = 'Pay@' + Math.random().toString(36).slice(2, 8).toUpperCase();
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: form.email,
          password: tempPassword,
        });

        if (authError) throw new Error('Account creation failed: ' + authError.message);
        if (!authData?.user) throw new Error('Failed to create login account.');

        // 2. Call SECURITY DEFINER RPC to insert profile into manager's tenant
        const { error: rpcError } = await supabase.rpc('insert_employee_profile', {
          p_user_id:     authData.user.id,
          p_first_name:  profileData.first_name,
          p_last_name:   profileData.last_name,
          p_email:       profileData.email,
          p_phone:       profileData.phone,
          p_department:  profileData.department,
          p_designation: profileData.designation,
          p_ctc:         profileData.ctc,
          p_join_date:   profileData.join_date,
          p_bank_acc:    profileData.bank_acc,
          p_pan:         profileData.pan,
          p_aadhar:      profileData.aadhar,
        });

        if (rpcError) throw new Error('Profile creation failed: ' + rpcError.message);

        setShowModal(false);
        setTempCreds({
          empName:  `${profileData.first_name} ${profileData.last_name}`,
          email:    profileData.email,
          password: tempPassword,
        });
        fetchData();
      }
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (emp) => {
    const newStatus = emp.status === 'Active' ? 'Inactive' : 'Active';
    await supabase.from('profiles').update({ status: newStatus }).eq('id', emp.id);
    showToast(`Employee ${newStatus === 'Active' ? 'activated' : 'deactivated'}`, 'info');
    fetchData();
  };

  const deleteEmployee = async (emp) => {
    if (!confirm(`Delete ${emp.first_name} ${emp.last_name}? This cannot be undone.`)) return;
    await supabase.from('profiles').delete().eq('id', emp.id);
    showToast('Employee deleted', 'success');
    fetchData();
  };

  const activeCount = employees.filter((e) => e.status === 'Active').length;

  return (
    <>
      <Header title="Employees" breadcrumb={`${activeCount} active employees`} />
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
          <input className="form-input" placeholder="🔍 Search..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => openModal()}>
              <i className="fas fa-plus" /> Add Employee
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading employees...</div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th><th>Department</th><th>Designation</th><th>Monthly CTC</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No employees found. Click &quot;Add Employee&quot; to get started.</td></tr>
                  ) : filtered.map((e) => (
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
                        <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteEmployee(e)} title="Delete"><i className="fas fa-trash" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Employee Modal */}
      <Modal show={showModal} onClose={() => setShowModal(false)} title={editEmp ? 'Edit Employee' : 'Add Employee'}
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEmployee} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving...</> : <><i className="fas fa-check" /> Save</>}
          </button>
        </>}
      >
        <div className="form-row">
          <div className="form-group"><label className="form-label">First Name *</label><input className="form-input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Last Name *</label><input className="form-input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Email {!editEmp && '*'}</label><input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!editEmp} />{!editEmp && <div className="form-hint">Employee will use this to login</div>}</div>
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
      </Modal>

      {/* Temp credentials Modal */}
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
