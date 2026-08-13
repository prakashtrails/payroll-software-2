import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { createEmployee, updateEmployeeAdmin } from '@/services/employeeService';
import { todayStr, phoneToPlaceholderEmail } from '@/lib/helpers';

/**
 * The identifier actually used for the Supabase Auth account: the real email
 * if the sheet had one, otherwise a placeholder derived from the phone
 * number so a person with no email column can still get a login (see
 * phoneToPlaceholderEmail). Returns '' if neither is present/usable.
 */
export const resolveLoginEmail = (profileData) =>
  profileData.email || phoneToPlaceholderEmail(profileData.phone);

export const isIndia = (country) => {
  const c = (country || '').toLowerCase().trim();
  return !c || c === 'india' || c === 'in';
};

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
  let e = String(raw || '').trim().replace(/\s+/g, '');
  if (e && !e.includes('@')) {
    const m = e.match(/^(.+?)(gmail\.com|yahoo\.co\.in|yahoo\.com|hotmail\.com|outlook\.com|rediffmail\.com)$/i);
    if (m) e = `${m[1]}@${m[2]}`;
  }
  return e;
};

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
  // JS Date object (when cellDates:true is used)
  if (val instanceof Date) return val.toISOString().slice(0, 10);

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

/**
 * Normalizes a raw parsed row (arbitrary header casing/spacing) into the
 * profileData shape createEmployee/updateEmployeeAdmin expect.
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
    const val = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim();
    return [key, val];
  }));

  const fullName = d.name || d.full_name || d.employee_name || '';
  const rowCountry = (d.country || d.country_of_residence || d.nationality || 'India').trim() || 'India';
  const rowIsIndia = isIndia(rowCountry);
  const outletLocation = (d.outlet_location || d.location || d.branch_location || d.outlet || d.branch || '').trim();

  const profileData = {
    first_name: d.first_name || d.firstname || fullName.split(' ')[0] || 'Imported',
    middle_name: d.middle_name || d.middlename || '',
    last_name: d.last_name || d.lastname || d.surname || fullName.split(' ').slice(1).join(' ') || 'User',
    email: cleanEmail(d.email || d.email_id || d.email_address || ''),
    phone: d.phone || d.mobile || d.contact || d.phone_number || d.mobile_number || '',
    department: d.department || d.dept || '',
    designation: d.designation || d.position || d.job_title || d.title || '',
    join_date: toDateStr(d.join_date || d.joining_date || d.date_of_joining || d.doj) || todayStr(),
    ctc: parseFloat(d.ctc || d.salary || d.annual_ctc || d.gross_salary || d.gross || 0) || 0,
    bank_acc: d.bank_acc || d.bank_account || d.account_number || d.acc_no || '',
    bank_name: d.bank_name || '',
    ifsc_code: d.ifsc_code || d.ifsc || '',
    // India-only compliance docs — set empty for international employees
    pan:    rowIsIndia ? (d.pan || d.pan_number || d.pan_no || '') : '',
    aadhar: rowIsIndia ? (d.aadhar || d.aadhaar || d.aadhar_number || d.aadhaar_number || '') : '',
    // International compliance docs — only relevant for non-India employees
    country: rowCountry,
    passport_number:    !rowIsIndia ? (d.passport_number || d.passport || d.passport_no || '') : '',
    work_permit_number: !rowIsIndia ? (d.work_permit_number || d.work_permit || d.permit_number || '') : '',
    work_permit_expiry: !rowIsIndia ? toDateStr(d.work_permit_expiry || d.permit_expiry || d.visa_expiry || '') || null : null,
    role: d.role || d.user_role || 'employee',
    status: /^inactive$/i.test(d.status) ? 'Inactive' : 'Active',
    weekly_holiday: d.weekly_holiday || d.holiday || 'Sunday',
    leave_allocation: parseInt(d.leave_allocation || d.leaves || d.annual_leaves || 0, 10) || 0,
    employee_id:     (d.employee_id || d.emp_id || d.staff_id || '').trim().toUpperCase() || null,
    outlet_location: outletLocation,
    outlet_id: null,
  };

  return profileData;
}

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

/**
 * Runs a bulk employee import for one tenant: creates new employees,
 * fills in missing name fields on incomplete existing rows, and
 * skips/reports duplicates or failures. Calls onProgress(current, total)
 * as it goes. Returns { successCount, updateCount, skipCount, failCount, failErrors }.
 */
