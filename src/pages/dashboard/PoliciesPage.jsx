import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listPolicies, createPolicy, deletePolicy,
  acknowledgePolicy, listMyAcknowledgements, countAcknowledgements, recordPolicyDownload, fetchPolicyAudit,
} from '@/services/policyService';
import { listColleagues } from '@/services/employeeService';
import { fullName } from '@/lib/helpers';

const isImageAttachment = (name, url) => /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/i.test(name || url || '');

// Supabase public storage URLs honour ?download=<name> by sending a
// Content-Disposition: attachment header — a plain <a download> is ignored
// cross-origin, so this is what actually makes the browser save the file.
const downloadUrl = (url, name) =>
  `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name || 'policy')}`;

const fmtStamp = (ts) => new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function SourceBadge({ source }) {
  if (!source) return null;
  return (
    <span className={`badge ${source === 'app' ? 'badge-purple' : 'badge-info'}`} style={{ fontSize: 10, marginLeft: 6 }}>
      <i className={`fas ${source === 'app' ? 'fa-mobile-screen' : 'fa-desktop'}`} style={{ marginRight: 3 }} />
      {source === 'app' ? 'Phone' : 'Web'}
    </span>
  );
}

const AUDIT_FILTERS = ['All', 'Acknowledged', 'Not Acknowledged', 'Downloaded'];

