-- Deleting a tenant that has ever appeared in a branch transfer (either as
-- the "from" or "to" branch) used to fail with a foreign key violation:
-- employee_transfers.from_tenant_id / to_tenant_id reference tenants(id)
-- with no ON DELETE action. Switch to SET NULL (not CASCADE) so the audit
-- row survives — it still shows the transfer happened — for whichever side
-- of the transfer still exists, instead of silently destroying history that
-- belongs to a tenant that wasn't deleted.
ALTER TABLE employee_transfers
  DROP CONSTRAINT IF EXISTS employee_transfers_from_tenant_id_fkey,
  DROP CONSTRAINT IF EXISTS employee_transfers_to_tenant_id_fkey;

ALTER TABLE employee_transfers
  ALTER COLUMN from_tenant_id DROP NOT NULL,
  ALTER COLUMN to_tenant_id   DROP NOT NULL;

ALTER TABLE employee_transfers
  ADD CONSTRAINT employee_transfers_from_tenant_id_fkey
    FOREIGN KEY (from_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  ADD CONSTRAINT employee_transfers_to_tenant_id_fkey
    FOREIGN KEY (to_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
