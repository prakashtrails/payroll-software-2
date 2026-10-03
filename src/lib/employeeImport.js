import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { createEmployee, updateEmployeeAdmin } from '@/services/employeeService';
import { listDepartments } from '@/services/tenantService';
import { setDirectManager } from '@/services/orgHierarchyService';
import { todayStr, phoneToPlaceholderEmail, normalizePhone } from '@/lib/helpers';

/**
 * The identifier actually used for the Supabase Auth account: the real email
 * if the sheet had one, otherwise a placeholder derived from the phone
 * number so a person with no email column can still get a login (see
 * phoneToPlaceholderEmail). Returns '' if neither is present/usable.
 */
export const isIndia = (country) => {
  const c = (country || '').toLowerCase().trim();
  return !c || c === 'india' || c === 'in';
};

// ============================================================
// Text cleanup
// ============================================================

// Cell values that mean "nothing was entered here", however the sheet spells
// it — collapsed to '' rather than stored as literal junk text.
const EMPTY_PLACEHOLDER_RE = /^(nan|n\/?a|null|none|undefined|-{1,2}|\.)$/i;

/** Trims, collapses repeated internal whitespace, and blanks out placeholder
 *  cell values (NaN/N-A/null/-/etc.) — the baseline cleanup every text field
 *  gets before any field-specific normalization. */
export const cleanText = (raw) => {
  if (raw == null) return '';
  const s = String(raw).trim().replace(/\s+/g, ' ');
  return EMPTY_PLACEHOLDER_RE.test(s) ? '' : s;
};

/** "JAYNATH" -> "Jaynath", "  ashok  " -> "Ashok", "al-amin" -> "Al-Amin",
 *  "o'brien" -> "O'Brien". Only recases letters — never touches spelling. */
