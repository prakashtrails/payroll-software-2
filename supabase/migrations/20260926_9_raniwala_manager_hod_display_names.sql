-- =============================================================
-- Raniwala: show every employee their Manager and HOD by name (26 Sep 2026).
--
-- manager_id / hod_id (set from HR's HOD.xlsx by 20260926_7/_8) cover everyone
-- whose manager/HOD is a real employee. The sheet also names people who have
-- no profile row: the owners "ABHISHEK SIR" / "ABHIYANT SIR" (deliberately
-- not created, see 20260926_7), and POOJA KHANDELWAL as HOD for four people
-- (she stays admin, not an HOD approver, see 20260926_8). These display-only
-- columns carry those names so the app/website can show them. They are
-- labels only: nothing routes approvals or notifications off them.
--
-- Shown only when the matching *_id is NULL; employees can't update profiles.
-- Matched by EMP CODE (unique codes only — 546/666/711 repeat in the sheet).
-- =============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS manager_display_name text,
  ADD COLUMN IF NOT EXISTS hod_display_name text;

COMMENT ON COLUMN profiles.manager_display_name IS
  'Display-only manager name for a manager with no profile row (e.g. ABHISHEK SIR). Used only when manager_id is NULL.';
COMMENT ON COLUMN profiles.hod_display_name IS
  'Display-only HOD name for an HOD with no HOD profile (e.g. ABHIYANT SIR). Used only when hod_id is NULL.';

WITH sheet(code, manager_name, hod_name) AS (VALUES
  ('240', NULL, 'ABHIYANT SIR'),
  ('451', NULL, 'ABHIYANT SIR'),
  ('82', NULL, 'ABHIYANT SIR'),
  ('302', NULL, 'ABHIYANT SIR'),
  ('81', NULL, 'ABHIYANT SIR'),
  ('444', NULL, 'ABHIYANT SIR'),
  ('94', NULL, 'ABHIYANT SIR'),
  ('394', NULL, 'ABHIYANT SIR'),
  ('253', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('1', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('2', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('3', NULL, 'ABHISHEK SIR'),
  ('7', NULL, 'ABHISHEK SIR'),
  ('14', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('15', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('21', NULL, 'ABHISHEK SIR'),
  ('25', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('56', NULL, 'ABHISHEK SIR'),
  ('60', 'ABHISHEK SIR', 'ABHIYANT SIR'),
  ('64', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('71', NULL, 'ABHIYANT SIR'),
  ('74', NULL, 'ABHIYANT SIR'),
  ('113', NULL, 'ABHISHEK SIR'),
  ('115', NULL, 'ABHISHEK SIR'),
  ('125', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('132', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('156', NULL, 'ABHISHEK SIR'),
  ('163', NULL, 'ABHIYANT SIR'),
  ('165', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('169', NULL, 'ABHISHEK SIR'),
  ('187', NULL, 'ABHISHEK SIR'),
  ('192', NULL, 'ABHIYANT SIR'),
  ('194', NULL, 'ABHIYANT SIR'),
  ('201', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('206', NULL, 'ABHISHEK SIR'),
  ('208', NULL, 'ABHISHEK SIR'),
  ('210', NULL, 'ABHISHEK SIR'),
  ('214', NULL, 'ABHISHEK SIR'),
  ('216', NULL, 'ABHISHEK SIR'),
  ('223', NULL, 'ABHISHEK SIR'),
  ('228', NULL, 'ABHISHEK SIR'),
  ('230', NULL, 'ABHISHEK SIR'),
  ('242', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('245', NULL, 'ABHISHEK SIR'),
  ('249', NULL, 'ABHISHEK SIR'),
  ('259', NULL, 'ABHISHEK SIR'),
  ('261', NULL, 'ABHISHEK SIR'),
  ('267', NULL, 'ABHISHEK SIR'),
  ('286', NULL, 'ABHIYANT SIR'),
  ('291', NULL, 'ABHIYANT SIR'),
  ('298', NULL, 'ABHISHEK SIR'),
  ('300', NULL, 'ABHISHEK SIR'),
  ('316', NULL, 'ABHISHEK SIR'),
  ('327', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('330', NULL, 'ABHIYANT SIR'),
  ('332', NULL, 'ABHISHEK SIR'),
  ('339', NULL, 'ABHISHEK SIR'),
  ('343', NULL, 'ABHISHEK SIR'),
  ('350', NULL, 'ABHIYANT SIR'),
  ('352', NULL, 'ABHISHEK SIR'),
  ('356', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('357', 'ABHISHEK SIR', 'ABHISHEK SIR'),
  ('360', NULL, 'ABHISHEK SIR'),
  ('363', NULL, 'ABHISHEK SIR'),
  ('365', 'POOJA KHANDELWAL', 'POOJA KHANDELWAL'),
  ('373', NULL, 'ABHISHEK SIR'),
  ('374', NULL, 'ABHIYANT SIR'),
  ('384', NULL, 'ABHISHEK SIR'),
  ('398', NULL, 'ABHISHEK SIR'),
  ('402', NULL, 'ABHISHEK SIR'),
  ('408', NULL, 'ABHISHEK SIR'),
  ('415', NULL, 'ABHIYANT SIR'),
  ('418', NULL, 'ABHISHEK SIR'),
  ('421', NULL, 'ABHIYANT SIR'),
  ('430', 'POOJA KHANDELWAL', 'POOJA KHANDELWAL'),
  ('437', NULL, 'ABHISHEK SIR'),
  ('440', NULL, 'ABHISHEK SIR'),
  ('441', NULL, 'ABHISHEK SIR'),
  ('446', NULL, 'ABHISHEK SIR'),
  ('447', NULL, 'ABHISHEK SIR'),
  ('450', 'POOJA KHANDELWAL', 'POOJA KHANDELWAL'),
  ('453', 'POOJA KHANDELWAL', 'POOJA KHANDELWAL'),
  ('455', NULL, 'ABHISHEK SIR'),
  ('457', NULL, 'ABHISHEK SIR'),
  ('458', NULL, 'ABHISHEK SIR'),
  ('459', NULL, 'ABHISHEK SIR'),
  ('462', NULL, 'ABHISHEK SIR')
)
UPDATE profiles p
SET manager_display_name = CASE WHEN p.manager_id IS NULL THEN s.manager_name ELSE p.manager_display_name END,
    hod_display_name     = CASE WHEN p.hod_id IS NULL THEN s.hod_name ELSE p.hod_display_name END
FROM sheet s, tenants t
WHERE t.id = p.tenant_id
  AND t.company_name ILIKE '%Raniwala%'
  AND p.employee_id = s.code;
