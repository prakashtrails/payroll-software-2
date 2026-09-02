// Maps a notification's logical link_key to the role-correct route — this
// app uses a different path per role for the same feature (e.g. '/leaves'
// vs '/manager-leaves' vs '/my-leaves'), so a notification can't just store
// a raw href without it being wrong for some of its recipients.
const LINKS = {
  leave_requests:         { admin: '/leaves',            manager: '/manager-leaves',            employee: '/my-leaves' },
  regularize_attendance:  { admin: '/regularize',         manager: '/manager-regularize',         employee: '/my-regularize' },
  wfh_requests:            { admin: '/wfh-requests',       manager: '/manager-wfh-requests',       employee: '/my-wfh' },
  special_requests:        { admin: '/special-requests',   manager: '/manager-special-requests',   employee: '/my-special-requests' },
  expense_claims:          { admin: '/expense-claims',     manager: '/expense-claims',             employee: '/expense-claims' },
  travel_requests:         { admin: '/travel-requests',    manager: '/travel-requests',            employee: '/travel-requests' },
  headcount_requests:      { admin: '/headcount-requests', manager: '/headcount-requests',         employee: '/headcount-requests' },
  grievances:              { admin: '/grievances',         manager: '/grievances',                 employee: '/grievances' },
  attendance:              { admin: '/attendance',         manager: '/manager-attendance',         employee: '/my-attendance' },
  announcements:           { admin: '/announcements',      manager: '/announcements',              employee: '/announcements' },
};

export function resolveNotificationLink(linkKey, role) {
  const entry = LINKS[linkKey];
  if (!entry) return null;
  return entry[role] || entry.employee || null;
}
