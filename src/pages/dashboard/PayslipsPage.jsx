import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmt, monthLabel, getInitials, getAvatarColor } from '@/lib/helpers';

export default function PayslipsPage() {
  const { tenant } = useAuth();
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [payslips, setPayslips] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filterEmp, setFilterEmp] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchPayslips = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);

    // Fetch payroll+payslips and employees in parallel
    const [payrollRes, empsRes] = await Promise.all([
      supabase
        .from('payrolls')
        .select('id, payslips(*)')
        .eq('tenant_id', tenant.id)
        .eq('month', month + 1)
        .eq('year', year)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('tenant_id', tenant.id)
        .eq('status', 'Active'),
    ]);

    setPayslips(payrollRes.data?.payslips || []);
    setEmployees(empsRes.data || []);
    setLoading(false);
  }, [tenant, month, year]);

  useEffect(() => { fetchPayslips(); }, [fetchPayslips]);

  const changeMonth = (delta) => {
    let m = month + delta, y = year;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setMonth(m); setYear(y);
  };

  let filtered = payslips;
  if (filterEmp) filtered = filtered.filter((p) => p.profile_id === filterEmp);

  const printPayslip = (slip) => {
    let breakdown = { earnings: [], deductions: [] };
    try { breakdown = typeof slip.breakdown === 'string' ? JSON.parse(slip.breakdown) : slip.breakdown; } catch (e) { /**/ }

    const w = window.open('', '', 'width=700,height=600');
    w.document.write(`<html><head><title>Payslip</title>
    <style>body{font-family:Inter,sans-serif;padding:20px}*{margin:0;box-sizing:border-box}
    .row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
    .row.total{font-weight:700;font-size:15px;padding-top:10px;border-top:2px solid #000;margin-top:6px}
    .header{display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #000}
    .section{font-size:12px;font-weight:700;margin:12px 0 6px;padding:4px 8px;background:#f0f0f0;border-radius:4px}</style></head><body>
    <div class="header"><div><strong style="font-size:16px">${tenant?.company_name || 'Company'}</strong><br><span style="font-size:11px">Payslip for ${monthLabel(month, year)}</span></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;margin-bottom:14px">
      <div>Name: <strong>${slip.emp_name}</strong></div>
      <div>Department: <strong>${slip.department || '—'}</strong></div>
      <div>Days Worked: <strong>${slip.work_days}/${slip.total_work_days}</strong></div></div>
    <div class="section">Earnings</div>
    ${(breakdown.earnings || []).map((e) => `<div class="row"><span>${e.name}</span><span>₹${e.amount?.toLocaleString('en-IN')}</span></div>`).join('')}
    <div class="row" style="font-weight:600;border-top:1px solid #ccc;padding-top:6px"><span>Total Earnings</span><span>₹${slip.gross_earnings?.toLocaleString('en-IN')}</span></div>
    <div class="section">Deductions</div>
    ${(breakdown.deductions || []).map((d) => `<div class="row"><span>${d.name}</span><span>₹${d.amount?.toLocaleString('en-IN')}</span></div>`).join('')}
    ${slip.advance_deduction > 0 ? `<div class="row"><span>Advance Recovery</span><span>₹${slip.advance_deduction?.toLocaleString('en-IN')}</span></div>` : ''}
    <div class="row" style="font-weight:600;border-top:1px solid #ccc;padding-top:6px"><span>Total Deductions</span><span>₹${(slip.total_deductions + slip.advance_deduction)?.toLocaleString('en-IN')}</span></div>
    <div class="row total"><span>Net Pay</span><span>₹${slip.net_pay?.toLocaleString('en-IN')}</span></div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <>
      <Header title="Payslips" breadcrumb={monthLabel(month, year)} />
      <div className="page-content">
        <div className="filter-bar">
          <div className="month-selector">
            <button onClick={() => changeMonth(-1)}><i className="fas fa-chevron-left" /></button>
            <span>{monthLabel(month, year)}</span>
            <button onClick={() => changeMonth(1)}><i className="fas fa-chevron-right" /></button>
          </div>
          <select className="form-select" value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)}>
            <option value="">All Employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                <i className="fas fa-file-invoice empty-icon" />
                <h3>No payslips found</h3>
                <p>No payroll has been processed for {monthLabel(month, year)}</p>
              </div>
            </div>
          </div>
        ) : (
          filtered.map((slip) => {
            let breakdown = { earnings: [], deductions: [] };
            try { breakdown = typeof slip.breakdown === 'string' ? JSON.parse(slip.breakdown) : slip.breakdown; } catch (e) { /**/ }

            return (
              <div className="card" key={slip.id}>
                <div className="card-body">
                  <div className="payslip">
                    <div className="payslip-header">
                      <div>
                        <strong style={{ fontSize: 16 }}>{tenant?.company_name || 'Company'}</strong><br />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Payslip for {monthLabel(month, year)}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => printPayslip(slip)}>
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
            );
          })
        )}
      </div>
    </>
  );
}
