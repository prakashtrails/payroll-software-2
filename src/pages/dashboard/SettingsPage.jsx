import React from 'react';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export default function SettingsPage() {
  const { tenant, fetchProfile, user } = useAuth();
  const [form, setForm] = useState({
    company_name: '', pay_day: 1, work_days: 26, currency: '₹',
    shift_start: '09:00', shift_end: '18:00', late_threshold: 15
  });
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setForm({
      company_name: tenant.company_name || '',
      pay_day: tenant.pay_day || 1,
      work_days: tenant.work_days || 26,
      currency: tenant.currency || '₹',
      shift_start: tenant.shift_start || '09:00',
      shift_end: tenant.shift_end || '18:00',
      late_threshold: tenant.late_threshold || 15,
    });
    fetchDepartments();
  }, [tenant]);

  const fetchDepartments = async () => {
    const { data } = await supabase
      .from('departments')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('name');
    setDepartments(data || []);
  };

  const saveSettings = async () => {
    setSaving(true);
    const { error } = await supabase.from('tenants').update({
      company_name: form.company_name || 'My Company',
      pay_day: parseInt(form.pay_day) || 1,
      work_days: parseInt(form.work_days) || 26,
      currency: form.currency || '₹',
      shift_start: form.shift_start || '09:00',
      shift_end: form.shift_end || '18:00',
      late_threshold: parseInt(form.late_threshold) || 15,
    }).eq('id', tenant.id);

    setSaving(false);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast('Settings saved', 'success');
    if (user) fetchProfile(user.id); // refresh tenant in context
  };

  const addDepartment = async () => {
    const name = prompt('Enter department name:');
    if (!name?.trim()) return;
    const { error } = await supabase.from('departments').insert([{ tenant_id: tenant.id, name: name.trim() }]);
    if (error) return showToast('Failed to add', 'error');
    showToast('Department added', 'success');
    fetchDepartments();
  };

  const removeDepartment = async (id) => {
    await supabase.from('departments').delete().eq('id', id);
    showToast('Department removed', 'success');
    fetchDepartments();
  };

  return (
    <>
      <Header title="Settings" breadcrumb="Company and system configuration" />
      <div className="page-content">
        <div className="grid-2">
          {/* Company Settings */}
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
                {saving ? 'Saving...' : <><i className="fas fa-save" /> Save Settings</>}
              </button>
            </div>
          </div>

          {/* Departments */}
          <div className="card">
            <div className="card-header">
              <h3>Departments</h3>
              <button className="btn btn-primary btn-sm" onClick={addDepartment}><i className="fas fa-plus" /> Add</button>
            </div>
            <div className="card-body">
              {departments.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No departments configured. Add departments to organize your team.</p>
              ) : (
                departments.map((d) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                    <span style={{ fontSize: 13 }}>{d.name}</span>
                    <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeDepartment(d.id)}>
                      <i className="fas fa-times" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
