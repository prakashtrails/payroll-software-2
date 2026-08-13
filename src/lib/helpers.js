// Utility helpers shared across the app
// Utility helpers shared across the app

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape a value for safe interpolation into a raw HTML string (e.g. document.write). */
export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/**
 * Single source of truth for password strength, enforced identically at signup,
 * password reset, and forced first-login change — previously each surface had a
 * different (and differently weak) rule, so a password valid in one place could
 * be rejected in another.
 * Returns '' if valid, or a user-facing error message.
 */
/** Last 10 digits of a phone number, stripped of spaces/dashes/country-code prefixes. */
export const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/**
 * Employees imported without an email need SOME identifier for their Supabase
 * Auth account — phone-based auth isn't configured in this project (see
 * otpService.js), so instead of a real email we synthesize a deterministic,
 * fake-but-valid one from their phone number. It's never shown to anyone;
 * login just re-derives it from whatever phone number is typed in.
 */
export const phoneToPlaceholderEmail = (phone) => {
  const digits = normalizePhone(phone);
  return digits ? `p${digits}@phone.crewcore.internal` : '';
};

export function validatePassword(password) {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
  if (!/\d/.test(password)) return 'Password must contain at least one number.';
  return '';
}

export const fmt = (n, currency = '₹') =>
  currency + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

fmt.date = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** "5m ago" / "3h ago" / "2d ago" — falls back to a short date beyond a week. */
export const timeAgo = (iso) => {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export const monthKey = (m, y) => `${y}-${String(m + 1).padStart(2, '0')}`;

export const monthLabel = (m, y) =>
  new Date(y, m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const getInitials = (firstName, lastName) =>
  ((firstName || '')[0] || '') + ((lastName || '')[0] || '');

/** Full display name from a profile/employee-shaped object, skipping any blank parts. */
export const fullName = (p) =>
  [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ');

export const AVATAR_COLORS = [
  '#00AEEF,#0078A8', '#8B5CF6,#6D28D9', '#22C55E,#16A34A',
  '#FF6B35,#E5501E', '#F59E0B,#D97706', '#EC4899,#DB2777',
  '#14B8A6,#0D9488', '#6366F1,#4F46E5', '#EF4444,#DC2626',
  '#06B6D4,#0891B2',
];

export const getAvatarColor = (id) => {
  const hash = [...(id || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

/**
 * Outlet-view scoping filter shared by every admin page: `outletProfileIds`
 * is null when HR is viewing "Combined" (no filtering), or a Set of the
 * selected outlet's employee ids when scoped to one outlet.
 */
export const scopedToOutlet = (rows, outletProfileIds, key = 'profile_id') =>
  outletProfileIds ? (rows || []).filter((r) => outletProfileIds.has(r[key])) : (rows || []);

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const dateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const timeStr = (d) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export const fmtTime12 = (t) => {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ap}`;
};

export const diffHours = (t1, t2) => {
  if (!t1 || !t2) return 0;
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  // Overnight shift (e.g. clock-in 22:00, clock-out 06:00 next day) — wrap past midnight
  // instead of clamping to 0, which silently zeroed every overnight employee's hours.
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
};

export const fmtDuration = (hrs) => {
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${m}m`;
};

// ── Safe formula evaluator for 'formula' salary components ────────────────
// Small recursive-descent parser — deliberately NOT eval()/new Function() on
// stored text, since component formulas are tenant-authored data. Supports
// + - * / (), unary minus, min()/max(), and bare identifiers resolved from a
// `vars` scope (ctc, basic, and other components by their snake_case key).
function tokenizeFormula(src) {
  const tokens = [];
  const re = /\s*(?:([0-9]*\.?[0-9]+)|([a-zA-Z_][a-zA-Z0-9_]*)|([+\-*/(),]))/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m || m[0].length === 0) {
      if (/\s/.test(src[i])) { i++; continue; }
      throw new Error(`Unexpected character in formula: "${src[i]}"`);
    }
    if (m[1] !== undefined) tokens.push({ type: 'num', value: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ type: 'id', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: 'op', value: m[3] });
    i = re.lastIndex;
  }
  return tokens;
}

function parseFormula(tokens, vars) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let val = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }
  function parseTerm() {
    let val = parseFactor();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      const rhs = parseFactor();
      val = op === '*' ? val * rhs : (rhs === 0 ? 0 : val / rhs);
    }
    return val;
  }
  function parseFactor() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of formula');
    if (t.type === 'op' && t.value === '-') { next(); return -parseFactor(); }
    if (t.type === 'op' && t.value === '(') {
      next();
      const val = parseExpr();
      if (!peek() || peek().value !== ')') throw new Error('Missing closing )');
      next();
      return val;
    }
    if (t.type === 'num') { next(); return t.value; }
    if (t.type === 'id') {
      next();
      if (peek() && peek().type === 'op' && peek().value === '(') {
        next();
        const args = [];
        if (!(peek() && peek().value === ')')) {
          args.push(parseExpr());
          while (peek() && peek().value === ',') { next(); args.push(parseExpr()); }
        }
        if (!peek() || peek().value !== ')') throw new Error('Missing closing )');
        next();
        if (t.value === 'min') return Math.min(...args);
        if (t.value === 'max') return Math.max(...args);
        if (t.value === 'round') return Math.round(args[0]);
        throw new Error(`Unknown function "${t.value}"`);
      }
      if (!(t.value in vars)) return 0; // unresolved reference — treat as 0 rather than throwing mid-payroll-run
      return Number(vars[t.value]) || 0;
    }
    throw new Error('Unexpected token in formula');
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error('Unexpected trailing tokens in formula');
  return result;
}

