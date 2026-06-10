// Utility helpers shared across the app
// Utility helpers shared across the app
export const fmt = (n, currency = '₹') =>
  currency + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

fmt.date = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const monthKey = (m, y) => `${y}-${String(m + 1).padStart(2, '0')}`;

export const monthLabel = (m, y) =>
  new Date(y, m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const getInitials = (firstName, lastName) =>
  ((firstName || '')[0] || '') + ((lastName || '')[0] || '');

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
  return Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
};

export const fmtDuration = (hrs) => {
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${m}m`;
};

// Calculate salary breakdown from CTC, components, and working days
export function calcSalary(ctc, components, totalWorkDays, actualDays) {
  const ratio = actualDays / (totalWorkDays || 1);

  const basicComp = components.find(
    (c) => c.category === 'earning' && c.calc_type === 'percent_ctc' && c.name.toLowerCase().includes('basic')
  );
  const basicPercent = basicComp ? basicComp.percent : 50;
  const basic = ctc * (basicPercent / 100);

  const earnings = [];
  const deductions = [];
  let totalEarning = 0;
  let totalDeduction = 0;

  components
    .filter((c) => c.category === 'earning')
    .forEach((c) => {
      let val = 0;
      if (c.calc_type === 'percent_ctc') val = ctc * (c.percent / 100);
      else if (c.calc_type === 'percent_basic') val = basic * (c.percent / 100);
      else val = c.fixed;
      val = Math.round(val * ratio);
      earnings.push({ name: c.name, amount: val });
      totalEarning += val;
    });

  components
    .filter((c) => c.category === 'deduction')
    .forEach((c) => {
      let val = 0;
      if (c.calc_type === 'percent_ctc') val = ctc * (c.percent / 100);
      else if (c.calc_type === 'percent_basic') val = basic * (c.percent / 100);
      else val = c.fixed;
      val = Math.round(val * ratio);
      deductions.push({ name: c.name, amount: val });
      totalDeduction += val;
    });

  return { earnings, deductions, totalEarning, totalDeduction, net: totalEarning - totalDeduction };
}

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
