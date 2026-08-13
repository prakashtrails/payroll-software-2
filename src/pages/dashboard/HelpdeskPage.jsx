import React, { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  TICKET_CATEGORIES, TICKET_PRIORITIES,
  listTenantTickets, createTicket, listTicketMessages, postMessage, updateTicketStatus,
} from '@/services/supportTicketService';
import { fullName, timeAgo } from '@/lib/helpers';

const STATUS_TABS = ['Open', 'In Progress', 'Resolved', 'Closed', 'All'];
const STATUS_BADGE = { Open: 'badge-warning', 'In Progress': 'badge-info', Resolved: 'badge-success', Closed: 'badge-purple' };
const PRIORITY_BADGE = { Low: 'badge-info', Medium: 'badge', High: 'badge-warning', Urgent: 'badge-danger' };

const EMPTY_FORM = { subject: '', category: TICKET_CATEGORIES[0], priority: 'Medium', description: '' };

function NewTicketModal({ show, onClose, onCreated }) {
  const { tenant, profile } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (show) setForm(EMPTY_FORM); }, [show]);

  const handleSave = async () => {
    if (!form.subject.trim()) return showToast('Subject is required', 'error');
    if (!form.description.trim()) return showToast('Please describe the issue', 'error');
    setSaving(true);
    const { error } = await createTicket({
      tenant_id: tenant.id,
      created_by: profile.id,
      subject: form.subject,
      category: form.category,
      priority: form.priority,
      description: form.description,
    });
    setSaving(false);
    if (error) return showToast('Failed to raise ticket: ' + error.message, 'error');
    showToast('Ticket raised — the support team has been notified', 'success');
    onCreated();
    onClose();
  };

  return (
    <Modal show={show} onClose={onClose} title="Raise a Ticket" width="520px"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Submitting…</> : <><i className="fas fa-paper-plane" /> Submit Ticket</>}
        </button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Subject *</label>
          <input className="form-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short summary of the issue" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category</label>
            <select className="form-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Description *</label>
          <textarea
            className="form-input" rows={5}
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe the issue in detail — what happened, what you expected, any steps to reproduce."
          />
        </div>
      </div>
    </Modal>
  );
}

function TicketDetailModal({ ticket, onClose, onChanged }) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    if (!ticket) return;
    setLoading(true);
    const { data, error } = await listTicketMessages(ticket.id);
    if (error) showToast('Failed to load thread: ' + error.message, 'error');
    else setMessages(data);
    setLoading(false);
  }, [ticket]);

  useEffect(() => { load(); setReply(''); }, [load]);

  const handleReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    const { error } = await postMessage({
      ticket_id: ticket.id, tenant_id: ticket.tenant_id, sender_id: profile.id,
      message: reply, senderRole: profile.role,
    });
    setSending(false);
    if (error) return showToast('Failed to send reply: ' + error.message, 'error');
    setReply('');
    load();
  };

  const toggleClose = async () => {
    const nextStatus = ticket.status === 'Closed' ? 'Open' : 'Closed';
    setUpdating(true);
    const { error } = await updateTicketStatus(ticket.id, nextStatus);
    setUpdating(false);
    if (error) return showToast('Failed to update ticket: ' + error.message, 'error');
    showToast(nextStatus === 'Closed' ? 'Ticket closed' : 'Ticket reopened', 'success');
    onChanged();
  };

  if (!ticket) return null;

  return (
    <Modal show={!!ticket} onClose={onClose} title={ticket.subject} width="600px"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
        <button className="btn btn-primary" onClick={toggleClose} disabled={updating}>
          {ticket.status === 'Closed' ? <><i className="fas fa-undo" /> Reopen Ticket</> : <><i className="fas fa-check" /> Close Ticket</>}
        </button>
      </>}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span className={`badge ${STATUS_BADGE[ticket.status] || 'badge'}`}>{ticket.status}</span>
        <span className={`badge ${PRIORITY_BADGE[ticket.priority] || 'badge'}`}>{ticket.priority}</span>
        <span className="badge badge-info">{ticket.category}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Raised {timeAgo(ticket.created_at)}</span>
      </div>

      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12, fontSize: 13, marginBottom: 14, whiteSpace: 'pre-wrap' }}>
        {ticket.description}
      </div>

      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>No replies yet.</div>
        ) : messages.map((m) => {
          const isSupport = m.sender?.role === 'superadmin';
          return (
            <div key={m.id} style={{
              alignSelf: isSupport ? 'flex-start' : 'flex-end',
              maxWidth: '85%', background: isSupport ? 'var(--primary-light)' : 'var(--bg)',
              borderRadius: 10, padding: '8px 12px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isSupport ? 'var(--primary)' : 'var(--text-muted)', marginBottom: 3 }}>
                {isSupport ? 'Support Team' : fullName(m.sender) || 'You'} · {timeAgo(m.created_at)}
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.message}</div>
            </div>
          );
        })}
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <textarea
          className="form-input" rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply…"
        />
        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={handleReply} disabled={sending || !reply.trim()}>
          {sending ? 'Sending…' : <><i className="fas fa-paper-plane" /> Send Reply</>}
        </button>
      </div>
    </Modal>
  );
}

export default function HelpdeskPage() {
  const { tenant } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('Open');
  const [showNew, setShowNew] = useState(false);
  const [detailTicket, setDetailTicket] = useState(null);

  const fetchTickets = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const { data, error } = await listTenantTickets(tenant.id, { status: statusFilter === 'All' ? '' : statusFilter });
    if (error) showToast('Failed to load tickets: ' + error.message, 'error');
    else setTickets(data);
    setLoading(false);
  }, [tenant, statusFilter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const openTicket = (t) => setDetailTicket(t);
  const handleChanged = () => { fetchTickets(); setDetailTicket(null); };

  return (
    <>
      <Header
        title="Helpdesk"
        breadcrumb="Dashboard / Helpdesk"
        actions={<button className="btn btn-primary" onClick={() => setShowNew(true)}><i className="fas fa-plus" /> New Ticket</button>}
      />

      <div className="page-content">
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>
              Tickets
              {tickets.length > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>({tickets.length})</span>}
            </h3>
            <div className="flex gap-1">
              {STATUS_TABS.map((s) => (
                <button
                  key={s}
                  className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Raised</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
                ) : tickets.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No tickets found.</td></tr>
                ) : tickets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.subject}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>
                    </td>
                    <td><span className="badge badge-info">{t.category}</span></td>
                    <td><span className={`badge ${PRIORITY_BADGE[t.priority] || 'badge'}`}>{t.priority}</span></td>
                    <td><span className={`badge ${STATUS_BADGE[t.status] || 'badge'}`}>{t.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(t.created_at)}</td>
                    <td>
                      <button className="btn btn-sm btn-outline" onClick={() => openTicket(t)}>
                        <i className="fas fa-comments" /> View / Reply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <NewTicketModal show={showNew} onClose={() => setShowNew(false)} onCreated={fetchTickets} />
      <TicketDetailModal ticket={detailTicket} onClose={() => setDetailTicket(null)} onChanged={handleChanged} />
    </>
  );
}
