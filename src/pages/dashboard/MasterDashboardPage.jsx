import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import { showToast } from '@/components/Toast';
import { fetchPlatformAnalytics, listAllTickets } from '@/services/platformService';
import { fmt, timeAgo } from '@/lib/helpers';

function fmtMoney(n, currency = '₹') {
  if (!n) return `${currency}0`;
  if (n >= 10000000) return `${currency}${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000)   return `${currency}${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)     return `${currency}${(n / 1000).toFixed(1)}K`;
  return fmt(n, currency);
}

const shortMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

const PRIORITY_BADGE = { Low: 'badge-info', Medium: 'badge', High: 'badge-warning', Urgent: 'badge-danger' };

/** Sorted horizontal bar list, scaled to its own max — used for growth trend and top companies. */
function BarList({ items, valueKey, labelKey, color, formatValue }) {
  const max = Math.max(1, ...items.map((d) => d[valueKey] || 0));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((d, i) => {
        const val = d[valueKey] || 0;
        const pct = Math.round((val / max) * 100);
        return (
          <div key={d.id || d.month || i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>{d[labelKey]}</span>
              <span style={{ fontWeight: 700 }}>{formatValue ? formatValue(val) : val}</span>
            </div>
            <div style={{ height: 8, background: 'var(--border)', borderRadius: 99 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MasterDashboardPage() {
  const [stats, setStats] = useState(null);
  const [openTickets, setOpenTickets] = useState({ data: [], count: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: analytics, error: aErr }, { data: tickets, count, error: tErr }] = await Promise.all([
        fetchPlatformAnalytics(),
        listAllTickets({ status: 'Open', page: 1 }),
      ]);
      if (aErr) showToast('Failed to load platform analytics: ' + aErr.message, 'error');
      else setStats(analytics);
      if (tErr) showToast('Failed to load tickets: ' + tErr.message, 'error');
      else setOpenTickets({ data: tickets, count });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !stats) {
    return (
      <>
        <Header title="Master Dashboard" breadcrumb="Platform Overview" />
        <div className="page-content">
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading platform analytics…
          </div>
        </div>
      </>
    );
  }

  const companies  = stats?.companies  || { total: 0, new_this_month: 0 };
  const employees  = stats?.employees  || { total: 0, active: 0, inactive: 0, new_this_month: 0, by_role: {} };
  const attendance = stats?.attendance_today || { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, total: 0 };
  const payroll    = stats?.payroll_this_month || { runs_processed: 0, total_net_pay: 0 };
  const pending    = stats?.pending || { leave_requests: 0, wfh_requests: 0 };
  const topCompanies = stats?.top_companies || [];
  const recentSignups = stats?.recent_signups || [];
  const growthTrend = stats?.growth_trend || [];

  const attendancePct = attendance.total > 0 ? Math.round((attendance.present / attendance.total) * 100) : 0;
  const attendanceColor = attendancePct >= 75 ? 'var(--success)' : attendancePct >= 50 ? 'var(--warning)' : 'var(--danger)';

  const growthForBars = growthTrend.map((g) => ({ ...g, label: shortMonth(g.month) }));
  const topCompaniesForBars = topCompanies.map((c) => ({ ...c, label: c.company_name }));

  return (
    <>
      <Header
        title="Master Dashboard"
        breadcrumb="Complete overview of everything happening on CrewCore"
        actions={
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
            <i className={`fas fa-sync-alt${loading ? ' fa-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className="page-content">
        <div className="stats-row" style={{ marginBottom: 24 }}>
          <StatCard
            icon="fa-building" iconColor="blue"
            value={<>{companies.total}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', display: 'block' }}>+{companies.new_this_month} this month</span></>}
            label="Companies"
          />
          <StatCard
            icon="fa-users" iconColor="green"
            value={<>{employees.total}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', display: 'block' }}>+{employees.new_this_month} this month</span></>}
            label="Total Employees"
          />
          <StatCard icon="fa-user-check" iconColor="purple" value={employees.active} label="Active Employees" />
          <StatCard icon="fa-calendar-check" iconColor="green" value={`${attendance.present} / ${attendance.total}`} label="Present Today" />
          <StatCard icon="fa-money-bill-wave" iconColor="orange" value={fmtMoney(payroll.total_net_pay)} label="Payroll This Month" />
          <StatCard icon="fa-hourglass-half" iconColor="red" value={pending.leave_requests + pending.wfh_requests} label="Pending Leave / WFH" />
          <Link to="/helpdesk-admin" style={{ textDecoration: 'none', color: 'inherit' }}>
            <StatCard icon="fa-headset" iconColor={openTickets.count > 0 ? 'red' : 'blue'} value={openTickets.count} label="Open Support Tickets" />
          </Link>
        </div>

        {/* Attendance today */}
        <div className="card" style={{ marginBottom: 24, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Attendance Today — All Companies</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: attendanceColor }}>
              {attendance.present} / {attendance.total} &nbsp;({attendancePct}%)
            </span>
          </div>
          <div style={{ height: 10, background: 'var(--border)', borderRadius: 99 }}>
            <div style={{ height: '100%', width: `${attendancePct}%`, background: attendanceColor, borderRadius: 99, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span><span style={{ color: 'var(--success)', fontWeight: 600 }}>{attendance.present}</span> present</span>
            <span><span style={{ color: 'var(--warning)', fontWeight: 600 }}>{attendance.late}</span> late</span>
            <span><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{attendance.half_day}</span> half day</span>
            <span><span style={{ color: 'var(--primary)', fontWeight: 600 }}>{attendance.leave}</span> on leave</span>
            <span><span style={{ color: 'var(--danger)', fontWeight: 600 }}>{attendance.absent}</span> absent</span>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-header"><h3>Growth — Last 6 Months</h3></div>
            <div style={{ padding: '4px 20px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Companies Added</div>
              <BarList items={growthForBars} valueKey="companies_added" labelKey="label" color="var(--primary)" />
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '20px 0 8px' }}>Employees Added</div>
              <BarList items={growthForBars} valueKey="employees_added" labelKey="label" color="var(--success)" />
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Top Companies</h3></div>
            <div style={{ padding: '4px 20px 20px' }}>
              {topCompaniesForBars.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No companies yet.</div>
              ) : (
                <BarList items={topCompaniesForBars} valueKey="active_employees" labelKey="label" color="var(--primary)" />
              )}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header"><h3>Recent Signups</h3></div>
            <div style={{ padding: '4px 20px 16px' }}>
              {recentSignups.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No companies yet.</div>
              ) : recentSignups.map((c) => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <Link to="/tenants" style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', textDecoration: 'none' }}>{c.company_name}</Link>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(c.created_at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Recent Open Tickets</h3>
              <Link to="/helpdesk-admin" style={{ fontSize: 12, color: 'var(--primary)' }}>View all →</Link>
            </div>
            <div style={{ padding: '4px 20px 16px' }}>
              {openTickets.data.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No open tickets. All clear.</div>
              ) : openTickets.data.slice(0, 5).map((t) => (
                <Link
                  key={t.id}
                  to={`/helpdesk-admin?ticket=${t.id}`}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-light)', textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.tenants?.company_name || '—'} · {timeAgo(t.created_at)}</div>
                  </div>
                  <span className={`badge ${PRIORITY_BADGE[t.priority] || 'badge'}`} style={{ flexShrink: 0, marginLeft: 8 }}>{t.priority}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
