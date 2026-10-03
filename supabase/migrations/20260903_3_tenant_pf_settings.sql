-- =============================================================
-- Per-tenant PF (Provident Fund) formula settings.
--
-- Problem: PF deduction was a single hardcoded formula for every tenant —
-- 12% of CTC when CTC <= Rs.15,000, else a flat Rs.1,800/month (see
-- calcPfEsic in src/lib/helpers.js). Real companies differ on their PF wage
-- ceiling and contribution rate (some voluntarily contribute above the
-- statutory Rs.15,000 ceiling, others use a different rate), so this needed
-- to be a tenant setting, not a code constant.
--
-- pf_wage_ceiling: the wage amount PF is calculated against once CTC exceeds
-- it (statutory default Rs.15,000). pf_employee_rate: the employee's PF
-- contribution rate as a percent of that wage (statutory default 12%). The
-- employer's contribution mirrors the same rate for payslip display purposes
-- (calcPfEsic / payrollService.processPayroll) -- it is shown info-only on
-- the payslip's PF statutory block, never deducted from the employee.
--
-- Defaults preserve the exact prior hardcoded behavior (15000 / 12%) so no
-- existing tenant's payroll changes until an admin explicitly adjusts it.
-- =============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pf_wage_ceiling  numeric NOT NULL DEFAULT 15000 CHECK (pf_wage_ceiling > 0),
  ADD COLUMN IF NOT EXISTS pf_employee_rate numeric NOT NULL DEFAULT 12    CHECK (pf_employee_rate > 0 AND pf_employee_rate <= 100);
