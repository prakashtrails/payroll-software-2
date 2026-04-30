import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { updateTenant, listDepartments, addDepartment, removeDepartment, listShifts, addShift, removeShift } from '@/services/tenantService';

export default function SettingsPage() {
  const { tenant, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    company_name: '', pay_day: 1, work_days: 26, currency: '₹',
    shift_start: '09:00', shift_end: '18:00', late_threshold: 15,
    min_half_day_hours: 4, min_full_day_hours: 8,
    geofence_lat: '', geofence_lng: '', geofence_radius: 200,
  });
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts]           = useState([]);
  const [saving, setSaving]           = useState(false);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    const [deptRes, shiftRes] = await Promise.all([
      listDepartments(tenant.id),
      listShifts(tenant.id)
    ]);
    setDepartments(deptRes.data || []);
    setShifts(shiftRes.data || []);
  }, [tenant]);

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

  const handleAddDepartment = async () => {
    const name = prompt('Enter department name:');
    if (!name?.trim()) return;
    const { error } = await addDepartment(tenant.id, name);
    if (error) return showToast('Failed to add: ' + error.message, 'error');
    showToast('Department added', 'success');
    fetchData();
  };

  const handleRemoveDepartment = async (id) => {
    const { error } = await removeDepartment(id);
    if (error) return showToast('Remove failed: ' + error.message, 'error');
    showToast('Department removed', 'success');
    fetchData();
  };

  const handleAddShift = async () => {
    const name = prompt('Enter shift name (e.g. Night Shift):');
    if (!name?.trim()) return;
    const start = prompt('Start time (HH:MM):', '22:00');
    const end = prompt('End time (HH:MM):', '07:00');
    if (!start || !end) return;

    const { error } = await addShift(tenant.id, { name, start_time: start, end_time: end, total_hours: 9 });
    if (error) return showToast('Failed to add shift: ' + error.message, 'error');
    showToast('Shift added', 'success');
    fetchData();
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
      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          
          <div className="card">
            <div className="card-header"><h3>Company Settings</h3></div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Company Name</label>
                <input className="form-input" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Company Join Code</label>
                <div style={{ 
                  padding: '12px', 
                  background: 'var(--bg)', 
                  borderRadius: 'var(--radius-md)', 
                  border: '1px dashed var(--primary)',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  letterSpacing: '2px',
                  textAlign: 'center',
                  color: 'var(--primary)',
                  cursor: 'pointer'
                }} onClick={() => {
                  navigator.clipboard.writeText(tenant?.join_code);
                  showToast('Join code copied to clipboard', 'success');
                }} title="Click to copy">
                  {tenant?.join_code || 'N/A'}
                </div>
                <div className="form-hint">Share this code with employees so they can join your workspace.</div>
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
              
              <div style={{ padding: '12px', background: 'var(--bg)', borderRadius: 'var(--radius-md)', marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 13 }}><i className="fas fa-map-marker-alt" /> Geofencing</h4>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>Restrict employee clock-in/out to a specific location.</p>
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
              <h3>Shifts</h3>
              <button className="btn btn-primary btn-sm" onClick={handleAddShift}><i className="fas fa-plus" /> Add Shift</button>
            </div>
            <div className="card-body">
              {shifts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Only the company default shift is available. Add more shifts for flexible timing.</p>
              ) : shifts.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.start_time} — {s.end_time}</div>
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
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
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

