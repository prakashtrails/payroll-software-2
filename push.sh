#!/usr/bin/env bash
# =============================================================================
# Manager Dashboard - Push to GitHub
# Repository: https://github.com/prakashtrails/payroll-software-2.git
# Branch: Dangi-fixes
# =============================================================================

echo "🚀 Manager Dashboard - GitHub Push"
echo "=================================================================="
echo ""
echo "Repository: https://github.com/prakashtrails/payroll-software-2.git"
echo "Branch: Dangi-fixes"
echo "Status: READY TO PUSH"
echo ""
echo "=================================================================="
echo ""

# Change to project directory
cd "C:\Users\7\Downloads\payroll-software-2-Dangi-fixes 2222\payroll-software-2-Dangi-fixes" || {
    echo "❌ Failed to change directory"
    exit 1
}

echo "✅ Changed to project directory"
echo ""

# Step 1: Initialize git
echo "[1/6] Initializing git..."
if [ ! -d .git ]; then
    git init
    git config user.name "Dangi"
    git config user.email "prakashtrails@github.com"
    echo "✅ Git initialized"
else
    echo "✅ Git already initialized"
fi
echo ""

# Step 2: Add remote
echo "[2/6] Adding remote repository..."
if git remote get-url origin >/dev/null 2>&1; then
    echo "✅ Remote already configured: $(git remote get-url origin)"
else
    git remote add origin https://github.com/prakashtrails/payroll-software-2.git
    echo "✅ Remote added"
fi
echo ""

# Step 3: Check status
echo "[3/6] Checking git status..."
git status --porcelain | head -20
echo "✅ Status checked"
echo ""

# Step 4: Create branch
echo "[4/6] Creating/checking branch..."
if git rev-parse --verify Dangi-fixes >/dev/null 2>&1; then
    git checkout Dangi-fixes
    echo "✅ Switched to Dangi-fixes"
else
    git checkout -b Dangi-fixes
    echo "✅ Created Dangi-fixes branch"
fi
echo ""

# Step 5: Stage and commit
echo "[5/6] Staging and committing changes..."
git add -A
git commit -m "feat: Implement Manager Dashboard and Regularize Attendance feature

- Create ManagerDashboardPage with live clock and team metrics
- Create RegularizeAttendancePage for bulk attendance updates
- Add regularizeAttendance service with automatic status calculation
- Implement comprehensive audit logging
- Add manager role navigation and route configuration
- Clock in/out functionality for managers
- Bulk employee selection by name or department
- Automatic status calculation based on hours worked
- Support for both Admin and Manager roles

Files Added:
  + src/pages/dashboard/ManagerDashboardPage.jsx
  + src/pages/dashboard/RegularizeAttendancePage.jsx

Files Modified:
  ~ src/App.jsx
  ~ src/components/Sidebar.jsx
  ~ src/services/attendanceService.js
  ~ src/services/employeeService.js
  ~ src/components/HolidayCalendar.jsx

Documentation:
  + README_DEPLOYMENT.md
  + IMPLEMENTATION_SUMMARY.md
  + DEPLOY_GUIDE.md
  + QUICK_REFERENCE.md
  + VISUAL_SUMMARY.md
  + GETTING_STARTED.md
  + GITHUB_PUSH_GUIDE.md
  + PUSH_TO_GITHUB.md
  + START_HERE.md

Co-authored-by: GitHub Copilot CLI <223556219+Copilot@users.noreply.github.com>"

if [ $? -eq 0 ]; then
    echo "✅ Changes committed"
else
    echo "⚠️  No changes to commit (or commit failed)"
fi
echo ""

# Step 6: Push to GitHub
echo "[6/6] Pushing to GitHub..."
git fetch origin --quiet 2>/dev/null
git push -u origin Dangi-fixes

if [ $? -eq 0 ]; then
    echo "✅ Push successful!"
    echo ""
    echo "=================================================================="
    echo "🎉 SUCCESS! CHANGES PUSHED TO GITHUB"
    echo "=================================================================="
    echo ""
    echo "Repository: https://github.com/prakashtrails/payroll-software-2"
    echo "Branch: Dangi-fixes"
    echo ""
    echo "📌 Next Steps:"
    echo "1. Visit: https://github.com/prakashtrails/payroll-software-2/tree/Dangi-fixes"
    echo "2. Create Pull Request: https://github.com/prakashtrails/payroll-software-2/pull/new/Dangi-fixes"
    echo "3. Request team review"
    echo "4. Address feedback"
    echo "5. Merge PR after approval"
    echo "6. Deploy to production (follow DEPLOY_GUIDE.md)"
    echo ""
    echo "View commits: https://github.com/prakashtrails/payroll-software-2/commits/Dangi-fixes"
    echo "=================================================================="
else
    echo "❌ Push failed"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check GitHub credentials"
    echo "2. Ensure you have push access"
    echo "3. Try: git push -u origin Dangi-fixes --force-with-lease"
    echo "4. See PUSH_TO_GITHUB.md for more help"
    exit 1
fi

echo ""
