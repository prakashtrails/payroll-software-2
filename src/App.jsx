import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Pages
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';

import DashboardPage from './pages/dashboard/DashboardPage';
import EmployeesPage from './pages/dashboard/EmployeesPage';
import AttendancePage from './pages/dashboard/AttendancePage';
import SalaryPage from './pages/dashboard/SalaryPage';
import PayrollPage from './pages/dashboard/PayrollPage';
import PayslipsPage from './pages/dashboard/PayslipsPage';
import AdvancesPage from './pages/dashboard/AdvancesPage';
import SettingsPage from './pages/dashboard/SettingsPage';
import TenantsPage from './pages/dashboard/TenantsPage';

import EmployeeDashboard from './pages/employee/DashboardPage';
import MyAttendancePage from './pages/employee/MyAttendancePage';
import MyPayslipsPage from './pages/employee/MyPayslipsPage';

// Layouts
import DashboardLayout from './layouts/DashboardLayout';
import AuthLayout from './layouts/AuthLayout';

function PrivateRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();
  
  if (loading) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner"></div></div>;
  }
  
  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />; // or to some unauthorized page
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      <Route element={<DashboardLayout />}>
        {/* Admin/Manager Routes */}
        <Route path="/dashboard" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><DashboardPage /></PrivateRoute>} />
        <Route path="/employees" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><EmployeesPage /></PrivateRoute>} />
        <Route path="/attendance" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><AttendancePage /></PrivateRoute>} />
        <Route path="/salary" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><SalaryPage /></PrivateRoute>} />
        <Route path="/payroll" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><PayrollPage /></PrivateRoute>} />
        <Route path="/payslips" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><PayslipsPage /></PrivateRoute>} />
        <Route path="/advances" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><AdvancesPage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><SettingsPage /></PrivateRoute>} />
        
        {/* Superadmin specific */}
        <Route path="/tenants" element={<PrivateRoute allowedRoles={['superadmin']}><TenantsPage /></PrivateRoute>} />

        {/* Employee Routes */}
        <Route path="/my-dashboard" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><EmployeeDashboard /></PrivateRoute>} />
        <Route path="/my-attendance" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyAttendancePage /></PrivateRoute>} />
        <Route path="/my-payslips" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyPayslipsPage /></PrivateRoute>} />
      </Route>
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
