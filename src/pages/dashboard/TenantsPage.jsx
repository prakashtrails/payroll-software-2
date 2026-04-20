import React from 'react';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import { listAllTenants } from '@/services/tenantService';

export default function TenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listAllTenants().then(({ data }) => {
      setTenants(data);
      setLoading(false);
    });
  }, []);

  return (
    <>
      <Header title="Tenant Management" breadcrumb="Platform administration" />
      <div className="page-content">
        <div className="stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <StatCard icon="fa-building"     iconColor="blue"   value={tenants.length} label="Total Tenants" />
          <StatCard icon="fa-check-circle" iconColor="green"  value={tenants.length} label="Active" />
          <StatCard icon="fa-clock"        iconColor="orange" value={0}              label="Pending Setup" />
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading tenants…</div>
        ) : (
          <div className="card">
            <div className="card-header"><h3>Registered Businesses</h3></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Company</th><th>Domain</th><th>Working Days</th><th>Currency</th><th>Registered</th></tr>
                </thead>
                <tbody>
                  {tenants.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No tenants registered yet.</td></tr>
                  ) : tenants.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.company_name}</strong></td>
                      <td>{t.domain || '—'}</td>
                      <td>{t.work_days || 26}</td>
                      <td>{t.currency || '₹'}</td>
                      <td>{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
