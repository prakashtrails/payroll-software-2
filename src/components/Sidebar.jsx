import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { getInitials, fullName } from '@/lib/helpers';

const HOME_NAV_ITEM = {
  label: 'Home', icon: 'fa-house', href: '/home',
  flyout: [
    { label: 'Dashboard', href: '/home' },
    { label: 'Welcome', href: '/home?tab=welcome' },
  ],
};

const ME_NAV_ITEM = {
  label: 'Me', icon: 'fa-user', href: '/me',
  flyout: [
    {
      label: 'Attendance', href: '/me?tab=attendance',
      flyout: [
        { label: 'Log', href: '/me?tab=attendance&sub=log' },
        { label: 'Regularize', href: '/me?tab=attendance&sub=regularize' },
        { label: 'Work From Home', href: '/me?tab=attendance&sub=wfh' },
      ],
    },
    { label: 'Leave', href: '/me?tab=leave' },
    { label: 'Performance', href: '/me?tab=performance' },
    { label: 'Tax Declaration', href: '/my-tax-declaration' },
    { label: 'My Training', href: '/my-training' },
  ],
};

const PERFORMANCE_NAV_ITEMS = [
  { label: 'KRAs', icon: 'fa-bullseye', href: '/performance/kras' },
  { label: '1:1 Meetings', icon: 'fa-people-arrows', href: '/performance/one-on-ones' },
  { label: 'Feedback', icon: 'fa-comment-dots', href: '/performance/feedback' },
  { label: 'PIP', icon: 'fa-chart-line', href: '/performance/pip' },
  { label: 'Reviews', icon: 'fa-star', href: '/performance/reviews' },
];