export const toTitleCase = (s) => {
  if (!s) return s;
  return s
    .split(' ')
    .map((word) => word
      .split(/([-'])/)
      .map((part) => (part === '-' || part === "'" ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
      .join(''))
    .join(' ');
};

// Short, all-caps tokens that read as acronyms in a department/designation —
// title-casing these would turn a legitimate abbreviation into a typo
// ("Hr" instead of "HR"), so they're force-uppercased instead of title-cased.
const KNOWN_ACRONYMS = new Set([
  'hr', 'hrd', 'it', 'pr', 'kyc', 'ceo', 'coo', 'cfo', 'cto', 'hod', 'qa', 'qc', 'po', 'ot',
  'f&b', 'h.k', 'h.k.', 'hk', 'gm', 'agm', 'fom', 'pos',
]);

const titleCaseWithAcronyms = (s) =>
  s.split(' ').filter(Boolean).map((word) => {
    const lower = word.toLowerCase();
    return KNOWN_ACRONYMS.has(lower) ? lower.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');

/**
 * Sheets pasted from other sources routinely have a stray space baked into
 * the email cell (e.g. "Ashish Verma2278@gmail.com" — a name fragment glued
 * onto the address with a space instead of nothing), which Supabase Auth
 * rejects outright as an invalid format. Spaces are never valid in an email
 * address, so stripping them is always safe. Also recovers the common
 * "name got separated from an otherwise-fine address" case where the '@' was
 * simply dropped before a well-known provider domain (e.g.
 * "chetanmanmya7877gmail.com" -> "chetanmanmya7877@gmail.com").
 */
export const cleanEmail = (raw) => {
  let e = cleanText(raw).replace(/\s+/g, '').toLowerCase();
  if (e && !e.includes('@')) {
    const m = e.match(/^(.+?)(gmail\.com|yahoo\.co\.in|yahoo\.com|hotmail\.com|outlook\.com|rediffmail\.com)$/i);
    if (m) e = `${m[1]}@${m[2]}`;
  }
  return e;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (email) => !!email && EMAIL_RE.test(email);

/**
 * The identifier actually used for the Supabase Auth account: the real email
 * if the sheet had one *and it's actually valid* (an unfixable malformed
 * address can never work as a login and would just fail signup outright —
 * better to fall back), otherwise a placeholder derived from the phone
 * number so a person with no usable email can still get a login (see
 * phoneToPlaceholderEmail). Returns '' if neither is present/usable.
 */
export const resolveLoginEmail = (profileData) =>
  (isValidEmail(profileData.email) ? profileData.email : '') || phoneToPlaceholderEmail(profileData.phone);

/**
 * Department/designation typos that are unambiguous enough to auto-correct,
 * plus singular/plural variants that are clearly the same department. Keyed
 * by the trimmed/collapsed/lowercased raw value. Deliberately small — when a
 * variant isn't obviously the same thing, the import leaves it alone rather
 * than guessing (see spec: "when uncertain, preserve the original value").
 */
const DEPARTMENT_SPELLING_FIXES = {
  maintanence: 'maintenance',
  maintainance: 'maintenance',
  account: 'accounts',
  secutity: 'security',
  sevice: 'service',
};

const DESIGNATION_SPELLING_FIXES = {
  maintanence: 'maintenance',
  maintainance: 'maintenance',
  secutity: 'security',
  sevice: 'service',
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Applies whole-word fixes only (via \b boundaries) — a naive substring
 * replace would "fix" the already-correct "accounts" by matching "account"
 * inside it and produce "accountss". An exact full-string match against the
 * dictionary is tried first (cheap and unambiguous); the word-boundary regex
 * pass after that catches a fix embedded in a longer phrase, e.g.
 * "maintanence executive" -> "maintenance executive".
 */
const applySpellingFixes = (key, dict) => {
  if (dict[key]) return dict[key];
  let result = key;
  for (const [wrong, right] of Object.entries(dict)) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(wrong)}\\b`, 'g'), right);
  }
  return result;
};

/** Normalized key used to detect two department strings as "the same
 *  department" regardless of case, spacing, or a known typo/singular form. */
const deptKey = (raw) => {
  const key = applySpellingFixes(cleanText(raw).toLowerCase(), DEPARTMENT_SPELLING_FIXES);
  // Short acronym-style tokens that differ only by punctuation ("H.K" /
  // "H.K." / "HK") are the same abbreviation, just typed differently —
  // collapse the periods so they land on one canonical entry instead of
  // three. Length-limited so this never touches an ordinary sentence-like
  // department name that happens to contain a period.
  const noPeriods = key.replace(/\./g, '');
  return noPeriods !== key && noPeriods.length <= 5 && /^[a-z&]+$/.test(noPeriods) ? noPeriods : key;
};

/** Canonical display form for a *new* department name (existing departments
 *  keep whatever spelling is already in the database — see resolveDepartments). */
const formatDepartmentName = (raw) => titleCaseWithAcronyms(deptKey(raw));

const formatDesignation = (raw) => {
  const key = applySpellingFixes(cleanText(raw).toLowerCase(), DESIGNATION_SPELLING_FIXES);
  return titleCaseWithAcronyms(key);
};

/**
 * Bank names are almost always "ACRONYM + common word(s)" ("HDFC BANK",
 * "ICICI BANK", "STATE BANK OF INDIA") — there's no reliable way to tell a
 * real acronym token ("HDFC") from a shouted-in-caps ordinary word ("STATE")
 * without a bank-name dictionary, and guessing wrong turns a legitimate name
 * into a misspelling ("Hdfc" instead of HDFC). Per the import spec's own
 * fallback rule — preserve the original value when uncertain — this only
 * trims/collapses whitespace and never recases a bank name.
 */
const normalizeBankName = (raw) => cleanText(raw);

// Country names/codes shouted in caps ("USA", "UK", "UAE") read as
// legitimate abbreviations, not sloppy data entry — recasing them to
// "Usa"/"Uk"/"Uae" would be wrong, so they're preserved the same way
// department/designation acronyms are.
const COUNTRY_ACRONYMS = new Set(['usa', 'uk', 'uae', 'us']);
const normalizeCountry = (raw) => {
  const cleaned = cleanText(raw);
  if (!cleaned) return '';
  return cleaned.split(' ').map((word) => {
    const lower = word.toLowerCase();
    return COUNTRY_ACRONYMS.has(lower) ? lower.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
};

const ROLE_VALUES = new Set(['employee', 'admin', 'manager']);
const normalizeRole = (raw) => {
  const r = cleanText(raw).toLowerCase();
  return ROLE_VALUES.has(r) ? r : 'employee';
};

const WEEKDAY_RE = /^(sun|mon|tue|wed|thu|fri|sat)/i;
const normalizeWeeklyHoliday = (raw) => {
  const cleaned = cleanText(raw);
  return WEEKDAY_RE.test(cleaned) ? toTitleCase(cleaned) : (cleaned || 'Sunday');
};

// ============================================================
// Dates
// ============================================================

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const to4DigitYear = (year) => (year.length === 2 ? (Number(year) <= 69 ? `20${year}` : `19${year}`) : year);

/**
 * Every spreadsheet column that reaches here can be in a different date
 * format row-to-row — Excel auto-formats cells inconsistently, and people
 * paste from different locales. This always normalizes to the one format
 * Postgres `date` columns actually take: YYYY-MM-DD. Numeric dates are read
 * day-first (DD/MM/YYYY, the Indian/UK convention this app otherwise uses)
 * unless that's impossible (e.g. "12/25/2026"), in which case it's read as
 * month-first instead of producing an invalid date.
 */
const toDateStr = (val) => {
  if (!val && val !== 0) return '';
  // Excel serial number (e.g. 45839)
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }
  // JS Date object (when cellDates:true is used). SheetJS builds these at
  // *local* midnight, minus a few seconds of historical-offset drift (IST
  // gives 8 Jan as 2024-01-07T18:29:50Z), so toISOString() alone lands on the
  // previous day. Shift to local wall-clock time and round to the nearest day.
  if (val instanceof Date) {
    const localMs = val.getTime() - val.getTimezoneOffset() * 60000;
    return new Date(Math.round(localMs / 86400000) * 86400000).toISOString().slice(0, 10);
  }

  const s = String(val).trim();
  if (!s) return '';

  // Already ISO-ish: YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // Textual month, either order: "1 Feb 2026" / "01-February-2026" or "Feb 1, 2026"
  m = s.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})$/)
    || s.match(/^([A-Za-z]{3,9})[\s\-\/]+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const [, a, b, year] = m;
    const [day, monthName] = /^\d/.test(a) ? [a, b] : [b, a];
    const month = MONTH_NAMES[monthName.slice(0, 3).toLowerCase()];
    if (month) return `${to4DigitYear(year)}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Numeric with separators — D/M/Y, D-M-Y, or D.M.Y, 2- or 4-digit year
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, day, month, year] = m;
    year = to4DigitYear(year);
    // Sheet is actually month-first (e.g. US "12/25/2026") if the assumed
    // day is out of range but the assumed month isn't — swap instead of
    // emitting an invalid date.
    if (Number(month) > 12 && Number(day) <= 12) [day, month] = [month, day];
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return s;
};

/** True if `s` is a real, valid YYYY-MM-DD date (not just date-*shaped*). */
const isValidDateStr = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const parseRows = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
};

// Minimal RFC4180-style parser: handles quoted fields with embedded commas,
// newlines, and escaped "" quotes — a naive split(',')/split('\n') silently
// shifts every column after the first comma inside an unquoted text field
// (e.g. a remarks or address column).
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const nonEmptyRows = rows.filter(r => r.some(v => v.trim() !== ''));
  if (nonEmptyRows.length < 2) return [];
  const headers = nonEmptyRows[0].map(h => h.trim().toLowerCase());
  return nonEmptyRows.slice(1).map(values => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim(); });
    return obj;
  });
};

/** Parses a File (CSV or Excel) into an array of row objects keyed by header. */
export function parseImportFile(file) {
  const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.xlsm');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (evt) => {
      try {
        const rows = isXlsx
          ? parseRows(new Uint8Array(evt.target.result))
          : parseCsv(evt.target.result);
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    if (isXlsx) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });
}

// ============================================================
// Row -> profileData mapping
// ============================================================

/**
 * Numeric identifiers (phone/account number/aadhaar/etc.) must never come out
 * scientific-notation-formatted or lose leading zeros. parseImportFile never
 * asks XLSX for Excel's *displayed* text (no `raw:false`), so a numeric cell
 * always arrives here as a genuine JS number in its real magnitude — safe
 * from "8.55525E+11"-style corruption. This just renders that number back to
 * a plain digit string (never exponential, never a trailing ".0"), and
 * otherwise passes strings through untouched. Leading zeros already lost by
 * Excel treating the cell as a number can't be recovered after the fact —
 * this only prevents *this* pass from mangling identifiers further.
 */
const identifierToString = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw.toFixed(0) : '';
  return cleanText(raw);
};

