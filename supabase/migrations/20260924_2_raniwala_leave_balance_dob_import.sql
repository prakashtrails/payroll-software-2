-- =============================================================
-- One-time HR data import for Raniwala Jewellers: opening Earned Leave
-- balances + Date of Birth, sourced from HR's "Leave Balance as on 19 Sep
-- and Date of Birth.xlsx" (265 rows, 19 Sep 2026 snapshot). Must run after
-- 20260924_1_raniwala_leave_types_policy.sql, which creates the 'Earned
-- Leave' leave_types row this migration allocates against.
--
-- Source-data cleanup applied before generating the VALUES below (done in
-- Python against the raw sheet, not in SQL):
--   - 4 fully-blank placeholder rows (EMP CODE/Balance/DOB all empty,
--     names like "AANAND CONTRACT") dropped -- nothing to import.
--   - 1 exact duplicate row (EMP CODE 711, CHETAN GOENKA, appeared twice
--     with identical balance) de-duplicated to a single row.
--   - 2 rows had un-usable Date of Birth values and are imported with a
--     NULL dob instead (flagged here, not silently trusted):
--       EMP CODE 439 AAKASH DOLKA      -- source cell literally '#N/A'
--       EMP CODE 429 AMBA DUTT         -- source cell was a bare time
--                                         value / 1900-01-01 artifact,
--                                         not a plausible birth date
--   - Everything else (dates stored as text like '15-07-1998', negative
--     balances, etc.) was parsed/kept as-is -- a negative balance is a
--     legitimate over-utilised Earned Leave position, not bad data.
--
-- Matching a sheet row to a profiles row, per employee:
--   1. Primary: profiles.employee_id = EMP CODE (text), scoped to the
--      Raniwala tenant -- but ONLY when that EMP CODE is unambiguous
--      within the sheet itself. Three codes are reused across different
--      people in the source file (546: 2 different names; 666: 5
--      different names) -- those codes are excluded from code-matching
--      entirely and fall through to name-matching instead, so no one
--      risks getting another employee's balance/DOB.
--   2. Fallback (and sole method for the ambiguous-code rows above):
--      exact, case-insensitive, whitespace-normalised match against
--      profiles.first_name || middle_name || last_name.
--   3. Zero matches or more than one match -> the row is SKIPPED and
--      reported via RAISE NOTICE (visible in the Supabase SQL editor
--      output) rather than guessed at. Re-run this migration after
--      fixing profiles.employee_id / names to pick up any stragglers --
--      it's idempotent (see guards below).
--
-- Applied per matched row:
--   - profiles.date_of_birth := sheet DOB, whenever the sheet has one
--     (overwrites any existing value -- this sheet is HR's current
--     source of truth). Untouched when the sheet's DOB is NULL.
--   - One 'Allocation' entry on leave_ledger for Earned Leave, dated
--     2026-09-19 (the sheet's "as on" date), equal to the sheet's
--     balance -- an OPENING balance, per user decision, since Earned
--     Leave is a brand-new leave_types row for Raniwala with no prior
--     ledger history to conflict with. Guarded by a NOT EXISTS check on
--     this note so re-running the migration never double-credits.
-- =============================================================

DO $$
DECLARE
  v_tenant       uuid;
  v_leave_type   uuid;
  v_row          RECORD;
  v_profile      uuid;
  v_match_count  int;
  v_matched      int := 0;
  v_skipped      int := 0;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE company_name ILIKE '%Raniwala%';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Raniwala Jewellers tenant not found (name ILIKE %%Raniwala%%) -- aborting, nothing changed';
  END IF;

  SELECT id INTO v_leave_type FROM leave_types WHERE tenant_id = v_tenant AND name = 'Earned Leave';
  IF v_leave_type IS NULL THEN
    RAISE EXCEPTION 'Raniwala "Earned Leave" leave_types row not found -- run 20260924_1_raniwala_leave_types_policy.sql first';
  END IF;

  CREATE TEMP TABLE raw_import (
    emp_code      int,
    full_name     text,
    leave_balance numeric,
    dob           date
  ) ON COMMIT DROP;

  INSERT INTO raw_import (emp_code, full_name, leave_balance, dob) VALUES
  (253, 'ARZOO JAIMINY', 36.5, '1991-06-26'),
  (449, 'DHAVAL BHAVESHKUMAR TRIVEDI', 3.5, '1991-08-20'),
  (1, 'GUNJAN SHARMA', 4.5, '1982-04-18'),
  (2, 'GANESH CHAND SHARMA', 16.5, '1978-03-19'),
  (3, 'RAJESH JAIN', 3, '1995-06-16'),
  (7, 'MOHAN LAL SHARMA', 6.5, '1971-05-21'),
  (14, 'PUSHPA JHA', 3.5, '1987-11-15'),
  (15, 'KANHAIYA LAL KUMAWAT', 15.5, '1984-07-15'),
  (21, 'MUKESH KUMAR CHOUDHARY', 4.5, '1993-09-13'),
  (25, 'MOHIT PAREEK', 26, '1990-01-01'),
  (56, 'MONIKA KASUMBHIWAL', 10.5, '1994-08-08'),
  (60, 'AMIT SARDANA', 1.5, '1981-09-15'),
  (64, 'PUSHPENDRA SINGH RAJPUT', 22, '1992-07-08'),
  (71, 'SHREEJA MAHASANI', 21, '1980-10-12'),
  (74, 'TARUN SHARMA', 8, '1988-02-11'),
  (78, 'ANUJ PAREEK', 10, '1991-06-26'),
  (113, 'NARENDRA GAUTAM', 4, '1995-12-22'),
  (115, 'SHANKAR LAL PARASHAR', 3.5, '1988-08-30'),
  (125, 'BHANU JAIN', 5, '1989-08-14'),
  (132, 'GAURAV KESHWANI', 2.5, '2001-09-28'),
  (138, 'SHIPRA SRIVASTAVA', 12, '1992-03-13'),
  (144, 'JAIDEEP MEHRA', 1, '1987-12-24'),
  (156, 'GYAN CHAND PALIWAL', 15.5, '1977-07-14'),
  (163, 'RAM KISHORE SHARMA', 25, '1990-11-03'),
  (165, 'BOSKY SHARMA', 2.5, '1984-01-06'),
  (169, 'KUSHAGRA SINGH', 17, '2001-01-08'),
  (171, 'SUMIT CHANGIL', 3.5, '2001-08-25'),
  (184, 'VIKAS SINGH', 2.5, '1993-02-16'),
  (187, 'SIDDHARTH AJMERA', 4.5, '1987-04-09'),
  (192, 'LOKESH SAHU', 24.5, '1996-09-02'),
  (194, 'BHANWAR SINGH SHEKHAWAT', 9, '1989-07-10'),
  (201, 'UMA SONI', 0, '1984-03-01'),
  (206, 'SUHAIL TARIQ', -1.5, '1988-11-15'),
  (208, 'AJAY CHOMAL', 5.5, '1991-07-16'),
  (210, 'JITENDRA KUMAR SHARMA', 4, '1987-05-06'),
  (214, 'TOFFIK KHAN', 3.5, '1999-03-03'),
  (216, 'DILEEP SINGH', 2, '1995-07-01'),
  (220, 'BHAVNA SHARMA', 7.5, '1982-08-02'),
  (223, 'HARSH PALIWAL', 2.5, '1998-08-24'),
  (228, 'PRASHANT SINGH GAUR', -3, '2002-05-22'),
  (230, 'PUJA KUMARI', -2.5, '1997-07-18'),
  (232, 'RAM JEEVAN MEENA', 2, '2001-02-25'),
  (237, 'YOGENDRA SINGH CHOUHAN', 3.5, '2001-04-10'),
  (241, 'LOKESH BAIRWA', 4, '1999-07-04'),
  (242, 'NITESH TIWARI', 12, '1980-10-10'),
  (245, 'MANOJ KUMAR', 10, '1996-06-24'),
  (249, 'ABHINAV SINGH', 3, '2002-11-23'),
  (255, 'RAKSHITA JAIN', 20.5, '2003-02-21'),
  (259, 'MUKESH SHARMA', 3, '1999-07-01'),
  (261, 'RADHE SHYAM SHARMA', 20, '1988-07-06'),
  (262, 'NEHA SONI', 3, '2003-04-20'),
  (267, 'DOLLY SHARMA', 2.5, '1999-11-27'),
  (268, 'MAHAK PARVEEN', 3, '2002-06-17'),
  (280, 'DEEPAK CHOUDHARY', -1.5, '2002-03-07'),
  (282, 'KHUSHBOO MEENA', 8, '1995-10-29'),
  (286, 'SEEMA JANGID', 2.5, '1996-08-28'),
  (291, 'RAHUL TRIVEDI', 2.5, '1988-01-13'),
  (298, 'YUKTI SONI', -2.5, '2002-09-14'),
  (300, 'RAJUL JAIN', -2.5, '1999-07-26'),
  (305, 'EKTA RATHORE', 12.5, '2001-10-09'),
  (306, 'PUSHPENDRA VERMA', 6.5, '1997-04-21'),
  (310, 'DIVYA ASWANI', 0, '2002-03-15'),
  (316, 'YUVRAJ SINGH', 1.5, '2005-07-10'),
  (319, 'RIYA YADAV', 2.5, '1997-12-24'),
  (320, 'SUNIL KUMAR BAIRWA', 5.5, '1996-05-05'),
  (327, 'DIVYA BAID', -1.5, '2000-08-18'),
  (330, 'PRAGATI TIWARI', 3, '1992-11-18'),
  (332, 'REKHA LAXKAR', 9, '1996-12-18'),
  (336, 'ABHISHEK KUMAR SONI', 4.5, '1995-07-30'),
  (339, 'PRATIBHA VASHISHTHA', 3.5, '1988-08-10'),
  (343, 'BHUMIKA SHARMA', 5.5, '1988-12-11'),
  (346, 'SHRWAN KUMAR SONI', 1.5, '1966-07-15'),
  (350, 'VINAYAK HARIT', 1, '2000-12-22'),
  (352, 'SHRI KRISHAN SHARMA', 6, '1991-11-26'),
  (353, 'PRINCY TANK', 3, '2004-03-09'),
  (356, 'IMRAN NASIR KHAN', -3.5, '1987-01-25'),
  (357, 'POOJA KHANDELWAL', 11, '1983-01-13'),
  (360, 'BHAVYA GARG', 2, '2002-10-12'),
  (363, 'MUKESH SINGH', -1.5, '1999-01-01'),
  (364, 'POONAM BHAT', 3, '1997-01-21'),
  (365, 'HIMANSHI', 3, '2001-10-12'),
  (373, 'VISHAL YADAV', -1.5, '1995-11-01'),
  (374, 'VASUNDHARA SHARMA', -1.5, '1993-07-16'),
  (384, 'KAPIL KUMAR VERMA', 2.5, '1995-06-01'),
  (386, 'SURESH CHAND KUMAWAT', 5.5, '2003-10-05'),
  (388, 'NIKITA PARMANI', 7, '2002-04-28'),
  (398, 'LIZA THAKWANI', 2.5, '2004-10-01'),
  (401, 'AMAN BISWAS', 7, '2003-06-03'),
  (402, 'RAVI KUMAR', 10, '1998-10-02'),
  (406, 'LALLU RAM', 6, '1996-08-07'),
  (408, 'AYUSH AGARWAL', -0.5, '2004-02-10'),
  (413, 'GUNGUN AGARWAL', 2, '2004-06-27'),
  (414, 'SAGAR BHATIA', 3, '2004-10-21'),
  (415, 'MANISH MISHRA', 6, '1988-06-24'),
  (417, 'DEEPAK KUMAR', 6.5, '2002-07-20'),
  (418, 'VARSHA SONI', 3.5, '1999-07-10'),
  (420, 'LALIT SAINI', 2, '2004-07-25'),
  (421, 'GAYATRI KUMAWAT', -0.5, '1995-12-08'),
  (424, 'RAHUL VERMA', 1.5, '1999-10-02'),
  (425, 'PRAVEEN KUMAR', 3.5, '2000-09-20'),
  (429, 'AMBA DUTT', 6, NULL),
  (433, 'GAJENDRA KUMAWAT', 1, '2002-11-12'),
  (437, 'TARUN PRAJAPAT', 3.5, '1998-05-11'),
  (440, 'NAMAN KHANDELWAL', 0, '1999-11-13'),
  (441, 'GEETA SINGH', 1.5, '1996-07-26'),
  (443, 'AMISHI VIJAY', 0.5, '1969-02-22'),
  (446, 'NIHARIKA JAMAR', 4, '2003-01-31'),
  (447, 'VARUN GANGAWAT', 4, '2005-07-06'),
  (448, 'DEVIKA SATHEESH K', -0.5, '1991-08-20'),
  (450, 'VANSHIKA GAUR', 2, '1989-10-23'),
  (452, 'JITENDRA JATAV', -1.5, '1999-08-11'),
  (453, 'RISHAB CHAUDHARY', 0, '1998-07-15'),
  (454, 'PANKAJ DAS', 3, '1998-07-15'),
  (455, 'KANISHK AGARWAL', 0.5, '1999-05-17'),
  (457, 'ASTHA TIBREWAL', 0.5, '2001-03-28'),
  (458, 'RISHITA BALDOTA', 1.5, '2004-07-09'),
  (459, 'MOHIT KUMAR JANGID', 0.5, '2000-09-25'),
  (462, 'RAHUL JANGID', 1.5, '2005-11-19'),
  (539, 'RAHUL KUMAWAT', 2.5, '2003-10-10'),
  (394, 'RITIK JAIN', 10, '1998-11-17'),
  (94, 'NARENDRA ASNANI', 20, '1982-03-15'),
  (81, 'AMEY PALAV', 8, '1981-06-23'),
  (442, 'AFZAL ANWAR SHEIKH', 2, '1973-09-11'),
  (444, 'SAJEEV THANKAPPAN KAZHANCHI', 0.5, '1987-07-21'),
  (200, 'PAVAN LONE', 10.5, '1998-06-23'),
  (302, 'RAHUL SETHIA', 7.5, '1992-12-15'),
  (435, 'YASH VERMA', 8.5, '2000-07-14'),
  (460, 'FARHEEN SAIFI', 1.5, '2004-07-25'),
  (461, 'PAWAN SHARMA', 1.5, '1981-02-02'),
  (82, 'MEHUL CHANDULAL VITHLANI', 18, '1966-09-14'),
  (18, 'BUDHEE PRAKASH BAIRWA', 9, NULL),
  (49, 'JOGENDRA SINGH', 0.5, NULL),
  (59, 'LOKENDRA BABU', 10, NULL),
  (62, 'SOURAV DAS', 0.5, NULL),
  (65, 'MAHENDRA SINGH KISHNAWAT', 0.5, NULL),
  (77, 'BABU LAL YADAV', 1.5, NULL),
  (79, 'HARIRAM GURJAR', 5, NULL),
  (86, 'ASHOK KUMAR MEHARA', 0.5, NULL),
  (87, 'ASHOK SWAMI', -4, NULL),
  (95, 'ASHOK KUMAR SHARMA', 1.5, NULL),
  (139, 'SHANKAR LAL', -1.5, NULL),
  (150, 'DHARMENDRA KUMAR', 2, NULL),
  (151, 'RAJENDRA KUMAR RAIGER', 3, NULL),
  (152, 'RAVI KUMAR BAIRWA', 4, NULL),
  (199, 'ARUN SHARMA', 3, NULL),
  (221, 'SARIM KHAN', 26, NULL),
  (271, 'MANISH VERMA', -2, NULL),
  (275, 'VIKAS SINGH KARNAWAT', 0.5, NULL),
  (502, 'PARITOSH GHOSH', 1.5, NULL),
  (506, 'SUROJIT DEBNATH', 5.5, NULL),
  (508, 'ASHISH KUMAR PAL', 1.5, NULL),
  (510, 'HASAN SK', 3.5, NULL),
  (512, 'SUBRAT MONDAL', 2.5, NULL),
  (517, 'ASHOK KUMAR KUMAWAT', 4, NULL),
  (518, 'PARTHA SARDAR', 0.5, NULL),
  (519, 'SANJAY RAJOWAR', 0.5, NULL),
  (523, 'JAYANTA DAS', -2.5, NULL),
  (526, 'ANIL GOTHWAL', 1.5, NULL),
  (531, 'AMIT KUMAR MONDAL', 0.5, NULL),
  (532, 'BISWAJIT ADAK', 1.5, NULL),
  (538, 'VIPLOB CHAKROBORTY', 0, NULL),
  (543, 'JAYANTA BARMAN', 3, NULL),
  (546, 'BABU SONA BARMAN', 1.5, NULL),
  (546, 'PALASH BARMAN', 1.5, NULL),
  (565, 'SHIVAM KUMAR UPRATI', 1.5, NULL),
  (566, 'GANESH DUTTA', 13, NULL),
  (571, 'CHANDAN RAJBHAR', 2.5, NULL),
  (573, 'ASHOK PAREEK', 12, NULL),
  (574, 'PABAN GHOSH', 6, NULL),
  (575, 'SAJIJUL', 3, NULL),
  (577, 'SUMANTA DEY', 0, NULL),
  (579, 'SANJAY RAKSHIT', -3.5, NULL),
  (588, 'SUNIL KUMAR SAIN', 1, NULL),
  (596, 'BAPI MONDAL', 1, NULL),
  (599, 'UMMED SINGH RATHOR', -2.5, NULL),
  (601, 'POORAN RAJBHAR', -5.5, NULL),
  (607, 'ASIM HAZRA', 5, NULL),
  (617, 'SANKRITAN MONDAL', -17.5, NULL),
  (622, 'SANJAY PAL', 7, NULL),
  (624, 'VIRENDRA SINGH', 1.5, NULL),
  (633, 'SWAPAN NANDI', 6, NULL),
  (637, 'MANOJ PAL', 1, NULL),
  (647, 'PRASENJIT DAS', 3, NULL),
  (650, 'SANJAY VERMA', 7.5, NULL),
  (651, 'RATAN DEY', 2.5, NULL),
  (657, 'PAPAI GHOSH', 1.5, NULL),
  (661, 'SANJAY JANGID', 0.5, NULL),
  (662, 'MAHADEB BARMAN', -13, NULL),
  (663, 'HEMANT KUMAR MAHAWAR', 0, NULL),
  (664, 'RANJAN BISWAS', -1.5, NULL),
  (666, 'FARDEEN KHAN', 0.5, NULL),
  (666, 'SOMNATH HAZRA', 0.5, NULL),
  (666, 'SAURAV KUMAR', 0.5, NULL),
  (666, 'SANJIT MANDAL', 0.5, NULL),
  (666, 'SHAHZAD KHAN', 0.5, NULL),
  (669, 'AJAY SINGH JADAOUN', 1.5, NULL),
  (670, 'ABHIJIT DUTTA', 5.5, NULL),
  (671, 'CHINMOY SAHA', 1, NULL),
  (675, 'GAJANAND VERMA', 2.5, NULL),
  (676, 'KISHORE KUMAR HALDAR', 14.5, NULL),
  (678, 'SHIBNATH DAS', -17.5, NULL),
  (679, 'SARABINDU HAZRA', 1, NULL),
  (684, 'SUBRATA DAS', -5, NULL),
  (685, 'SAQIB KHAN', -1.5, NULL),
  (694, 'VISHNU RAJAWAT', 0.5, NULL),
  (695, 'SUBIR', -2.5, NULL),
  (698, 'SANJAY GHOSH', 7, NULL),
  (707, 'RAMESH KUMAR YADAV', 9, NULL),
  (709, 'BISWAJIT MONDAL', 4, NULL),
  (711, 'CHETAN GOENKA', 4.5, NULL),
  (716, 'GOVIND NARAYAN SAIN', 10.5, NULL),
  (718, 'DINESH KUMAR MEHARA', -0.5, NULL),
  (729, 'INDRAJIT GHOSH', 0, NULL),
  (730, 'ANIL SONI', -0.5, NULL),
  (731, 'RAHUL SAINI', 7, NULL),
  (733, 'MUKESH KUMAR SHARMA', 0.5, NULL),
  (738, 'SUKANTA BISWAS', 1, NULL),
  (739, 'KISHORE HALDER', 2, NULL),
  (740, 'MANOJ KUMAR SHARMA', 4, NULL),
  (741, 'PATIRAM MONDAL', 4.5, NULL),
  (749, 'ROHIT SAINI', 3, NULL),
  (752, 'ARIF KHAN', -0.5, NULL),
  (756, 'PURUSHOTAM BAIRWA', 0.5, NULL),
  (766, 'DIPAK HALDER', 4.5, NULL),
  (768, 'TOTAN MONDAL', -0.5, NULL),
  (770, 'RAJ DAS', 1.5, NULL),
  (771, 'SINTU DEY', 0.5, NULL),
  (772, 'KISHAN SONI', -0.5, NULL),
  (774, 'WASIM AKTAR', -1.5, NULL),
  (776, 'UMANG GUPTA', 0.5, NULL),
  (777, 'RAVI SAINI', 0.5, NULL),
  (778, 'LAKHAN MURMU', -0.5, NULL),
  (779, 'CHANDAN SINGH', 1, NULL),
  (780, 'AJAY KUMAR PANCHAL', 1, NULL),
  (781, 'RAKESH DEY', -1.5, NULL),
  (782, 'BANTI MEENA', 1.5, NULL),
  (783, 'GOBINDO HAZRA', 1.5, NULL),
  (784, 'BHUBAN DEY', 1.5, NULL),
  (785, 'KUMAR MITRA', -0.5, NULL),
  (786, 'BISHNU GHOSH', 1.5, NULL),
  (787, 'RANJIT BISWAS', -2.5, NULL),
  (788, 'ANIL KUMAR BAIRWA', 0.5, NULL),
  (789, 'DEEPAK KUMAR BAIRWA', 1, NULL),
  (367, 'NEERAJ KUMAR', 2, '1996-08-11'),
  (368, 'RASHMI KUMARI', 3, '2000-04-18'),
  (372, 'JASPREET SINGH', -2.5, '1999-09-10'),
  (377, 'KAMAL SINGH', 3, '1977-09-13'),
  (385, 'LATIKA CHAUHAN', -3.5, '2000-06-28'),
  (391, 'URVASHI BISHT', 16, '2002-08-03'),
  (392, 'DEEPANSHI AGARWAL', 9, '2002-01-01'),
  (395, 'ANKITA TIWARI', -12.5, '1982-08-23'),
  (409, 'JAISHRI DHIR', 0, '2001-01-10'),
  (438, 'KRITIKA DIWAKAR', 3.5, '1993-03-31'),
  (439, 'AAKASH DOLKA', 1.5, NULL),
  (451, 'DEEPAK DHANKAR', 3.5, '1998-02-04'),
  (240, 'AJAY CK', 3, '2000-03-18'),
  (751, 'Anand Sain', -11.5, NULL),
  (564, 'Siddhartha Das', 1.5, NULL),
  (790, 'Manoj Sain', 1.5, NULL),
  (197, 'Akash Bairwa', 10, NULL);

  -- EMP CODEs that map to more than one distinct name within the sheet
  -- itself -- untrustworthy for code-matching (see header comment).
  CREATE TEMP TABLE ambiguous_codes AS
    SELECT emp_code FROM raw_import
    WHERE emp_code IS NOT NULL
    GROUP BY emp_code
    HAVING COUNT(DISTINCT upper(trim(full_name))) > 1;

  FOR v_row IN SELECT * FROM raw_import LOOP
    v_profile := NULL;

    IF v_row.emp_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ambiguous_codes a WHERE a.emp_code = v_row.emp_code) THEN
      SELECT id, COUNT(*) OVER () INTO v_profile, v_match_count
      FROM profiles
      WHERE tenant_id = v_tenant AND employee_id = v_row.emp_code::text;
      IF v_match_count IS DISTINCT FROM 1 THEN
        v_profile := NULL;
      END IF;
    END IF;

    IF v_profile IS NULL THEN
      SELECT id, COUNT(*) OVER () INTO v_profile, v_match_count
      FROM profiles
      WHERE tenant_id = v_tenant
        AND upper(trim(regexp_replace(concat_ws(' ', first_name, middle_name, last_name), '\s+', ' ', 'g')))
          = upper(trim(regexp_replace(v_row.full_name, '\s+', ' ', 'g')));
      IF v_match_count IS DISTINCT FROM 1 THEN
        v_profile := NULL;
      END IF;
    END IF;

    IF v_profile IS NULL THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'SKIPPED (no unique profile match): EMP CODE %, %', v_row.emp_code, v_row.full_name;
      CONTINUE;
    END IF;

    v_matched := v_matched + 1;

    IF v_row.dob IS NOT NULL THEN
      UPDATE profiles SET date_of_birth = v_row.dob WHERE id = v_profile;
    END IF;

    IF v_row.leave_balance IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM leave_ledger
      WHERE profile_id = v_profile AND leave_type_id = v_leave_type
        AND note = 'Opening Earned Leave balance import (HR sheet, as on 19 Sep 2026)'
    ) THEN
      INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, effective_date, note)
      VALUES (v_tenant, v_profile, v_leave_type, 'Allocation', v_row.leave_balance, '2026-09-19',
              'Opening Earned Leave balance import (HR sheet, as on 19 Sep 2026)');
    END IF;
  END LOOP;

  RAISE NOTICE 'Raniwala leave/DOB import complete: % matched, % skipped (see NOTICEs above for who)', v_matched, v_skipped;
END $$;
