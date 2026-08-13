import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { fetchOutletsOverview } from '@/services/outletDashboardService';

const PALETTE = [
  { bg: 'var(--primary-light)', fg: 'var(--primary)',  bar: 'var(--primary)'  },
  { bg: 'var(--success-light)', fg: 'var(--success)',  bar: 'var(--success)'  },
  { bg: '#ede9fe',              fg: '#7c3aed',         bar: '#7c3aed'         },
  { bg: 'var(--warning-light)', fg: 'var(--warning)',  bar: 'var(--warning)'  },
  { bg: 'var(--danger-light)',  fg: 'var(--danger)',   bar: 'var(--danger)'   },
  { bg: '#fce7f3',              fg: '#be185d',         bar: '#be185d'         },
];

export default function CombinedOutletDashboardPage() {
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const { selectOutlet } = useOutletView();
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await fetchOutletsOverview(tenant.id);
    if (error) showToast('Could not load combined data: ' + error.message, 'error');
    setOutlets(data || []); // keep the "unassigned" bucket (id: null) so totals below don't silently exclude anyone
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  // Real, named outlets only — used for the outlet-vs-outlet comparison chart, which
  // can't meaningfully show an "unassigned" bar (there's nowhere for it to link to).
  const realOutlets = outlets.filter((o) => o.id);
  const unassigned  = outlets.find((o) => !o.id);

  // Combining fewer than 2 outlets is meaningless — bounce back to the regular dashboard
  // rather than show a "combined" view of a single outlet (this page is reached via a
  // sidebar link that's already hidden in that case, but guard direct/stale navigation too).
  useEffect(() => {
    if (!loading && realOutlets.length <= 1) navigate('/dashboard', { replace: true });
  }, [loading, realOutlets.length, navigate]);

  // Totals include unassigned employees — otherwise "Total Employees" undercounts
  // anyone who hasn't been assigned to an outlet yet.
  const totalEmps    = outlets.reduce((s, o) => s + o.employee_count, 0);
  const totalPresent = outlets.reduce((s, o) => s + o.present_today, 0);
  const totalLate    = outlets.reduce((s, o) => s + o.late_today, 0);
  const totalAbsent  = outlets.reduce((s, o) => s + o.absent_today, 0);
  const totalLeaves  = outlets.reduce((s, o) => s + o.pending_leaves, 0);
  const overallPct   = totalEmps > 0 ? Math.round((totalPresent / totalEmps) * 100) : 0;

  return (
    <>
      <Header
        title={`Combined Dashboard — ${tenant?.company_name || ''}`}
        breadcrumb={`${realOutlets.length} outlets combined`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/outlets')}>
              <i className="fas fa-store" /> All Outlets
            </button>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
              <i className={`fas fa-sync-alt${loading ? ' fa-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />

      <div className="page-content">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading combined data…
          </div>
        ) : (
          <>
            <div className="stats-row" style={{ marginBottom: 24 }}>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                  <i className="fas fa-store" />
                </div>
                <div>
                  <div className="stat-value">{realOutlets.length}</div>
                  <div className="stat-label">Outlets</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
                  <i className="fas fa-users" />
                </div>
                <div>
                  <div className="stat-value">{totalEmps}</div>
                  <div className="stat-label">Total Employees</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: '#ede9fe', color: '#7c3aed' }}>
                  <i className="fas fa-user-check" />
                </div>
                <div>
                  <div className="stat-value">
                    {totalPresent}
                    <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 5 }}>
                      {overallPct}%
                    </span>
                  </div>
                  <div className="stat-label">Present Today</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                  <i className="fas fa-clock" />
                </div>
                <div>
                  <div className="stat-value">{totalLate}</div>
                  <div className="stat-label">Late Today</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                  <i className="fas fa-calendar-times" />
                </div>
                <div>
                  <div className="stat-value">{totalLeaves}</div>
                  <div className="stat-label">Pending Leaves</div>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 24, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Combined Attendance Today</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: overallPct >= 75 ? 'var(--success)' : overallPct >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
                  {totalPresent} / {totalEmps} &nbsp;({overallPct}%)
                </span>
              </div>
              <div style={{ height: 10, background: 'var(--border)', borderRadius: 99 }}>
                <div style={{
                  height: '100%', width: `${overallPct}%`, borderRadius: 99,
                  background: overallPct >= 75 ? 'var(--success)' : overallPct >= 50 ? 'var(--warning)' : 'var(--danger)',
                  transition: 'width 0.6s ease',
                }} />
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                <span><span style={{ color: 'var(--success)', fontWeight: 600 }}>{totalPresent}</span> present</span>
                <span><span style={{ color: 'var(--warning)', fontWeight: 600 }}>{totalLate}</span> late</span>
                <span><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{totalAbsent}</span> absent</span>
              </div>
            </div>

            {unassigned && unassigned.employee_count > 0 && (
              <div className="card" style={{ marginBottom: 24, padding: '12px 16px', background: 'var(--warning-light)', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <i className="fas fa-exclamation-triangle" />
                <span style={{ flex: 1, fontSize: 13 }}>
                  {unassigned.employee_count} active employee{unassigned.employee_count !== 1 ? 's are' : ' is'} not yet assigned to an outlet — included in the totals above, but not shown in the comparison below.
                </span>
                <button className="btn btn-sm btn-outline" onClick={() => navigate('/employees')}>
                  Assign Now
                </button>
              </div>
            )}

            {realOutlets.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <h3>Attendance Comparison</h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Today's attendance rate per outlet — sorted highest first</span>
                </div>
                <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {[...realOutlets]
                    .map((o, i) => ({
                      ...o,
                      pct: o.employee_count > 0 ? Math.round((o.present_today / o.employee_count) * 100) : 0,
                      color: PALETTE[i % PALETTE.length],
                    }))
                    .sort((a, b) => b.pct - a.pct)
                    .map((o) => (
                      <div key={o.id} style={{ cursor: 'pointer' }} onClick={() => { selectOutlet(o.id); navigate('/dashboard'); }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: o.color.bar, flexShrink: 0 }} />
                            <span style={{ fontWeight: 500 }}>{o.name}</span>
                          </div>
                          <span style={{ fontWeight: 700, color: o.color.fg }}>{o.pct}%</span>
                        </div>
                        <div style={{ height: 8, background: 'var(--border)', borderRadius: 99 }}>
                          <div style={{ height: '100%', width: `${o.pct}%`, background: o.color.bar, borderRadius: 99, transition: 'width 0.6s ease' }} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {o.present_today} of {o.employee_count} present
                          {o.late_today > 0 && <span style={{ marginLeft: 10, color: 'var(--warning)' }}>{o.late_today} late</span>}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