const NAV_CONFIG = {
  superadmin: [
    {
      title: 'Platform',
      items: [
        { label: 'Master Dashboard', icon: 'fa-chart-line', href: '/master-dashboard' },
        { label: 'Tenants', icon: 'fa-building', href: '/tenants' },
        { label: 'All Employees', icon: 'fa-users', href: '/platform-employees' },
        { label: 'Helpdesk', icon: 'fa-headset', href: '/helpdesk-admin' },
      ],
    },
  ],
  admin: [
    {
      title: 'Main',
      items: [
        HOME_NAV_ITEM,
        ME_NAV_ITEM,
        { label: 'All Outlets', icon: 'fa-store', href: '/outlets' },
        { label: 'Combined Dashboard', icon: 'fa-layer-group', href: '/outlets/combined' },
        { label: 'Employees', icon: 'fa-users', href: '/employees' },
        { label: 'Grievances', icon: 'fa-exclamation-circle', href: '/grievances' },
        { label: 'Attendance', icon: 'fa-fingerprint', href: '/attendance' },
        { label: 'Shift Roster', icon: 'fa-calendar-week', href: '/shift-roster' },
        {
          label: 'Requests', icon: 'fa-inbox', href: '/leaves',
          flyout: [
            { label: 'Leave Requests', href: '/leaves' },
            { label: 'Regularize Attendance', href: '/regularize' },
            { label: 'WFH Requests', href: '/wfh-requests' },
            { label: 'Special Requests', href: '/special-requests' },
            { label: 'Expense Claims', href: '/expense-claims' },
            { label: 'Travel Requests', href: '/travel-requests' },
          ],
        },
        {
          label: 'Leave Setup', icon: 'fa-calendar-check', href: '/leave-types',
          flyout: [
            { label: 'Leave Types', href: '/leave-types' },
            { label: 'Leave Balances', href: '/leave-balances' },
          ],
        },
        { label: 'Employee Calendar', icon: 'fa-calendar-day', href: '/employee-calendar' },
        { label: 'Master Report', icon: 'fa-file-alt', href: '/master-report' },
        { label: 'Helpdesk', icon: 'fa-headset', href: '/helpdesk' },
        {
          label: 'Hiring', icon: 'fa-briefcase', href: '/hiring',
          flyout: [
            { label: 'Job Postings', href: '/hiring' },
            { label: 'Headcount Requests', href: '/headcount-requests' },
            { label: 'Interviews', href: '/interviews' },
            { label: 'Offer Letters', href: '/offer-letters' },
            { label: 'Refer', href: '/refer' },
          ],
        },
        { label: 'Announcements', icon: 'fa-bullhorn', href: '/announcements' },
        { label: 'Policies', icon: 'fa-file-contract', href: '/policies' },
        { label: 'Training & Skills', icon: 'fa-graduation-cap', href: '/training' },
      ],
    },
    {
      title: 'Performance',
      items: PERFORMANCE_NAV_ITEMS,
    },
    {
      title: 'Payroll',
      items: [
        { label: 'Salary Structure', icon: 'fa-sliders-h', href: '/salary' },
        { label: 'Run Payroll', icon: 'fa-money-bill-wave', href: '/payroll' },
        { label: 'Payslips', icon: 'fa-file-invoice-dollar', href: '/payslips' },
        { label: 'Advances & Loans', icon: 'fa-hand-holding-usd', href: '/advances' },
        { label: 'One-Off Pay Items', icon: 'fa-coins', href: '/salary-additions' },
        { label: 'Income Tax Slabs', icon: 'fa-receipt', href: '/tax-slabs' },
      ],
    },
    {
      title: 'System',
      items: [
        { label: 'Approval Chains', icon: 'fa-route', href: '/approval-chains' },
        { label: 'Settings', icon: 'fa-cog', href: '/settings' },
      ],
    },
  ],
  manager: [
    {
      title: 'Main',
      items: [
        HOME_NAV_ITEM,
        ME_NAV_ITEM,
        { label: 'Employees', icon: 'fa-users', href: '/manager-employees' },
        { label: 'Attendance', icon: 'fa-fingerprint', href: '/manager-attendance' },
        {
          label: 'Requests', icon: 'fa-inbox', href: '/manager-leaves',
          flyout: [
            { label: 'Leave Requests', href: '/manager-leaves' },
            { label: 'Regularize Attendance', href: '/manager-regularize' },
            { label: 'WFH Requests', href: '/manager-wfh-requests' },
            { label: 'Special Requests', href: '/manager-special-requests' },
            { label: 'Expense Claims', href: '/expense-claims' },
            { label: 'Travel Requests', href: '/travel-requests' },
          ],
        },
        { label: 'Employee Calendar', icon: 'fa-calendar-day', href: '/manager-employee-calendar' },
        {
          label: 'Hiring', icon: 'fa-briefcase', href: '/hiring',
          flyout: [
            { label: 'Job Postings', href: '/hiring' },
            { label: 'Headcount Requests', href: '/headcount-requests' },
            { label: 'Interviews', href: '/interviews' },
            { label: 'Offer Letters', href: '/offer-letters' },
            { label: 'Refer', href: '/refer' },
          ],
        },
        { label: 'Announcements', icon: 'fa-bullhorn', href: '/announcements' },
        { label: 'Policies', icon: 'fa-file-contract', href: '/policies' },
        { label: 'Grievances', icon: 'fa-exclamation-circle', href: '/grievances' },
      ],
    },
    {
      title: 'Performance',
      items: PERFORMANCE_NAV_ITEMS,
    },
    {
      title: 'Payroll',
      items: [
        { label: 'Payroll', icon: 'fa-money-bill-wave', href: '/manager-payroll' },
        { label: 'Payslips', icon: 'fa-file-invoice-dollar', href: '/manager-payslips' },
        { label: 'Advances & Loans', icon: 'fa-hand-holding-usd', href: '/manager-advances' },
        { label: 'One-Off Pay Items', icon: 'fa-coins', href: '/manager-salary-additions' },
      ],
    },
  ],
  employee: [
    {
      title: 'My Space',
      items: [
        HOME_NAV_ITEM,
        ME_NAV_ITEM,
        { label: 'My Payslips', icon: 'fa-file-invoice-dollar', href: '/my-payslips' },
        { label: 'Special Requests', icon: 'fa-star-half-alt', href: '/my-special-requests' },
        { label: 'Expense Claims', icon: 'fa-receipt', href: '/expense-claims' },
        { label: 'Travel Requests', icon: 'fa-plane', href: '/travel-requests' },
        {
          label: 'Hiring', icon: 'fa-briefcase', href: '/hiring',
          flyout: [
            { label: 'Job Postings', href: '/hiring' },
            { label: 'My Interviews', href: '/interviews' },
            { label: 'Refer', href: '/refer' },
          ],
        },
        { label: 'Announcements', icon: 'fa-bullhorn', href: '/announcements' },
        { label: 'Policies', icon: 'fa-file-contract', href: '/policies' },
        { label: 'Grievances', icon: 'fa-exclamation-circle', href: '/grievances' },
      ],
    },
    {
      title: 'Performance',
      items: PERFORMANCE_NAV_ITEMS,
    },
  ],
};



// iOS/touch browsers have no real hover — an element with a mouseenter
// listener needs a first "confirming" tap before a second tap registers as a
// click, which would make a hover-flyout nav item unusable on a phone.
// Detecting real hover support up front lets touch devices skip the flyout
// wiring entirely and get a plain, single-tap link instead.
const supportsHover = typeof window !== 'undefined'
  && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Closing the flyout the instant the pointer leaves the trigger makes it nearly
// unusable — the flyout renders via position:fixed off to the side, so crossing
// the gap to reach it passes over page content that isn't a descendant of the
// trigger, firing mouseleave before the pointer arrives. A short grace period
// (cancelled if the pointer lands on the trigger OR the flyout) covers that gap.
const FLYOUT_CLOSE_DELAY = 300;