/**
 * Normalizes a raw parsed row (arbitrary header casing/spacing) into the
 * profileData shape createEmployee/updateEmployeeAdmin expect. Every text
 * field is cleaned (trimmed, whitespace-collapsed, placeholder-blanked) and
 * case-normalized per the field's own rules — see cleanText/toTitleCase/
 * titleCaseWithAcronyms above.
 *
 * outlet_id is always left null here — runBulkImport resolves it in a
 * second pass, after auto-creating any branch name from the sheet that
 * doesn't exist yet for the tenant (mirrors department auto-create).
 */
export function mapRowToProfileData(data) {
  const d = Object.fromEntries(Object.entries(data).map(([k, v]) => {
    const key = k.trim().toLowerCase().replace(/[\s\-]+/g, '_');
    // Convert Date objects to YYYY-MM-DD before stringifying to avoid
    // locale timezone strings like "GMT+0530" reaching Postgres.
    const val = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    return [key, val];
  }));
  const t = (v) => cleanText(v); // shorthand for plain trim/collapse/placeholder-strip

  const fullNameRaw = t(d.name || d.full_name || d.employee_name);
  const firstFromFull = fullNameRaw.split(' ')[0] || '';
  const lastFromFull = fullNameRaw.split(' ').slice(1).join(' ');

  const firstName = toTitleCase(t(d.first_name || d.firstname) || firstFromFull);
  const middleName = toTitleCase(t(d.middle_name || d.middlename));
  const lastName = toTitleCase(t(d.last_name || d.lastname || d.surname) || lastFromFull);

  const rowCountry = t(d.country || d.country_of_residence || d.nationality) || 'India';
  const rowIsIndia = isIndia(rowCountry);
  // Not title-cased here — outlet_location is canonicalized against the
  // tenant's real outlets in runBulkImport (see computeOutletCanonicalization),
  // the same way department is. Reformatting it independently here is exactly
  // what let "OTH" (the outlets table's actual name) and "Oth" (this field,
  // title-cased in isolation) drift apart on the same employee.
  const outletLocation = t(d.outlet_location || d.location || d.branch_location || d.outlet || d.branch);

  const email = cleanEmail(d.email || d.email_id || d.email_address);
  const emailFlag = email && !isValidEmail(email) ? `invalid email format: "${email}"` : null;

  // DOJ / "Date of Joining" / join_date: several header spellings can carry
  // the same value — take the first one that parses to a real date rather
  // than blindly preferring one column, so a blank/garbled DOJ cell doesn't
  // win over a valid Date of Joining cell (or vice versa).
  const dojCandidates = [d.join_date, d.joining_date, d.date_of_joining, d.doj].map(toDateStr);
  const joinDate = dojCandidates.find(isValidDateStr) || '';

  const rawDept = t(d.department || d.dept);
  const rawDesignation = t(d.designation || d.position || d.job_title || d.title);
  const rawDivision = t(d.division);
  // "Manager" is a person's name (e.g. "ABHISHEK SIR"), not a profiles column —
  // resolved to manager_id in a separate pass after every row is created/updated
  // (see resolveManagerAssignments), since the named manager may appear later
  // in the same sheet or already exist as another tenant employee.
  const managerName = t(d.manager || d.manager_name || d.reporting_manager || d.reports_to);

  const profileData = {
    first_name: firstName || 'Imported',
    middle_name: middleName,
    last_name: lastName || 'User',
    email,
    phone: identifierToString(d.phone ?? d.mobile ?? d.contact ?? d.phone_number ?? d.mobile_number),
    department: rawDept, // canonicalized in-place by runBulkImport once every row's department is known
    designation: rawDesignation ? formatDesignation(rawDesignation) : '',
    division: rawDivision ? titleCaseWithAcronyms(rawDivision.toLowerCase()) : '',
    manager_name: managerName,
    join_date: joinDate || todayStr(),
    ctc: parseFloat(t(d.ctc || d.salary || d.annual_ctc || d.gross_salary || d.gross)) || 0,
    bank_acc: identifierToString(d.bank_acc ?? d.bank_account ?? d.account_number ?? d.acc_no),
    bank_name: normalizeBankName(d.bank_name),
    ifsc_code: t(d.ifsc_code || d.ifsc).toUpperCase(),
    // India-only compliance docs — set empty for international employees
    pan:    rowIsIndia ? identifierToString(d.pan ?? d.pan_number ?? d.pan_no).toUpperCase() : '',
    aadhar: rowIsIndia ? identifierToString(d.aadhar ?? d.aadhaar ?? d.aadhar_number ?? d.aadhaar_number) : '',
    // International compliance docs — only relevant for non-India employees
    country: normalizeCountry(rowCountry),
    passport_number:    !rowIsIndia ? identifierToString(d.passport_number ?? d.passport ?? d.passport_no).toUpperCase() : '',
    work_permit_number: !rowIsIndia ? identifierToString(d.work_permit_number ?? d.work_permit ?? d.permit_number) : '',
    work_permit_expiry: !rowIsIndia ? (toDateStr(d.work_permit_expiry || d.permit_expiry || d.visa_expiry) || null) : null,
    role: normalizeRole(d.role || d.user_role),
    status: /^inactive$/i.test(t(d.status)) ? 'Inactive' : 'Active',
    weekly_holiday: normalizeWeeklyHoliday(d.weekly_holiday || d.holiday),
    leave_allocation: parseInt(t(d.leave_allocation || d.leaves || d.annual_leaves), 10) || 0,
    employee_id: t(d.employee_id || d.emp_id || d.staff_id || d.emp_code).toUpperCase() || null,
    essl_employee_code: identifierToString(d.essl_employee_code ?? d.essl_id ?? d.essl_code ?? d.device_user_id ?? d.biometric_code) || null,
    outlet_location: outletLocation,
    outlet_id: null,
    _flags: [emailFlag].filter(Boolean),
  };

  return profileData;
}

