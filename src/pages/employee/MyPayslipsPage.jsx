import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { fetchMyPayslip } from '@/services/payrollService';
import { fmt, monthLabel } from '@/lib/helpers';

// Masks a formatted amount behind ₹ •••••• until revealed
function Amt({ value, show }) {
  if (!show) return <span style={{ fontFamily: 'monospace', letterSpacing: 2, color: 'var(--text-muted)' }}>₹ ••••••</span>;
  return <span>{fmt(value)}</span>;
}

export default function MyPayslipsPage() {
  const { profile, tenant } = useAuth();
  const [month, setMonth]     = useState(new Date().getMonth());
  const [year, setYear]       = useState(new Date().getFullYear());
  const [slip, setSlip]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAmounts, setShowAmounts] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    const { data } = await fetchMyPayslip(tenant.id, profile.id, month, year);
    setSlip(data);
    setLoading(false);
  }, [profile, tenant, month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const changeMonth = (delta) => {
    let m = month + delta, y = year;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setMonth(m); setYear(y);
    setShowAmounts(false); // hide again when switching month
  };

  let breakdown = { earnings: [], deductions: [] };
  if (slip) {
    try { breakdown = typeof slip.breakdown === 'string' ? JSON.parse(slip.breakdown) : slip.breakdown; } catch (_e) { /**/ }
  }

  return (
    <>
      <Header title="My Payslips" breadcrumb={monthLabel(month, year)} />
      <div className="page-content">
        <div className="filter-bar">
          <div className="month-selector">
            <button onClick={() => changeMonth(-1)}><i className="fas fa-chevron-left" /></button>
            <span>{monthLabel(month, year)}</span>
            <button onClick={() => changeMonth(1)}><i className="fas fa-chevron-right" /></button>
          </div>
          {slip && (
            <button
              className={`btn ${showAmounts ? 'btn-primary' : 'btn-outline'} btn-sm`}
              onClick={() => setShowAmounts((v) => !v)}
              style={{ marginLeft: 'auto' }}
            >
              <i className={`fas ${showAmounts ? 'fa-eye-slash' : 'fa-eye'}`} />
              {' '}{showAmounts ? 'Hide Amounts' : 'Reveal Amounts'}
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…
          </div>
        ) : !slip ? (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                <i className="fas fa-file-invoice empty-icon" />
                <h3>No payslip available</h3>
                <p>No payroll has been processed for {monthLabel(month, year)}.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-body">
              {!showAmounts && (
                <div style={{
                  background: 'var(--warning-light, #fffbeb)', color: 'var(--warning)',
                  padding: '8px 14px', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <i className="fas fa-lock" />
                  Salary amounts are hidden for privacy. Click <strong>Reveal Amounts</strong> to view.
                </div>
              )}
              <div className="payslip">
                <div className="payslip-header">
                  <div>
                    <strong style={{ fontSize: 16 }}>{tenant?.company_name || 'Company'}</strong><br />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Payslip for {monthLabel(month, year)}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => window.print()}>
                      <i className="fas fa-print" /> Print
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12, marginBottom: 14 }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>Name:</span> <strong>{slip.emp_name}</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Department:</span> <strong>{slip.department || '—'}</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Days Worked:</span> <strong>{slip.work_days}/{slip.total_work_days}</strong></div>
                </div>

                <div className="payslip-section-title" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>Earnings</div>
                {(breakdown.earnings || []).map((e, i) => (
                  <div className="payslip-row" key={i}>
                    <span>{e.name}</span>
                    <span><Amt value={e.amount} show={showAmounts} /></span>
                  </div>
                ))}
                <div className="payslip-row" style={{ fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span>Total Earnings</span>
                  <span><Amt value={slip.gross_earnings} show={showAmounts} /></span>
                </div>

                <div className="payslip-section-title" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>Deductions</div>
                {(breakdown.deductions || []).map((d, i) => (
                  <div className="payslip-row" key={i}>
                    <span>{d.name}</span>
                    <span><Amt value={d.amount} show={showAmounts} /></span>
                  </div>
                ))}
                {slip.advance_deduction > 0 && (
                  <div className="payslip-row">
                    <span>Advance/Loan Recovery</span>
                    <span><Amt value={slip.advance_deduction} show={showAmounts} /></span>
                  </div>
                )}
                <div className="payslip-row" style={{ fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span>Total Deductions</span>
                  <span><Amt value={slip.total_deductions + slip.advance_deduction} show={showAmounts} /></span>
                </div>

                <div className="payslip-row total">
                  <span>Net Pay</span>
                  <span style={{ color: 'var(--success)' }}>
                    <Amt value={slip.net_pay} show={showAmounts} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
