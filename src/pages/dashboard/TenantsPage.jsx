import React from 'react';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import {
  listAllTenants, createTenant, listOutlets, createOutlet, updateOutlet, removeOutlet, deleteTenant,
} from '@/services/tenantService';
import { listTenantMembers } from '@/services/platformService';
import { updateEmployee, updateEmployeeEmail, setEmployeeStatus, removeEmployee } from '@/services/employeeService';
import { parseImportFile, runBulkImport, downloadSampleCSV } from '@/lib/employeeImport';
import { getInitials, getAvatarColor, fmt, fullName } from '@/lib/helpers';

const EMPTY_CREATE_FORM = {
  companyName: '', domain: '', currency: '₹', workDays: 26,
  adminFirstName: '', adminLastName: '', adminEmail: '',
};

function CredentialsPanel({ creds, onDone }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(
      `Company: ${creds.companyName}\nJoin Code: ${creds.joinCode}\nAdmin Email: ${creds.adminEmail}\nTemporary Password: ${creds.tempPassword}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 44, color: 'var(--success)', marginBottom: 12 }}>
          <i className="fas fa-check-circle" />
        </div>
        <h3 style={{ marginBottom: 6 }}>{creds.companyName} created</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Share these credentials with the company to get them started
        </p>
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: 16, position: 'relative' }}>
        <button
          onClick={copy}
          style={{ position: 'absolute', right: 10, top: 10, border: 'none', background: 'none', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-muted)' }}
          title="Copy to clipboard"
        >
          <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} />
        </button>
        {[
          ['Join Code', creds.joinCode],
          ['Admin Email', creds.adminEmail],
          ['Temporary Password', creds.tempPassword],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>{label}</span>
            <strong style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{val}</strong>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
        <i className="fas fa-info-circle" style={{ color: 'var(--primary)' }} />{' '}
        The admin must change this password on first login. The join code lets employees self-signup into this company.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

function CreateCompanyModal({ show, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_CREATE_FORM);
  const [saving, setSaving] = useState(false);
  const [creds, setCreds] = useState(null);

  useEffect(() => {
    if (show) { setForm(EMPTY_CREATE_FORM); setCreds(null); }
  }, [show]);

  const handleCreate = async () => {
    if (!form.companyName.trim()) return showToast('Company name is required', 'error');
    if (!form.adminFirstName.trim() || !form.adminLastName.trim()) return showToast('Admin first/last name is required', 'error');
    if (!form.adminEmail.trim()) return showToast('Admin email is required', 'error');

    setSaving(true);
    try {
      const result = await createTenant({
        companyName: form.companyName.trim(),
        domain: form.domain.trim(),
        currency: form.currency.trim() || '₹',
        workDays: parseInt(form.workDays, 10) || 26,
        adminFirstName: form.adminFirstName.trim(),
        adminLastName: form.adminLastName.trim(),
        adminEmail: form.adminEmail.trim(),
      });
      setCreds({ companyName: form.companyName.trim(), ...result });
      onCreated();
    } catch (err) {
      showToast(err.message || 'Failed to create company', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      show={show}
      onClose={onClose}
      title={creds ? 'Company Created' : 'Create Company'}
      width="480px"
      footer={creds ? null : (
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Creating…</> : <><i className="fas fa-check" /> Create</>}
          </button>
        </>
      )}
    >
      {creds ? (
        <CredentialsPanel creds={creds} onDone={onClose} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">Company Name *</label>
            <input className="form-input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="e.g. Acme Retail Pvt Ltd" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Domain</label>
              <input className="form-input" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="e.g. acme.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Currency Symbol</label>
              <input className="form-input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Working Days / Month</label>
            <input className="form-input" type="number" min="1" max="31" value={form.workDays} onChange={(e) => setForm({ ...form, workDays: e.target.value })} />
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Admin First Name *</label>
              <input className="form-input" value={form.adminFirstName} onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Admin Last Name *</label>
              <input className="form-input" value={form.adminLastName} onChange={(e) => setForm({ ...form, adminLastName: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Admin Email *</label>
            <input className="form-input" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="admin@acme.com" />
            <div className="form-hint">This becomes the company's first login — you'll get a temporary password to hand off.</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BranchesTab({ tenantId, outlets, onChanged }) {
  const [form, setForm] = useState({ name: '', address: '', city: '' });
  const [saving, setSaving] = useState(false);

  const addBranch = async () => {
    if (!form.name.trim()) return showToast('Branch name is required', 'error');
    setSaving(true);
    const { error } = await createOutlet(tenantId, form);
    setSaving(false);
    if (error) return showToast('Failed to add branch: ' + error.message, 'error');
    setForm({ name: '', address: '', city: '' });
    onChanged();
  };

  const toggleActive = async (outlet) => {
    const { error } = await updateOutlet(outlet.id, { is_active: !outlet.is_active });
    if (error) return showToast('Failed to update branch', 'error');
    onChanged();
  };

  const remove = async (outlet) => {
    if (!confirm(`Remove branch "${outlet.name}"? Employees assigned to it will be unassigned, not deleted.`)) return;
    const { error } = await removeOutlet(outlet.id);
    if (error) return showToast('Failed to remove branch: ' + error.message, 'error');
    onChanged();
  };

  return (
    <div>
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <div className="form-group">
          <label className="form-label">Branch Name *</label>
          <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mumbai Bandra" />
        </div>
        <div className="form-group">
          <label className="form-label">City</label>
          <input className="form-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Address</label>
        <input className="form-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-outline" onClick={addBranch} disabled={saving}>
          <i className="fas fa-plus" /> Add Branch
        </button>
      </div>

      {outlets.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 13 }}>No branches yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>City</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {outlets.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong>{o.address && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{o.address}</div>}</td>
                  <td>{o.city || '—'}</td>
                  <td><span className={`badge ${o.is_active ? 'badge-success' : 'badge-secondary'}`}>{o.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-outline btn-icon btn-sm" onClick={() => toggleActive(o)} title="Toggle active"><i className="fas fa-power-off" /></button>
                      <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => remove(o)} title="Remove"><i className="fas fa-trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BulkUploadTab({ tenantId, outlets, onImported }) {
  const [rows, setRows] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
  const [summary, setSummary] = useState(null);

  const outletsByName = new Map(outlets.map((o) => [o.name.trim().toLowerCase(), o.id]));

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSummary(null);
    try {
      const parsed = await parseImportFile(file);
      if (!parsed.length) { showToast('No data rows found in file', 'error'); e.target.value = ''; return; }
      setRows(parsed);
    } catch (err) {
      showToast('Failed to parse file: ' + (err.message || 'Unknown error'), 'error');
    }
    e.target.value = '';
  };

  const confirmImport = async () => {
    if (!rows) return;
    setImportProgress({ current: 0, total: rows.length });
    try {
      const result = await runBulkImport({
        tenantId, rows,
        onProgress: (current, total) => setImportProgress({ current, total }),
      });
      setSummary(result);
      onImported();
    } finally {
      setImportProgress(null);
      setRows(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" disabled={!!importProgress} onClick={() => document.getElementById('platform-import-file').click()}>
          <i className="fas fa-file-import" /> Choose CSV / XLSX
        </button>
        <input id="platform-import-file" type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm" style={{ display: 'none' }} onChange={handleFile} disabled={!!importProgress} />
        <button className="btn btn-outline" disabled={!!importProgress} onClick={downloadSampleCSV}>
          <i className="fas fa-file-csv" /> Download Template
        </button>
      </div>

      {importProgress && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          Importing {importProgress.current} / {importProgress.total}…
        </div>
      )}

      {rows && !importProgress && (
        <div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>{rows.length}</strong> row(s) parsed. Preview (first 20 shown) — branch names are matched
            against this company's branches above; any branch name not seen before is created automatically,
            same as departments. Dates in any format are normalized automatically. Phone number is required
            for every row (used as the login when there's no email) — email is the only field that's allowed
            to be missing.
          </div>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Email</th><th>Name</th><th>CTC</th><th>Branch</th><th>Match</th></tr></thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => {
                  const email = r.email || r.Email || r['Email Address'] || '';
                  const branch = r.outlet_location || r.location || r['Outlet Location'] || r.outlet || r.OUTLET || r.branch || r.Branch || '';
                  const matched = branch && outletsByName.has(String(branch).trim().toLowerCase());
                  return (
                    <tr key={i}>
                      <td>{email || <span style={{ color: 'var(--danger)' }}>missing</span>}</td>
                      <td>{r.first_name || r['First Name'] || ''} {r.middle_name || r['Middle Name'] || ''} {r.last_name || r['Last Name'] || ''}</td>
                      <td>{r.ctc || r.CTC || '—'}</td>
                      <td>{branch || '—'}</td>
                      <td>{branch ? (matched ? <span className="badge badge-success">Matched</span> : <span className="badge badge-secondary">Will create</span>) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button className="btn btn-outline" onClick={() => setRows(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmImport}>
              <i className="fas fa-upload" /> Confirm Import
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div style={{ marginTop: 16, fontSize: 13, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>
          <strong>{summary.successCount}</strong> imported
          {summary.updateCount > 0 && <>, <strong>{summary.updateCount}</strong> updated</>}
          {summary.skipCount > 0 && <>, <strong>{summary.skipCount}</strong> skipped</>}
          {summary.failCount > 0 && <>, <strong>{summary.failCount}</strong> failed</>}
          {summary.failErrors.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--danger)' }}>
              {summary.failErrors.map((e, i) => <li key={i} style={{ fontSize: 12 }}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_MEMBER_FORM = { role: 'employee', status: 'Active', department: '', designation: '', ctc: '', email: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EditMemberModal({ member, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_MEMBER_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!member) return;
    setForm({
      role: member.role || 'employee',
      status: member.status || 'Active',
      department: member.department || '',
      designation: member.designation || '',
      ctc: member.ctc || '',
      email: member.email || '',
    });
  }, [member]);

  const handleSave = async () => {
    const newEmail = form.email.trim();
    const emailChanged = newEmail !== (member.email || '');
    if (emailChanged && !EMAIL_RE.test(newEmail)) {
      return showToast('Enter a valid email address', 'error');
    }

    setSaving(true);

    // Email is a separate flow (update-employee-email) because it's the
    // employee's Supabase Auth login identity, not just a profile field —
    // it needs the service-role Auth admin API to update, and deliberately
    // never touches their password/temp_password.
    if (emailChanged) {
      const { error: emailError } = await updateEmployeeEmail(member.id, newEmail);
      if (emailError) {
        setSaving(false);
        return showToast('Failed to update email: ' + emailError.message, 'error');
      }
    }

    const { error } = await updateEmployee(member.id, {
      role: form.role,
      status: form.status,
      department: form.department.trim(),
      designation: form.designation.trim(),
      ctc: parseFloat(form.ctc) || 0,
    });
    setSaving(false);
    if (error) return showToast('Failed to update member: ' + error.message, 'error');
    showToast('Member updated', 'success');
    onSaved();
    onClose();
  };

  return (
    <Modal
      show={!!member}
      onClose={onClose}
      title={member ? `Edit — ${fullName(member)}` : 'Edit Member'}
      width="440px"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving…</> : <><i className="fas fa-check" /> Save</>}
        </button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Login Email</label>
          <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="form-hint">Updates their sign-in email too. Their existing password is unaffected.</div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="admin">HR / Admin</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Department</label>
            <input className="form-input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Designation</label>
            <input className="form-input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Monthly CTC (₹)</label>
          <input className="form-input" type="number" min="0" value={form.ctc} onChange={(e) => setForm({ ...form, ctc: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

function MemberCredentialsModal({ member, onClose }) {
  const [copied, setCopied] = useState(false);
  const hasEmail = !!member?.email;
  const loginLabel = hasEmail ? 'Email' : 'Phone (login ID)';
  const loginValue = hasEmail ? member?.email : member?.phone;

  // employee_current_passwords is superadmin-only (RLS) and only exists once
  // the member has set their own password — it reflects their live password,
  // unlike temp_password which is only ever the original onboarding value.
  const cpEntry = Array.isArray(member?.employee_current_passwords)
    ? member.employee_current_passwords[0]
    : member?.employee_current_passwords;
  const currentPassword = cpEntry?.password;
  const displayPassword = currentPassword || member?.temp_password;
  const passwordLabel = currentPassword ? 'Current Password' : 'Temporary Password';

  const copy = () => {
    navigator.clipboard.writeText(`${loginLabel}: ${loginValue}\nPassword: ${displayPassword || '********'}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal show={!!member} onClose={onClose} title="Member Credentials" width="440px"
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 44, color: 'var(--success)', marginBottom: 12 }}>
          <i className="fas fa-user-shield" />
        </div>
        <h3 style={{ marginBottom: 6 }}>{fullName(member)}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Login credentials for this member</p>
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', padding: 16, position: 'relative' }}>
        <button
          onClick={copy}
          style={{ position: 'absolute', right: 10, top: 10, border: 'none', background: 'none', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-muted)' }}
          title="Copy to clipboard"
        >
          <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} />
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>{loginLabel}</span>
          <strong>{loginValue || '—'}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>{passwordLabel}</span>
          <strong style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{displayPassword || '********'}</strong>
        </div>
      </div>
      {!hasEmail && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
          <i className="fas fa-info-circle" /> No email on file — this member logs in with their phone number instead.
        </p>
      )}
      {!displayPassword && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
          <i className="fas fa-info-circle" /> No stored password on file for this member.
        </p>
      )}
    </Modal>
  );
}

