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

export default function OutletsOverviewPage() {
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const { selectedOutletId, selectedOutletName, selectOutlet } = useOutletView();
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  const openOutlet = (id) => {
    selectOutlet(id);
    navigate('/dashboard');
  };

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await fetchOutletsOverview(tenant.id);
    if (error) showToast('Could not load outlets: ' + error.message, 'error');
    setOutlets(data || []);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const realOutlets = outlets.filter((o) => o.id);
  const unassigned = outlets.find((o) => !o.id);
  const totalEmps = outlets.reduce((s, o) => s + o.employee_count, 0);

  return (
    <>
      <Header
        title="Which outlet do you want to open?"
        breadcrumb={
          selectedOutletName
            ? `Currently viewing: ${selectedOutletName} · ${realOutlets.length} outlets · ${totalEmps} employees`
            : `${realOutlets.length} outlets · ${totalEmps} employees`
        }
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
              <i className={`fas fa-sync-alt${loading ? ' fa-spin' : ''}`} /> Refresh
            </button>
            {realOutlets.length > 1 && (
              <button className="btn btn-outline btn-sm" onClick={() => navigate('/outlets/combined')}>
                <i className="fas fa-chart-bar" /> Compare Outlets
              </button>
            )}
          </div>
        }
      />

      <div className="page-content">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading outlets…
          </div>
        ) : realOutlets.length === 0 ? (
          <div style={{ padding: 72, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18, background: 'var(--primary-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', fontSize: 28, color: 'var(--primary)',
            }}>
              <i className="fas fa-store" />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              No outlets yet
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Add outlets from Settings, or import employees with an OUTLET/branch<br />
              column — outlets are created automatically from that column.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {realOutlets.length > 1 && (
                <div
                  onClick={() => openOutlet(null)}
                  style={{
                    background: 'var(--card-bg)', border: `1px dashed ${!selectedOutletId ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: 12, cursor: 'pointer', padding: '18px', display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                    background: 'var(--primary-light)', color: 'var(--primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                  }}>
                    <i className="fas fa-layer-group" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>
                      Combined (All Outlets)
                      {!selectedOutletId && (
                        <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--primary)', color: '#fff', borderRadius: 4, padding: '1px 5px', marginLeft: 8 }}>
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {totalEmps} employees across every outlet
                    </div>
                  </div>
                </div>
              )}

              {realOutlets.map((outlet, idx) => {
                const c = PALETTE[idx % PALETTE.length];
                const pct = outlet.employee_count > 0
                  ? Math.round((outlet.present_today / outlet.employee_count) * 100) : 0;

                const isCurrent = outlet.id === selectedOutletId;
                return (
                  <div
                    key={outlet.id}
                    onClick={() => openOutlet(outlet.id)}
                    style={{
                      background: 'var(--card-bg)', border: `1px solid ${isCurrent ? c.fg : 'var(--border)'}`,
                      borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                      boxShadow: isCurrent ? `0 0 0 1px ${c.fg}55` : undefined,
                      transition: 'box-shadow 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 0 1px ${c.fg}55`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                  >
                    <div style={{ background: c.bg, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                        background: c.fg, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, fontWeight: 700,
                      }}>
                        {outlet.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: c.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {outlet.name}
                          {isCurrent && (
                            <span style={{ fontSize: 9, fontWeight: 700, background: c.fg, color: '#fff', borderRadius: 4, padding: '1px 5px', marginLeft: 8 }}>
                              CURRENT
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: c.fg, opacity: 0.75, marginTop: 2 }}>
                          {outlet.employee_count} active employee{outlet.employee_count !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {outlet.pending_leaves > 0 && (
                        <div style={{ background: 'var(--danger)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '3px 8px', flexShrink: 0 }}>
                          {outlet.pending_leaves} leave{outlet.pending_leaves !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>

                    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Today's Attendance</span>
                          <span style={{ fontWeight: 700, color: c.fg }}>{pct}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--border)', borderRadius: 99 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: c.bar, borderRadius: 99, transition: 'width 0.5s ease' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
                          <span style={{ color: 'var(--success)' }}>
                            <i className="fas fa-check-circle" style={{ marginRight: 3 }} />{outlet.present_today} present
                          </span>
                          {outlet.late_today > 0 && (
                            <span style={{ color: 'var(--warning)' }}>
                              <i className="fas fa-clock" style={{ marginRight: 3 }} />{outlet.late_today} late
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>
                        Open HR dashboard <i className="fas fa-arrow-right" style={{ marginLeft: 3 }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {unassigned && (
              <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--warning-light)', color: 'var(--warning)', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="fas fa-exclamation-triangle" />
                {unassigned.employee_count} active employee{unassigned.employee_count !== 1 ? 's' : ''} not yet assigned to an outlet — edit them from the Employees page to set their branch.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
