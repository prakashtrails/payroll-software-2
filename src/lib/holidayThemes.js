// Shared festival/holiday theming — used by the Home dashboard's holiday
// banner and the login celebration/splash overlays. Keyed by keyword match
// against the holiday's name, so any holiday a tenant adds (now or in the
// future) is automatically themed; anything that doesn't match a known
// keyword falls back to DEFAULT_HOLIDAY_THEME instead of going untreated.
export const HOLIDAY_THEMES = [
  { match: /independence|republic/i, gradient: 'linear-gradient(120deg,#0b3d24,#15803d 45%,#f97316)', icon: 'fa-flag', emojis: ['🇮🇳', '🚩'] },
  { match: /diwali|deepavali/i, gradient: 'linear-gradient(120deg,#7c2d12,#c2410c 50%,#f59e0b)', icon: 'fa-fire', emojis: ['🪔', '✨', '🎆'] },
  { match: /holi/i, gradient: 'linear-gradient(120deg,#7e22ce,#db2777 45%,#f59e0b 75%,#22c55e)', icon: 'fa-palette', emojis: ['🎨', '🌈', '💦'] },
  { match: /christmas/i, gradient: 'linear-gradient(120deg,#14532d,#166534 50%,#dc2626)', icon: 'fa-tree', emojis: ['🎄', '❄️', '🎁'] },
  { match: /eid/i, gradient: 'linear-gradient(120deg,#0f766e,#0e7490 50%,#facc15)', icon: 'fa-moon', emojis: ['🌙', '⭐', '🕌'] },
  { match: /gandhi/i, gradient: 'linear-gradient(120deg,#1e3a8a,#3730a3 60%,#93c5fd)', icon: 'fa-dove', emojis: ['🕊️', '🇮🇳'] },
  { match: /new year/i, gradient: 'linear-gradient(120deg,#312e81,#6d28d9 55%,#db2777)', icon: 'fa-champagne-glasses', emojis: ['🎉', '🎆', '🥂'] },
  { match: /pongal|makar|sankranti/i, gradient: 'linear-gradient(120deg,#92400e,#d97706 55%,#fde047)', icon: 'fa-sun', emojis: ['🪁', '☀️'] },
  { match: /raksha|rakhi/i, gradient: 'linear-gradient(120deg,#9d174d,#db2777 55%,#f472b6)', icon: 'fa-hand-holding-heart', emojis: ['🎀', '💝'] },
  { match: /friday|easter/i, gradient: 'linear-gradient(120deg,#312e81,#4338ca 55%,#a5b4fc)', icon: 'fa-cross', emojis: ['✝️', '🐣'] },
];

export const DEFAULT_HOLIDAY_THEME = {
  gradient: 'linear-gradient(120deg,#312e81,#6d28d9 60%,#db2777)',
  icon: 'fa-gift',
  emojis: ['🎉', '✨', '🎊'],
};

export const getHolidayTheme = (name = '') =>
  HOLIDAY_THEMES.find((t) => t.match.test(name)) || DEFAULT_HOLIDAY_THEME;
