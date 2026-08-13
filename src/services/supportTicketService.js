import { supabase } from '@/lib/supabase';

export const TICKET_CATEGORIES = [
  'Payroll', 'Attendance', 'Leave & Approvals', 'Employee Records',
  'Compliance', 'Technical / Access', 'Other',
];

export const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

/** Raises a new ticket — RLS requires the caller to be the tenant's admin and created_by = self. */
export async function createTicket({ tenant_id, created_by, subject, category, priority, description }) {
  const { data, error } = await supabase
    .from('support_tickets')
    .insert([{ tenant_id, created_by, subject: subject.trim(), category, priority, description: description.trim() }])
    .select()
    .single();
  return { data, error };
}

/** HR's own tenant ticket list, newest first, optionally filtered by status. */
export async function listTenantTickets(tenantId, { status = '' } = {}) {
  let q = supabase
    .from('support_tickets')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function fetchTicket(ticketId) {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*, tenants(company_name)')
    .eq('id', ticketId)
    .maybeSingle();
  return { data, error };
}

/** Reply thread for a ticket, oldest first. */
export async function listTicketMessages(ticketId) {
  const { data, error } = await supabase
    .from('support_ticket_messages')
    .select('*, sender:profiles!support_ticket_messages_sender_id_fkey(first_name, last_name, role)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

/**
 * Posts a reply. When the superadmin (support side) replies to a still-Open
 * ticket, also flips it to 'In Progress' — a small convenience transition
 * done here rather than a DB trigger, since no generic trigger convention
 * exists elsewhere in this schema.
 */
export async function postMessage({ ticket_id, tenant_id, sender_id, message, senderRole }) {
  const { data, error } = await supabase
    .from('support_ticket_messages')
    .insert([{ ticket_id, tenant_id, sender_id, message: message.trim() }])
    .select()
    .single();
  if (error) return { data, error };

  if (senderRole === 'superadmin') {
    await supabase
      .from('support_tickets')
      .update({ status: 'In Progress' })
      .eq('id', ticket_id)
      .eq('status', 'Open');
  }

  return { data, error: null };
}

export async function updateTicketStatus(ticketId, status) {
  const { error } = await supabase
    .from('support_tickets')
    .update({ status, resolved_at: ['Resolved', 'Closed'].includes(status) ? new Date().toISOString() : null })
    .eq('id', ticketId);
  return { error };
}
