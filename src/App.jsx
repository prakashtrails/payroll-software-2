import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Pages
import HomePage from './pages/HomePage';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';

import DashboardPage from './pages/dashboard/DashboardPage';
import EmployeesPage from './pages/dashboard/EmployeesPage';
import AttendancePage from './pages/dashboard/AttendancePage';
import SalaryPage from './pages/dashboard/SalaryPage';
import PayrollPage from './pages/dashboard/PayrollPage';
import PayslipsPage from './pages/dashboard/PayslipsPage';

import LeavesPage from './pages/dashboard/LeavesPage';
import AdvancesPage from './pages/dashboard/AdvancesPage';
import SettingsPage from './pages/dashboard/SettingsPage';
import TenantsPage from './pages/dashboard/TenantsPage';
import RegularizeAttendancePage from './pages/dashboard/RegularizeAttendancePage';
import SpecialRequestsPage from './pages/dashboard/SpecialRequestsPage';
import EmployeeCalendarPage from './pages/dashboard/EmployeeCalendarPage';

import ManagerDashboardPage from './pages/dashboard/ManagerDashboardPage';

import EmployeeDashboard from './pages/employee/DashboardPage';
import MyAttendancePage from './pages/employee/MyAttendancePage';
import MyLeavesPage from './pages/employee/MyLeavesPage';
import MyPayslipsPage from './pages/employee/MyPayslipsPage';
import MySpecialRequestsPage from './pages/employee/MySpecialRequestsPage';

// Layouts
import DashboardLayout from './layouts/DashboardLayout';
import AuthLayout from './layouts/AuthLayout';

function homeFor(role) {
  if (role === 'employee') return '/my-dashboard';
  if (role === 'manager')  return '/manager-dashboard';
  return '/dashboard';
}

function PrivateRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner"></div></div>;
  }

  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={homeFor(profile.role)} replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route element={<DashboardLayout />}>
        {/* Admin Routes */}
        <Route path="/dashboard" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><DashboardPage /></PrivateRoute>} />
        <Route path="/employees" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><EmployeesPage /></PrivateRoute>} />
        <Route path="/attendance" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><AttendancePage /></PrivateRoute>} />
        <Route path="/salary" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><SalaryPage /></PrivateRoute>} />
        <Route path="/payroll" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><PayrollPage /></PrivateRoute>} />
        <Route path="/payslips" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><PayslipsPage /></PrivateRoute>} />
        <Route path="/leaves" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><LeavesPage /></PrivateRoute>} />
        <Route path="/advances" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><AdvancesPage /></PrivateRoute>} />
        <Route path="/special-requests" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><SpecialRequestsPage /></PrivateRoute>} />
        <Route path="/employee-calendar" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><EmployeeCalendarPage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><SettingsPage /></PrivateRoute>} />
        <Route path="/regularize" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><RegularizeAttendancePage /></PrivateRoute>} />
        
        {/* Manager Routes */}
        <Route path="/manager-dashboard" element={<PrivateRoute allowedRoles={['manager']}><ManagerDashboardPage /></PrivateRoute>} />
        <Route path="/manager-employees" element={<PrivateRoute allowedRoles={['manager']}><EmployeesPage /></PrivateRoute>} />
        <Route path="/manager-attendance" element={<PrivateRoute allowedRoles={['manager']}><AttendancePage /></PrivateRoute>} />
        <Route path="/manager-leaves" element={<PrivateRoute allowedRoles={['manager']}><LeavesPage /></PrivateRoute>} />
        <Route path="/manager-special-requests" element={<PrivateRoute allowedRoles={['manager']}><SpecialRequestsPage /></PrivateRoute>} />
        <Route path="/manager-employee-calendar" element={<PrivateRoute allowedRoles={['manager']}><EmployeeCalendarPage /></PrivateRoute>} />
        <Route path="/manager-settings" element={<PrivateRoute allowedRoles={['manager']}><SettingsPage /></PrivateRoute>} />
        <Route path="/manager-regularize" element={<PrivateRoute allowedRoles={['manager']}><RegularizeAttendancePage /></PrivateRoute>} />
        
        {/* Superadmin specific */}
        <Route path="/tenants" element={<PrivateRoute allowedRoles={['superadmin']}><TenantsPage /></PrivateRoute>} />

        {/* Employee Routes */}
        <Route path="/my-dashboard" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><EmployeeDashboard /></PrivateRoute>} />
        <Route path="/my-attendance" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyAttendancePage /></PrivateRoute>} />
        <Route path="/my-leaves" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyLeavesPage /></PrivateRoute>} />
        <Route path="/my-special-requests" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MySpecialRequestsPage /></PrivateRoute>} />
        <Route path="/my-payslips" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyPayslipsPage /></PrivateRoute>} />
      </Route>
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
