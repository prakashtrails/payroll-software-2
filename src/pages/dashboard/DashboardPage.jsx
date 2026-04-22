import React from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import { useAuth } from '@/context/AuthContext';
import { fetchDashboardStats } from '@/services/tenantService';
import { fmt, monthLabel } from '@/lib/helpers';

export default function GeneralDashboard() {
  const { tenant } = useAuth();
  const [stats, setStats]   = useState({ activeEmployees: 0, totalCTC: 0, processedPayrolls: 0, outstandingAdvances: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    fetchDashboardStats(tenant.id).then(({ error, ...s }) => {
      if (!error) setStats(s);
      setLoading(false);
    });
  }, [tenant]);

  const now = new Date();

  return (
    <>
      <Header title="Manager Dashboard" breadcrumb={`${monthLabel(now.getMonth(), now.getFullYear())} Overview`} />
      <div className="page-content">
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading insights…
          </div>
        ) : (
          <>
            <div className="stats-row">
              <StatCard icon="fa-users"            iconColor="blue"   value={stats.activeEmployees}     label="Active Employees" />
              <StatCard icon="fa-wallet"           iconColor="green"  value={fmt(stats.totalCTC)}        label="Monthly CTC Total" />
              <StatCard icon="fa-file-invoice"     iconColor="purple" value={stats.processedPayrolls}   label="Payrolls Processed" />
              <StatCard icon="fa-hand-holding-usd" iconColor="orange" value={fmt(stats.outstandingAdvances)} label="Outstanding Advances" />
            </div>

            <div className="grid-3-1">
              <div className="card">
                <div className="card-header"><h3>Recent Payroll History</h3></div>
                <div className="card-body">
                  {stats.processedPayrolls > 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {stats.processedPayrolls} payroll run{stats.processedPayrolls !== 1 ? 's' : ''} processed so far.
                    </p>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      No payroll processed yet. Go to <Link to="/payroll" style={{ color: 'var(--primary)' }}>Run Payroll</Link> to get started.
                    </p>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Quick Actions</h3></div>
                <div className="card-body">
                  <div style={{ display: 'grid', gap: 8 }}>
                    <Link to="/payroll"   className="btn btn-primary btn-block"><i className="fas fa-play-circle" /> Run Payroll</Link>
                    <Link to="/employees" className="btn btn-outline btn-block"><i className="fas fa-user-plus" /> Manage Employees</Link>
                    <Link to="/advances"  className="btn btn-outline btn-block"><i className="fas fa-hand-holding-usd" /> New Advance</Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>System Setup Guide</h3></div>
              <div className="card-body">
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Welcome to PayrollPro. Here are the recommended next steps:
                </p>
                <ul style={{ paddingLeft: 20, marginTop: 12, fontSize: 13, color: 'var(--text)', display: 'grid', gap: 8 }}>
                  <li>Go to <strong>Settings</strong> to configure earning and deduction components.</li>
                  <li>Visit <strong>Employees</strong> to add your active workers and sync their CTC.</li>
                  <li>Direct employees to the login page so they can mark <strong>Attendance</strong>.</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
