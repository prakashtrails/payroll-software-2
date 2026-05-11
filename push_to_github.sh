#!/bin/bash
# Manager Dashboard - Git Push Script for Linux/Mac

PROJECT_PATH="C:\Users\7\Downloads\payroll-software-2-Dangi-fixes 2222\payroll-software-2-Dangi-fixes"
REPO_URL="https://github.com/prakashtrails/payroll-software-2.git"
BRANCH="Dangi-fixes"

echo "============================================================"
echo "MANAGER DASHBOARD - GITHUB PUSH"
echo "============================================================"
echo ""
echo "Repository: $REPO_URL"
echo "Branch: $BRANCH"
echo ""

cd "$PROJECT_PATH"

# Initialize git if needed
if [ ! -d .git ]; then
    echo "[1/5] Initializing git repository..."
    git init
    git config user.name "Dangi"
    git config user.email "prakashtrails@github.com"
    echo "[OK] Git initialized"
    echo ""
fi

# Configure remote
echo "[2/5] Configuring remote repository..."
if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Adding remote: $REPO_URL"
    git remote add origin "$REPO_URL"
else
    echo "Remote already configured:"
    git remote -v
fi
echo "[OK] Remote configured"
echo ""

# Check status
echo "[3/5] Checking git status..."
git status --porcelain
echo "[OK] Status checked"
echo ""

# Stage changes
echo "[4/5] Staging all changes..."
git add -A
echo "[OK] Changes staged"
echo ""

# Create commit
echo "[5/5] Creating commit..."
git commit -m "feat: Implement Manager Dashboard and Regularize Attendance feature

BREAKING CHANGES: None

Features:
- Create ManagerDashboardPage with live clock and team attendance metrics
- Create RegularizeAttendancePage for bulk attendance regularization
- Add regularizeAttendance service with automatic status calculation
- Comprehensive audit logging for all attendance changes
- Manager role navigation and route configuration
- Clock in/out functionality for managers
- Bulk employee selection by name or department
- Automatic status calculation based on hours worked
- Support for both Admin and Manager roles

Modified Files:
- src/App.jsx: 6 manager-specific routes
- src/components/Sidebar.jsx: Manager navigation config
- src/services/attendanceService.js: regularizeAttendance function
- src/services/employeeService.js: Manager role support
- src/components/HolidayCalendar.jsx: Manager role checks

Documentation:
- README_DEPLOYMENT.md
- IMPLEMENTATION_SUMMARY.md
- DEPLOY_GUIDE.md
- QUICK_REFERENCE.md
- VISUAL_SUMMARY.md
- GETTING_STARTED.md

Co-authored-by: GitHub Copilot CLI <223556219+Copilot@users.noreply.github.com>"

if [ $? -ne 0 ]; then
    echo ""
    echo "[ERROR] Git commit failed"
    exit 1
fi

echo "[OK] Commit created"
echo ""

# Show recent commits
echo "============================================================"
echo "RECENT COMMITS"
echo "============================================================"
git log --oneline -3
echo ""

# Push to GitHub
echo "============================================================"
echo "PUSHING TO GITHUB"
echo "============================================================"
echo "Branch: $BRANCH"
echo "Remote: origin"
echo ""

echo "Fetching from remote..."
git fetch origin --quiet 2>/dev/null

echo "Pushing to $REPO_URL (branch: $BRANCH)"
git push -u origin "$BRANCH"

if [ $? -ne 0 ]; then
    echo ""
    echo "[ERROR] Push failed"
    echo "Try: git push -u origin $BRANCH --force-with-lease"
    exit 1
fi

echo ""
echo "============================================================"
echo "SUCCESS! CHANGES PUSHED TO GITHUB"
echo "============================================================"
echo ""
echo "Repository: https://github.com/prakashtrails/payroll-software-2"
echo "Branch: $BRANCH"
echo ""
echo "Next Steps:"
echo "1. Visit: https://github.com/prakashtrails/payroll-software-2/tree/$BRANCH"
echo "2. Create a Pull Request to merge $BRANCH into main"
echo "3. Request team review"
echo "4. Address any feedback"
echo "5. Merge PR after approval"
echo "6. Deploy to production"
echo ""
echo "View your commits:"
echo "https://github.com/prakashtrails/payroll-software-2/commits/$BRANCH"
echo ""
