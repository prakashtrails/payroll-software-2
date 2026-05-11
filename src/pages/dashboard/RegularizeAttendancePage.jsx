import React, { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { regularizeAttendance } from '@/services/attendanceService';
import { listActiveEmployees } from '@/services/employeeService';
import { getInitials, getAvatarColor, todayStr } from '@/lib/helpers';

export default function RegularizeAttendancePage() {
  const { profile, tenant } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    fromDate: todayStr(),
    toDate: todayStr(),
    status: 'Present',
    clockInTime: '',
    clockOutTime: '',
    reason: ''
  });

  const [searchEmployee, setSearchEmployee] = useState('');
  const [expandedDept, setExpandedDept] = useState('');

  const fetchEmployees = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data } = await listActiveEmployees(tenant.id);
      setEmployees(data || []);
    } catch (err) {
      showToast('Failed to load employees', 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const filteredEmployees = employees.filter(emp => {
    const search = searchEmployee.toLowerCase();
    return (
      emp.first_name.toLowerCase().includes(search) ||
      emp.last_name.toLowerCase().includes(search) ||
      emp.email.toLowerCase().includes(search)
    );
  });

  const employeesByDept = {};
  filteredEmployees.forEach(emp => {
    const dept = emp.department || 'Unassigned';
    if (!employeesByDept[dept]) employeesByDept[dept] = [];
    employeesByDept[dept].push(emp);
  });

  const handleSelectEmployee = (empId) => {
    setSelectedEmployees(prev =>
      prev.includes(empId)
        ? prev.filter(id => id !== empId)
        : [...prev, empId]
    );
  };

  const handleSelectDepartment = (dept) => {
    const deptEmps = employeesByDept[dept].map(e => e.id);
    const allSelected = deptEmps.every(id => selectedEmployees.includes(id));

    if (allSelected) {
      setSelectedEmployees(prev => prev.filter(id => !deptEmps.includes(id)));
    } else {
      setSelectedEmployees(prev => [...new Set([...prev, ...deptEmps])]);
    }
  };

  const handleSelectAll = () => {
    if (selectedEmployees.length === filteredEmployees.length) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(filteredEmployees.map(e => e.id));
    }
  };

  const handleRegularize = async () => {
    if (!form.fromDate || !form.toDate) {
      return showToast('Please select date range', 'error');
    }
    if (selectedEmployees.length === 0) {
      return showToast('Please select at least one employee', 'error');
    }
    if (!form.status) {
      return showToast('Please select attendance status', 'error');
    }
    if (!form.reason || form.reason.trim() === '') {
      return showToast('Reason is required', 'error');
    }

    const from = new Date(form.fromDate);
    const to = new Date(form.toDate);
    if (from > to) {
      return showToast('From date must be less than or equal to To date', 'error');
    }

    setSubmitting(true);
    try {
      const result = await regularizeAttendance(tenant.id, {
        fromDate: form.fromDate,
        toDate: form.toDate,
        employeeIds: selectedEmployees,
        status: form.status,
        clockInTime: form.clockInTime || null,
        clockOutTime: form.clockOutTime || null,
        reason: form.reason,
        changedBy: profile.id
      });

      showToast(
        `Attendance regularized for ${result.recordsUpdated} records`,
        'success'
      );
      setShowModal(false);
      setSelectedEmployees([]);
      setForm({
        fromDate: todayStr(),
        toDate: todayStr(),
        status: 'Present',
        clockInTime: '',
        clockOutTime: '',
        reason: ''
      });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Header title="Regularize Attendance" breadcrumb="Bulk update attendance records" />
      <div className="page-content">
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Select Employees</h3>
            <button
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
              disabled={selectedEmployees.length === 0 || loading}
            >
              <i className="fas fa-check" /> Regularize ({selectedEmployees.length})
            </button>
          </div>

          <div className="card-body">
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ margin: '0 auto 16px' }} />
                Loading employees...
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="🔍 Search employees..."
                    value={searchEmployee}
                    onChange={(e) => setSearchEmployee(e.target.value)}
                    style={{ maxWidth: '300px' }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedEmployees.length === filteredEmployees.length && filteredEmployees.length > 0}
                      onChange={handleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                    <strong>Select All {filteredEmployees.length} Employees</strong>
                  </label>
                </div>

                <div className="employee-list" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                  {Object.keys(employeesByDept).map(dept => {
                    const deptEmps = employeesByDept[dept];
                    const deptSelected = deptEmps.every(e => selectedEmployees.includes(e.id));
                    const deptPartialSelected = deptEmps.some(e => selectedEmployees.includes(e.id)) && !deptSelected;

                    return (
                      <div key={dept} style={{ marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            marginBottom: '8px',
                            fontWeight: '600'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={deptSelected}
                            indeterminate={deptPartialSelected}
                            onChange={() => handleSelectDepartment(dept)}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>{dept}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>({deptEmps.length})</span>
                        </label>

                        <div
                          style={{
                            display: expandedDept === dept ? 'grid' : 'none',
                            gap: '8px',
                            marginLeft: '20px'
                          }}
                        >
                          {deptEmps.map(emp => (
                            <label
                              key={emp.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                padding: '8px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: selectedEmployees.includes(emp.id) ? 'var(--primary-light)' : 'transparent'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedEmployees.includes(emp.id)}
                                onChange={() => handleSelectEmployee(emp.id)}
                                style={{ cursor: 'pointer' }}
                              />
                              <div
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '50%',
                                  background: `linear-gradient(135deg, ${getAvatarColor(emp.id)})`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'white',
                                  fontSize: '12px',
                                  fontWeight: 'bold'
                                }}
                              >
                                {getInitials(emp.first_name, emp.last_name)}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '14px', fontWeight: '500' }}>
                                  {emp.first_name} {emp.last_name}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                  {emp.email}
                                </div>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                {emp.designation}
                              </div>
                            </label>
                          ))}
                        </div>

                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => setExpandedDept(expandedDept === dept ? '' : dept)}
                          style={{ marginTop: '4px' }}
                        >
                          {expandedDept === dept ? '▼ Collapse' : '▶ Expand'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Modal
        show={showModal}
        onClose={() => setShowModal(false)}
        title="Regularize Attendance"
        width="600px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setShowModal(false)} disabled={submitting}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleRegularize} disabled={submitting}>
              {submitting ? (
                <>
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Regularizing...
                </>
              ) : (
                <>
                  <i className="fas fa-check" /> Regularize
                </>
              )}
            </button>
          </>
        }
      >
        <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '8px' }}>
          <div className="form-group">
            <label className="form-label">From Date *</label>
            <input
              type="date"
              className="form-input"
              value={form.fromDate}
              onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">To Date *</label>
            <input
              type="date"
              className="form-input"
              value={form.toDate}
              onChange={(e) => setForm({ ...form, toDate: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Attendance Status *</label>
            <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Half Day">Half Day</option>
              <option value="Absent">Absent</option>
              <option value="Leave">Leave</option>
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Clock In Time (Optional)</label>
              <input
                type="time"
                className="form-input"
                value={form.clockInTime}
                onChange={(e) => setForm({ ...form, clockInTime: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Clock Out Time (Optional)</label>
              <input
                type="time"
                className="form-input"
                value={form.clockOutTime}
                onChange={(e) => setForm({ ...form, clockOutTime: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Reason *</label>
            <textarea
              className="form-input"
              placeholder="Enter reason for regularization (e.g., Work from home, Site visit, Client meeting, etc.)"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={4}
              style={{ resize: 'none', fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          <div
            style={{
              padding: '12px',
              backgroundColor: 'var(--info-light)',
              color: 'var(--info)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              marginTop: '16px'
            }}
          >
            <i className="fas fa-info-circle" /> This will update attendance for {selectedEmployees.length} employee(s)
            in the selected date range and create audit log entries.
          </div>
        </div>
      </Modal>
    </>
  );
}