export default function PoliciesPage() {
  const { tenant, profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin';

  const [policies, setPolicies] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ title: '', body: '' });
  const [pdfFile, setPdfFile]   = useState(null);
  const fileInputRef = useRef(null);

  const [myAcks, setMyAcks]       = useState({});
  const [ackCounts, setAckCounts] = useState({});
  const [acking, setAcking]       = useState(null);
  const [audit, setAudit] = useState(null); // { policy, loading, employees, acks, downloads }
  const [auditFilter, setAuditFilter] = useState('All');
  const [auditSearch, setAuditSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    setLoading(true);
    try {
      const [{ data, error }, { data: acks }] = await Promise.all([
        listPolicies(tenant.id),
        listMyAcknowledgements(tenant.id, profile.id),
      ]);
      if (error) showToast(error.message || 'Failed to load policies', 'error');
      setPolicies(data || []);
      setMyAcks(acks || {});
      if (isAdmin) {
        const { data: counts } = await countAcknowledgements(tenant.id);
        setAckCounts(counts || {});
      }
    } catch (err) {
      showToast(err.message || 'Failed to load policies', 'error');
    } finally {
      setLoading(false);
    }
  }, [tenant, profile, isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = () => {
    setForm({ title: '', body: '' });
    setPdfFile(null);
    setShowModal(true);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      showToast('Only PDF or image files are allowed', 'error');
      e.target.value = '';
      return;
    }
    setPdfFile(file);
  };

  const save = async () => {
    if (!form.title.trim()) return showToast('Title is required', 'error');
    setSaving(true);
    try {
      const { error } = await createPolicy({
        tenantId: tenant.id,
        createdBy: profile.id,
        title: form.title.trim(),
        body: form.body.trim(),
        pdfFile,
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Policy rolled out', 'success');
      setShowModal(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this policy?')) return;
    const { error } = await deletePolicy(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Deleted', 'success');
    fetchData();
  };

  const handleAcknowledge = async (policy) => {
    setAcking(policy.id);
    const { error } = await acknowledgePolicy(policy.id, profile, tenant.id, policy.title);
    setAcking(null);
    if (error) return showToast('Failed to acknowledge: ' + error.message, 'error');
    const ackedAt = new Date().toISOString();
    setMyAcks((prev) => ({ ...prev, [policy.id]: ackedAt }));
    setAckCounts((prev) => ({ ...prev, [policy.id]: (prev[policy.id] || 0) + 1 }));
    showToast('Acknowledged', 'success');
  };

  const handleDownload = (policy) => {
    // Not awaited — the download itself must never wait on (or fail because of) the audit write.
    recordPolicyDownload(policy.id, profile.id, tenant.id);
  };

  const openAudit = async (policy) => {
    setAuditFilter('All');
    setAuditSearch('');
    setAudit({ policy, loading: true, employees: [], acks: {}, downloads: {} });
    const [{ data: employees }, { acks, downloads, error }] = await Promise.all([
      listColleagues(tenant.id),
      fetchPolicyAudit(policy.id),
    ]);
    if (error) {
      showToast('Failed to load acknowledgements: ' + error.message, 'error');
      setAudit(null);
      return;
    }
    setAudit({ policy, loading: false, employees, acks, downloads });
  };

  const auditRows = (() => {
    if (!audit || audit.loading) return [];
    const q = auditSearch.trim().toLowerCase();
    return audit.employees
      .map((emp) => ({ emp, ack: audit.acks[emp.id], dl: audit.downloads[emp.id] }))
      .filter(({ emp, ack, dl }) => {
        if (auditFilter === 'Acknowledged' && !ack) return false;
        if (auditFilter === 'Not Acknowledged' && ack) return false;
        if (auditFilter === 'Downloaded' && !dl) return false;
        if (!q) return true;
        return fullName(emp).toLowerCase().includes(q) || (emp.employee_id || '').toLowerCase().includes(q)
          || (emp.department || '').toLowerCase().includes(q);
      })
      // Pending first — that's who HR needs to chase.
      .sort((a, b) => (!!a.ack - !!b.ack) || fullName(a.emp).localeCompare(fullName(b.emp)));
  })();

  const auditCounts = audit && !audit.loading ? {
    total: audit.employees.length,
    acked: audit.employees.filter((e) => audit.acks[e.id]).length,
    ackedApp: audit.employees.filter((e) => audit.acks[e.id]?.source === 'app').length,
    downloaded: audit.employees.filter((e) => audit.downloads[e.id]).length,
  } : null;

  return (
    <>
      <Header title="Policies" breadcrumb="Company policy roll-outs" />
      <div className="page-content">
        {isAdmin && (
          <div className="filter-bar">
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn btn-primary" onClick={openModal}>
                <i className="fas fa-plus" /> Roll Out Policy
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : policies.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No policies yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {policies.map((p) => (
              <div className="card" key={p.id} style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px' }}>{p.title}</h3>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {p.author ? fullName(p.author) : 'Admin'} · {new Date(p.created_at).toLocaleString()}
                    </div>
                  </div>
                  {isAdmin && (
                    <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(p.id)}>
                      <i className="fas fa-trash" />
                    </button>
                  )}
                </div>
                {p.body && <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{p.body}</p>}
                {p.pdf_url && (
                  <div style={{ marginTop: 12 }}>
                    {isImageAttachment(p.pdf_name, p.pdf_url) && (
                      <a href={p.pdf_url} target="_blank" rel="noopener noreferrer" onClick={() => handleDownload(p)} style={{ display: 'inline-block', marginBottom: 8 }}>
                        <img src={p.pdf_url} alt={p.pdf_name || 'Policy photo'} style={{ maxWidth: 320, maxHeight: 220, borderRadius: 8, display: 'block' }} />
                      </a>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a className="btn btn-outline btn-sm" href={p.pdf_url} target="_blank" rel="noopener noreferrer" onClick={() => handleDownload(p)}>
                        <i className={`fas ${isImageAttachment(p.pdf_name, p.pdf_url) ? 'fa-image' : 'fa-file-pdf'}`} /> View{p.pdf_name ? ` — ${p.pdf_name}` : ''}
                      </a>
                      <a className="btn btn-outline btn-sm" href={downloadUrl(p.pdf_url, p.pdf_name)} onClick={() => handleDownload(p)}>
                        <i className="fas fa-download" /> Download
                      </a>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  {myAcks[p.id] ? (
                    <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                      <i className="fas fa-check-circle" /> Acknowledged on {new Date(myAcks[p.id]).toLocaleString()}
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={acking === p.id}
                      onClick={() => handleAcknowledge(p)}
                    >
                      <i className="fas fa-check" /> {acking === p.id ? 'Acknowledging…' : 'I have read & acknowledge'}
                    </button>
                  )}
                  {isAdmin && (
                    <button className="btn btn-outline btn-sm" onClick={() => openAudit(p)}>
                      <i className="fas fa-users" /> {ackCounts[p.id] || 0} acknowledged · View who
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="Roll Out Policy" width="520px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <i className="fas fa-check" /> {saving ? 'Posting…' : 'Post'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Policy PDF or Photo</label>
          <input
            ref={fileInputRef}
            className="form-input"
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange}
          />
          {pdfFile && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{pdfFile.name}</div>}
        </div>
      </Modal>

      <Modal show={!!audit} onClose={() => setAudit(null)}
        title={audit ? `Policy status — ${audit.policy.title}` : ''} width="760px"
        footer={<button className="btn btn-outline" onClick={() => setAudit(null)}>Close</button>}
      >
        {audit?.loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…
          </div>
        ) : audit && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 14 }}>
              {[
                ['Employees', auditCounts.total, 'var(--text)'],
                ['Acknowledged', auditCounts.acked, 'var(--success)'],
                ['Pending', auditCounts.total - auditCounts.acked, 'var(--warning)'],
                ['Via Phone', auditCounts.ackedApp, 'var(--primary)'],
                ['Downloaded', auditCounts.downloaded, 'var(--text)'],
              ].map(([label, value, color]) => (
                <div key={label} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
              {AUDIT_FILTERS.map((f) => (
                <button key={f} className={`btn btn-sm ${auditFilter === f ? 'btn-primary' : 'btn-outline'}`} onClick={() => setAuditFilter(f)}>{f}</button>
              ))}
              <input className="form-input" placeholder="Search name, EMP code, department…" value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)} style={{ maxWidth: 240, marginLeft: 'auto' }} />
            </div>
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Employee</th><th>Acknowledged</th><th>Downloaded</th></tr>
                </thead>
                <tbody>
                  {auditRows.length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No employees match</td></tr>
                  ) : auditRows.map(({ emp, ack, dl }) => (
                    <tr key={emp.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{fullName(emp)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {[emp.employee_id, emp.department].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {ack ? (
                          <span style={{ color: 'var(--success)' }}>
                            <i className="fas fa-check-circle" /> {fmtStamp(ack.acknowledged_at)}<SourceBadge source={ack.source} />
                          </span>
                        ) : <span className="badge badge-warning">Pending</span>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {dl ? (
                          <span><i className="fas fa-download" style={{ color: 'var(--text-muted)' }} /> {fmtStamp(dl.downloaded_at)}<SourceBadge source={dl.source} /></span>
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