/** Evaluate a component formula string against a variable scope. Never throws to the caller — returns 0 on any parse/eval error. */
export function evalFormula(formula, vars) {
  if (!formula || !formula.trim()) return 0;
  try {
    return parseFormula(tokenizeFormula(formula), vars) || 0;
  } catch {
    return 0;
  }
}

/** "Special Allowance" -> "special_allowance", for referencing components inside other formulas. */
export const formulaKey = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Resolves every 'formula' component against { ctc, basic, ...other resolved
 * components }, honoring each component's declared `depends_on` (array of
 * formulaKey names). Components whose dependencies never resolve (missing
 * dep / circular reference) fall back to 0 rather than blocking payroll.
 */
function resolveFormulaComponents(components, baseVars) {
  const formulaComps = components.filter((c) => c.calc_type === 'formula');
  const resolved = {};
  let remaining = formulaComps;
  let guard = 0;
  while (remaining.length && guard <= formulaComps.length) {
    guard++;
    const scope = { ...baseVars, ...resolved };
    const stillRemaining = [];
    remaining.forEach((c) => {
      const deps = c.depends_on || [];
      const ready = deps.every((d) => d in scope);
      if (ready) resolved[formulaKey(c.name)] = evalFormula(c.formula, scope);
      else stillRemaining.push(c);
    });
    if (stillRemaining.length === remaining.length) break; // no progress this pass — cycle or missing dep
    remaining = stillRemaining;
  }
  remaining.forEach((c) => { resolved[formulaKey(c.name)] = 0; }); // unresolved after all passes
  return resolved;
}