export async function runBulkImport({ tenantId, rows, onProgress }) {
  const mappedRows = rows.map((data) => mapRowToProfileData(data));

  // Auto-create any department named in the sheet that doesn't exist yet for
  // this tenant, so admins don't have to pre-create departments before import.
  const deptNames = [...new Set(mappedRows.map((r) => r.department).filter(Boolean))];
  if (deptNames.length) {
    const { error: deptErr } = await supabase
      .from('departments')
      .upsert(deptNames.map((name) => ({ tenant_id: tenantId, name })), { onConflict: 'tenant_id,name', ignoreDuplicates: true });
    if (deptErr) console.error('Failed to auto-create departments:', deptErr);
  }

  // Same for branches ("outlets"): auto-create any branch name from the
  // sheet that doesn't exist yet for this tenant, then resolve every row's
  // outlet_id from its outlet_location text — so a branch column in the
  // sheet is enough, no need to pre-create branches first.
  const branchNames = [...new Set(mappedRows.map((r) => r.outlet_location).filter(Boolean))];
  if (branchNames.length) {
    const { data: existingOutlets } = await supabase
      .from('outlets')
      .select('id, name')
      .eq('tenant_id', tenantId);
    const outletIdByName = new Map((existingOutlets || []).map((o) => [o.name.trim().toLowerCase(), o.id]));
    const missingNames = branchNames.filter((n) => !outletIdByName.has(n.toLowerCase()));
    if (missingNames.length) {
      const { data: createdOutlets, error: outletErr } = await supabase
        .from('outlets')
        .insert(missingNames.map((name) => ({ tenant_id: tenantId, name })))
        .select('id, name');
      if (outletErr) console.error('Failed to auto-create branches:', outletErr);
      else createdOutlets.forEach((o) => outletIdByName.set(o.name.trim().toLowerCase(), o.id));
    }
    mappedRows.forEach((r) => {
      if (r.outlet_location) r.outlet_id = outletIdByName.get(r.outlet_location.toLowerCase()) ?? null;
    });
  }

  const { data: existingProfiles } = await supabase
    .from('profiles')
    .select('id, email, phone, first_name, middle_name, last_name, outlet_location, outlet_id')
    .eq('tenant_id', tenantId);
  const existingProfileMap = new Map(
    (existingProfiles || [])
      .map(p => [resolveLoginEmail(p).toLowerCase(), p])
      .filter(([key]) => key)
  );

  let successCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const failErrors = [];

  for (const [rowIndex, profileData] of mappedRows.entries()) {
    onProgress?.(rowIndex + 1, mappedRows.length);

    // At least one of email/phone is required as a login identifier — when
    // email is present, phone is allowed to stay blank for now (see
    // resolveLoginEmail / phoneToPlaceholderEmail).
    const label = profileData.email || profileData.phone || '(row ' + (rowIndex + 1) + ')';
    if (!profileData.phone && !profileData.email) {
      failCount++;
      failErrors.push(`${label}: missing both phone number and email — at least one is required to log in`);
      continue;
    }
    profileData.login_email = resolveLoginEmail(profileData);

    // Manual "Add Employee" hard-blocks CTC <= 0 — the import path must match
    // the same bar, or it silently creates live ₹0-salary employee records.
    if (!profileData.ctc || profileData.ctc <= 0) {
      failCount++;
      failErrors.push(`${label}: missing or invalid CTC — row skipped`);
      continue;
    }

    const existing = existingProfileMap.get(profileData.login_email.toLowerCase());
    if (existing) {
      // Update name/profile fields only if missing/placeholder — but branch
      // is synced on every re-import, since re-uploading the sheet with a
      // branch column added (or changed) is the whole point of a re-import.
      const nameMissing =
        !existing.first_name || existing.first_name === 'Imported' ||
        !existing.last_name || existing.last_name === 'User';
      const branchChanged = !!profileData.outlet_location && (
        profileData.outlet_location !== (existing.outlet_location || '') ||
        (profileData.outlet_id ?? null) !== (existing.outlet_id ?? null)
      );
      // Middle name is backfilled independently of nameMissing — a profile
      // can already have a real first/last name (not the "Imported"/"User"
      // placeholders) but still be missing the middle name the sheet has.
      const middleNameMissing = !existing.middle_name && !!profileData.middle_name;
      if (!nameMissing && !branchChanged && !middleNameMissing) {
        skipCount++;
        continue;
      }
      try {
        const updatePayload = {
          outlet_location: profileData.outlet_location,
          outlet_id: profileData.outlet_id,
        };
        if (middleNameMissing) {
          updatePayload.middle_name = profileData.middle_name;
        }
        if (nameMissing) {
          Object.assign(updatePayload, {
            first_name: profileData.first_name,
            middle_name: profileData.middle_name || '',
            last_name: profileData.last_name,
            phone: profileData.phone || '',
            department: profileData.department || '',
            designation: profileData.designation || '',
            join_date: toDateStr(profileData.join_date) || null,
            ctc: profileData.ctc || 0,
            bank_acc: profileData.bank_acc || '',
            bank_name: profileData.bank_name || '',
            ifsc_code: profileData.ifsc_code || '',
            pan: profileData.pan || '',
            aadhar: profileData.aadhar || '',
            country: profileData.country || 'India',
            passport_number: profileData.passport_number || '',
            work_permit_number: profileData.work_permit_number || '',
            work_permit_expiry: profileData.work_permit_expiry || null,
            weekly_holiday: profileData.weekly_holiday || 'Sunday',
            leave_allocation: profileData.leave_allocation || 0,
          });
        }
        const { error: updErr } = await updateEmployeeAdmin(existing.id, updatePayload);
        if (updErr) throw updErr;
        updateCount++;
      } catch (err) {
        failCount++;
        failErrors.push(`${label}: ${err.message || 'Update failed'}`);
      }
      continue;
    }

    try {
      await createEmployeeWithRetry(tenantId, profileData);
      existingProfileMap.set(profileData.login_email.toLowerCase(), { email: profileData.email, phone: profileData.phone });
      successCount++;
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

  return { successCount, updateCount, skipCount, failCount, failErrors };
}

export function downloadSampleCSV() {
  const csvContent =
    'employee_id,first_name,middle_name,last_name,email,phone,department,designation,join_date,ctc,bank_acc,outlet_location,country,pan,aadhar,passport_number,work_permit_number,work_permit_expiry,role,weekly_holiday,leave_allocation\n' +
    'MCMU1001,Jane,,Doe,jane.doe@example.com,9999999999,HR,Recruiter,2026-05-01,45000,123456789012,Mumbai,India,ABCDE1234F,999988887777,,,employee,Sunday,12\n' +
    'MCDL2001,John,Michael,Smith,john.smith@example.com,+442012345678,Engineering,Developer,2026-05-01,80000,GB12345678,Delhi,United Kingdom,,,,P12345678,WP-UK-9999,2027-12-31,employee,Saturday,15\n' +
    'MCMU1002,Ravi,,Kumar,,9123456780,Kitchen,Cook,1-Feb-2026,18000,987654321098,Mumbai,India,,,,,,employee,Sunday,12\n';
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', 'employee_import_sample.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
