import React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Pagination from '@/components/Pagination';
import { showToast } from '@/components/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { listAllEmployees, listPendingCredentials, PLATFORM_EMPLOYEE_PAGE_SIZE } from '@/services/platformService';
import { listAllTenants, listOutlets } from '@/services/tenantService';
import { fmt, getInitials, getAvatarColor, fullName } from '@/lib/helpers';

export default function AllEmployeesPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [tenantFilter, setTenantFilter] = useState('');
  const [outletFilter, setOutletFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PLATFORM_EMPLOYEE_PAGE_SIZE));

  const [employees, setEmployees] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listAllTenants().then(({ data, error }) => {
      if (error) showToast('Failed to load companies', 'error');
      setTenants(data || []);
    });
  }, []);

  useEffect(() => {
    setOutletFilter('');
    if (!tenantFilter) { setOutlets([]); return; }
    listOutlets(tenantFilter).then(({ data }) => setOutlets(data || []));
  }, [tenantFilter]);

  useEffect(() => { setPage(1); }, [debouncedSearch, tenantFilter, outletFilter, statusFilter]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, count, error } = await listAllEmployees({
        page, search: debouncedSearch, tenantId: tenantFilter, outletId: outletFilter, status: statusFilter,
      });
      if (error) showToast('Failed to load employees', 'error');
      setEmployees(data);
      setTotalCount(count);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, tenantFilter, outletFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [exporting, setExporting] = useState(false);

  // Superadmin-only bulk export of first-login credentials — requires at least
  // a company to be picked (optionally narrowed to one branch). Only includes
  // employees who haven't logged in yet (must_change_password still true);
  // once someone sets their own password temp_password is stale, so there'd
  // be no point exporting it.
  const exportTempPasswords = async () => {
    if (!tenantFilter) {
      return showToast('Pick a company first', 'warning');
    }
    setExporting(true);
    try {
      const { data, error } = await listPendingCredentials(tenantFilter, outletFilter);
      if (error) return showToast('Export failed: ' + error.message, 'error');
      if (!data.length) return showToast('No one here is still pending first login', 'info');

      const tenantName = tenants.find((t) => t.id === tenantFilter)?.company_name || 'company';
      const outletName = outletFilter ? (outlets.find((o) => o.id === outletFilter)?.name || 'branch') : 'all_branches';

      let csv = 'Employee ID,Name,Outlet,Email,Temporary Password\n';
      data.forEach((e) => {
        csv += `"${e.employee_id || ''}","${fullName(e)}","${e.outlets?.name || ''}","${e.email || ''}","${e.temp_password || ''}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `temp_passwords_${tenantName}_${outletName}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
      a.click();
      showToast(`Exported ${data.length} pending credentials`, 'success');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Header title="All Employees" breadcrumb={`${totalCount} employees across the platform`} />
      <div className="page-content">
        <div className="filter-bar">
          <select className="form-select" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
            <option value="">All Companies</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.company_name}</option>)}
          </select>
          {outlets.length > 0 && (
            <select className="form-select" value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
              <option value="">All Branches</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <input
            className="form-input"
            placeholder="🔍 Search name, email, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
          />
          {tenantFilter && (
            <button className="btn btn-outline" onClick={exportTempPasswords} disabled={exporting}>
              <i className="fas fa-key" /> {exporting ? 'Exporting…' : outletFilter ? 'Export Temp Passwords (CSV)' : 'Export All Temp Passwords (CSV)'}
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />Loading employees…
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Employee</th><th>Company</th><th>Branch</th><th>Department</th><th>Monthly CTC</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                        No employees match your filters.
                      </td>
                    </tr>
                  ) : employees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div className="emp-cell">
                          <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${getAvatarColor(e.id)})` }}>
                            {getInitials(e.first_name, e.last_name)}
                          </div>
                          <div>
                            <div className="emp-name">{fullName(e)}</div>
                            <div className="emp-role">{e.email || ''}</div>
                          </div>
                        </div>
                      </td>
                      <td>{e.tenants?.company_name || '—'}</td>
                      <td>{e.outlets?.name || e.outlet_location || '—'}</td>
                      <td>{e.department || '—'}</td>
                      <td>{fmt(e.ctc)}</td>
                      <td><span className={`badge ${e.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>{e.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          </div>
        )}
      </div>
    </>
  );
}
