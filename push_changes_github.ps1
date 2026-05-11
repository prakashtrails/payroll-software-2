#!/usr/bin/env pwsh
# Manager Dashboard Implementation - GitHub Push Script
# Repository: https://github.com/prakashtrails/payroll-software-2.git
# Branch: Dangi-fixes

$projectPath = "C:\Users\7\Downloads\payroll-software-2-Dangi-fixes 2222\payroll-software-2-Dangi-fixes"
$repoUrl = "https://github.com/prakashtrails/payroll-software-2.git"
$branch = "Dangi-fixes"

Set-Location $projectPath

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "MANAGER DASHBOARD - GITHUB PUSH" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repository: $repoUrl" -ForegroundColor Yellow
Write-Host "Branch: $branch" -ForegroundColor Yellow
Write-Host ""

# Step 1: Initialize git if needed
if (!(Test-Path .git)) {
    Write-Host "[1/5] Initializing git repository..." -ForegroundColor Green
    git init
    git config user.name "Dangi"
    git config user.email "prakashtrails@github.com"
    Write-Host "[OK] Git initialized" -ForegroundColor Green
    Write-Host ""
}

# Step 2: Configure remote
Write-Host "[2/5] Configuring remote repository..." -ForegroundColor Green
$remoteExists = git remote get-url origin 2>$null
if (!$remoteExists) {
    Write-Host "Adding remote: $repoUrl" -ForegroundColor Yellow
    git remote add origin $repoUrl
} else {
    Write-Host "Remote already configured:" -ForegroundColor Yellow
    git remote -v
}
Write-Host "[OK] Remote configured" -ForegroundColor Green
Write-Host ""

# Step 3: Check status
Write-Host "[3/5] Checking git status..." -ForegroundColor Green
$status = git status --porcelain
if ($status) {
    Write-Host "Changes to commit:" -ForegroundColor Yellow
    $status | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
} else {
    Write-Host "No changes detected" -ForegroundColor Yellow
}
Write-Host "[OK] Status checked" -ForegroundColor Green
Write-Host ""

# Step 4: Stage changes
Write-Host "[4/5] Staging all changes..." -ForegroundColor Green
git add -A
Write-Host "[OK] Changes staged" -ForegroundColor Green
Write-Host ""

# Step 5: Commit
Write-Host "[5/5] Creating commit..." -ForegroundColor Green
git commit -m @"
feat: Implement Manager Dashboard and Regularize Attendance feature

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

Co-authored-by: GitHub Copilot CLI <223556219+Copilot@users.noreply.github.com>
"@

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Commit failed" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Commit created" -ForegroundColor Green
Write-Host ""

# Show recent commits
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "RECENT COMMITS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
git log --oneline -3
Write-Host ""

# Push to GitHub
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "PUSHING TO GITHUB" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Branch: $branch" -ForegroundColor Yellow
Write-Host "Remote: origin" -ForegroundColor Yellow
Write-Host ""

Write-Host "Fetching from remote..." -ForegroundColor Yellow
git fetch origin --quiet 2>$null

Write-Host "Pushing to $repoUrl (branch: $branch)" -ForegroundColor Yellow
git push -u origin $branch

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Push failed" -ForegroundColor Red
    Write-Host "Try: git push -u origin $branch --force-with-lease" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "SUCCESS! CHANGES PUSHED TO GITHUB" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Repository: https://github.com/prakashtrails/payroll-software-2" -ForegroundColor Cyan
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Visit: https://github.com/prakashtrails/payroll-software-2/tree/$branch" -ForegroundColor White
Write-Host "2. Create a Pull Request to merge $branch into main" -ForegroundColor White
Write-Host "3. Request team review" -ForegroundColor White
Write-Host "4. Address any feedback" -ForegroundColor White
Write-Host "5. Merge PR after approval" -ForegroundColor White
Write-Host "6. Deploy to production" -ForegroundColor White
Write-Host ""
Write-Host "View your commits:" -ForegroundColor Cyan
Write-Host "https://github.com/prakashtrails/payroll-software-2/commits/$branch" -ForegroundColor White
Write-Host ""
