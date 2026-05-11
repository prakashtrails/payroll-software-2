const fs = require('fs');
const path = require('path');

const srcBase = path.join(__dirname, '..', 'saas-payroll', 'src', 'app');
const destBase = path.join(__dirname, 'src', 'pages');

const mapping = [
  { src: '(auth)/login/page.js', dest: 'auth/LoginPage.jsx' },
  { src: '(auth)/signup/page.js', dest: 'auth/SignupPage.jsx' },
  { src: '(dashboard)/dashboard/page.js', dest: 'dashboard/DashboardPage.jsx' },
  { src: '(dashboard)/employees/page.js', dest: 'dashboard/EmployeesPage.jsx' },
  { src: '(dashboard)/attendance/page.js', dest: 'dashboard/AttendancePage.jsx' },
  { src: '(dashboard)/salary/page.js', dest: 'dashboard/SalaryPage.jsx' },
  { src: '(dashboard)/payroll/page.js', dest: 'dashboard/PayrollPage.jsx' },
  { src: '(dashboard)/payslips/page.js', dest: 'dashboard/PayslipsPage.jsx' },
  { src: '(dashboard)/advances/page.js', dest: 'dashboard/AdvancesPage.jsx' },
  { src: '(dashboard)/settings/page.js', dest: 'dashboard/SettingsPage.jsx' },
  { src: '(dashboard)/tenants/page.js', dest: 'dashboard/TenantsPage.jsx' },
  { src: '(dashboard)/my-dashboard/page.js', dest: 'employee/DashboardPage.jsx' },
  { src: '(dashboard)/my-attendance/page.js', dest: 'employee/MyAttendancePage.jsx' },
  { src: '(dashboard)/my-payslips/page.js', dest: 'employee/MyPayslipsPage.jsx' },
];

mapping.forEach(item => {
  const srcPath = path.join(srcBase, item.src);
  const destPath = path.join(destBase, item.dest);
  
  if (fs.existsSync(srcPath)) {
    let content = fs.readFileSync(srcPath, 'utf-8');
    
    // Remove "use client";
    content = content.replace(/['"]use client['"];?\n?/, '');
    
    // Replace next imports
    content = content.replace(/import Link from 'next\/link';/g, "import { Link } from 'react-router-dom';");
    content = content.replace(/import \{ useRouter \} from 'next\/navigation';/g, "import { useNavigate } from 'react-router-dom';");
    
    // Replace router.push with navigate
    content = content.replace(/const router = useRouter\(\);/g, "const navigate = useNavigate();");
    content = content.replace(/router\.push\((.*?)\)/g, "navigate($1)");
    content = content.replace(/router\.replace\((.*?)\)/g, "navigate($1, { replace: true })");

    // Add React import if missing
    if (!content.includes("import React")) {
        content = "import React from 'react';\n" + content;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    console.log(`Converted ${item.src} to ${item.dest}`);
  } else {
    console.warn(`File not found: ${srcPath}`);
  }
});
