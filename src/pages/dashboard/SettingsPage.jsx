import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { updateTenant, listDepartments, addDepartment, removeDepartment } from '@/services/tenantService';

export default function SettingsPage() {
  const { tenant, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    company_name: '', pay_day: 1, work_days: 26, currency: '₹',
    shift_start: '09:00', shift_end: '18:00', late_threshold: 15,
  });
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving]           = useState(false);

  const fetchDepartments = useCallback(async () => {
    if (!tenant) return;
    const { data } = await listDepartments(tenant.id);
    setDepartments(data || []);
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
    });
    fetchDepartments();
  }, [tenant, fetchDepartments]);

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
    fetchDepartments();
  };

  const handleRemoveDepartment = async (id) => {
    const { error } = await removeDepartment(id);
    if (error) return showToast('Remove failed: ' + error.message, 'error');
    showToast('Department removed', 'success');
    fetchDepartments();
  };

  return (
    <>
      <Header title="Settings" breadcrumb="Company and system configuration" />
      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
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
                  <label className="form-label">Shift Start</label>
                  <input className="form-input" type="time" value={form.shift_start} onChange={(e) => setForm({ ...form, shift_start: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Shift End</label>
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
            <div className="card-header"><h3>Organization Code</h3></div>
            <div className="card-body">
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Share this code with employees so they can self-register and join your workspace on the sign-up page.
              </p>
              {tenant?.join_code ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    fontSize: 26, fontWeight: 800, letterSpacing: 6,
                    fontFamily: 'monospace', color: 'var(--primary)',
                    background: 'var(--primary-light)', padding: '8px 20px',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    {tenant.join_code}
                  </span>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => { navigator.clipboard.writeText(tenant.join_code); }}
                  >
                    <i className="fas fa-copy" /> Copy
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  No code found. Re-run the migration SQL (section 6) to generate one.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Departments</h3>
              <button className="btn btn-primary btn-sm" onClick={handleAddDepartment}><i className="fas fa-plus" /> Add</button>
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

