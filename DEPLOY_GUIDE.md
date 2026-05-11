# Manager Dashboard - Deployment Guide

## Pre-Deployment Checklist

### Environment Verification
```bash
# Verify Node.js version (v18+)
node --version

# Verify npm installed
npm --version

# Verify project dependencies installed
npm list react react-router-dom @supabase/supabase-js
```

### Git Configuration
```bash
# Verify git is configured
git config --global user.name
git config --global user.email

# If not configured, set up:
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

---

## Deployment Steps

### Step 1: Commit Changes

```bash
# Navigate to project directory
cd "C:\Users\7\Downloads\payroll-software-2-Dangi-fixes 2222\payroll-software-2-Dangi-fixes"

# Stage all changes
git add -A

# Verify changes
git status

# Commit with proper message
git commit -m "feat: Implement Manager Dashboard and Regularize Attendance

BREAKING CHANGES: None

Features:
- Manager Dashboard with live clock and team metrics
- Regularize Attendance feature for bulk updates
- Automatic status calculation based on hours
- Comprehensive audit logging
- Manager role navigation and access control

Services:
- attendanceService.regularizeAttendance()
- Enhanced employeeService for manager queries
- HolidayCalendar manager role support

Tests:
- Manual testing completed
- Role-based access verified
- All validations tested

Fixes:
- N/A

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Step 2: Push to GitHub

```bash
# Push to main branch (or create feature branch)
git push origin main

# Or if you want to create a feature branch first:
git checkout -b feat/manager-dashboard-regularize
git push origin feat/manager-dashboard-regularize

# Then create Pull Request on GitHub
```

### Step 3: Code Review

1. Wait for team review on GitHub
2. Address any feedback
3. Get approvals
4. Ensure all CI/CD checks pass

### Step 4: Build Verification

```bash
# Install dependencies (if needed)
npm install

# Run linter
npm run lint

# Build for production
npm run build

# Preview build
npm run preview
```

### Step 5: Staging Deployment

```bash
# Deploy to staging environment
# (Using your deployment tool - Vercel, Netlify, AWS, etc.)

# Example for Vercel:
vercel --prod --scope=your-organization

# Test in staging:
# 1. Login as admin
# 2. Access /regularize route
# 3. Login as manager
# 4. Access /manager-dashboard
# 5. Access /manager-regularize
```

### Step 6: Production Deployment

```bash
# After successful staging tests, deploy to production
# (Using your deployment platform)

# Verify in production:
# 1. Admin and manager logins work
# 2. All routes accessible
# 3. Attendance regularization functions
# 4. Audit logs created
# 5. Clock in/out works
```

---

## Post-Deployment Verification

### Immediate Checks (1-2 hours after deployment)

```
✅ Login with Manager account
  - Sidebar shows manager navigation
  - Can access /manager-dashboard
  - Can access /manager-regularize
  - Cannot access /payroll

✅ Login with Admin account
  - Sidebar shows admin navigation
  - Can access /regularize
  - Can access /payroll
  - Can perform all functions

✅ Login with Employee account
  - Cannot access manager routes
  - Cannot access admin routes
  - Can access /my-dashboard

✅ Manager Dashboard functionality
  - Clock displays correctly
  - Timer updates every second
  - Clock In button works
  - Clock Out button works
  - Team attendance shows correct counts

✅ Regularize Attendance functionality
  - Can select employees
  - Can select departments
  - Date validation works
  - Can submit form
  - Records updated in database
  - Audit log entries created
```

### 24-Hour Checks

```
✅ Check error logs for exceptions
✅ Verify audit logs are being created properly
✅ Check for any performance issues
✅ Monitor database size growth
✅ Verify no data corruption
✅ Check user feedback for issues
```

### Weekly Checks

```
✅ Review audit logs for patterns
✅ Monitor regularization frequency
✅ Check for abuse/misuse
✅ Gather user feedback
✅ Verify system performance metrics
```

---

## Rollback Plan

If critical issues arise:

```bash
# View commit history
git log --oneline -10

# Revert to previous commit
git revert <commit-hash>

# Or reset (use with caution)
git reset --hard <commit-hash>

# Push rollback
git push origin main -f  # Only if necessary
```

---

## Performance Optimization Tips

### For Large Datasets
```javascript
// In RegularizeAttendancePage.jsx
// If handling 1000+ employees, add pagination
const EMPLOYEES_PER_PAGE = 100;

// Or implement virtual scrolling
// For very large date ranges, split into chunks
const CHUNK_SIZE = 30;  // days
```

### Database Optimization
```sql
-- Create indexes for faster queries
CREATE INDEX idx_attendance_profile_date 
ON attendance(profile_id, date);

CREATE INDEX idx_audit_log_changed_by 
ON attendance_audit_log(changed_by, date DESC);
```

---

## Monitoring & Alerts

