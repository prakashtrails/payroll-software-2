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
import AllEmployeesPage from './pages/dashboard/AllEmployeesPage';
import MasterDashboardPage from './pages/dashboard/MasterDashboardPage';
import HelpdeskPage from './pages/dashboard/HelpdeskPage';
import HelpdeskAdminPage from './pages/dashboard/HelpdeskAdminPage';
import HiringPage from './pages/dashboard/HiringPage';
import ReferPage from './pages/dashboard/ReferPage';
import RegularizeAttendancePage from './pages/dashboard/RegularizeAttendancePage';
import WFHRequestsPage from './pages/dashboard/WFHRequestsPage';
import SpecialRequestsPage from './pages/dashboard/SpecialRequestsPage';
import EmployeeCalendarPage from './pages/dashboard/EmployeeCalendarPage';
import MasterReportPage from './pages/dashboard/MasterReportPage';
import GroupDashboardPage from './pages/dashboard/GroupDashboardPage';
import OutletsOverviewPage from './pages/dashboard/OutletsOverviewPage';
import CombinedOutletDashboardPage from './pages/dashboard/CombinedOutletDashboardPage';
import AnnouncementsPage from './pages/dashboard/AnnouncementsPage';
import PoliciesPage from './pages/dashboard/PoliciesPage';
import KRAsPage from './pages/dashboard/KRAsPage';
import FeedbackPage from './pages/dashboard/FeedbackPage';
import PIPPage from './pages/dashboard/PIPPage';
import ReviewsPage from './pages/dashboard/ReviewsPage';
import OneOnOnesPage from './pages/dashboard/OneOnOnesPage';
import TaxSlabsPage from './pages/dashboard/TaxSlabsPage';
import SalaryAdditionsPage from './pages/dashboard/SalaryAdditionsPage';
import LeaveTypesPage from './pages/dashboard/LeaveTypesPage';
import LeaveBalancesPage from './pages/dashboard/LeaveBalancesPage';
import ShiftAssignmentsPage from './pages/dashboard/ShiftAssignmentsPage';
import GrievancePage from './pages/dashboard/GrievancePage';
import HeadcountRequestsPage from './pages/dashboard/HeadcountRequestsPage';
import InterviewsPage from './pages/dashboard/InterviewsPage';
import OfferLettersPage from './pages/dashboard/OfferLettersPage';
import TrainingPage from './pages/dashboard/TrainingPage';
import MyTrainingPage from './pages/employee/MyTrainingPage';
import ExpenseClaimsPage from './pages/dashboard/ExpenseClaimsPage';
import TravelRequestsPage from './pages/dashboard/TravelRequestsPage';
import ApprovalChainsPage from './pages/dashboard/ApprovalChainsPage';

import ManagerDashboardPage from './pages/dashboard/ManagerDashboardPage';

import EmployeeDashboard from './pages/employee/DashboardPage';
import MyAttendancePage from './pages/employee/MyAttendancePage';
import MyLeavesPage from './pages/employee/MyLeavesPage';
import MyPayslipsPage from './pages/employee/MyPayslipsPage';
import TaxDeclarationPage from './pages/employee/TaxDeclarationPage';
import MySpecialRequestsPage from './pages/employee/MySpecialRequestsPage';
import MyRegularizeRequestsPage from './pages/employee/MyRegularizeRequestsPage';
import MyWfhRequestsPage from './pages/employee/MyWfhRequestsPage';
import MePage from './pages/employee/MePage';
import HomePageTab from './pages/home/HomePage';

// Layouts
import DashboardLayout from './layouts/DashboardLayout';
import AuthLayout from './layouts/AuthLayout';

