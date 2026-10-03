import React, { useCallback, useEffect, useState } from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { getOrgTree, getOutletOrgEmployees } from '@/services/orgHierarchyService';
import { listOutlets, listAllTenants } from '@/services/tenantService';
import OrgTree from '@/components/orgHierarchy/OrgTree';
import OutletOrgExplorer from '@/components/orgHierarchy/OutletOrgExplorer';
import AssignManagerModal from '@/components/orgHierarchy/AssignManagerModal';
import { isRaniwalaTenant } from '@/lib/helpers';

const VIEWS = [
  { key: 'reporting', label: 'Reporting Hierarchy', icon: 'fa-sitemap' },
  { key: 'outlets', label: 'Outlet Structure', icon: 'fa-store' },
];

/**
 * Shared org-structure page: tenant admin/HR get it auto-scoped to their own
 * tenant; superadmin sees the same page plus a tenant picker so they can open
 * any tenant's tree (the "master hierarchy screen" superadmin asked for).
 *
 * Two independent views over the same active-employee list:
 *  - Reporting Hierarchy: the manager_id chain (OrgTree) — editable, used to
 *    reassign managers.
 *  - Outlet Structure: a read-only physical-location drill-down (Outlet →
 *    Division → Department → Person) via OutletOrgExplorer.
 */
export default function OrgHierarchyPage() {
  const { profile, tenant } = useAuth();
  const isSuperadmin = profile?.role === 'superadmin';

  const [view, setView] = useState('reporting');
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [employees, setEmployees] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assignTarget, setAssignTarget] = useState(null);

  useEffect(() => {
    if (!isSuperadmin) return;
    (async () => {
      const { data } = await listAllTenants();
      setTenants(data);
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('tenantId');
      setSelectedTenantId(fromQuery || data[0]?.id || '');
    })();
  }, [isSuperadmin]);

  const activeTenantId = isSuperadmin ? selectedTenantId : tenant?.id;
  const activeTenantName = isSuperadmin
    ? tenants.find((t) => t.id === selectedTenantId)?.company_name
    : tenant?.company_name;
  // Raniwala's chart is headed by Abhiyant Sir → Abhishek Sir (neither is a
  // user in the system), with the heads who report to them underneath.
  const topManagement = isRaniwalaTenant({ company_name: activeTenantName });

  const loadTree = useCallback(async () => {
    if (!activeTenantId) { setEmployees([]); setOutlets([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: reportingData }, { data: outletEmpData }, { data: outletData }] = await Promise.all([
      getOrgTree(activeTenantId),
      getOutletOrgEmployees(activeTenantId),
      listOutlets(activeTenantId),
    ]);
    // Reporting Hierarchy (manager_id chain) and Outlet Structure (outlet_id/
    // division/department) need slightly different columns — fetched
    // separately above, merged here so OrgTree still gets its manager_id.
    const byId = new Map(outletEmpData.map((e) => [e.id, e]));
    const merged = reportingData.map((e) => ({ ...e, ...(byId.get(e.id) || {}) }));
    setEmployees(merged);
    setOutlets(outletData);
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => { loadTree(); }, [loadTree]);

  return (
    <>
      <Header
        title="Org Structure"
        breadcrumb={activeTenantName ? `${VIEWS.find(v => v.key === view)?.label} — ${activeTenantName}` : 'Org Structure'}
      />
      <div className="page-content">
        <div className="filter-bar">
          {isSuperadmin && (
            <select
              className="form-select"
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              style={{ minWidth: 240 }}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.company_name}</option>
              ))}
            </select>
          )}
          <div style={{ display: 'flex', gap: 2, border: '1px solid var(--border)', borderRadius: 8, padding: 2, marginLeft: isSuperadmin ? 0 : 'auto' }}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={`btn btn-sm ${view === v.key ? 'btn-primary' : 'btn-outline'}`}
                style={{ border: 'none' }}
                onClick={() => setView(v.key)}
              >
                <i className={`fas ${v.icon}`} style={{ marginRight: 6 }} />{v.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div className="spinner" />
          </div>
        ) : (
          <div className="card">
            {view === 'reporting' ? (
              <OrgTree
                employees={employees}
                tenantName={activeTenantName}
                topManagement={topManagement}
                meId={profile?.id}
                myDepartment={profile?.department}
                onAssignManager={setAssignTarget}
              />
            ) : (
              <OutletOrgExplorer
                employees={employees}
                outlets={outlets}
                tenantName={activeTenantName}
              />
            )}
          </div>
        )}
      </div>

      <AssignManagerModal
        show={!!assignTarget}
        employee={assignTarget}
        candidates={employees}
        onClose={() => setAssignTarget(null)}
        onAssigned={loadTree}
      />
    </>
  );
}
