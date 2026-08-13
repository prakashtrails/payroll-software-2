import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listAllTickets, PLATFORM_TICKET_PAGE_SIZE } from '@/services/platformService';
import { listAllTenants } from '@/services/tenantService';
import {
  fetchTicket, listTicketMessages, postMessage, updateTicketStatus,
} from '@/services/supportTicketService';
import { fullName, timeAgo } from '@/lib/helpers';

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const STATUS_BADGE = { Open: 'badge-warning', 'In Progress': 'badge-info', Resolved: 'badge-success', Closed: 'badge-purple' };
const PRIORITY_BADGE = { Low: 'badge-info', Medium: 'badge', High: 'badge-warning', Urgent: 'badge-danger' };

function TicketDetailModal({ ticketId, onClose, onChanged }) {
  const { profile } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    const [{ data: t, error: tErr }, { data: msgs, error: mErr }] = await Promise.all([
      fetchTicket(ticketId),
      listTicketMessages(ticketId),
    ]);
    if (tErr) showToast('Failed to load ticket: ' + tErr.message, 'error');
    else setTicket(t);
    if (mErr) showToast('Failed to load thread: ' + mErr.message, 'error');
    else setMessages(msgs);
    setLoading(false);
  }, [ticketId]);

  useEffect(() => { load(); setReply(''); }, [load]);

  const handleReply = async () => {
    if (!reply.trim() || !ticket) return;
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

  const handleStatusChange = async (status) => {
    if (!ticket) return;
    setUpdatingStatus(true);
    const { error } = await updateTicketStatus(ticket.id, status);
    setUpdatingStatus(false);
    if (error) return showToast('Failed to update status: ' + error.message, 'error');
    showToast(`Ticket marked ${status}`, 'success');
    setTicket({ ...ticket, status });
    onChanged();
  };

  if (!ticketId) return null;

  return (
    <Modal show={!!ticketId} onClose={onClose} title={ticket?.subject || 'Ticket'} width="640px"
      footer={<button className="btn btn-outline" onClick={onClose}>Close</button>}
    >
      {loading && !ticket ? (
        <div style={{ textAlign: 'center', padding: 32 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : !ticket ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Ticket not found.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge badge-info">{ticket.tenants?.company_name || '—'}</span>
            <span className={`badge ${PRIORITY_BADGE[ticket.priority] || 'badge'}`}>{ticket.priority}</span>
            <span className="badge badge-info">{ticket.category}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Raised {timeAgo(ticket.created_at)}</span>
          </div>

          <div className="form-group" style={{ marginBottom: 14, maxWidth: 220 }}>
            <label className="form-label">Status</label>
            <select
              className="form-select" value={ticket.status} disabled={updatingStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12, fontSize: 13, marginBottom: 14, whiteSpace: 'pre-wrap' }}>
            {ticket.description}
          </div>

          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>No replies yet.</div>
            ) : messages.map((m) => {
              const isSupport = m.sender?.role === 'superadmin';
              return (
                <div key={m.id} style={{
                  alignSelf: isSupport ? 'flex-end' : 'flex-start',
                  maxWidth: '85%', background: isSupport ? 'var(--primary-light)' : 'var(--bg)',
                  borderRadius: 10, padding: '8px 12px',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: isSupport ? 'var(--primary)' : 'var(--text-muted)', marginBottom: 3 }}>
                    {isSupport ? 'You (Support)' : `${fullName(m.sender) || 'HR'} · ${m.sender?.role || ''}`} · {timeAgo(m.created_at)}
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.message}</div>
                </div>
              );
            })}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <textarea
              className="form-input" rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to this company's HR…"
            />
            <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={handleReply} disabled={sending || !reply.trim()}>
              {sending ? 'Sending…' : <><i className="fas fa-paper-plane" /> Send Reply</>}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function HelpdeskAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tenants, setTenants] = useState([]);
  const [tenantFilter, setTenantFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tickets, setTickets] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const totalPages = Math.max(1, Math.ceil(totalCount / PLATFORM_TICKET_PAGE_SIZE));

  const detailTicketId = searchParams.get('ticket');
  const setDetailTicketId = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('ticket', id); else next.delete('ticket');
    setSearchParams(next);
  };

  useEffect(() => {
    listAllTenants().then(({ data, error }) => {
      if (error) showToast('Failed to load companies', 'error');
      setTenants(data || []);
    });
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data, count, error }, { count: openCnt, error: openErr }] = await Promise.all([
        listAllTickets({ page, status: statusFilter, tenantId: tenantFilter, search }),
        listAllTickets({ page: 1, status: 'Open' }),
      ]);
      if (error) showToast('Failed to load tickets: ' + error.message, 'error');
      else { setTickets(data); setTotalCount(count); }
      if (!openErr) setOpenCount(openCnt);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, tenantFilter, search]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);
  useEffect(() => { setPage(1); }, [statusFilter, tenantFilter, search]);

  return (
    <>
      <Header title="Helpdesk" breadcrumb={`${openCount} open ticket${openCount !== 1 ? 's' : ''} across the platform`} />

      <div className="page-content">
        <div className="stats-row" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <StatCard icon="fa-envelope-open-text" iconColor="orange" value={openCount} label="Open" />
          <StatCard icon="fa-spinner" iconColor="blue" value={tickets.filter(t => t.status === 'In Progress').length} label="In Progress (this page)" />
          <StatCard icon="fa-check-circle" iconColor="green" value={tickets.filter(t => t.status === 'Resolved').length} label="Resolved (this page)" />
          <StatCard icon="fa-inbox" iconColor="purple" value={totalCount} label="Total Tickets" />
        </div>

        <div className="filter-bar">
          <select className="form-select" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
            <option value="">All Companies</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.company_name}</option>)}
          </select>
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            className="form-input" placeholder="🔍 Search subject…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
          />
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading tickets…
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Company</th><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Raised By</th><th>Raised</th><th></th></tr>
                </thead>
                <tbody>
                  {tickets.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No tickets match your filters.</td></tr>
                  ) : tickets.map((t) => (
                    <tr key={t.id}>
                      <td>{t.tenants?.company_name || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{t.subject}</td>
                      <td><span className="badge badge-info">{t.category}</span></td>
                      <td><span className={`badge ${PRIORITY_BADGE[t.priority] || 'badge'}`}>{t.priority}</span></td>
                      <td><span className={`badge ${STATUS_BADGE[t.status] || 'badge'}`}>{t.status}</span></td>
                      <td style={{ fontSize: 12 }}>{fullName(t.created_by_profile) || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(t.created_at)}</td>
                      <td>
                        <button className="btn btn-sm btn-outline" onClick={() => setDetailTicketId(t.id)}>
                          <i className="fas fa-comments" /> Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          </div>
        )}
      </div>

      <TicketDetailModal
        ticketId={detailTicketId}
        onClose={() => setDetailTicketId(null)}
        onChanged={fetchTickets}
      />
    </>
  );
}
