import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  updateTenant,
  listDepartments,
  addDepartment,
  removeDepartment,
  listShifts,
  addShift,
  removeShift,
  listHolidays,
  addHoliday,
  updateHolidayStatus,
  importHolidays,
  initializeMajorHolidays,
} from '@/services/tenantService';
import { monthLabel } from '@/lib/helpers';

export default function SettingsPage() {
  const { tenant, profile, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    company_name: '', pay_day: 1, work_days: 26, currency: '₹',
    shift_start: '09:00', shift_end: '18:00', late_threshold: 15,
    min_half_day_hours: 4, min_full_day_hours: 8,
    geofence_lat: '', geofence_lng: '', geofence_radius: 200,
  });
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts]           = useState([]);
  const [saving, setSaving]           = useState(false);
  const [showDepartmentModal, setShowDepartmentModal] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [newShiftName, setNewShiftName] = useState('');
  const [newShiftStart, setNewShiftStart] = useState('09:00');
  const [newShiftEnd, setNewShiftEnd] = useState('18:00');
  const [addLoading, setAddLoading] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [holidayMonth, setHolidayMonth] = useState(new Date().getMonth());
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState(new Date().toISOString().slice(0, 10));
  const [newHolidayDesc, setNewHolidayDesc] = useState('');
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    const [deptRes, shiftRes] = await Promise.all([
      listDepartments(tenant.id),
      listShifts(tenant.id)
    ]);
    setDepartments(deptRes.data || []);
    setShifts(shiftRes.data || []);
  }, [tenant]);

  const getHolidayDate = (h) => h.holiday_date || h.date;

  const fetchHolidays = useCallback(async () => {
    if (!tenant) return;
    const { data, error } = await listHolidays(tenant.id);
    if (error) return showToast('Could not load holidays: ' + error.message, 'error');

    const currentYear = String(new Date().getFullYear());
    const hasCurrentYear = (data || []).some((h) => (getHolidayDate(h) || '').startsWith(currentYear));

    if (!hasCurrentYear) {
      const { error: initError } = await initializeMajorHolidays(tenant.id);
      if (initError) return showToast('Could not initialize holidays: ' + initError.message, 'error');
      const { data: newData } = await listHolidays(tenant.id);
      setHolidays(newData || []);
    } else {
      setHolidays(data);
    }
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    fetchHolidays();
  }, [tenant, fetchHolidays]);

  const majorIndianHolidays = [
    { name: 'Republic Day', holiday_date: `${new Date().getFullYear()}-01-26`, description: 'National holiday' },
    { name: 'Labour Day', holiday_date: `${new Date().getFullYear()}-05-01`, description: 'International Workers’ Day' },
    { name: 'Independence Day', holiday_date: `${new Date().getFullYear()}-08-15`, description: 'National holiday' },
    { name: 'Gandhi Jayanti', holiday_date: `${new Date().getFullYear()}-10-02`, description: 'National holiday' },
    { name: 'Christmas Day', holiday_date: `${new Date().getFullYear()}-12-25`, description: 'Major festival' },
  ];

  const importMajorIndianHolidays = async () => {
    if (!tenant) return;
    setImportLoading(true);
    const { error } = await initializeMajorHolidays(tenant.id);
    setImportLoading(false);
    if (error) return showToast('Import failed: ' + error.message, 'error');
    showToast('Major holidays added. Approve or reject as needed.', 'success');
    fetchHolidays();
  };

  const handleAddHoliday = async () => {
    if (!newHolidayName.trim() || !newHolidayDate) return showToast('Holiday name and date are required', 'warning');
    if (!tenant || !profile) return showToast('Unable to save holiday', 'error');
    setHolidayLoading(true);
    const { error } = await addHoliday(tenant.id, {
      name: newHolidayName.trim(),
      holiday_date: newHolidayDate,
      description: newHolidayDesc.trim(),
      status: 'Approved',
      requested_by: profile.id,
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    });
    setHolidayLoading(false);
    if (error) return showToast('Failed to add holiday: ' + error.message, 'error');
    showToast('Holiday added and approved', 'success');
    setShowHolidayModal(false);
    setNewHolidayName('');
    setNewHolidayDesc('');
    setNewHolidayDate(new Date().toISOString().slice(0, 10));
    fetchHolidays();
  };

  const handleUpdateHolidayStatus = async (holidayId, status) => {
    if (!profile) return showToast('Unable to update status', 'error');
    setHolidayLoading(true);
    const { error } = await updateHolidayStatus(holidayId, status, profile.id);
    setHolidayLoading(false);
    if (error) return showToast('Status update failed: ' + error.message, 'error');
    showToast(`Holiday ${status.toLowerCase()}`, 'success');
    fetchHolidays();
  };

  const moveHolidayMonth = (delta) => {
    let newMonth = holidayMonth + delta;
    let newYear = holidayYear;
    if (newMonth > 11) { newMonth = 0; newYear += 1; }
    if (newMonth < 0) { newMonth = 11; newYear -= 1; }
    setHolidayMonth(newMonth);
    setHolidayYear(newYear);
  };

  useEffect(() => {
    if (!tenant) return;
    setForm({
      company_name:   tenant.company_name   || '',
      pay_day:        tenant.pay_day        || 1,
      work_days:      tenant.work_days      || 26,
      currency:       tenant.currency       || '₹',
      shift_start:    tenant.shift_start    || '09:00',
      shift_end:      tenant.shift_end      || '18:00',
      late_threshold: tenant.late_threshold || 15,
      min_half_day_hours: tenant.min_half_day_hours || 4,
      min_full_day_hours: tenant.min_full_day_hours || 8,
      geofence_lat: tenant.geofence_lat || '',
      geofence_lng: tenant.geofence_lng || '',
      geofence_radius: tenant.geofence_radius || 200,
    });
    fetchData();
  }, [tenant, fetchData]);

  const saveSettings = async () => {
    setSaving(true);
    const { error } = await updateTenant(tenant.id, {
      company_name:   form.company_name   || 'My Company',
      pay_day:        parseInt(form.pay_day)        || 1,
      work_days:      parseInt(form.work_days)      || 26,
      currency:       form.currency       || '₹',
      shift_start:    form.shift_start    || '09:00',
      shift_end:      form.shift_end      || '18:00',
      late_threshold: parseInt(form.late_threshold) || 15,
      min_half_day_hours: parseFloat(form.min_half_day_hours) || 4,
      min_full_day_hours: parseFloat(form.min_full_day_hours) || 8,
      geofence_lat: form.geofence_lat ? parseFloat(form.geofence_lat) : null,
      geofence_lng: form.geofence_lng ? parseFloat(form.geofence_lng) : null,
      geofence_radius: parseInt(form.geofence_radius) || 200,
    });
    setSaving(false);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast('Settings saved', 'success');
    refreshProfile();
  };

  const handleAddDepartment = () => {
    setNewDepartmentName('');
    setShowDepartmentModal(true);
  };

  const handleSubmitDepartment = async () => {
    if (!newDepartmentName.trim()) return showToast('Department name is required', 'warning');
    setAddLoading(true);
    const { error } = await addDepartment(tenant.id, newDepartmentName.trim());
    setAddLoading(false);
    if (error) return showToast('Failed to add: ' + error.message, 'error');
    showToast('Department added', 'success');
    setShowDepartmentModal(false);
    fetchData();
  };

  const handleRemoveDepartment = async (id) => {
    const { error } = await removeDepartment(id);
    if (error) return showToast('Remove failed: ' + error.message, 'error');
    showToast('Department removed', 'success');
    fetchData();
  };

  const handleAddShift = () => {
    setNewShiftName('');
    setNewShiftStart('09:00');
    setNewShiftEnd('18:00');
    setShowShiftModal(true);
  };

  const calculateShiftHours = (start, end) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let from = sh * 60 + sm;
    let to = eh * 60 + em;
    if (to <= from) to += 24 * 60;
    return Math.round((to - from) / 60 * 100) / 100;
  };

  const handleSubmitShift = async () => {
    if (!newShiftName.trim()) return showToast('Shift name is required', 'warning');
    if (!newShiftStart || !newShiftEnd) return showToast('Shift start and end are required', 'warning');
    setAddLoading(true);
    const totalHours = calculateShiftHours(newShiftStart, newShiftEnd) || 8;
    const { error } = await addShift(tenant.id, {
      name: newShiftName.trim(),
      start_time: newShiftStart,
      end_time: newShiftEnd,
      total_hours: totalHours,
    });
    setAddLoading(false);
    if (error) return showToast('Failed to add shift: ' + error.message, 'error');
    showToast('Shift added', 'success');
    setShowShiftModal(false);
    fetchData();
  };

  const handleCopyJoinCode = async () => {
    if (!tenant?.join_code) return showToast('No join code available yet', 'warning');
    try {
      await navigator.clipboard.writeText(tenant.join_code);
      showToast('Join code copied to clipboard', 'success');
    } catch {
      showToast('Could not copy — please copy manually', 'error');
    }
  };

  const handleRemoveShift = async (id) => {
    const { error } = await removeShift(id);
    if (error) return showToast('Remove failed: ' + error.message, 'error');
    showToast('Shift removed', 'success');
    fetchData();
  };

  return (
    <>
      <Header title="Settings" breadcrumb="Company and system configuration" />

      <Modal
        show={showDepartmentModal}
        onClose={() => setShowDepartmentModal(false)}
        title="Add Department"
      >
        <div className="form-group">
          <label className="form-label">Department name</label>
          <input
            className="form-input"
            value={newDepartmentName}
            onChange={(e) => setNewDepartmentName(e.target.value)}
            placeholder="e.g. Sales"
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={() => setShowDepartmentModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmitDepartment} disabled={addLoading}>
            {addLoading ? 'Adding…' : 'Add Department'}
          </button>
        </div>
      </Modal>

      <Modal
        show={showHolidayModal}
        onClose={() => setShowHolidayModal(false)}
        title="Add Holiday"
      >
        <div className="form-group">
          <label className="form-label">Holiday name</label>
          <input
            className="form-input"
            value={newHolidayName}
            onChange={(e) => setNewHolidayName(e.target.value)}
            placeholder="e.g. Diwali"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              className="form-input"
              type="date"
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              className="form-input"
              value={newHolidayDesc}
              onChange={(e) => setNewHolidayDesc(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={() => setShowHolidayModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddHoliday} disabled={holidayLoading}>
            {holidayLoading ? 'Saving…' : 'Save Holiday'}
          </button>
        </div>
      </Modal>

      <Modal
        show={showShiftModal}
        onClose={() => setShowShiftModal(false)}
        title="Add Shift"
      >
        <div className="form-group">
          <label className="form-label">Shift name</label>
          <input
            className="form-input"
            value={newShiftName}
            onChange={(e) => setNewShiftName(e.target.value)}
            placeholder="e.g. Night Shift"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start time</label>
            <input
              className="form-input"
              type="time"
              value={newShiftStart}
              onChange={(e) => setNewShiftStart(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">End time</label>
            <input
              className="form-input"
              type="time"
              value={newShiftEnd}
              onChange={(e) => setNewShiftEnd(e.target.value)}
            />
          </div>
        </div>
        <div className="form-hint">Leave end time earlier than start time for overnight shifts.</div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={() => setShowShiftModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmitShift} disabled={addLoading}>
            {addLoading ? 'Adding…' : 'Add Shift'}
          </button>
        </div>
      </Modal>

      <div className="page-content settings-page">
        <div className="grid-2">
          <div className="card">
            <div className="card-header"><h3>Invite Employees</h3></div>
            <div className="card-body">
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Share this join code with new employees. They enter it on the signup page to be added to your company.
              </p>
              <div className="form-label">Company join code</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: 2,
                  padding: '12px 18px',
                  background: 'var(--bg)',
                  border: '1px dashed var(--border)',
                  borderRadius: 'var(--radius-md)',
                  userSelect: 'all',
                  color: 'var(--primary)',
                }}>
                  {tenant?.join_code || '—'}
                </span>
                <button className="btn btn-outline btn-sm" onClick={handleCopyJoinCode} disabled={!tenant?.join_code}>
                  <i className="fas fa-copy" /> Copy
                </button>
              </div>
              <div className="form-hint" style={{ marginTop: 12 }}>
                Tip: send this code along with the link to <code>/signup</code> so employees can sign up directly.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Company Settings</h3></div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Company Name</label>
                <input className="form-input" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Pay Cycle Start Day</label>
                  <input className="form-input" type="number" min="1" max="28" value={form.pay_day} onChange={(e) => setForm({ ...form, pay_day: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Working Days / Month</label>
                  <input className="form-input" type="number" min="1" max="31" value={form.work_days} onChange={(e) => setForm({ ...form, work_days: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Currency Symbol</label>
                <input className="form-input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Default Shift Start</label>
                  <input className="form-input" type="time" value={form.shift_start} onChange={(e) => setForm({ ...form, shift_start: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Default Shift End</label>
                  <input className="form-input" type="time" value={form.shift_end} onChange={(e) => setForm({ ...form, shift_end: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Late Threshold (minutes)</label>
                <input className="form-input" type="number" min="0" value={form.late_threshold} onChange={(e) => setForm({ ...form, late_threshold: e.target.value })} />
                <div className="form-hint">Minutes after shift start before marking as Late</div>
              </div>
              <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
                {saving ? 'Saving…' : <><i className="fas fa-save" /> Save Settings</>}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Attendance & Geofencing</h3></div>
            <div className="card-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Half-Day Min. Hours</label>
                  <input className="form-input" type="number" step="0.5" value={form.min_half_day_hours} onChange={(e) => setForm({ ...form, min_half_day_hours: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Full-Day Min. Hours</label>
                  <input className="form-input" type="number" step="0.5" value={form.min_full_day_hours} onChange={(e) => setForm({ ...form, min_full_day_hours: e.target.value })} />
                </div>
              </div>
              
              <div className="settings-geofence">
                <h4><i className="fas fa-map-marker-alt" /> Geofencing</h4>
                <p>Restrict employee clock-in/out to a specific location.</p>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Latitude</label>
                    <input className="form-input" placeholder="e.g. 28.6139" value={form.geofence_lat} onChange={(e) => setForm({ ...form, geofence_lat: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Longitude</label>
                    <input className="form-input" placeholder="e.g. 77.2090" value={form.geofence_lng} onChange={(e) => setForm({ ...form, geofence_lng: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Radius (meters)</label>
                  <input className="form-input" type="number" value={form.geofence_radius} onChange={(e) => setForm({ ...form, geofence_radius: e.target.value })} />
                </div>
              </div>

              <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
                {saving ? 'Saving…' : <><i className="fas fa-save" /> Save Attendance Rules</>}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Holiday Calendar</h3>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-outline" onClick={() => setShowHolidayModal(true)}>
                  <i className="fas fa-plus" /> Add Holiday
                </button>
                <button className="btn btn-primary btn-sm" onClick={importMajorIndianHolidays} disabled={importLoading}>
                  {importLoading ? 'Importing…' : 'Import Major Holidays'}
                </button>
              </div>
            </div>
            <div className="card-body">
              <div className="settings-holiday-meta">
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Approved holidays automatically apply to employee attendance calendars.</span>
                <div className="settings-holiday-nav">
                  <button className="btn btn-outline btn-icon btn-sm" onClick={() => moveHolidayMonth(-1)}><i className="fas fa-chevron-left" /></button>
                  <span>{monthLabel(holidayMonth, holidayYear)}</span>
                  <button className="btn btn-outline btn-icon btn-sm" onClick={() => moveHolidayMonth(1)}><i className="fas fa-chevron-right" /></button>
                </div>
              </div>
              <div className="att-calendar" style={{ marginBottom: 20 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div className="att-cal-header" key={day}>{day}</div>
                ))}
                {(() => {
                  const firstDay = new Date(holidayYear, holidayMonth, 1).getDay();
                  const daysInMonth = new Date(holidayYear, holidayMonth + 1, 0).getDate();
                  const today = new Date();
                  const holidayMap = new Map(holidays.map((h) => [getHolidayDate(h), h]));
                  const cells = [];
                  for (let i = 0; i < firstDay; i++) cells.push(<div className="att-cal-day empty" key={`empty-${i}`} />);
                  for (let d = 1; d <= daysInMonth; d++) {
                    const date = new Date(holidayYear, holidayMonth, d);
                    const ds = date.toISOString().slice(0, 10);
                    const holiday = holidayMap.get(ds);
                    const isToday = d === today.getDate() && holidayMonth === today.getMonth() && holidayYear === today.getFullYear();
                    const cls = holiday ? 'holiday' : (date.getDay() === 0 || date.getDay() === 6 ? 'weekend' : '');
                    cells.push(
                      <div className={`att-cal-day ${cls}${isToday ? ' today' : ''}`} key={ds}>
                        <div className="day-num">{d}</div>
                        {holiday && <div className="day-hours" style={{ fontSize: 10 }}>{holiday.name}</div>}
                      </div>
                    );
                  }
                  return cells;
                })()}
              </div>
              {holidays.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No holidays configured yet. Import the major Indian holidays or add a custom holiday.</p>
              ) : (
                <div className="settings-holiday-list">
                  {holidays.map((holiday) => (
                    <div key={holiday.id} className="settings-holiday-row">
                      <div>
                        <div className="name">{holiday.name}</div>
                        <div className="meta">{getHolidayDate(holiday)} • {holiday.description || 'No description'}</div>
                        <div className="status"><strong>Status:</strong> {holiday.status}</div>
                      </div>
                      <div className="actions">
                        {holiday.status === 'Pending' && (
                          <>
                            <button className="btn btn-success btn-sm" onClick={() => handleUpdateHolidayStatus(holiday.id, 'Approved')} disabled={holidayLoading}>Approve</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleUpdateHolidayStatus(holiday.id, 'Rejected')} disabled={holidayLoading}>Reject</button>
                          </>
                        )}
                        {holiday.status !== 'Pending' && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Updated</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Shifts</h3>
              <button className="btn btn-primary btn-sm" onClick={handleAddShift}><i className="fas fa-plus" /> Add Shift</button>
            </div>
            <div className="card-body">
              {shifts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Only the company default shift is available. Add more shifts for flexible timing.</p>
              ) : shifts.map((s) => (
                <div key={s.id} className="settings-list-row">
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.start_time} — {s.end_time}</div>
                  </div>
                  <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleRemoveShift(s.id)}>
                    <i className="fas fa-trash-alt" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Departments</h3>
              <button className="btn btn-primary btn-sm" onClick={handleAddDepartment}><i className="fas fa-plus" /> Add Dept</button>
            </div>
            <div className="card-body">
              {departments.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No departments configured. Add departments to organize your team.</p>
              ) : departments.map((d) => (
                <div key={d.id} className="settings-list-row">
                  <span style={{ fontSize: 13 }}>{d.name}</span>
                  <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleRemoveDepartment(d.id)}>
                    <i className="fas fa-times" />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

