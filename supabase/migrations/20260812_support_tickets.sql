-- Helpdesk: HR (admin) raises tickets against their own company; superadmin
-- (the platform's support contact) sees and manages every ticket across every
-- tenant. Ticket content isn't sensitive payroll data, so — unlike the
-- platform-analytics RPC — superadmin gets a direct RLS bypass here, mirroring
-- the existing tenants/profiles/outlets precedent in 20260725_super_admin_platform.sql.

CREATE TABLE IF NOT EXISTS support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  subject     text NOT NULL,
  category    text NOT NULL CHECK (category IN (
                'Payroll', 'Attendance', 'Leave & Approvals', 'Employee Records',
                'Compliance', 'Technical / Access', 'Other'
              )),
  priority    text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Urgent')),
  description text NOT NULL,
  status      text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved','Closed')),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant     ON support_tickets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_by ON support_tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status     ON support_tickets(status);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id, created_at);

ALTER TABLE support_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- ---- support_tickets ----
CREATE POLICY "support_tickets: superadmin full access"
  ON support_tickets FOR ALL
  USING ((select my_role()) = 'superadmin')
  WITH CHECK ((select my_role()) = 'superadmin');

CREATE POLICY "support_tickets: admin sees own tenant"
  ON support_tickets FOR SELECT
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) = 'admin');

CREATE POLICY "support_tickets: admin can raise"
  ON support_tickets FOR INSERT
  WITH CHECK (
    tenant_id  = (select my_tenant_id())
    AND (select my_role()) = 'admin'
    AND created_by = (select auth.uid())
  );

CREATE POLICY "support_tickets: admin can update own tenant"
  ON support_tickets FOR UPDATE
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) = 'admin')
  WITH CHECK (tenant_id = (select my_tenant_id()) AND (select my_role()) = 'admin');

-- ---- support_ticket_messages ----
CREATE POLICY "support_ticket_messages: superadmin full access"
  ON support_ticket_messages FOR ALL
  USING ((select my_role()) = 'superadmin')
  WITH CHECK ((select my_role()) = 'superadmin');

CREATE POLICY "support_ticket_messages: admin sees own tenant"
  ON support_ticket_messages FOR SELECT
  USING (tenant_id = (select my_tenant_id()) AND (select my_role()) = 'admin');

CREATE POLICY "support_ticket_messages: admin can reply own tenant"
  ON support_ticket_messages FOR INSERT
  WITH CHECK (
    tenant_id = (select my_tenant_id())
    AND (select my_role()) = 'admin'
    AND sender_id = (select auth.uid())
  );
-- No UPDATE/DELETE policy on messages for either role — an immutable thread,
-- same as attendance_audit_log (insert + select only).
