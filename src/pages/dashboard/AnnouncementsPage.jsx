import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listAnnouncements, createAnnouncement, deleteAnnouncement } from '@/services/announcementService';
import { fullName } from '@/lib/helpers';

export default function AnnouncementsPage() {
  const { tenant, profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin';

  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showModal, setShowModal]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [form, setForm]                   = useState({ title: '', body: '' });

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data, error } = await listAnnouncements(tenant.id);
      if (error) showToast(error.message || 'Failed to load announcements', 'error');
      setAnnouncements(data || []);
    } catch (err) {
      showToast(err.message || 'Failed to load announcements', 'error');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = () => {
    setForm({ title: '', body: '' });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) return showToast('Title is required', 'error');
    setSaving(true);
    try {
      const { error } = await createAnnouncement({
        tenantId: tenant.id,
        createdBy: profile.id,
        title: form.title.trim(),
        body: form.body.trim(),
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Announcement posted', 'success');
      setShowModal(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    const { error } = await deleteAnnouncement(id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Deleted', 'success');
    fetchData();
  };

  return (
    <>
      <Header title="Announcements" breadcrumb="Company-wide announcements" />
      <div className="page-content">
        {isAdmin && (
          <div className="filter-bar">
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn btn-primary" onClick={openModal}>
                <i className="fas fa-plus" /> New Announcement
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : announcements.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No announcements yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {announcements.map((a) => (
              <div className="card" key={a.id} style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px' }}>{a.title}</h3>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {a.author ? fullName(a.author) : 'Admin'} · {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                  {isAdmin && (
                    <button className="btn btn-outline btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(a.id)}>
                      <i className="fas fa-trash" />
                    </button>
                  )}
                </div>
                {a.body && <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{a.body}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)} title="New Announcement" width="520px"
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
          <label className="form-label">Message</label>
          <textarea className="form-input" rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