// ============================================================
// Department canonicalization
// ============================================================

/**
 * Pure canonicalization logic, no I/O: given the tenant's existing
 * department names and every raw department string a sheet uses, returns
 * one canonical display name per logically-identical department
 * (case/whitespace/known-typo-insensitive) — always the properly-formatted
 * form (formatDepartmentName), never an arbitrary pre-existing duplicate.
 *
 * A tenant can already have duplicate department rows from before this
 * normalization existed (e.g. both "KITCHEN" and "Kitchen", or two
 * different misspellings with no correctly-spelled row at all) — picking
 * "whichever one the DB happens to return first" in that situation is
 * arbitrary and often wrong (and non-deterministic across runs). Always
 * deriving the canonical form from the normalized key itself, regardless of
 * which existing row is being looked at, means every duplicate converges on
 * the same properly-formatted name. `existingNames` only affects `created`:
 * a canonical name that's already an existing row's exact spelling isn't
 * "newly created", one that isn't (a cleaned-up correction) is.
 */
export function computeDepartmentCanonicalization(existingNames, rawDeptValues) {
  const existingSet = new Set(existingNames || []);
  const canonicalByKey = new Map(); // normalized key -> canonical display name
  const created = [];
  const merged = new Set(); // raw spellings that don't match their canonical form

  const resolve = (raw) => {
    const key = deptKey(raw);
    let canonical = canonicalByKey.get(key);
    if (!canonical) {
      canonical = formatDepartmentName(raw);
      canonicalByKey.set(key, canonical);
      if (!existingSet.has(canonical)) created.push(canonical);
    }
    return canonical;
  };

  for (const name of existingNames || []) resolve(name);
  for (const raw of rawDeptValues) {
    if (!raw) continue;
    const canonical = resolve(raw);
    if (canonical !== raw) merged.add(`"${raw}" -> "${canonical}"`);
  }

  return { canonicalByKey, created, merged: [...merged] };
}

/**
 * Resolves every row's `department` to its canonical form (see
 * computeDepartmentCanonicalization), creating each new canonical
 * department exactly once. Mutates `mappedRows` in place. Returns
 * { created, merged } for the summary.
 */
async function resolveDepartments(tenantId, mappedRows) {
  const { data: existing } = await listDepartments(tenantId);
  const { canonicalByKey, created, merged } = computeDepartmentCanonicalization(
    (existing || []).map((d) => d.name),
    mappedRows.map((r) => r.department)
  );

  for (const row of mappedRows) {
    if (row.department) row.department = canonicalByKey.get(deptKey(row.department));
  }

  if (created.length) {
    const { error } = await supabase
      .from('departments')
      .upsert(created.map((name) => ({ tenant_id: tenantId, name })), { onConflict: 'tenant_id,name', ignoreDuplicates: true });
    if (error) console.error('Failed to auto-create departments:', error);
  }

  return { created, merged };
}

// ============================================================
// Outlet ("branch") canonicalization
// ============================================================

const outletKey = (raw) => cleanText(raw).toLowerCase();

/**
 * Pure canonicalization for outlet/branch names — same case/whitespace
 * problem as departments (e.g. "OTH" vs "Oth", "Sutra VS" vs "Sutra Vs"),
 * but outlets are admin-managed physical locations rather than
 * auto-created-on-typo text, so unlike departments this *does* prefer
 * whatever spelling already exists in the outlets table (a location code
 * like "OTH" might be deliberately all-caps) rather than recomputing a
 * "nicer" form. Only a name with no existing match at all gets Title-Cased,
 * as a reasonable default for a brand-new outlet the sheet is introducing.
 */
export function computeOutletCanonicalization(existingNames, rawValues) {
  const canonicalByKey = new Map();
  for (const name of existingNames || []) {
    const key = outletKey(name);
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, name);
  }

  const created = [];
  const merged = new Set();

  for (const raw of rawValues) {
    if (!raw) continue;
    const key = outletKey(raw);
    let canonical = canonicalByKey.get(key);
    if (!canonical) {
      canonical = toTitleCase(cleanText(raw));
      canonicalByKey.set(key, canonical);
      created.push(canonical);
    }
    if (canonical !== raw) merged.add(`"${raw}" -> "${canonical}"`);
  }

  return { canonicalByKey, created, merged: [...merged] };
}

// ============================================================
// In-file duplicate detection/merging
// ============================================================

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

