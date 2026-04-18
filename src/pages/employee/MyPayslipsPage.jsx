import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmt, monthLabel } from '@/lib/helpers';

export default function MyPayslipsPage() {
  const { profile, tenant } = useAuth();
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [slip, setSlip] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMyPayslip = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);

    const { data: payroll } = await supabase
      .from('payrolls')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('month', month + 1)
      .eq('year', year)
      .maybeSingle();

    if (payroll) {
      const { data: mySlip } = await supabase
        .from('payslips')
        .select('*')
        .eq('payroll_id', payroll.id)
        .eq('profile_id', profile.id)
        .maybeSingle();
      setSlip(mySlip);
    } else {
      setSlip(null);
    }
    setLoading(false);
  }, [profile, tenant, month, year]);

  useEffect(() => { fetchMyPayslip(); }, [fetchMyPayslip]);

  const changeMonth = (delta) => {
    let m = month + delta, y = year;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setMonth(m); setYear(y);
  };

  let breakdown = { earnings: [], deductions: [] };
  if (slip) {
    try { breakdown = typeof slip.breakdown === 'string' ? JSON.parse(slip.breakdown) : slip.breakdown; } catch (e) { /**/ }
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
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading...</div>
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
                  <div className="payslip-row" key={i}><span>{e.name}</span><span>{fmt(e.amount)}</span></div>
                ))}
                <div className="payslip-row" style={{ fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span>Total Earnings</span><span>{fmt(slip.gross_earnings)}</span>
                </div>
                <div className="payslip-section-title" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>Deductions</div>
                {(breakdown.deductions || []).map((d, i) => (
                  <div className="payslip-row" key={i}><span>{d.name}</span><span>{fmt(d.amount)}</span></div>
                ))}
                {slip.advance_deduction > 0 && (
                  <div className="payslip-row"><span>Advance/Loan Recovery</span><span>{fmt(slip.advance_deduction)}</span></div>
                )}
                <div className="payslip-row" style={{ fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span>Total Deductions</span><span>{fmt(slip.total_deductions + slip.advance_deduction)}</span>
                </div>
                <div className="payslip-row total"><span>Net Pay</span><span style={{ color: 'var(--success)' }}>{fmt(slip.net_pay)}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
