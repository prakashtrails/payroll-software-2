// In-dashboard Help / FAQ content (pending-list item 9). Static on purpose:
// zero DB rows and zero requests. The AI assistant (item 11) also sends a
// compact version of this list to the model as its product knowledge, so keep
// answers factual and in sync with the app when features change.
//
// Each topic:
//   id        stable slug (used for ?topic= deep links)
//   category  section heading on the Help page
//   q / a     question + answer; `a` is plain text, blank line = new paragraph,
//             lines starting with "1." / "•" render as steps
//   roles     who sees it (omit = everyone): employee | manager | hod | management | admin
//   featureKey hides the topic when that feature is switched off for the company
//   link      route (string) or { admin, manager, employee } map, like notificationLinks

const EVERYONE_STAFF = ['employee', 'manager', 'hod', 'management', 'admin'];
const MANAGERS = ['manager', 'hod', 'management', 'admin'];

export const HELP_CATEGORIES = [
  'Getting started', 'Attendance', 'Leave & requests', 'Tasks & projects', 'Pay & finance',
  'Performance', 'Company', 'For managers', 'For HR / admin', 'Account & security',
];

export const HELP_TOPICS = [
  // ── Getting started ─────────────────────────────────────────────────────
  {
    id: 'what-is-crewcore', category: 'Getting started',
    q: 'What can I do in CrewCore?',
    a: 'CrewCore is your company\'s HR workspace. Depending on what your company has switched on, you can mark attendance, apply for leave and work-from-home, see payslips, track tasks, set performance goals, read announcements and policies, and raise requests.\n\nThe left sidebar shows only the features your company uses. "Home" is your dashboard and "Me" holds your personal attendance, leave and performance.',
    link: '/home',
  },
  {
    id: 'find-a-page', category: 'Getting started',
    q: 'How do I quickly find a page or action?',
    a: 'Use the search box at the top of every page. Type what you want to do — for example "apply leave", "payslip" or "regularize" — and pick the result. You can also ask the CrewCore Assistant (the chat bubble at the bottom-right) in plain language.',
  },
  {
    id: 'notifications', category: 'Getting started',
    q: 'Where do I see my notifications?',
    a: 'Click the bell icon at the top of the page for the latest updates, or open Notifications for the full list. Clicking a notification takes you straight to the related page (for example the leave request or task).\n\nIf you use the CrewCore mobile app, the same notifications also arrive as push notifications on your phone.',
    link: '/notifications',
  },
  {
    id: 'mobile-app', category: 'Getting started',
    q: 'Is there a mobile app?',
    a: 'Yes. The CrewCore app lets you clock in and out, apply for leave, check payslips and get push notifications. Sign in with the same email or phone number you use on the website.',
  },

  // ── Attendance ──────────────────────────────────────────────────────────
  {
    id: 'clock-in', category: 'Attendance', featureKey: 'attendance', roles: EVERYONE_STAFF,
    q: 'How do I clock in and clock out?',
    a: '1. Open Home.\n2. Use the clock-in button on the attendance card at the top.\n3. At the end of your day, use the same card to clock out.\n\nIf your company uses geofencing, you must be inside your office location for the clock-in to be accepted, and your browser or phone will ask for location permission — allow it.',
    link: '/home',
  },
  {
    id: 'geofence-error', category: 'Attendance', featureKey: 'attendance', roles: EVERYONE_STAFF,
    q: 'It says I am outside the office location. What should I do?',
    a: '• Make sure location permission is allowed for CrewCore in your browser or phone settings.\n• Turn on precise/high-accuracy location and wait a few seconds for the location to settle.\n• If you are genuinely working from elsewhere, apply for Work From Home or ask HR.\n\nIf it keeps failing inside the office, tell HR — they can check your outlet\'s location settings.',
  },
  {
    id: 'attendance-history', category: 'Attendance', featureKey: 'attendance', roles: EVERYONE_STAFF,
    q: 'Where can I see my attendance history?',
    a: 'Open Me → Attendance → Log. You will see each day\'s status (Present, Late, Half Day, Absent, Mispunch, Leave), your punch times and total hours.',
    link: '/me?tab=attendance&sub=log',
  },
  {
    id: 'regularize', category: 'Attendance', featureKey: 'regularize_attendance', roles: EVERYONE_STAFF,
    q: 'I forgot to punch. How do I correct my attendance?',
    a: '1. Open Me → Attendance → Regularize.\n2. Pick the date, enter the correct in/out times and a reason.\n3. Submit — your manager (and HR, if your company requires it) approves it.\n\nRegularization is only allowed within the window your company sets (usually today and the last couple of days), so raise it quickly.',
    link: '/me?tab=attendance&sub=regularize',
  },
  {
    id: 'mispunch', category: 'Attendance', featureKey: 'attendance', roles: EVERYONE_STAFF,
    q: 'What does "Mispunch" or "Pending Approval" mean?',
    a: 'Mispunch means only one punch (in or out) was recorded for the day — raise a regularization to fix it.\n\nPending Approval means your punch was made from the app or website at a location where your company requires manager approval; it counts once your manager approves it.',
  },

  // ── Leave & requests ────────────────────────────────────────────────────
  {
    id: 'apply-leave', category: 'Leave & requests', featureKey: 'leave_requests', roles: EVERYONE_STAFF,
    q: 'How do I apply for leave?',
    a: '1. Open Me → Leave.\n2. Choose the leave type and dates (half-day if available) and add a reason.\n3. Submit. Your request goes to your manager and then through any further approvers your company has set (for example HOD or HR).\n\nYou get a notification when it is approved or rejected, and your balance updates automatically.',
    link: '/me?tab=leave',
  },
  {
    id: 'leave-balance', category: 'Leave & requests', featureKey: 'leave_requests', roles: EVERYONE_STAFF,
    q: 'How do I check my leave balance?',
    a: 'Open Me → Leave. Your remaining balance for each leave type is shown at the top. Balances accrue and carry forward according to your company\'s leave policy — ask HR if a number looks wrong.',
    link: '/me?tab=leave',
  },
  {
    id: 'cancel-leave', category: 'Leave & requests', featureKey: 'leave_requests', roles: EVERYONE_STAFF,
    q: 'Can I cancel a leave request?',
    a: 'Ask your manager (while it is pending) to reject it, or HR (once it is approved) to cancel it, so your balance is restored correctly. You can see the current status of every request under Me → Leave.',
    link: '/me?tab=leave',
  },
  {
    id: 'wfh', category: 'Leave & requests', featureKey: 'wfh_requests', roles: EVERYONE_STAFF,
    q: 'How do I request Work From Home?',
    a: 'Open Me → Attendance → Work From Home, pick the dates and add a reason. Your manager approves it, and approved WFH days are reflected in your attendance.',
    link: '/me?tab=attendance&sub=wfh',
  },
  {
    id: 'expense-claim', category: 'Leave & requests', featureKey: 'expense_claims', roles: EVERYONE_STAFF,
    q: 'How do I claim an expense?',
    a: 'Open Expense Claims, add the amount, category, date and a description (attach the bill if asked), then submit for approval. You can track its status on the same page.',
    link: '/expense-claims',
  },
  {
    id: 'travel', category: 'Leave & requests', featureKey: 'travel_requests', roles: EVERYONE_STAFF,
    q: 'How do I request business travel?',
    a: 'Open Travel Requests, enter the trip details (from/to, dates, purpose) and submit. Your approver is notified and you can follow the status there.',
    link: '/travel-requests',
  },
  {
    id: 'grievance', category: 'Leave & requests', featureKey: 'grievances',
    q: 'How do I raise a grievance or complaint?',
    a: 'Open Grievances (under My Finances in the sidebar), describe the issue and submit. HR reviews it and you can follow its status on the same page.',
    link: '/grievances',
  },

  // ── Tasks & projects ────────────────────────────────────────────────────
  {
    id: 'tasks-overview', category: 'Tasks & projects', featureKey: 'tasks', roles: EVERYONE_STAFF,
    q: 'How do tasks work?',
    a: 'Open Tasks from the sidebar.\n\n• My Tasks — work assigned to you.\n• Assigned by Me — tasks you gave to others.\n• My Team — tasks of people who report to you (managers only).\n\nSwitch between the list and the board (columns per status) with the buttons above the list. Overdue tasks are highlighted in red.',
    link: '/tasks',
  },
  {
    id: 'create-task', category: 'Tasks & projects', featureKey: 'tasks', roles: EVERYONE_STAFF,
    q: 'How do I create or assign a task?',
    a: '1. Open Tasks and click New Task.\n2. Enter a title, optional description, priority and due date.\n3. Choose who it is for. Everyone can create tasks for themselves; managers can assign to people in their reporting team, and HR can assign to anyone.\n\nThe assignee is notified immediately.',
    link: '/tasks',
  },
  {
    id: 'task-status', category: 'Tasks & projects', featureKey: 'tasks', roles: EVERYONE_STAFF,
    q: 'How do I update a task\'s status or add a comment?',
    a: 'Change the status from the dropdown in the list, drag the card to another column on the board, or open the task to change it there. Statuses are To Do, In Progress, Blocked, Done and Cancelled (only the person who assigned it, or a manager, can cancel).\n\nOpen a task to add comments — the other person is notified, and the full history of status changes stays on the task.',
    link: '/tasks',
  },
  {
    id: 'task-reminders', category: 'Tasks & projects', featureKey: 'tasks', roles: EVERYONE_STAFF,
    q: 'Will I be reminded about due tasks?',
    a: 'Yes. Every morning at 9:00 AM you get one reminder listing your tasks that are due today, due tomorrow or overdue. If you assigned a task that is now overdue, you get a reminder too. Your company may also send these to Slack, email or WhatsApp.',
    link: '/tasks',
  },
  {
    id: 'meeting-notes', category: 'Tasks & projects', featureKey: 'ai_meetings', roles: EVERYONE_STAFF,
    q: 'How do I turn a meeting into tasks with AI?',
    a: '1. Open Meeting Notes and click New Meeting Notes.\n2. Enter the title and date, then paste the transcript or upload the .txt / .vtt / .srt file exported from Google Meet, Zoom or Teams.\n3. Click Extract with AI. Review the summary and the action items — fix titles, owners, due dates and priorities, and untick anything that should not become a task.\n4. Save. The notes are stored and each selected action item becomes a task for its owner (you can assign only to yourself and your team; HR can assign to anyone).\n\nThe transcript itself is not stored.',
    link: '/meetings',
  },
  {
    id: 'assistant', category: 'Getting started', featureKey: 'ai_assistant',
    q: 'What can the CrewCore Assistant do?',
    a: 'Click the round robot button at the bottom-right of any page. You can ask how to do something, ask it to open a page, check your own leave balance, attendance, payslips and tasks, or ask it to create a task ("remind me to send the invoice on Monday").\n\nIt only sees what you are allowed to see, cannot approve or change records, and has a daily message limit. AI can make mistakes, so check important details.',
  },
  {
    id: 'projects', category: 'Tasks & projects', featureKey: 'projects',
    q: 'What is the difference between Projects and Tasks?',
    a: 'A project groups people and tasks for a piece of work with a start and end date; HR and managers create projects and add members. Project tasks also appear on your Tasks page with the project name, so you can track everything in one place.',
    link: { admin: '/projects', manager: '/projects', employee: '/me?tab=projects' },
  },

  // ── Pay & finance ───────────────────────────────────────────────────────
  {
    id: 'payslip', category: 'Pay & finance', featureKey: 'payslips', roles: EVERYONE_STAFF,
    q: 'Where is my payslip?',
    a: 'Open My Payslips (under My Finances). Pick the month to view the full breakdown of earnings and deductions. Use the print button to print it or save it as a PDF.',
    link: '/my-payslips',
  },
  {
    id: 'tax-declaration', category: 'Pay & finance', featureKey: 'tax_declaration', roles: EVERYONE_STAFF,
    q: 'How do I submit my tax declaration?',
    a: 'Open Tax Declaration (under My Finances), fill in your investments and exemptions for the financial year and submit. HR uses it to calculate TDS in payroll.',
    link: '/my-tax-declaration',
  },
  {
    id: 'salary-wrong', category: 'Pay & finance', featureKey: 'payslips', roles: EVERYONE_STAFF,
    q: 'My salary or a deduction looks wrong. What do I do?',
    a: 'Check your attendance and leave for that month first (late marks, half days and unpaid leave affect pay). If it still looks wrong, raise it with HR — or through Grievances if your company uses it.',
  },

  // ── Performance ─────────────────────────────────────────────────────────
  {
    id: 'goals', category: 'Performance', featureKey: 'performance_kras',
    q: 'How do I set my goals and track performance?',
    a: 'Open Performance → Goals & Scorecards. Your goals (KRAs/KPIs) are agreed with your manager; submit monthly updates on progress under Monthly Updates. Your manager reviews them and HR runs the review cycles.',
    link: '/performance/kras',
  },
  {
    id: 'reviews', category: 'Performance', featureKey: 'performance_reviews',
    q: 'How do performance reviews work?',
    a: 'When HR opens a review cycle you complete your self-review, then your manager adds their review and rating. You can see the outcome under Performance → Reviews once it is shared.',
    link: '/performance/reviews',
  },
  {
    id: 'feedback-1on1', category: 'Performance', featureKey: 'performance_feedback',
    q: 'Where do I give feedback or see 1:1 meetings?',
    a: 'Performance → Feedback lets you give and receive feedback with colleagues. Performance → 1:1 Meetings lists the one-on-ones scheduled with your manager, with notes.',
    link: '/performance/feedback',
  },

  // ── Company ─────────────────────────────────────────────────────────────
  {
    id: 'announcements', category: 'Company', featureKey: 'announcements',
    q: 'Where are company announcements?',
    a: 'Important announcements appear on Home. The full list is under Company → Announcements.',
    link: '/announcements',
  },
  {
    id: 'policies', category: 'Company', featureKey: 'policies',
    q: 'Where do I read company policies?',
    a: 'Open Company → Policies to read or download each policy. Some policies ask you to acknowledge that you have read them — use the Acknowledge button on the policy.',
    link: '/policies',
  },
  {
    id: 'holidays', category: 'Company',
    q: 'Where is the holiday list?',
    a: 'Upcoming holidays for your branch are shown on Home. The full calendar is in Employee Calendar for HR and managers.',
    link: '/home',
  },
  {
    id: 'refer', category: 'Company', featureKey: 'refer',
    q: 'How do I refer a candidate for a job?',
    a: 'Open Recruitment → Job Postings to see open roles, then use Refer to submit the candidate\'s details and resume. HR tracks the referral through the hiring pipeline.',
    link: '/refer',
  },

  // ── For managers ────────────────────────────────────────────────────────
  {
    id: 'approve-requests', category: 'For managers', roles: MANAGERS,
    q: 'How do I approve my team\'s leave and other requests?',
    a: 'Open Requests in the sidebar (Leave Requests, Regularize Attendance, WFH Requests and so on). Each request shows the employee, dates and reason — Approve or Reject it. You are notified whenever someone in your team submits a new request.',
    link: { admin: '/leaves', manager: '/manager-leaves' },
  },
  {
    id: 'team-attendance', category: 'For managers', roles: MANAGERS, featureKey: 'attendance',
    q: 'How do I see my team\'s attendance?',
    a: 'Managers: open Attendance → Attendance Log for your team\'s daily status and punches. HR sees everyone under Attendance.',
    link: { admin: '/attendance', manager: '/manager-attendance' },
  },
  {
    id: 'punch-approvals', category: 'For managers', roles: MANAGERS, featureKey: 'attendance',
    q: 'What are Punch Approvals?',
    a: 'If your company requires it, punches made from the app or website at certain locations wait for approval. Open Requests → Punch Approvals to approve or reject them; approved punches then count towards attendance.',
    link: { admin: '/punch-approvals', manager: '/manager-punch-approvals' },
  },
  {
    id: 'team-tasks', category: 'For managers', roles: MANAGERS, featureKey: 'tasks',
    q: 'How do I track my team\'s work?',
    a: 'Open Tasks → My Team to see every task assigned to people who report to you, with filters for status, priority and assignee. The Overdue count at the top shows what needs attention.',
    link: '/tasks',
  },

  // ── For HR / admin ──────────────────────────────────────────────────────
  {
    id: 'add-employees', category: 'For HR / admin', roles: ['admin'], featureKey: 'employees',
    q: 'How do I add employees?',
    a: 'Open Employees. Use Add Employee for one person, or Import to upload many at once from an Excel (.xlsx) or CSV file — download the template from the import screen first. You can also share the company join code (Settings → Invite Employees) so people sign up themselves.',
    link: '/employees',
  },
  {
    id: 'run-payroll', category: 'For HR / admin', roles: ['admin'], featureKey: 'run_payroll',
    q: 'How do I run payroll?',
    a: '1. Make sure salary structures are set (Payroll → Salary Structure) and attendance/leave for the month are final.\n2. Open Payroll → Run Payroll, pick the month and review the calculated pay, deductions, advances and one-off items.\n3. Finalise to generate payslips, which employees then see under My Payslips.',
    link: '/payroll',
  },
  {
    id: 'leave-setup', category: 'For HR / admin', roles: ['admin'], featureKey: 'leave_setup',
    q: 'How do I set up leave types and balances?',
    a: 'Settings → Leave Types defines each leave type (paid/unpaid, yearly quota, accrual, carry forward). Leave Balances shows and adjusts each employee\'s balance.',
    link: '/leave-types',
  },
  {
    id: 'holidays-shifts', category: 'For HR / admin', roles: ['admin'],
    q: 'Where do I set holidays, shifts and departments?',
    a: 'Open Settings → General Settings. It has cards for the Holiday Calendar, Shifts (timings and late/early rules), Departments, Attendance & Geofencing and company details.',
    link: '/settings',
  },
  {
    id: 'approval-chains', category: 'For HR / admin', roles: ['admin'], featureKey: 'approval_chains',
    q: 'How do I change who approves requests?',
    a: 'Approvals follow each employee\'s reporting manager (set on their employee profile). For multi-step approval, configure Settings → Approval Chains. The org chart is under Org Structure.',
    link: '/approval-chains',
  },
  {
    id: 'task-channels', category: 'For HR / admin', roles: ['admin'], featureKey: 'tasks',
    q: 'How do I send task alerts to Slack, email or WhatsApp?',
    a: '1. Open Settings → General Settings → Task Notifications & Reminders.\n2. For Slack, create an Incoming Webhook in your Slack workspace (Slack → Apps → Incoming Webhooks), paste the URL and click Test.\n3. Switch on email and/or WhatsApp if available, choose whether to include status changes, and Save.\n\nIn-app and mobile push notifications are always on.',
    link: '/settings',
  },
  {
    id: 'announce', category: 'For HR / admin', roles: ['admin'], featureKey: 'announcements',
    q: 'How do I post an announcement or policy?',
    a: 'Company → Announcements → New announcement for news; Company → Policies to upload a policy document and (optionally) require employees to acknowledge it. Employees are notified.',
    link: '/announcements',
  },
  {
    id: 'reports', category: 'For HR / admin', roles: ['admin'], featureKey: 'master_report',
    q: 'Where are the reports?',
    a: 'Master Report combines attendance, leave and payroll data with filters and export. Attendance also has its own late-comers and monthly views.',
    link: '/master-report',
  },

  // ── Account & security ──────────────────────────────────────────────────
  {
    id: 'forgot-password', category: 'Account & security',
    q: 'I forgot my password.',
    a: 'On the login page click "Forgot password", enter your registered email and use the one-time code (OTP) sent to you to set a new password. If you sign in with a phone number and cannot reset it, ask HR to reset your password.',
    link: '/reset-password',
  },
  {
    id: 'update-profile', category: 'Account & security',
    q: 'How do I update my personal details (phone, address, bank)?',
    a: 'Some details can be changed from your profile; changes to sensitive information (like bank account or phone) may need HR approval before they apply. If a field is locked, ask HR to update it.',
    link: '/me',
  },
  {
    id: 'logged-out', category: 'Account & security',
    q: 'Why was I logged out?',
    a: 'You are signed out when your password is changed (by you or HR) or your session expires. Sign in again; if it keeps happening on the mobile app, update the app to the latest version.',
  },
];

/** Topics visible to this role with these features. */
export function visibleHelpTopics(role, isEnabled = () => true) {
  const r = role === 'superadmin' ? 'admin' : role;
  return HELP_TOPICS.filter((t) => (!t.roles || t.roles.includes(r)) && (!t.featureKey || isEnabled(t.featureKey)));
}

/** Resolve a topic's link for this role (string or role map). */
export function helpTopicLink(topic, role) {
  const l = topic.link;
  if (!l) return null;
  if (typeof l === 'string') return l;
  return l[role] || ((role === 'hod' || role === 'management') ? l.manager : null) || l.employee || l.admin || null;
}
