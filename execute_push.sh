#!/usr/bin/env bash
# Execute git push for Manager Dashboard
cd "C:\Users\7\Downloads\payroll-software-2-Dangi-fixes 2222\payroll-software-2-Dangi-fixes"

echo "=== Git Push Execution ==="
echo "Step 1: Initialize git..."
git init

echo "Step 2: Configure user..."
git config user.name "Dangi"
git config user.email "prakashtrails@github.com"

echo "Step 3: Check status..."
git status

echo "Step 4: Add remote..."
git remote add origin https://github.com/prakashtrails/payroll-software-2.git 2>/dev/null || git remote set-url origin https://github.com/prakashtrails/payroll-software-2.git

echo "Step 5: Create/checkout branch..."
git checkout -b Dangi-fixes 2>/dev/null || git checkout Dangi-fixes

echo "Step 6: Stage all files..."
git add -A

echo "Step 7: Create commit..."
git commit -m "feat: Implement Manager Dashboard and Regularize Attendance feature

- ManagerDashboardPage with live clock and team metrics
- RegularizeAttendancePage for bulk updates
- regularizeAttendance service with auto status calc
- Manager navigation and routes
- Audit logging for all changes
- Role-based access control

Co-authored-by: GitHub Copilot CLI <223556219+Copilot@users.noreply.github.com>"

echo "Step 8: Push to GitHub..."
git push -u origin Dangi-fixes

echo "Done!"