function MembersTab({ tenantId, members, loading, onChanged }) {
  const [editMember, setEditMember] = useState(null);
  const [credsMember, setCredsMember] = useState(null);

  const toggleStatus = async (m) => {
    const newStatus = m.status === 'Active' ? 'Inactive' : 'Active';
    const { error } = await setEmployeeStatus(m.id, newStatus);
    if (error) return showToast('Failed to update status', 'error');
    onChanged();
  };

  const deleteMember = async (m) => {
    if (!confirm(
      `Permanently delete ${fullName(m)}?\n\n` +
      `This also permanently deletes their attendance, payslips, advances, and leave records. This cannot be undone.`
    )) return;
    const { error } = await removeEmployee(m.id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Member deleted', 'success');
    onChanged();
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  }

  return (
    <div>
      {members.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 13 }}>No members yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Member</th><th>Role</th><th>Department</th><th>CTC</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="emp-cell">
                      <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(m.id)})` }}>
                        {getInitials(m.first_name, m.last_name)}
                      </div>
                      <div>
                        <div className="emp-name">{fullName(m)}</div>
                        <div className="emp-role">{m.email || ''}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{m.role}</td>
                  <td>{m.department || '—'}</td>
                  <td>{fmt(m.ctc)}</td>
                  <td><span className={`badge ${m.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>{m.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-outline btn-icon btn-sm" onClick={() => setEditMember(m)} title="Edit settings"><i className="fas fa-edit" /></button>
                      <button className="btn btn-outline btn-icon btn-sm" onClick={() => setCredsMember(m)} title="Show Credentials"><i className="fas fa-key" /></button>
                      <button className="btn btn-outline btn-icon btn-sm" onClick={() => toggleStatus(m)} title="Toggle active"><i className="fas fa-power-off" /></button>
                      <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteMember(m)} title="Delete"><i className="fas fa-trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditMemberModal member={editMember} onClose={() => setEditMember(null)} onSaved={onChanged} />
      <MemberCredentialsModal member={credsMember} onClose={() => setCredsMember(null)} />
    </div>
  );
}

