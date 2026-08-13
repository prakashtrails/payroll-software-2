-- Same class of bug as 20260726_tenant_delete_fk_fix.sql, different columns:
-- every "who approved/reviewed/created this" audit column below references
-- profiles(id) with no ON DELETE action. Because this app allows cross-
-- tenant approvals (managers approving requests for another branch in the
-- same group — see 20260614_request_routing.sql), a row can belong to a
-- tenant that ISN'T being deleted while its actor column points at a
-- profile in a tenant that IS — e.g. leave_requests.approved_by, which is
-- exactly what broke company deletion:
--   "update or delete on table profiles violates foreign key constraint
--    leave_requests_approved_by_fkey"
-- Fixed the same way: SET NULL, not CASCADE, so the row (and the fact that
-- someone approved/reviewed/created it) survives; only the now-dangling
-- "who" reference is cleared.

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_approved_by_fkey;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE regularize_requests
  DROP CONSTRAINT IF EXISTS regularize_requests_reviewed_by_fkey;
ALTER TABLE regularize_requests
  ADD CONSTRAINT regularize_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE special_requests
  DROP CONSTRAINT IF EXISTS special_requests_approved_by_fkey;
ALTER TABLE special_requests
  ADD CONSTRAINT special_requests_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE employee_transfers
  DROP CONSTRAINT IF EXISTS employee_transfers_transferred_by_fkey;
ALTER TABLE employee_transfers
  ADD CONSTRAINT employee_transfers_transferred_by_fkey
    FOREIGN KEY (transferred_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE employee_promotions
  DROP CONSTRAINT IF EXISTS employee_promotions_created_by_fkey;
ALTER TABLE employee_promotions
  ADD CONSTRAINT employee_promotions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_created_by_fkey;
ALTER TABLE announcements
  ADD CONSTRAINT announcements_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE policies
  DROP CONSTRAINT IF EXISTS policies_created_by_fkey;
ALTER TABLE policies
  ADD CONSTRAINT policies_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
