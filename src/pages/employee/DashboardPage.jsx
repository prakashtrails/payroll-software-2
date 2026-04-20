import React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { fetchMyMonthStats } from '@/services/attendanceService';
import { fetchMyAdvanceBalance } from '@/services/advanceService';
import { fmt, monthLabel } from '@/lib/helpers';

// Masked amount display — hidden by default, tap eye to reveal
function MaskedAmount({ value, visible }) {
  return (
    <span style={{ fontFamily: visible ? 'inherit' : 'monospace', letterSpacing: visible ? 'normal' : 2 }}>
      {visible ? fmt(value) : '₹ ••••••'}
    </span>
  );
}

export default function EmployeeDashboard() {
  const { profile, tenant } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ ctc: 0, presentDays: 0, outstandingAdvances: 0 });
  const [showSalary, setShowSalary] = useState(false);

  useEffect(() => {
    if (!profile || !tenant) return;
    const now = new Date();
    Promise.all([
      fetchMyMonthStats(profile.id, now.getFullYear(), now.getMonth()),
      fetchMyAdvanceBalance(profile.id),
    ]).then(([attRes, advRes]) => {
      setStats({
        ctc:                 profile.ctc || 0,
        presentDays:         attRes.presentDays,
        outstandingAdvances: advRes.total,
      });
    });
  }, [profile, tenant]);

  const now = new Date();

  return (
    <>
      <Header title={`Welcome back, ${profile?.first_name || 'User'}`} breadcrumb={`${monthLabel(now.getMonth(), now.getFullYear())} Stats`} />
      <div className="page-content">
        <div className="stats-row">
          {/* CTC card — masked by default */}
          <div className="stat-card">
            <div className="stat-icon green">
              <i className="fas fa-wallet" />
            </div>
            <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MaskedAmount value={stats.ctc} visible={showSalary} />
              <button
                onClick={() => setShowSalary((v) => !v)}
                title={showSalary ? 'Hide salary' : 'Show salary'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 13, padding: 2,
                  lineHeight: 1,
                }}
              >
                <i className={`fas ${showSalary ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
            <div className="stat-label">Monthly CTC</div>
          </div>

          <div className="stat-card">
            <div className="stat-icon blue"><i className="fas fa-calendar-check" /></div>
            <div className="stat-value">{stats.presentDays}</div>
            <div className="stat-label">Days Present this Month</div>
          </div>

          <div className="stat-card">
            <div className="stat-icon orange"><i className="fas fa-hand-holding-usd" /></div>
            <div className="stat-value">
              <MaskedAmount value={stats.outstandingAdvances} visible={showSalary} />
            </div>
            <div className="stat-label">Active Loan Balance</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header"><h3>Recent Announcements</h3></div>
            <div className="card-body">
              <div className="empty-state">
                <i className="fas fa-bullhorn empty-icon" />
                <h3>No new announcements</h3>
                <p>Your team updates will appear here.</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Self Service</h3></div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: 12 }}>
                <button className="btn btn-outline btn-block" style={{ justifyContent: 'left' }} onClick={() => navigate('/my-attendance')}>
                  <i className="fas fa-fingerprint" style={{ width: 24 }} /> Open Attendance Clock
                </button>
                <button className="btn btn-outline btn-block" style={{ justifyContent: 'left' }} onClick={() => navigate('/my-payslips')}>
                  <i className="fas fa-file-invoice-dollar" style={{ width: 24 }} /> View Latest Payslip
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
