import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getInitials } from '@/lib/helpers';

const NAV_CONFIG = {
  superadmin: [
    {
      title: 'Platform',
      items: [
        { label: 'Dashboard', icon: 'fa-th-large', href: '/dashboard' },
        { label: 'Tenants', icon: 'fa-building', href: '/tenants' },
      ],
    },
  ],
  manager: [
    {
      title: 'Main',
      items: [
        { label: 'Dashboard', icon: 'fa-th-large', href: '/dashboard' },
        { label: 'Employees', icon: 'fa-users', href: '/employees' },
        { label: 'Attendance', icon: 'fa-fingerprint', href: '/attendance' },
      ],
    },
    {
      title: 'Payroll',
      items: [
        { label: 'Salary Structure', icon: 'fa-sliders-h', href: '/salary' },
        { label: 'Run Payroll', icon: 'fa-money-bill-wave', href: '/payroll' },
        { label: 'Payslips', icon: 'fa-file-invoice-dollar', href: '/payslips' },
        { label: 'Advances & Loans', icon: 'fa-hand-holding-usd', href: '/advances' },
      ],
    },
    {
      title: 'System',
      items: [
        { label: 'Settings', icon: 'fa-cog', href: '/settings' },
      ],
    },
  ],
  employee: [
    {
      title: 'My Space',
      items: [
        { label: 'Dashboard', icon: 'fa-th-large', href: '/my-dashboard' },
        { label: 'My Attendance', icon: 'fa-fingerprint', href: '/my-attendance' },
        { label: 'My Payslips', icon: 'fa-file-invoice-dollar', href: '/my-payslips' },
      ],
    },
  ],
};

// Aliases for admin
NAV_CONFIG['admin'] = NAV_CONFIG['manager'];

export default function Sidebar() {
  const { profile, tenant, signOut } = useAuth();
  const location = useLocation();
  const pathname = location.pathname;

  if (!profile) return null;

  const role = profile.role || 'employee';
  const sections = NAV_CONFIG[role] || NAV_CONFIG.employee;

  const initials = getInitials(profile.first_name, profile.last_name);
  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'User';
  const roleLabel = role === 'superadmin' ? 'Super Admin' : role === 'manager' || role === 'admin' ? 'Manager' : 'Employee';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">P</div>
        <div>
          <h2>PayrollPro</h2>
          <span>{tenant?.company_name || 'Payroll Suite'}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {sections.map((section, si) => (
          <div className="nav-section" key={si}>
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={`nav-item ${pathname === item.href ? 'active' : ''}`}
              >
                <span className="icon">
                  <i className={`fas ${item.icon}`} />
                </span>
                {item.label}
              </Link>
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
  );
}