// A flyout entry that itself has a `flyout` (e.g. Attendance's Log/Regularize/WFH)
// opens a second-level menu to its right, using the same hover-delay dance as
// the top-level trigger so the gap between the two panels doesn't close it.
function FlyoutItem({ item, onNavigate }) {
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const closeTimer = useRef(null);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  if (!item.flyout) {
    return (
      <Link to={item.href} className="nav-flyout-item" onClick={onNavigate}>
        {item.label}
      </Link>
    );
  }

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHover(false), FLYOUT_CLOSE_DELAY);
  };

  const handleEnter = () => {
    cancelClose();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setCoords({ top: rect.top, left: rect.right + 6 });
    }
    setHover(true);
  };

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={scheduleClose}>
      <Link to={item.href} className="nav-flyout-item nav-flyout-item-parent" onClick={onNavigate}>
        {item.label}
        <i className="fas fa-chevron-right nav-flyout-arrow" />
      </Link>
      {hover && (
        <div
          className="nav-flyout" style={{ top: coords.top, left: coords.left }}
          onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
        >
          {item.flyout.map((f) => (
            <FlyoutItem key={f.href} item={f} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

// Matches the current pathname against an item's own href OR (recursively) any
// of its flyout children's hrefs — so a parent like "Requests", whose four
// sub-pages each have a distinct pathname (unlike Home/Me's shared '/home'
// '/me' base), still highlights as active while on any of them.
function itemMatchesPath(item, pathname) {
  if (item.href.split('?')[0] === pathname) return true;
  return !!item.flyout?.some((f) => itemMatchesPath(f, pathname));
}

function NavItem({ item, pathname, onClose }) {
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const closeTimer = useRef(null);
  const isActive = itemMatchesPath(item, pathname);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  if (!item.flyout || !supportsHover) {
    return (
      <Link to={item.href} className={`nav-item ${isActive ? 'active' : ''}`} onClick={onClose}>
        <span className="icon"><i className={`fas ${item.icon}`} /></span>
        {item.label}
      </Link>
    );
  }

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHover(false), FLYOUT_CLOSE_DELAY);
  };

  const handleEnter = () => {
    cancelClose();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setCoords({ top: rect.top, left: rect.right + 6 });
    }
    setHover(true);
  };

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={scheduleClose}>
      <Link to={item.href} className={`nav-item ${isActive ? 'active' : ''}`} onClick={onClose}>
        <span className="icon"><i className={`fas ${item.icon}`} /></span>
        {item.label}
        <i className="fas fa-chevron-right nav-item-arrow" />
      </Link>
      {hover && (
        <div
          className="nav-flyout" style={{ top: coords.top, left: coords.left }}
          onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
        >
          {item.flyout.map((f) => (
            <FlyoutItem
              key={f.href} item={f}
              onNavigate={() => { cancelClose(); setHover(false); onClose(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ open = false, onClose = () => {} }) {
  const { profile, tenant, signOut } = useAuth();
  const { outlets, selectedOutletName } = useOutletView();
  const location = useLocation();
  const pathname = location.pathname;

  if (!profile) return null;

  const role = profile.role || 'employee';

  // Inject Group Dashboard link for admin/superadmin when tenant is part of a group
  const rawSections = NAV_CONFIG[role] || NAV_CONFIG.employee;
  const withGroupDashboard = (role === 'admin' || role === 'superadmin') && tenant?.group_code
    ? rawSections.map(section =>
        section.title === 'Main'
          ? {
              ...section,
              items: [
                section.items[0], // Home
                { label: 'Group Dashboard', icon: 'fa-layer-group', href: '/group-dashboard' },
                ...section.items.slice(1),
              ],
            }
          : section
      )
    : rawSections;

  // "Combined Dashboard" only makes sense with 2+ outlets to combine — one outlet's
  // totals are just the company's totals, so hide it rather than show a pointless duplicate.
  const sections = outlets.length > 1
    ? withGroupDashboard
    : withGroupDashboard.map(section => ({
        ...section,
        items: section.items.filter(item => item.href !== '/outlets/combined'),
      }));

  const initials = getInitials(profile.first_name, profile.last_name);
  const displayName = fullName(profile) || 'User';
  const roleLabel = role === 'superadmin' ? 'Super Admin' : role === 'admin' ? 'HR' : role === 'manager' ? 'Manager' : 'Employee';

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
      <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">
        <i className="fas fa-times" />
      </button>
      <div className="sidebar-logo">
        <div className="logo-icon"><img src="/logo.png" alt="CrewCore" /></div>
        <div>
          <h2>CrewCore</h2>
          <span>{tenant?.company_name || 'CrewCore'}</span>
          {(role === 'admin' || role === 'superadmin') && outlets.length > 0 && (
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
              <i className="fas fa-store" style={{ marginRight: 4 }} />
              Viewing: {selectedOutletName || 'All Outlets'}
            </div>
          )}
        </div>
      </div>

      <nav className="sidebar-nav">
        {sections.map((section, si) => (
          <div className="nav-section" key={si}>
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => (
              <NavItem key={item.href} item={item} pathname={pathname} onClose={onClose} />
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div className="user-info">
            {displayName}
            <span>{roleLabel}</span>
          </div>
          <button className="logout-btn" onClick={signOut} title="Sign Out">
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
