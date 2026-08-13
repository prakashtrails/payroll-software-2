import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  listReceivedFeedback, listGivenFeedback, listPendingRequests,
  giveFeedback, requestFeedback, respondToFeedbackRequest,
} from '@/services/feedbackService';
import { listActiveEmployees } from '@/services/employeeService';
import { fullName } from '@/lib/helpers';

const TYPE_BADGE = {
  praise: { label: 'Praise', cls: 'badge-success' },
  feedback: { label: 'Feedback', cls: 'badge-info' },
  request: { label: 'Requested', cls: 'badge-secondary' },
};

export function FeedbackContent() {
  const { tenant, profile } = useAuth();

  const [tab, setTab] = useState('received');
  const [received, setReceived] = useState([]);
  const [given, setGiven] = useState([]);
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showGiveModal, setShowGiveModal] = useState(false);
  const [giveForm, setGiveForm] = useState({ to_profile_id: '', type: 'praise', message: '', visibility: 'private' });
  const [savingGive, setSavingGive] = useState(false);

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({ requested_from: '' });
  const [savingRequest, setSavingRequest] = useState(false);

  const [responseDraft, setResponseDraft] = useState({});

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    setLoading(true);
    try {
      const [rRes, gRes, pRes, eRes] = await Promise.all([
        listReceivedFeedback(tenant.id, profile.id),
        listGivenFeedback(tenant.id, profile.id),
        listPendingRequests(tenant.id, profile.id),
        listActiveEmployees(tenant.id),
      ]);
      setReceived(rRes.data || []);
      setGiven(gRes.data || []);
      setRequests(pRes.data || []);
      setEmployees((eRes.data || []).filter((e) => e.id !== profile.id));
    } finally {
      setLoading(false);
    }
  }, [tenant, profile]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openGiveModal = () => {
    setGiveForm({ to_profile_id: '', type: 'praise', message: '', visibility: 'private' });
    setShowGiveModal(true);
  };

  const saveGive = async () => {
    if (!giveForm.to_profile_id) return showToast('Select who this feedback is for', 'error');
    if (!giveForm.message.trim()) return showToast('Message is required', 'error');
    setSavingGive(true);
    try {
      const { error } = await giveFeedback({
        tenantId: tenant.id,
        fromProfileId: profile.id,
        toProfileId: giveForm.to_profile_id,
        type: giveForm.type,
        message: giveForm.message.trim(),
        visibility: giveForm.visibility,
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Feedback sent', 'success');
      setShowGiveModal(false);
      fetchData();
    } finally {
      setSavingGive(false);
    }
  };

  const openRequestModal = () => {
    setRequestForm({ requested_from: '' });
    setShowRequestModal(true);
  };

  const saveRequest = async () => {
    if (!requestForm.requested_from) return showToast('Select who you want feedback from', 'error');
    setSavingRequest(true);
    try {
      const { error } = await requestFeedback({
        tenantId: tenant.id,
        createdBy: profile.id,
        toProfileId: profile.id,
        requestedFrom: requestForm.requested_from,
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Feedback requested', 'success');
      setShowRequestModal(false);
      fetchData();
    } finally {
      setSavingRequest(false);
    }
  };

  const respond = async (req) => {
    const message = (responseDraft[req.id] || '').trim();
    if (!message) return showToast('Write a response first', 'error');
    const { error } = await respondToFeedbackRequest(req.id, { fromProfileId: profile.id, message });
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Response submitted', 'success');
    fetchData();
  };

  const renderList = (items, emptyText) => (
    loading ? (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
      </div>
    ) : items.length === 0 ? (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{emptyText}</div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {items.map((f) => (
          <div className="card" key={f.id} style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{f.from_profile ? fullName(f.from_profile) : 'Someone'}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>→</span>
                  <strong>{f.to_profile ? fullName(f.to_profile) : ''}</strong>
                  <span className={`badge ${TYPE_BADGE[f.type]?.cls || 'badge-info'}`}>{TYPE_BADGE[f.type]?.label || f.type}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{new Date(f.created_at).toLocaleString()}</div>
              </div>
            </div>
            {f.message && <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{f.message}</p>}
          </div>
        ))}
      </div>
    )
  );

  return (
    <>
      <div className="page-content">
        <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {['received', 'given', 'requests'].map((t) => (
            <button
              key={t}
              className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`}
              style={{ borderRadius: '6px 6px 0 0' }}
              onClick={() => setTab(t)}
            >
              {t === 'received' ? 'Received' : t === 'given' ? 'Given' : `Requests${requests.length ? ` (${requests.length})` : ''}`}
            </button>
          ))}
        </div>

        <div className="filter-bar">
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={openRequestModal}>
              <i className="fas fa-hand-paper" /> Request Feedback
            </button>
            <button className="btn btn-primary" onClick={openGiveModal}>
              <i className="fas fa-plus" /> Give Feedback
            </button>
          </div>
        </div>

        {tab === 'received' && renderList(received, 'No feedback received yet')}
        {tab === 'given' && renderList(given, "You haven't given any feedback yet")}
        {tab === 'requests' && (
          loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
            </div>
          ) : requests.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No pending requests</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {requests.map((r) => (
                <div className="card" key={r.id} style={{ padding: 20 }}>
                  <div style={{ fontSize: 14 }}>
                    <strong>{r.to_profile ? fullName(r.to_profile) : 'Someone'}</strong> asked you for feedback
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{new Date(r.created_at).toLocaleString()}</div>
                  <textarea
                    className="form-input" rows={3} style={{ marginTop: 12 }}
                    placeholder="Write your feedback…"
                    value={responseDraft[r.id] || ''}
                    onChange={(e) => setResponseDraft({ ...responseDraft, [r.id]: e.target.value })}
                  />
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => respond(r)}>
                    <i className="fas fa-paper-plane" /> Submit
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <Modal show={showGiveModal} onClose={() => setShowGiveModal(false)} title="Give Feedback" width="520px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowGiveModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveGive} disabled={savingGive}>
            <i className="fas fa-check" /> {savingGive ? 'Sending…' : 'Send'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">To *</label>
          <select className="form-select" value={giveForm.to_profile_id} onChange={(e) => setGiveForm({ ...giveForm, to_profile_id: e.target.value })}>
            <option value="">Select</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-select" value={giveForm.type} onChange={(e) => setGiveForm({ ...giveForm, type: e.target.value })}>
            <option value="praise">Praise</option>
            <option value="feedback">Constructive Feedback</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Message *</label>
          <textarea className="form-input" rows={4} value={giveForm.message} onChange={(e) => setGiveForm({ ...giveForm, message: e.target.value })} />
        </div>
      </Modal>

      <Modal show={showRequestModal} onClose={() => setShowRequestModal(false)} title="Request Feedback" width="480px"
        footer={<>
          <button className="btn btn-outline" onClick={() => setShowRequestModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveRequest} disabled={savingRequest}>
            <i className="fas fa-check" /> {savingRequest ? 'Sending…' : 'Send Request'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">From *</label>
          <select className="form-select" value={requestForm.requested_from} onChange={(e) => setRequestForm({ ...requestForm, requested_from: e.target.value })}>
            <option value="">Select (HR or Manager)</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
          <div className="form-hint">They'll see this as a pending request under their Feedback → Requests tab.</div>
        </div>
      </Modal>
    </>
  );
}

export default function FeedbackPage() {
  return (
    <>
      <Header title="Feedback" breadcrumb="Give and receive praise and feedback" />
      <FeedbackContent />
    </>
  );
}