// Calculate salary breakdown from CTC, components, and working days
export function calcSalary(ctc, components, totalWorkDays, actualDays) {
  const ratio = actualDays / (totalWorkDays || 30);

  const basicComp = components.find(
    (c) => c.category === 'earning' && c.calc_type === 'percent_ctc' && c.name.toLowerCase().includes('basic')
  );
  const basicPercent = basicComp ? basicComp.percent : 50;
  const basic = ctc * (basicPercent / 100);

  const baseVars = { ctc, basic };
  const formulaValues = resolveFormulaComponents(components, baseVars);

  const valueFor = (c) => {
    if (c.calc_type === 'percent_ctc') return ctc * (c.percent / 100);
    if (c.calc_type === 'percent_basic') return basic * (c.percent / 100);
    if (c.calc_type === 'formula') return formulaValues[formulaKey(c.name)] || 0;
    return c.fixed;
  };

  const earnings = [];
  const deductions = [];
  let totalEarning = 0;
  let totalDeduction = 0;

  components
    .filter((c) => c.category === 'earning')
    .forEach((c) => {
      const val = Math.round(valueFor(c) * ratio);
      earnings.push({ name: c.name, amount: val });
      totalEarning += val;
    });

  components
    .filter((c) => c.category === 'deduction')
    .forEach((c) => {
      const val = Math.round(valueFor(c) * ratio);
      deductions.push({ name: c.name, amount: val });
      totalDeduction += val;
    });

  return { earnings, deductions, totalEarning, totalDeduction, net: totalEarning - totalDeduction };
}

// ── Income tax (TDS) engine ─────────────────────────────────────────────────
// Simplified but real slab-based projection: annualizes the monthly CTC,
// subtracts declared (proof-capped) exemptions + standard deduction, applies
// the tenant's configured slabs, adds cess, applies the Sec 87A-style zero
// -tax rebate below the configured threshold, then spreads the annual
// liability evenly across the 12 months of the financial year. Admins should
// review/update `tax_slabs` for the current year — the seeded defaults are a
// starting point, not a guarantee of current-year accuracy.
export function calcSlabTax(taxableIncome, slabs, cessPercent = 4) {
  if (taxableIncome <= 0 || !slabs?.length) return 0;
  let tax = 0;
  slabs.forEach((s) => {
    if (taxableIncome <= s.from) return;
    const upper = s.to == null ? taxableIncome : Math.min(taxableIncome, s.to);
    const taxableInSlab = Math.max(0, upper - s.from);
    tax += taxableInSlab * (s.rate / 100);
  });
  return Math.round(tax * (1 + cessPercent / 100));
}

/**
 * Monthly TDS deduction line for one employee, or null if no active slab
 * config / nothing payable. `declarations` = this employee's tax_declarations
 * rows for the financial year; `taxSlab` = the tenant's active tax_slabs row.
 */
export function calcTds(ctc, declarations, taxSlab, actualDays, totalWorkDays) {
  if (!taxSlab || !taxSlab.slabs?.length) return null;

  const ratio = actualDays / (totalWorkDays || 1);
  const annualGross = (ctc || 0) * 12;
  const declaredTotal = (declarations || []).reduce((sum, d) => {
    const proofCap = d.proof_submitted_amount != null ? d.proof_submitted_amount : d.declared_amount;
    return sum + Math.min(Number(d.declared_amount) || 0, Number(proofCap) || 0);
  }, 0);

  const taxableIncome = Math.max(0, annualGross - declaredTotal - (taxSlab.standard_deduction || 0));
  if (taxableIncome <= (taxSlab.rebate_threshold || 0)) return null;

  const annualTax = calcSlabTax(taxableIncome, taxSlab.slabs, taxSlab.cess_percent);
  const monthlyTds = Math.round((annualTax / 12) * ratio);
  return monthlyTds > 0 ? { name: 'TDS', amount: monthlyTds } : null;
}

