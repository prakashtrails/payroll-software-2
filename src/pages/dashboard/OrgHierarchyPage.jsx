import React, { useCallback, useEffect, useState } from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { getOrgTree } from '@/services/orgHierarchyService';
import { listAllTenants } from '@/services/tenantService';
import OrgTree from '@/components/orgHierarchy/OrgTree';
import AssignManagerModal from '@/components/orgHierarchy/AssignManagerModal';

/**
 * Shared org-structure page: tenant admin/HR get it auto-scoped to their own
 * tenant; superadmin sees the same page plus a tenant picker so they can open
 * any tenant's tree (the "master hierarchy screen" superadmin asked for).
 */
export default function OrgHierarchyPage() {
  const { profile, tenant } = useAuth();
  const isSuperadmin = profile?.role === 'superadmin';

  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [employees, setEmployees] = useState([]);
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

  const loadTree = useCallback(async () => {
    if (!activeTenantId) { setEmployees([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await getOrgTree(activeTenantId);
    setEmployees(data);
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => { loadTree(); }, [loadTree]);

  return (
    <>
      <Header
        title="Org Structure"
        breadcrumb={activeTenantName ? `Reporting hierarchy — ${activeTenantName}` : 'Reporting hierarchy'}
      />
      <div className="page-content">
        {isSuperadmin && (
          <div className="filter-bar">
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
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div className="spinner" />
          </div>
        ) : (
          <div className="card">
            <OrgTree
              employees={employees}
              tenantName={activeTenantName}
              onAssignManager={setAssignTarget}
            />
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