const rowFullName = (row) => normalizeManagerName([row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '));

/** Employee IDs that the sheet gives to more than one differently-named
 *  person (an HR typo, e.g. five people all under code 666). For these the
 *  code alone can't identify anyone, so matching also requires the name. */
function findSharedEmployeeIds(rows) {
  const namesById = new Map();
  for (const r of rows) {
    if (!r.employee_id) continue;
    if (!namesById.has(r.employee_id)) namesById.set(r.employee_id, new Set());
    namesById.get(r.employee_id).add(rowFullName(r));
  }
  return new Set([...namesById].filter(([, names]) => names.size > 1).map(([id]) => id.toUpperCase()));
}

/** Identifiers strong enough to say "this is the same person" on their own. */
function matchKeys(row, sharedIds = new Set()) {
  const keys = [];
  if (row.employee_id) {
    keys.push(sharedIds.has(row.employee_id.toUpperCase())
      ? 'eidname:' + row.employee_id + '|' + rowFullName(row)
      : 'eid:' + row.employee_id);
  }
  if (row.essl_employee_code) keys.push('essl:' + row.essl_employee_code);
  if (row.email) keys.push('email:' + row.email);
  const phone10 = normalizePhone(row.phone);
  if (phone10.length === 10) keys.push('phone:' + phone10);
  if (row.aadhar && onlyDigits(row.aadhar).length >= 10) keys.push('aadhar:' + onlyDigits(row.aadhar));
  if (row.pan && row.pan.length >= 8) keys.push('pan:' + row.pan);
  // Fallback only — name+DOJ is the weakest signal, used solely when nothing
  // stronger is available for this row.
  if (!keys.length && row.first_name && row.last_name && row.join_date) {
    keys.push('namedoj:' + `${row.first_name}|${row.last_name}`.toLowerCase() + '|' + row.join_date);
  }
  return keys;
}

const MERGE_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'email', 'phone', 'department', 'designation',
  'division', 'join_date', 'ctc', 'bank_acc', 'bank_name', 'ifsc_code', 'pan', 'aadhar', 'country',
  'passport_number', 'work_permit_number', 'work_permit_expiry', 'weekly_holiday',
  'leave_allocation', 'employee_id', 'outlet_location', 'manager_name',
];

/**
 * Collapses rows that represent the same person into one, preferring the
 * most complete information (later rows' non-blank values win, on the
 * assumption a repeated row later in the sheet is a correction/update of an
 * earlier one). Returns { rows, duplicateCount }.
 */
function dedupeWithinFile(mappedRows) {
  const groups = [];          // array of merged rows
  const keyToGroupIdx = new Map();
  let duplicateCount = 0;
  const sharedIds = findSharedEmployeeIds(mappedRows);

  for (const row of mappedRows) {
    const keys = matchKeys(row, sharedIds);
    let groupIdx = null;
    for (const k of keys) {
      if (keyToGroupIdx.has(k)) { groupIdx = keyToGroupIdx.get(k); break; }
    }
    if (groupIdx == null) {
      groupIdx = groups.length;
      groups.push({ ...row });
    } else {
      duplicateCount++;
      const target = groups[groupIdx];
      // Later row's non-blank values are the "more recent" correction;
      // a blank cell in the later row never erases a value the earlier
      // occurrence already had.
      for (const f of MERGE_FIELDS) {
        const val = row[f];
        const isBlank = val === '' || val == null;
        if (!isBlank) target[f] = val;
      }
    }
    for (const k of keys) keyToGroupIdx.set(k, groupIdx);
  }

  return { rows: groups, duplicateCount };
}

// ============================================================
// Existing-employee matching + update
// ============================================================

/** Priority-ordered lookup maps for matching an imported row to an existing
 *  CrewCore employee: Employee ID > ESSL code > Email > Mobile > Aadhaar/PAN
 *  > Name+DOJ > name alone (see byFullName/byFirstLast). */
function buildExistingIndexes(existingProfiles) {
  const byEmployeeId = new Map();
  const byEsslCode = new Map();
  const byEmail = new Map();
  const byPhone = new Map();
  const byAadhar = new Map();
  const byPan = new Map();
  const byNameDoj = new Map();
  // Name-only fallback (no employee ID/ESSL code in the sheet at all yet, or
  // it doesn't match what's on file) — grouped as arrays so a name shared by
  // more than one employee can be told apart from a genuine unique match
  // instead of silently updating the wrong person.
  const byFullName = new Map();
  const byFirstLast = new Map();
  const addTo = (map, key, p) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  };

  for (const p of existingProfiles) {
    if (p.employee_id) byEmployeeId.set(p.employee_id.toUpperCase(), p);
    if (p.essl_employee_code) byEsslCode.set(p.essl_employee_code, p);
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
    const phone10 = normalizePhone(p.phone);
    if (phone10.length === 10) byPhone.set(phone10, p);
    if (p.aadhar && onlyDigits(p.aadhar).length >= 10) byAadhar.set(onlyDigits(p.aadhar), p);
    if (p.pan && p.pan.length >= 8) byPan.set(p.pan.toUpperCase(), p);
    if (p.first_name && p.last_name && p.join_date) {
      byNameDoj.set(`${p.first_name}|${p.last_name}`.toLowerCase() + '|' + p.join_date, p);
    }
    addTo(byFullName, normalizeManagerName([p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')), p);
    addTo(byFirstLast, normalizeManagerName([p.first_name, p.last_name].filter(Boolean).join(' ')), p);
  }
  return { byEmployeeId, byEsslCode, byEmail, byPhone, byAadhar, byPan, byNameDoj, byFullName, byFirstLast };
}

/**
 * Returns { profile, via } on an unambiguous match, or { ambiguous: [...] }
 * when the row's name alone matches more than one existing employee (never
 * auto-picks one — see runBulkImport, which reports it for manual review
 * instead of risking an update to the wrong person), or null for no match.
 */
function findExistingMatch(row, idx, sharedIds = new Set()) {
  const eid = row.employee_id?.toUpperCase();
  if (eid && idx.byEmployeeId.has(eid)) {
    const profile = idx.byEmployeeId.get(eid);
    // A code the sheet reuses for several people only counts when the name
    // agrees too — otherwise fall through to the other identifiers/name.
    const profileName = normalizeManagerName([profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' '));
    if (!sharedIds.has(eid) || profileName === rowFullName(row)) return { profile, via: 'employee ID' };
  }
  if (row.essl_employee_code && idx.byEsslCode.has(row.essl_employee_code)) {
    return { profile: idx.byEsslCode.get(row.essl_employee_code), via: 'ESSL code' };
  }
  if (row.email && idx.byEmail.has(row.email.toLowerCase())) {
    return { profile: idx.byEmail.get(row.email.toLowerCase()), via: 'email' };
  }
  const phone10 = normalizePhone(row.phone);
  if (phone10.length === 10 && idx.byPhone.has(phone10)) {
    return { profile: idx.byPhone.get(phone10), via: 'phone' };
  }
  const aadharDigits = onlyDigits(row.aadhar);
  if (aadharDigits.length >= 10 && idx.byAadhar.has(aadharDigits)) {
    return { profile: idx.byAadhar.get(aadharDigits), via: 'Aadhaar' };
  }
  if (row.pan && row.pan.length >= 8 && idx.byPan.has(row.pan.toUpperCase())) {
    return { profile: idx.byPan.get(row.pan.toUpperCase()), via: 'PAN' };
  }
  if (row.first_name && row.last_name && row.join_date) {
    const key = `${row.first_name}|${row.last_name}`.toLowerCase() + '|' + row.join_date;
    if (idx.byNameDoj.has(key)) return { profile: idx.byNameDoj.get(key), via: 'name + joining date' };
  }

  // Last resort: match on name alone (e.g. a sheet with only EMP CODE/NAME —
  // no email/phone/DOJ to key off, and the code itself doesn't line up with
  // what's on file). Only ever returns an unambiguous single match.
  const fullNameKey = normalizeManagerName([row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '));
  const firstLastKey = normalizeManagerName([row.first_name, row.last_name].filter(Boolean).join(' '));
  const nameCandidates = [...new Set([...(idx.byFullName.get(fullNameKey) || []), ...(idx.byFirstLast.get(firstLastKey) || [])])];
  if (nameCandidates.length === 1) return { profile: nameCandidates[0], via: 'name' };
  if (nameCandidates.length > 1) return { ambiguous: nameCandidates };

  return null;
}

// Fields that are safe to update from a re-import whenever the sheet has a
// valid, different value. Name fields are handled separately — see
// buildUpdatePayload — since overwriting someone's real name off a fuzzy
// (phone/aadhaar/name+DOJ) match is riskier than any of these.
const UPDATABLE_FIELDS = [
  'department', 'designation', 'division', 'ctc', 'bank_acc', 'bank_name', 'ifsc_code',
  'pan', 'aadhar', 'phone', 'country', 'passport_number', 'work_permit_number',
  'work_permit_expiry', 'weekly_holiday', 'leave_allocation', 'employee_id',
  'essl_employee_code',
];

/**
 * Existing employee + new valid information -> UPDATE.
 * Existing employee + blank/invalid imported field -> KEEP EXISTING DATA.
 * Existing employee + same information -> NO CHANGE (field omitted).
 * Returns { payload, changedFields }.
 */
function buildUpdatePayload(existing, incoming) {
  const payload = {};
  const changedFields = [];

  const nameIsPlaceholder =
    !existing.first_name || existing.first_name === 'Imported' ||
    !existing.last_name || existing.last_name === 'User';
  if (nameIsPlaceholder && incoming.first_name && incoming.last_name) {
    if (incoming.first_name !== existing.first_name) { payload.first_name = incoming.first_name; changedFields.push('first_name'); }
    if (incoming.last_name !== existing.last_name) { payload.last_name = incoming.last_name; changedFields.push('last_name'); }
  }
  if (!existing.middle_name && incoming.middle_name) {
    payload.middle_name = incoming.middle_name;
    changedFields.push('middle_name');
  }

  for (const f of UPDATABLE_FIELDS) {
    const val = incoming[f];
    const isBlank = val === '' || val == null || (f === 'ctc' && !val) || (f === 'leave_allocation' && !val);
    if (isBlank) continue; // never overwrite good data with a blank/invalid cell
    if (val !== existing[f]) { payload[f] = val; changedFields.push(f); }
  }

  // join_date: never overwrite a valid existing date with a blank/invalid
  // one; do accept a valid, different date as a correction.
  if (isValidDateStr(incoming.join_date) && incoming.join_date !== existing.join_date) {
    payload.join_date = incoming.join_date;
    changedFields.push('join_date');
  }

  // Branch: synced on every re-import (unchanged from prior behavior) —
  // re-uploading the sheet with a branch column added/changed is the
  // whole point of a re-import.
  if (incoming.outlet_location && (
    incoming.outlet_location !== (existing.outlet_location || '') ||
    (incoming.outlet_id ?? null) !== (existing.outlet_id ?? null)
  )) {
    payload.outlet_location = incoming.outlet_location;
    payload.outlet_id = incoming.outlet_id;
    changedFields.push('outlet');
  }

  return { payload, changedFields };
}

/**
 * A login identifier for an employee who has neither an email nor a phone
 * number yet. Unlike phoneToPlaceholderEmail, this can't be re-derived from
 * anything the employee will ever type — it exists purely so the Auth
 * account/profile can be created now and given a real email or phone later
 * (via updateEmployeeEmail / updateEmployeeAdmin), at which point that
 * becomes their actual login. Never shown to the employee.
 */
const randomPlaceholderEmail = () =>
  `pending-${Math.random().toString(36).slice(2, 10)}@noemail.crewcore.internal`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRateLimitError = (msg) => /rate limit|too many requests|security purposes|after \d+ second/i.test(msg || '');

/** Retries createEmployee on a rate-limit response — near-certain during a
 *  large bulk import — with increasing backoff, before giving up. */
async function createEmployeeWithRetry(tenantId, profileData, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await createEmployee(tenantId, profileData);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRateLimitError(err.message)) {
        await sleep(2000 * (attempt + 1)); // 2s, 4s, 6s
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ============================================================
// Manager-name resolution
// ============================================================

// Honorifics that ride along with an Indian workplace's informal manager
// references ("ABHISHEK SIR") but aren't part of anyone's actual name —
// stripped so "Abhishek Sir" and a profile named "Abhishek" can still match.
const HONORIFIC_RE = /\b(sir|mam|ma'?am|madam|ji)\b\.?/gi;

const normalizeManagerName = (raw) =>
  cleanText(raw).toLowerCase().replace(HONORIFIC_RE, '').replace(/\s+/g, ' ').trim();

/**
 * Resolves every row's free-text "Manager" name to a manager_id and assigns
 * it via the set_direct_manager RPC (the org-hierarchy source of truth — see
 * orgHierarchyService.setDirectManager), so the named manager's Team section
 * picks up the employee immediately.
 *
 * Matches against every active employee/admin/manager in the tenant (not
 * just rows from this import) — the sheet's "ABHISHEK SIR" is often an
 * existing admin/owner account, not a row in the file itself. Tries a full
 * first+middle+last match before falling back to first+last (a manager
 * column commonly drops someone's middle name, e.g. "GANESH SHARMA" for
 * "Ganesh Chand Sharma"). A name matching more than one employee is left
 * unassigned and flagged for manual review rather than guessing.
 */
async function resolveManagerAssignments(tenantId, assignments, manualReview) {
  if (!assignments.length) return { managerAssigned: 0 };

  const { data: allProfiles } = await supabase
    .from('profiles')
    .select('id, first_name, middle_name, last_name')
    .eq('tenant_id', tenantId);

  const byFullName = new Map();
  const byFirstLast = new Map();
  const addTo = (map, key, id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(id);
  };
  for (const p of allProfiles || []) {
    addTo(byFullName, normalizeManagerName([p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')), p.id);
    addTo(byFirstLast, normalizeManagerName([p.first_name, p.last_name].filter(Boolean).join(' ')), p.id);
  }

  let managerAssigned = 0;
  for (const { employeeId, label, managerName } of assignments) {
    const key = normalizeManagerName(managerName);
    const candidates = [...new Set((byFullName.get(key) || byFirstLast.get(key) || []))]
      .filter((id) => id !== employeeId);

    if (candidates.length === 0) {
      manualReview.push(`${label}: manager "${managerName}" not found — assign manually`);
    } else if (candidates.length > 1) {
      manualReview.push(`${label}: manager "${managerName}" matches ${candidates.length} employees — assign manually`);
    } else {
      const { error } = await setDirectManager(employeeId, candidates[0]);
      if (error) manualReview.push(`${label}: failed to assign manager "${managerName}" — ${error.message}`);
      else managerAssigned++;
    }
  }

  return { managerAssigned };
}

/**
 * Runs a bulk employee import for one tenant. Cleans/normalizes every row,
 * canonicalizes departments so capitalization/whitespace/known-typo variants
 * never create duplicate department records, collapses duplicate people
 * within the file itself, then matches each remaining row against existing
 * CrewCore employees (Employee ID > email > phone > Aadhaar/PAN > name+DOJ)
 * — updating only the fields the sheet has valid new data for, and creating
 * only genuinely new employees. Calls onProgress(current, total) as it goes.
 *
 * Returns { successCount, updateCount, skipCount, failCount, failErrors,
 *   managerAssigned, departmentsCreated, departmentsMerged, duplicatesInFile,
 *   manualReview, fieldsUpdated }.
 */
export async function runBulkImport({ tenantId, rows, onProgress, allowPlaceholderLogins = false, allowMissingCtc = false }) {
  const mappedRows = rows.map((data) => mapRowToProfileData(data));

  const manualReview = [];
  mappedRows.forEach((row, i) => {
    row._flags.forEach((f) => manualReview.push(`Row ${i + 1} (${row.email || row.phone || row.employee_id || 'unnamed'}): ${f}`));
  });

  const { created: departmentsCreated, merged: departmentsMerged } = await resolveDepartments(tenantId, mappedRows);

  // Same for branches ("outlets"): canonicalize every row's outlet_location
  // to the tenant's real outlet name (case/whitespace-insensitive — "OTH"
  // and "Oth" are the same branch), auto-creating a new outlet only for a
  // name with no existing match at all, then resolve outlet_id from that
  // canonical name. A branch column in the sheet is enough on its own; no
  // need to pre-create branches first.
  const branchNames = mappedRows.map((r) => r.outlet_location).filter(Boolean);
  let outletsCreated = [];
  let outletsMerged = [];
  if (branchNames.length) {
    const { data: existingOutlets } = await supabase
      .from('outlets')
      .select('id, name')
      .eq('tenant_id', tenantId);
    const outletIdByName = new Map((existingOutlets || []).map((o) => [o.name, o.id]));
    const { canonicalByKey, created, merged } = computeOutletCanonicalization(
      (existingOutlets || []).map((o) => o.name),
      branchNames
    );
    outletsCreated = created;
    outletsMerged = merged;

    if (created.length) {
      const { data: createdOutlets, error: outletErr } = await supabase
        .from('outlets')
        .insert(created.map((name) => ({ tenant_id: tenantId, name })))
        .select('id, name');
      if (outletErr) console.error('Failed to auto-create branches:', outletErr);
      else createdOutlets.forEach((o) => outletIdByName.set(o.name, o.id));
    }

    mappedRows.forEach((r) => {
      if (!r.outlet_location) return;
      const canonical = canonicalByKey.get(outletKey(r.outlet_location));
      r.outlet_location = canonical;
      r.outlet_id = outletIdByName.get(canonical) ?? null;
    });
  }

  const { rows: dedupedRows, duplicateCount: duplicatesInFile } = dedupeWithinFile(mappedRows);
  const sharedIds = findSharedEmployeeIds(mappedRows);

  const { data: existingProfiles } = await supabase
    .from('profiles')
    .select('id, employee_id, essl_employee_code, email, phone, first_name, middle_name, last_name, department, designation, division, ctc, bank_acc, bank_name, ifsc_code, pan, aadhar, country, passport_number, work_permit_number, work_permit_expiry, weekly_holiday, leave_allocation, join_date, outlet_location, outlet_id')
    .eq('tenant_id', tenantId);
  const idx = buildExistingIndexes(existingProfiles || []);
  // Also index by login email (real email, or phone placeholder) so a row
  // that only matches on the synthesized placeholder still finds its record —
  // preserves prior behavior for phone-only employees.
  const byLoginEmail = new Map(
    (existingProfiles || [])
      .map((p) => [resolveLoginEmail(p).toLowerCase(), p])
      .filter(([key]) => key)
  );

  let successCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const failErrors = [];
  const fieldsUpdated = [];
  // Employee/manager-name pairs to resolve once every row has been created or
  // updated — a row's named manager may be another employee later in this
  // same sheet, so this can't be done inline per-row.
  const pendingManagerAssignments = [];

  for (const [rowIndex, profileData] of dedupedRows.entries()) {
    onProgress?.(rowIndex + 1, dedupedRows.length);
    delete profileData._flags;
    const managerName = profileData.manager_name;
    delete profileData.manager_name;

    const label = profileData.email || profileData.phone || profileData.employee_id || '(row ' + (rowIndex + 1) + ')';

    // Existing-employee match is attempted first and needs neither a login
    // identifier nor a CTC value — a re-import that's only correcting
    // department/division/manager for an already-live employee shouldn't be
    // blocked by columns the sheet never carried in the first place. Those
    // requirements apply below, only to rows that turn out to be brand new.
    const loginGuess = resolveLoginEmail(profileData).toLowerCase();
    const match = findExistingMatch(profileData, idx, sharedIds) || (loginGuess && byLoginEmail.has(loginGuess)
      ? { profile: byLoginEmail.get(loginGuess), via: 'login email' }
      : null);

    if (match?.ambiguous) {
      failCount++;
      failErrors.push(`${label}: name matches ${match.ambiguous.length} existing employees and no Employee ID/ESSL code/email/phone confirms which one — row skipped, assign manually`);
      continue;
    }

    if (match) {
      const { profile: existing } = match;
      const { payload, changedFields } = buildUpdatePayload(existing, profileData);
      if (!changedFields.length) {
        skipCount++;
      } else {
        try {
          const { error: updErr } = await updateEmployeeAdmin(existing.id, payload);
          if (updErr) throw updErr;
          updateCount++;
          fieldsUpdated.push(`${label}: ${changedFields.join(', ')}`);
          // Keep the in-memory record in sync in case a later row in this same
          // file also resolves to this employee.
          Object.assign(existing, payload);
        } catch (err) {
          failCount++;
          failErrors.push(`${label}: ${err.message || 'Update failed'}`);
        }
      }
      if (managerName) pendingManagerAssignments.push({ employeeId: existing.id, label, managerName });
      continue;
    }

    // No existing match — creating a brand-new employee still needs a login
    // identifier and a real CTC, same as manual "Add Employee".
    if (!profileData.phone && !profileData.email) {
      if (!allowPlaceholderLogins) {
        failCount++;
        failErrors.push(`${label}: missing both phone number and email — at least one is required to log in`);
        continue;
      }
      // Explicitly opted in (e.g. "create the record now, add contact info
      // later") — give them a placeholder login so the profile/outlet/
      // department assignment happens now; nobody can actually sign in with
      // this until a real email or phone replaces it.
      profileData.login_email = randomPlaceholderEmail();
      manualReview.push(`${label}: created with a placeholder login — add a real email or phone before this employee can sign in`);
    } else {
      profileData.login_email = resolveLoginEmail(profileData);
    }

    if (!profileData.ctc || profileData.ctc <= 0) {
      if (!allowMissingCtc) {
        failCount++;
        failErrors.push(`${label}: missing or invalid CTC — row skipped`);
        continue;
      }
      // Explicitly opted in — create the record now with CTC = 0 rather than
      // blocking on a figure the sheet never had; manual review flags it so
      // it isn't forgotten before the next payroll run.
      profileData.ctc = 0;
      manualReview.push(`${label}: created with CTC = 0 — set their real Monthly CTC before running payroll`);
    }

    try {
      const created = await createEmployeeWithRetry(tenantId, profileData);
      const newRecord = { ...profileData, id: created.userId };
      if (profileData.employee_id) idx.byEmployeeId.set(profileData.employee_id.toUpperCase(), newRecord);
      if (profileData.essl_employee_code) idx.byEsslCode.set(profileData.essl_employee_code, newRecord);
      if (profileData.email) idx.byEmail.set(profileData.email.toLowerCase(), newRecord);
      byLoginEmail.set(profileData.login_email.toLowerCase(), newRecord);
      successCount++;
      if (managerName) pendingManagerAssignments.push({ employeeId: created.userId, label, managerName });
    } catch (err) {
      const msg = err.message || '';
      if (/already registered|already in use|already exists|user already/i.test(msg)) {
        skipCount++;
      } else if (isRateLimitError(msg)) {
        failCount++;
        failErrors.push(`${label}: still rate-limited after retries — re-run import to pick up remaining rows`);
      } else {
        console.error(`Import fail for ${label}:`, err);
        failCount++;
        failErrors.push(`${label}: ${msg || 'Unknown error'}`);
      }
    }
  }

  const { managerAssigned } = await resolveManagerAssignments(tenantId, pendingManagerAssignments, manualReview);

  return {
    successCount, updateCount, skipCount, failCount, failErrors, managerAssigned,
    departmentsCreated, departmentsMerged, outletsCreated, outletsMerged,
    duplicatesInFile, manualReview, fieldsUpdated,
  };
}

export function downloadSampleCSV() {
  const csvContent =
    'employee_id,essl_employee_code,first_name,middle_name,last_name,email,phone,department,designation,division,manager,join_date,ctc,bank_acc,outlet_location,country,pan,aadhar,passport_number,work_permit_number,work_permit_expiry,role,weekly_holiday,leave_allocation\n' +
    'MCMU1001,,Jane,,Doe,jane.doe@example.com,9999999999,HR,Recruiter,Support,John Smith,2026-05-01,45000,123456789012,Mumbai,India,ABCDE1234F,999988887777,,,,employee,Sunday,12\n' +
    'MCDL2001,,John,Michael,Smith,john.smith@example.com,+442012345678,Engineering,Developer,Support,,2026-05-01,80000,GB12345678,Delhi,United Kingdom,,,,P12345678,WP-UK-9999,2027-12-31,employee,Saturday,15\n' +
    'MCMU1002,113,Ravi,,Kumar,,9123456780,Kitchen,Cook,Factory,John Smith,1-Feb-2026,18000,987654321098,Mumbai,India,,,,,,employee,Sunday,12\n';
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', 'employee_import_sample.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
