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
  admin: [
    {
      title: 'Main',
      items: [
        { label: 'Dashboard', icon: 'fa-th-large', href: '/dashboard' },
        { label: 'Employees', icon: 'fa-users', href: '/employees' },
        { label: 'Attendance', icon: 'fa-fingerprint', href: '/attendance' },
        { label: 'Regularize Attendance', icon: 'fa-file-alt', href: '/regularize' },
        { label: 'Leave Requests', icon: 'fa-calendar-check', href: '/leaves' },
        { label: 'Special Requests', icon: 'fa-star-half-alt', href: '/special-requests' },
        { label: 'Employee Calendar', icon: 'fa-calendar-day', href: '/employee-calendar' },
        { label: 'Master Report', icon: 'fa-file-alt', href: '/master-report' },
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
  manager: [
    {
      title: 'Main',
      items: [
        { label: 'Dashboard', icon: 'fa-th-large', href: '/manager-dashboard' },
        { label: 'Employees', icon: 'fa-users', href: '/manager-employees' },
        { label: 'Attendance', icon: 'fa-fingerprint', href: '/manager-attendance' },
        { label: 'Regularize Attendance', icon: 'fa-file-alt', href: '/manager-regularize' },
        { label: 'Leave Requests', icon: 'fa-calendar-check', href: '/manager-leaves' },
        { label: 'Special Requests', icon: 'fa-star-half-alt', href: '/manager-special-requests' },
        { label: 'Employee Calendar', icon: 'fa-calendar-day', href: '/manager-employee-calendar' },
      ],
    },
    {
      title: 'Payroll',
      items: [
        { label: 'Payroll', icon: 'fa-money-bill-wave', href: '/manager-payroll' },
        { label: 'Payslips', icon: 'fa-file-invoice-dollar', href: '/manager-payslips' },
        { label: 'Advances & Loans', icon: 'fa-hand-holding-usd', href: '/manager-advances' },
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
        { label: 'My Leaves', icon: 'fa-calendar-alt', href: '/my-leaves' },
        { label: 'Special Requests', icon: 'fa-star-half-alt', href: '/my-special-requests' },
      ],
    },
  ],
};



export default function Sidebar() {
  const { profile, tenant, signOut } = useAuth();
  const location = useLocation();
  const pathname = location.pathname;

  if (!profile) return null;

  const role = profile.role || 'employee';
  const sections = NAV_CONFIG[role] || NAV_CONFIG.employee;

  const initials = getInitials(profile.first_name, profile.last_name);
  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'User';
  const roleLabel = role === 'superadmin' ? 'Super Admin' : role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Employee';

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
