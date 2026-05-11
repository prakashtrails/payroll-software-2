@echo off
REM Manager Dashboard Implementation - Git Push Script

echo ===================================
echo Manager Dashboard Implementation
echo ===================================
echo.

cd /d "C:\Users\7\Downloads\payroll-software-2-Dangi-fixes 2222\payroll-software-2-Dangi-fixes"

REM Initialize git if needed
if not exist .git (
    echo [*] Initializing git repository...
    git init
    git config user.name "Copilot"
    git config user.email "223556219+Copilot@users.noreply.github.com"
)

echo [*] Checking git status...
git status

echo.
echo [*] Adding all changes...
git add -A

echo.
echo [*] Creating commit...
git commit -m "feat: Implement Manager Dashboard and Regularize Attendance feature

- Create ManagerDashboardPage with live clock, team attendance overview, and clock in/out
- Create RegularizeAttendancePage for bulk attendance updates with audit logging
- Add regularizeAttendance service function with automatic status calculation
- Update App.jsx with manager routes and role-based access control
- Update Sidebar.jsx with manager navigation configuration
- Update HolidayCalendar.jsx to include manager role in authorization checks
- Update employeeService.js to include manager role in employee queries
- Support both Admin and Manager roles for Regularize Attendance feature
- Add comprehensive audit logging for all attendance regularization actions
- Implement automatic status calculation based on hours worked

Features:
- Manager can view own team attendance and metrics
- Manager can clock in/out like employees
- Manager can regularize attendance for team members with reasons
- Admin can regularize attendance with all validations
- Automatic hour-based status calculation (Present/Late/Half Day/Absent)
- Full audit trail for compliance

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" 

if errorlevel 1 (
    echo [ERROR] Git commit failed
    pause
    exit /b 1
)

echo.
echo [*] Checking commit result...
git log --oneline -3

echo.
echo ===================================
echo [SUCCESS] Changes committed!
echo ===================================
echo.
echo Next steps:
echo 1. Push to GitHub: git push origin main
echo 2. Create Pull Request for review
echo.
pause
