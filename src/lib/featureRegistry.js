// Single source of truth for every toggleable CrewCore feature. This is what
// makes new features show up for the superadmin automatically: add one entry
// here in the same commit/PR that ships the feature, and the next time
// anyone opens Toggle Services, featureService.syncFeatureRegistry() upserts
// it into the `features` table — no separate SQL migration needed to make it
// visible/toggleable (the table itself still exists for company_feature_toggles'
// FK and for RLS-scoped reads, this file is just what keeps it in sync).
//
// Dashboard/Home, "Me", and Settings are deliberately absent — they stay
// always-on so a company never loses its landing page or the ability to fix
// its own configuration.
export const FEATURE_REGISTRY = [
  { key: 'employees', name: 'Employees', category: 'General', description: 'Employee directory, profiles, and records management.', sort_order: 10 },
  { key: 'attendance', name: 'Attendance', category: 'General', description: 'Daily attendance, punches, and attendance overview.', sort_order: 20 },
  { key: 'shift_roster', name: 'Shift Roster', category: 'General', description: 'Assigning employees to shifts and roster planning.', sort_order: 30 },
  { key: 'employee_calendar', name: 'Employee Calendar', category: 'General', description: 'Calendar view of leave, holidays, and attendance.', sort_order: 40 },
  { key: 'master_report', name: 'Master Report', category: 'General', description: 'Consolidated cross-module reporting.', sort_order: 50 },
  { key: 'helpdesk', name: 'Helpdesk', category: 'General', description: 'Internal support ticketing for employees.', sort_order: 60 },
  { key: 'announcements', name: 'Announcements', category: 'General', description: 'Company-wide announcements and notices.', sort_order: 70 },
  { key: 'policies', name: 'Policies', category: 'General', description: 'Company policy documents.', sort_order: 80 },
  { key: 'onboarding', name: 'Onboarding', category: 'General', description: 'New-hire onboarding checklists and tracking.', sort_order: 91 },
  { key: 'offboarding', name: 'Offboarding', category: 'General', description: 'Employee exit checklists and tracking.', sort_order: 92 },
  { key: 'training', name: 'Training & Skills', category: 'General', description: 'Training programs and skill tracking.', sort_order: 90 },
  { key: 'assets', name: 'Assets', category: 'General', description: 'Company equipment inventory and assignment tracking.', sort_order: 93 },
  { key: 'projects', name: 'Projects', category: 'General', description: 'Project tracking and task assignment.', sort_order: 94 },
  { key: 'grievances', name: 'Grievances', category: 'General', description: 'Employee grievance submission and resolution.', sort_order: 100 },
  { key: 'outlets_multi_branch', name: 'Outlets / Multi-Branch', category: 'General', description: 'Multi-outlet overview, combined and group dashboards.', sort_order: 110 },

  { key: 'leave_requests', name: 'Leave Requests', category: 'Requests', description: 'Employee leave request submission and approval.', sort_order: 200 },
  { key: 'regularize_attendance', name: 'Regularize Attendance', category: 'Requests', description: 'Requests to correct missed or incorrect punches.', sort_order: 210 },
  { key: 'wfh_requests', name: 'Work From Home', category: 'Requests', description: 'Work-from-home request submission and approval.', sort_order: 220 },
  { key: 'special_requests', name: 'Special Requests', category: 'Requests', description: 'Miscellaneous employee requests.', sort_order: 230 },
  { key: 'expense_claims', name: 'Expense Claims', category: 'Requests', description: 'Expense claim submission and reimbursement.', sort_order: 240 },
  { key: 'travel_requests', name: 'Travel Requests', category: 'Requests', description: 'Business travel request and approval.', sort_order: 250 },
  { key: 'leave_setup', name: 'Leave Setup', category: 'Requests', description: 'Leave type and leave balance configuration.', sort_order: 260 },
  { key: 'tax_declaration', name: 'Tax Declaration', category: 'Requests', description: 'Employee income tax declaration.', sort_order: 270 },

  { key: 'hiring', name: 'Job Postings', category: 'Hiring', description: 'Open job postings and candidate pipeline.', sort_order: 300 },
  { key: 'recruitment_pipeline', name: 'Recruitment Pipeline', category: 'Hiring', description: 'End-to-end candidate pipeline: requisition, interviews, offer, and onboarding hand-off, mapped to the recruitment SOP.', sort_order: 305 },
  { key: 'headcount_requests', name: 'Headcount Requests', category: 'Hiring', description: 'Requests to open new headcount.', sort_order: 310 },
  { key: 'interviews', name: 'Interviews', category: 'Hiring', description: 'Interview scheduling and feedback.', sort_order: 320 },
  { key: 'offer_letters', name: 'Offer Letters', category: 'Hiring', description: 'Offer letter generation and tracking.', sort_order: 330 },
  { key: 'refer', name: 'Refer a Candidate', category: 'Hiring', description: 'Employee referral submissions.', sort_order: 340 },

  { key: 'performance_kras', name: 'KRAs', category: 'Performance', description: 'Key result area goal tracking.', sort_order: 400 },
  { key: 'performance_one_on_ones', name: '1:1 Meetings', category: 'Performance', description: 'One-on-one meeting scheduling and notes.', sort_order: 410 },
  { key: 'performance_feedback', name: 'Feedback', category: 'Performance', description: 'Peer and manager feedback.', sort_order: 420 },
  { key: 'performance_pip', name: 'PIP', category: 'Performance', description: 'Performance improvement plans.', sort_order: 430 },
  { key: 'performance_reviews', name: 'Reviews', category: 'Performance', description: 'Formal performance review cycles.', sort_order: 440 },

  { key: 'salary_structure', name: 'Salary Structure', category: 'Payroll', description: 'Employee salary component structure.', sort_order: 500 },
  { key: 'run_payroll', name: 'Run Payroll', category: 'Payroll', description: 'Monthly payroll processing.', sort_order: 510 },
  { key: 'payslips', name: 'Payslips', category: 'Payroll', description: 'Payslip generation and access.', sort_order: 520 },
  { key: 'advances_loans', name: 'Advances & Loans', category: 'Payroll', description: 'Employee salary advances and loans.', sort_order: 530 },
  { key: 'salary_additions', name: 'One-Off Pay Items', category: 'Payroll', description: 'One-time additions or deductions to pay.', sort_order: 540 },
  { key: 'tax_slabs', name: 'Income Tax Slabs', category: 'Payroll', description: 'Income tax slab configuration.', sort_order: 550 },

  { key: 'approval_chains', name: 'Approval Chains', category: 'System', description: 'Multi-step approval workflow configuration.', sort_order: 600 },
];