function homeFor(role) {
  if (role === 'superadmin') return '/master-dashboard';
  return '/home';
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
        <Route path="/shift-roster" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><ShiftAssignmentsPage /></PrivateRoute>} />
        <Route path="/salary" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><SalaryPage /></PrivateRoute>} />
        <Route path="/payroll" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><PayrollPage /></PrivateRoute>} />
        <Route path="/payslips" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><PayslipsPage /></PrivateRoute>} />
        <Route path="/tax-slabs" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><TaxSlabsPage /></PrivateRoute>} />
        <Route path="/salary-additions" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><SalaryAdditionsPage /></PrivateRoute>} />
        <Route path="/leaves" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><LeavesPage /></PrivateRoute>} />
        <Route path="/leave-types" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><LeaveTypesPage /></PrivateRoute>} />
        <Route path="/leave-balances" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><LeaveBalancesPage /></PrivateRoute>} />
        <Route path="/advances" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><AdvancesPage /></PrivateRoute>} />
        <Route path="/special-requests" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><SpecialRequestsPage /></PrivateRoute>} />
        <Route path="/employee-calendar" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><EmployeeCalendarPage /></PrivateRoute>} />
        <Route path="/master-report" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><MasterReportPage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><SettingsPage /></PrivateRoute>} />
        <Route path="/approval-chains" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><ApprovalChainsPage /></PrivateRoute>} />
        <Route path="/regularize" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><RegularizeAttendancePage /></PrivateRoute>} />
        <Route path="/wfh-requests" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><WFHRequestsPage /></PrivateRoute>} />
        <Route path="/group-dashboard" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><GroupDashboardPage /></PrivateRoute>} />
        <Route path="/outlets" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><OutletsOverviewPage /></PrivateRoute>} />
        <Route path="/outlets/combined" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><CombinedOutletDashboardPage /></PrivateRoute>} />
        <Route path="/helpdesk" element={<PrivateRoute allowedRoles={['admin']}><HelpdeskPage /></PrivateRoute>} />

        {/* Manager Routes */}
        <Route path="/manager-dashboard" element={<PrivateRoute allowedRoles={['manager']}><ManagerDashboardPage /></PrivateRoute>} />
        <Route path="/manager-employees" element={<PrivateRoute allowedRoles={['manager']}><EmployeesPage /></PrivateRoute>} />
        <Route path="/manager-attendance" element={<PrivateRoute allowedRoles={['manager']}><AttendancePage /></PrivateRoute>} />
        <Route path="/manager-leaves" element={<PrivateRoute allowedRoles={['manager']}><LeavesPage /></PrivateRoute>} />
        <Route path="/manager-special-requests" element={<PrivateRoute allowedRoles={['manager']}><SpecialRequestsPage /></PrivateRoute>} />
        <Route path="/manager-employee-calendar" element={<PrivateRoute allowedRoles={['manager']}><EmployeeCalendarPage /></PrivateRoute>} />
        <Route path="/manager-regularize" element={<PrivateRoute allowedRoles={['manager']}><RegularizeAttendancePage /></PrivateRoute>} />
        <Route path="/manager-wfh-requests" element={<PrivateRoute allowedRoles={['manager']}><WFHRequestsPage /></PrivateRoute>} />
        <Route path="/manager-payroll" element={<PrivateRoute allowedRoles={['manager']}><PayrollPage /></PrivateRoute>} />
        <Route path="/manager-payslips" element={<PrivateRoute allowedRoles={['manager']}><PayslipsPage /></PrivateRoute>} />
        <Route path="/manager-advances" element={<PrivateRoute allowedRoles={['manager']}><AdvancesPage /></PrivateRoute>} />
        <Route path="/manager-salary-additions" element={<PrivateRoute allowedRoles={['manager']}><SalaryAdditionsPage /></PrivateRoute>} />
        
        {/* Superadmin specific */}
        <Route path="/master-dashboard" element={<PrivateRoute allowedRoles={['superadmin']}><MasterDashboardPage /></PrivateRoute>} />
        <Route path="/tenants" element={<PrivateRoute allowedRoles={['superadmin']}><TenantsPage /></PrivateRoute>} />
        <Route path="/platform-employees" element={<PrivateRoute allowedRoles={['superadmin']}><AllEmployeesPage /></PrivateRoute>} />
        <Route path="/helpdesk-admin" element={<PrivateRoute allowedRoles={['superadmin']}><HelpdeskAdminPage /></PrivateRoute>} />

        {/* Employee Routes */}
        <Route path="/home" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><HomePageTab /></PrivateRoute>} />
        <Route path="/me" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MePage /></PrivateRoute>} />
        <Route path="/my-dashboard" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><EmployeeDashboard /></PrivateRoute>} />
        <Route path="/my-attendance" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyAttendancePage /></PrivateRoute>} />
        <Route path="/my-leaves" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyLeavesPage /></PrivateRoute>} />
        <Route path="/my-special-requests" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MySpecialRequestsPage /></PrivateRoute>} />
        <Route path="/my-regularize" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyRegularizeRequestsPage /></PrivateRoute>} />
        <Route path="/my-wfh" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyWfhRequestsPage /></PrivateRoute>} />
        <Route path="/my-payslips" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><MyPayslipsPage /></PrivateRoute>} />
        <Route path="/my-tax-declaration" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager']}><TaxDeclarationPage /></PrivateRoute>} />

        {/* Shared: Announcements & Policies (visible to everyone, create restricted to admin inside the page) */}
        <Route path="/announcements" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><AnnouncementsPage /></PrivateRoute>} />
        <Route path="/policies" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><PoliciesPage /></PrivateRoute>} />
        <Route path="/grievances" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><GrievancePage /></PrivateRoute>} />

        {/* Hiring: everyone can browse open positions and refer candidates; creating/editing postings is gated to admins inside the page (canManage) */}
        <Route path="/hiring" element={<PrivateRoute allowedRoles={['employee', 'manager', 'admin', 'superadmin']}><HiringPage /></PrivateRoute>} />
        {/* Shared: Refer (submit + track referrals for everyone, all-referrals oversight restricted to admin inside the page) */}
        <Route path="/refer" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><ReferPage /></PrivateRoute>} />
        <Route path="/headcount-requests" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><HeadcountRequestsPage /></PrivateRoute>} />
        {/* Interviews: admin/manager schedule; any employee can be assigned as interviewer and needs "My Interviews" */}
        <Route path="/interviews" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><InterviewsPage /></PrivateRoute>} />
        <Route path="/offer-letters" element={<PrivateRoute allowedRoles={['admin', 'manager', 'superadmin']}><OfferLettersPage /></PrivateRoute>} />
        <Route path="/training" element={<PrivateRoute allowedRoles={['admin', 'superadmin']}><TrainingPage /></PrivateRoute>} />
        <Route path="/my-training" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><MyTrainingPage /></PrivateRoute>} />
        <Route path="/expense-claims" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><ExpenseClaimsPage /></PrivateRoute>} />
        <Route path="/travel-requests" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><TravelRequestsPage /></PrivateRoute>} />

        {/* Shared: Performance Management (KRAs, Feedback, PIP, Reviews) — visible to everyone, role logic inside each page */}
        <Route path="/performance/kras" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><KRAsPage /></PrivateRoute>} />
        <Route path="/performance/feedback" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><FeedbackPage /></PrivateRoute>} />
        <Route path="/performance/pip" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><PIPPage /></PrivateRoute>} />
        <Route path="/performance/reviews" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><ReviewsPage /></PrivateRoute>} />
        <Route path="/performance/one-on-ones" element={<PrivateRoute allowedRoles={['employee', 'admin', 'manager', 'superadmin']}><OneOnOnesPage /></PrivateRoute>} />
      </Route>
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