### Key Metrics to Monitor
1. **Attendance Regularization Rate** - How many records are being regularized
2. **Error Rate** - Regularization failures
3. **Audit Log Growth** - Database growth rate
4. **User Activity** - Who's using the feature
5. **Performance** - Response times for regularization

### Recommended Alerts
- Alert if regularization fails > 5 times in an hour
- Alert if audit logs exceed 1GB
- Alert if response time > 10 seconds for regularization
- Alert if same user regularizes same employee multiple times in a day

---

## Database Maintenance

### Regular Backups
```bash
# Ensure your database is backed up daily
# For Supabase: Automatic backups are enabled by default
# Check settings: https://app.supabase.com → Backups

# Manual backup
# Download via Supabase Dashboard → Settings → Backups
```

### Archive Audit Logs
```sql
-- Archive old audit logs (after 1 year)
INSERT INTO attendance_audit_log_archive
SELECT * FROM attendance_audit_log
WHERE date < DATE_SUB(CURDATE(), INTERVAL 365 DAY);

DELETE FROM attendance_audit_log
WHERE date < DATE_SUB(CURDATE(), INTERVAL 365 DAY);
```

---

## Support & Communication

### Notify Stakeholders
```
Subject: Manager Dashboard & Regularize Attendance - Now Available

Dear Team,

The Manager Dashboard and Regularize Attendance features are now live.

New Capabilities:
- Managers can now access their own dashboard with clock in/out
- Both Admins and Managers can regularize team attendance in bulk
- All changes are automatically logged for audit purposes

Getting Started:
1. Login as Manager
2. Visit Manager Dashboard to clock in/out
3. Use Regularize Attendance to update team records

For support, please contact the IT team.

Best regards,
Payroll System Team
```

### Training Materials

```markdown
# Manager Dashboard Training

## For Managers
- Video: How to use Manager Dashboard (5 min)
- Guide: Regularizing Attendance (PDF)
- FAQ: Common Questions

## For Admins
- Guide: Audit Logging Overview
- Best Practices: When to regularize attendance
- Troubleshooting: Common issues
```

---

## Troubleshooting Common Issues

### Issue: Managers cannot see their team employees

**Solution**:
```javascript
// In employeeService.js, verify manager role is included
.in('role', ['employee', 'admin', 'manager'])  // ✅ Must include 'manager'
```

### Issue: Regularization records not appearing

**Solution**:
1. Check if `attendance_audit_log` table exists
2. Verify Supabase RLS policies
3. Check user permissions

### Issue: Clock in/out failing with error

**Solution**:
1. Verify user has valid profile with role = 'manager'
2. Check Supabase connection
3. Verify tenant exists in database

### Issue: Date validation too strict

**Solution**:
```javascript
// In RegularizeAttendancePage.jsx, adjust validation logic
const today = new Date();
today.setHours(0, 0, 0, 0);
if (to > today) {
  // Can adjust to allow current day
  today.setDate(today.getDate() + 1);
}
```

---

## Version Control Best Practices

### Branch Strategy
```bash
# Use feature branches
git checkout -b feat/manager-dashboard

# Use release branches for deployment
git checkout -b release/v1.2.0

# Use hotfix branches for urgent fixes
git checkout -b hotfix/manager-clock-issue
```

### Commit Message Format
```
feat: Add new feature
fix: Fix a bug
docs: Documentation changes
style: Code style changes
refactor: Code refactoring
test: Test additions
chore: Maintenance
```

---

## Security Checklist

```
✅ Role-based access control enforced
✅ Input validation on all forms
✅ SQL injection prevention (using Supabase prepared statements)
✅ XSS prevention (React auto-escaping)
✅ CSRF protection (via Supabase)
✅ Audit logging enabled
✅ Error messages don't expose sensitive info
✅ Passwords never logged
✅ API keys secured in environment variables
```

---

## Success Criteria

Deployment is considered successful when:

1. ✅ All unit tests pass
2. ✅ All integration tests pass
3. ✅ No critical bugs in production
4. ✅ Performance meets baseline
5. ✅ All users can access appropriate features
6. ✅ Audit logs are being created
7. ✅ Error rate < 0.1%
8. ✅ Users report no issues in first 24 hours

---

## Rollback Decision Tree

```
Is production experiencing critical issues?
├─ YES
│  ├─ Is it blocking all users?
│  │  ├─ YES → Rollback immediately
│  │  └─ NO → Attempt hotfix first
│  └─ Affects core functionality?
│     ├─ YES → Consider rollback
│     └─ NO → Wait for monitoring
└─ NO → Continue monitoring

If rolling back:
1. Notify stakeholders
2. Execute git revert
3. Redeploy to production
4. Verify functionality restored
5. Document incident
6. Schedule postmortem
```

---

**Deployment Guide Version**: 1.0  
**Last Updated**: 2026-05-11  
**Status**: Ready for Production
