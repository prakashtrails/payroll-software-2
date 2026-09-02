-- "Multifencing": lets a tenant admin allow EVERY employee to clock in/out
-- from ANY of the company's outlets (not just their home outlet plus any
-- per-employee grants in profile_outlet_access — see 20260814_1). Geofencing
-- itself is unchanged: the employee still has to be physically inside one of
-- the outlets' fences, just not restricted to which outlet that is.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allow_any_outlet_clockin boolean NOT NULL DEFAULT false;
