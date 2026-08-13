import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listPolicies, createPolicy, deletePolicy } from '@/services/policyService';
import { fullName } from '@/lib/helpers';

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

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data, error } = await listPolicies(tenant.id);
      if (error) showToast(error.message || 'Failed to load policies', 'error');
      setPolicies(data || []);
    } catch (err) {
      showToast(err.message || 'Failed to load policies', 'error');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = () => {
    setForm({ title: '', body: '' });
    setPdfFile(null);
    setShowModal(true);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      showToast('Only PDF files are allowed', 'error');
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
                  <a className="btn btn-outline btn-sm" style={{ marginTop: 12, display: 'inline-flex' }}
                    href={p.pdf_url} target="_blank" rel="noopener noreferrer">
                    <i className="fas fa-file-pdf" /> {p.pdf_name || 'View PDF'}
                  </a>
                )}
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
          <label className="form-label">Policy PDF</label>
          <input
            ref={fileInputRef}
            className="form-input"
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
          />
          {pdfFile && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{pdfFile.name}</div>}
        </div>
      </Modal>
    </>
  );
}