function DeleteCompanyPanel({ tenant, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!confirming) {
    return (
      <button className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setConfirming(true)}>
        <i className="fas fa-trash" /> Delete Company
      </button>
    );
  }

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await deleteTenant(tenant.id);
    setDeleting(false);
    if (error) return showToast('Failed to delete company: ' + error.message, 'error');
    showToast(`${tenant.company_name} deleted`, 'success');
    onDeleted();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        className="form-input"
        style={{ width: 220 }}
        placeholder={`Type "${tenant.company_name}" to confirm`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <button className="btn btn-outline" onClick={() => { setConfirming(false); setTyped(''); }} disabled={deleting}>Cancel</button>
      <button
        className="btn btn-danger"
        disabled={deleting || typed !== tenant.company_name}
        onClick={handleDelete}
      >
        {deleting ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Deleting…</> : <><i className="fas fa-trash" /> Confirm Delete</>}
      </button>
    </div>
  );
}

function ManageTenantModal({ tenant, onClose, onChanged }) {
  const [tab, setTab] = useState('branches');
  const [outlets, setOutlets] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);

  const refreshOutlets = async () => {
    if (!tenant) return;
    setLoading(true);
    const { data, error } = await listOutlets(tenant.id);
    if (error) showToast('Failed to load branches', 'error');
    setOutlets(data || []);
    setLoading(false);
  };

  const refreshMembers = async () => {
    if (!tenant) return;
    setMembersLoading(true);
    const { data, error } = await listTenantMembers(tenant.id);
    if (error) showToast('Failed to load members', 'error');
    setMembers(data || []);
    setMembersLoading(false);
  };

  useEffect(() => { setTab('branches'); refreshOutlets(); refreshMembers(); }, [tenant?.id]);

  const handleDeleted = () => {
    onChanged();
    onClose();
  };

  return (
    <Modal
      show={!!tenant}
      onClose={onClose}
      title={tenant ? `Manage — ${tenant.company_name}` : 'Manage'}
      fullScreen
      footer={<>
        {tenant && <DeleteCompanyPanel tenant={tenant} onDeleted={handleDeleted} />}
        <button className="btn btn-outline" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
      </>}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[['branches', 'Branches'], ['members', `Members${members.length ? ` (${members.length})` : ''}`], ['upload', 'Bulk Upload Employees']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-outline'}`}
            style={{ borderRadius: '6px 6px 0 0', border: tab === key ? undefined : 'none' }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'branches' ? (
        loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : (
          <BranchesTab tenantId={tenant?.id} outlets={outlets} onChanged={() => { refreshOutlets(); onChanged(); }} />
        )
      ) : tab === 'members' ? (
        <MembersTab tenantId={tenant?.id} members={members} loading={membersLoading} onChanged={refreshMembers} />
      ) : (
        loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : (
          <BulkUploadTab tenantId={tenant?.id} outlets={outlets} onImported={() => { refreshMembers(); onChanged(); }} />
        )
      )}
    </Modal>
  );
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [manageTenant, setManageTenant] = useState(null);

  const fetchTenants = () => {
    setLoading(true);
    listAllTenants()
      .then(({ data, error }) => {
        if (error) showToast(error.message || 'Failed to load tenants', 'error');
        setTenants(data || []);
      })
      .catch((err) => showToast(err.message || 'Failed to load tenants', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTenants(); }, []);

  return (
    <>
      <Header title="Tenant Management" breadcrumb="Platform administration" />
      <div className="page-content">
        <div className="stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <StatCard icon="fa-building"     iconColor="blue"   value={tenants.length} label="Total Tenants" />
          <StatCard icon="fa-check-circle" iconColor="green"  value={tenants.length} label="Active" />
          <StatCard icon="fa-clock"        iconColor="orange" value={0}              label="Pending Setup" />
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading tenants…</div>
        ) : (
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Registered Businesses</h3>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <i className="fas fa-plus" /> Create Company
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Company</th><th>Domain</th><th>Working Days</th><th>Currency</th><th>Registered</th><th></th></tr>
                </thead>
                <tbody>
                  {tenants.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No tenants registered yet.</td></tr>
                  ) : tenants.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.company_name}</strong></td>
                      <td>{t.domain || '—'}</td>
                      <td>{t.work_days || 26}</td>
                      <td>{t.currency || '₹'}</td>
                      <td>{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => setManageTenant(t)}>
                          <i className="fas fa-cog" /> Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <CreateCompanyModal show={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchTenants} />
      <ManageTenantModal tenant={manageTenant} onClose={() => setManageTenant(null)} onChanged={fetchTenants} />
    </>
  );
}
