-- Add actual overtime minutes worked field for the Salary Overtime request type
ALTER TABLE special_requests ADD COLUMN IF NOT EXISTS overtime_minutes integer;

-- Store calculated overtime pay (computed at submission, referenced at payroll time)
ALTER TABLE special_requests ADD COLUMN IF NOT EXISTS overtime_pay numeric(12,2) DEFAULT 0;