/** India financial year (Apr–Mar) label for a given date, e.g. "2026-27". */
export function currentFinancialYear(date = new Date()) {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1; // FY starts in April (month index 3)
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Default India new-regime slab set — seeded per tenant, editable via TaxSlabsPage. */
export const DEFAULT_INDIA_NEW_REGIME_SLABS = [
  { from: 0,       to: 400000,  rate: 0  },
  { from: 400000,  to: 800000,  rate: 5  },
  { from: 800000,  to: 1200000, rate: 10 },
  { from: 1200000, to: 1600000, rate: 15 },
  { from: 1600000, to: 2000000, rate: 20 },
  { from: 2000000, to: 2400000, rate: 25 },
  { from: 2400000, to: null,    rate: 30 },
];

/**
 * Salary overtime rounding: breakpoint at 45 min.
 *   0–44 min  → 0 h    45–1h44 → 1 h    1h45–2h44 → 2 h  ...
 * Formula: floor((minutes + 15) / 60)
 */
export function calcPayableOvertimeHours(minutes) {
  if (!minutes || minutes <= 0) return 0;
  return Math.floor((minutes + 15) / 60);
}

/**
 * Overtime pay = (CTC × 0.5) / (30 days × shift hours) × payable OT hours
 * i.e. 50 % of the normal hourly rate per overtime hour.
 */
export function calcOtPay(ctc, shiftHours, payableHours) {
  if (!ctc || !payableHours) return 0;
  return Math.round((ctc * 0.5) / 30 / (shiftHours || 8) * payableHours);
}

// ── Weekly Off Comp Off helpers ───────────────────────────────────────────────

export const HIGH_SALARY_THRESHOLD = 30000;

/** Returns all calendar dates in a month that fall on the given weekday (0=Sun…6=Sat). */
export function getWeeklyOffDaysInMonth(year, month, weeklyOffDay) {
  const days = [];
  for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === weeklyOffDay) days.push(dateStr(d));
  }
  return days;
}

/**
 * Determines the monthly comp off settlement outcome for a high-salary employee.
 *
 * Rules:
 * - 0 WOs worked        → 'none'     (no impact)
 * - comp leaves ≥ WOs worked → 'balanced' (leaves offset the missed WOs)
 * - ALL WOs in month worked AND 0 comp leaves taken → 'credited' (+1 comp off, 1-yr validity)
 * - All other partial cases → 'expired' (unused comp offs expire, no carry-over)
 */
export function calcWeeklyOffSettlement(weeklyOffsWorked, totalWOsInMonth, compLeavesUsed) {
  if (weeklyOffsWorked === 0) return { type: 'none', credit: 0 };
  if (compLeavesUsed >= weeklyOffsWorked) return { type: 'balanced', credit: 0 };
  if (weeklyOffsWorked >= totalWOsInMonth && compLeavesUsed === 0) return { type: 'credited', credit: 1 };
  return { type: 'expired', credit: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Great-circle distance in meters between two lat/lng points (haversine formula). */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Whether a punch's lat/lng falls inside the effective geofence (outlet
 * override, falling back to the tenant default). Returns null (not flagged)
 * when no geofence is configured or no punch coordinates were captured —
 * i.e. this only ever flags, never silently blocks a punch.
 */
export function checkGeofence(punchLat, punchLng, outlet, tenant) {
  const center = (outlet?.geofence_lat != null && outlet?.geofence_lng != null)
    ? { lat: outlet.geofence_lat, lng: outlet.geofence_lng, radius: outlet.geofence_radius ?? tenant?.geofence_radius ?? 200 }
    : (tenant?.geofence_lat != null && tenant?.geofence_lng != null)
      ? { lat: tenant.geofence_lat, lng: tenant.geofence_lng, radius: tenant.geofence_radius ?? 200 }
      : null;
  if (!center || punchLat == null || punchLng == null) return null;
  return distanceMeters(punchLat, punchLng, center.lat, center.lng) > center.radius;
}

// PF deduction: 12% of CTC if CTC ≤ ₹15,000, else ₹1,800 (both pro-rated by work days)
// ESIC: uses the per-employee esic_amount (pro-rated)
export function calcPfEsic(emp, ctc, actualDays, totalWorkDays) {
  const ratio = actualDays / (totalWorkDays || 1);
  const deductions = [];

  if (emp?.pf_enabled) {
    const pfBase = ctc <= 15000 ? ctc * 0.12 : 1800;
    deductions.push({ name: 'PF', amount: Math.round(pfBase * ratio) });
  }

  if (emp?.esic_enabled && (emp?.esic_amount || 0) > 0) {
    deductions.push({ name: 'ESIC', amount: Math.round((emp.esic_amount || 0) * ratio) });
  }

  return deductions;
}
