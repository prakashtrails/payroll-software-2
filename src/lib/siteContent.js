// Public website content (landing page "/" and "/erp"). Edit copy here —
// the pages only lay it out.

export const SUPPORT_EMAIL = 'crewcoreadmin@gmail.com';

/** "New in CrewCore" cards on the landing page (pending-list item 4). */
export const WHATS_NEW = [
  {
    icon: 'fa-list-check', title: 'Task Management',
    text: 'Create, assign and track tasks with priorities, due dates, a board view, comments and full status history — across your reporting team.',
  },
  {
    icon: 'fa-bell', title: 'Reminders on Slack, WhatsApp & Email',
    text: 'A 9 AM digest of due and overdue tasks, plus instant alerts for assignments and status changes on the channels your team already uses.',
  },
  {
    icon: 'fa-robot', title: 'AI Assistant', badge: 'Add-on',
    text: 'Ask in plain language: "How many leaves do I have?", "Show my overdue tasks", "Create a task for Friday". It only sees what you are allowed to see.',
  },
  {
    icon: 'fa-microphone-lines', title: 'AI Meeting Notes', badge: 'Add-on',
    text: 'Paste or upload a Meet, Zoom or Teams transcript. CrewCore writes the summary and turns every action item into an assigned task.',
  },
  {
    icon: 'fa-bullseye', title: 'Performance Management',
    text: 'Company goals cascading to KPI scorecards, monthly updates with manager approval, review cycles, 360° feedback and analytics.',
  },
  {
    icon: 'fa-globe', title: 'Careers Page & Hiring Pipeline',
    text: 'A public careers page for your open roles, candidates from every source in one pipeline, interviews, background checks and offer letters.',
  },
  {
    icon: 'fa-location-dot', title: 'Live Tracking & Geofencing', badge: 'Add-on',
    text: 'Geofenced clock-in per outlet and opt-in live tracking for field teams, with routes and time on site.',
  },
  {
    icon: 'fa-mobile-screen', title: 'SMS OTP Login',
    text: 'Staff without a work email sign in with a one-time code on their mobile — no passwords to forget.',
  },
];

/**
 * "Trusted by" strip (pending-list item 5). Add only clients who agreed to be
 * listed publicly. The section stays hidden while this list is empty.
 *   { name: 'Company name', logo: '/clients/company.png' (optional), sector: 'Retail' (optional) }
 */
export const CLIENTS = [];

/** /erp "coming soon" page (pending-list item 6). */
export const ERP_MODULES = [
  { icon: 'fa-boxes-stacked', title: 'Inventory & Warehouses', text: 'Stock across outlets and warehouses, batches, transfers and low-stock alerts.' },
  { icon: 'fa-cart-shopping', title: 'Purchase', text: 'Purchase requests, orders, vendor management and goods receipt.' },
  { icon: 'fa-file-invoice', title: 'Sales & GST Invoicing', text: 'Quotations, orders and GST-compliant invoices with e-invoice and e-way bill support.' },
  { icon: 'fa-scale-balanced', title: 'Accounts', text: 'Ledgers, receivables, payables and bank reconciliation — with payroll posted automatically from CrewCore.' },
  { icon: 'fa-handshake', title: 'CRM', text: 'Leads, follow-ups and customer history, assigned as CrewCore tasks to your sales team.' },
  { icon: 'fa-chart-pie', title: 'Reports & Dashboards', text: 'Branch-wise sales, margins, stock and cost of people in one view.' },
];
