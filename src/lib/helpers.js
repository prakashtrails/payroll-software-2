// Utility helpers shared across the app
export const fmt = (n, currency = '₹') =>
  currency + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

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
