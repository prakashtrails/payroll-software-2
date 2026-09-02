import { useEffect, useState, useCallback, useMemo } from 'react';
import Header from '@/components/Header';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { listAllTenants, listOutlets, updateTenant } from '@/services/tenantService';
import {
  listFeatures, listCompanyFeatureToggles, resolveFeatureState, setFeatureToggle, clearFeatureOverride,
  syncFeatureRegistry,
} from '@/services/featureService';

// Keka-style default: 3 self-approvals/month, matches the prior hardcoded
// requestQuotaService.SELF_LIMIT — shown here only as the input's placeholder
// when a tenant hasn't set anything yet.
const DEFAULT_AUTO_APPROVAL_LIMIT = 3;

// Generic per-tenant "N self-approvals/month, or off entirely" control —
// backs both Leave Auto-Approval (leave_auto_approval_*) and Attendance
// Regularization Auto-Approval (regularize_auto_approval_*), which are
// independent tenant columns so a company can auto-approve one and not the
// other (e.g. Indwell wants 3 for leave but every regularize request reviewed).
function AutoApprovalCard({ tenant, onSaved, title, description, enabledField, limitField }) {
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState(DEFAULT_AUTO_APPROVAL_LIMIT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setEnabled(tenant[enabledField] !== false);
    setLimit(tenant[limitField] ?? DEFAULT_AUTO_APPROVAL_LIMIT);
  }, [tenant?.id, enabledField, limitField]);

  if (!tenant) return null;

  const dirty = enabled !== (tenant[enabledField] !== false)
    || Number(limit) !== (tenant[limitField] ?? DEFAULT_AUTO_APPROVAL_LIMIT);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await updateTenant(tenant.id, {
      [enabledField]: enabled,
      [limitField]: Math.max(0, parseInt(limit, 10) || 0),
    });
    setSaving(false);
    if (error) return showToast('Failed to update: ' + error.message, 'error');
    showToast(`${title} settings saved`, 'success');
    onSaved();
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><h3>{title}</h3></div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn btn-outline btn-icon btn-sm"
            onClick={() => setEnabled((v) => !v)}
            title={enabled ? 'Disable auto-approval' : 'Enable auto-approval'}
          >
            <i className={`fas ${enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`} style={{ color: enabled ? 'var(--success)' : 'var(--text-muted)' }} />
          </button>
          <span className={`badge ${enabled ? 'badge-success' : 'badge-secondary'}`}>{enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        {enabled && (
          <div className="form-group" style={{ maxWidth: 260, marginBottom: 0 }}>
            <label className="form-label">Auto-approvals per employee / month</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
        )}
        <div>
          <button className="btn btn-primary btn-sm" disabled={saving || !dirty} onClick={handleSave}>
            {saving ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Saving…</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ToggleServicesPage() {
  const { profile } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [outlets, setOutlets] = useState([]);
  const [scopeOutletId, setScopeOutletId] = useState(''); // '' = company-wide
  const [features, setFeatures] = useState([]);
  const [toggles, setToggles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  const refreshTenants = useCallback(() => {
    listAllTenants().then(({ data }) => setTenants(data || []));
  }, []);

  const currentTenant = tenants.find((t) => t.id === tenantId) || null;

  useEffect(() => {
    listAllTenants().then(({ data }) => {
      setTenants(data || []);
      if (data?.length) setTenantId((prev) => prev || data[0].id);
    });
    // Bring the DB's feature list up to date with the code registry first —
    // any feature added to FEATURE_REGISTRY since this page was last opened
    // shows up right away, with no separate migration step required.
    syncFeatureRegistry().finally(() => {
      listFeatures().then(({ data }) => setFeatures(data || []));
    });
  }, []);

  const loadTenantScoped = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: outletData }, { data: toggleData }] = await Promise.all([
      listOutlets(tenantId),
      listCompanyFeatureToggles(tenantId),
    ]);
    setOutlets(outletData || []);
    setToggles(toggleData || []);
    setScopeOutletId('');
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { loadTenantScoped(); }, [loadTenantScoped]);

  const currentOutletId = scopeOutletId || null;

  // Grouped in the order listFeatures() already returns (sort_order) —
  // categories fall out in that same order as a side effect of Map insertion.
  const grouped = useMemo(() => {
    const byCategory = new Map();
    for (const f of features) {
      if (!byCategory.has(f.category)) byCategory.set(f.category, []);
      byCategory.get(f.category).push(f);
    }
    return Array.from(byCategory.entries());
  }, [features]);

  const handleToggle = async (f) => {
    const effective = resolveFeatureState(toggles, f.key, currentOutletId);
    setSavingKey(f.key);
    const { error } = await setFeatureToggle(tenantId, currentOutletId, f.key, !effective, profile?.id);
    setSavingKey(null);
    if (error) return showToast('Failed to update: ' + error.message, 'error');
    loadTenantScoped();
  };

  const handleReset = async (f) => {
    setSavingKey(f.key);
    const { error } = await clearFeatureOverride(tenantId, currentOutletId, f.key);
    setSavingKey(null);
    if (error) return showToast('Failed to reset: ' + error.message, 'error');
    loadTenantScoped();
  };

  return (
    <>
      <Header title="Toggle Services" breadcrumb="Platform administration — enable or disable individual features per company, or per branch" />
      <div className="page-content">
        <div className="filter-bar">
          <div className="form-group" style={{ minWidth: 240 }}>
            <label className="form-label">Company</label>
            <select className="form-select" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.company_name}</option>)}
            </select>
          </div>
          {outlets.length > 0 && (
            <div className="form-group" style={{ minWidth: 220 }}>
              <label className="form-label">Scope</label>
              <select className="form-select" value={scopeOutletId} onChange={(e) => setScopeOutletId(e.target.value)}>
                <option value="">Company-wide (all branches)</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><div className="spinner" style={{ margin: '0 auto 16px' }} />Loading…</div>
        ) : !tenantId ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No companies registered yet.</div>
        ) : (
          <>
          {!scopeOutletId && (
            <>
              <AutoApprovalCard
                tenant={currentTenant}
                onSaved={refreshTenants}
                title="Leave Auto-Approval"
                description={'Employees can self-approve their own leave requests instantly, up to a monthly limit, before requests start routing to their manager and then HR. Some companies want a few auto-approvals a month; others want every leave request reviewed by a human — turn this off for those.'}
                enabledField="leave_auto_approval_enabled"
                limitField="leave_auto_approval_limit"
              />
              <AutoApprovalCard
                tenant={currentTenant}
                onSaved={refreshTenants}
                title="Attendance Regularization Auto-Approval"
                description={'Employees can self-approve their own attendance-correction requests instantly, up to a monthly limit, before requests start routing to their manager and then HR. Independent of the leave setting above — a company can auto-approve one and not the other.'}
                enabledField="regularize_auto_approval_enabled"
                limitField="regularize_auto_approval_limit"
              />
            </>
          )}
          {grouped.map(([category, items]) => (
            <div className="card" key={category} style={{ marginBottom: 16 }}>
              <div className="card-header"><h3>{category}</h3></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Feature</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {items.map((f) => {
                      const explicitRow = toggles.find((t) => t.feature_key === f.key && (t.outlet_id || null) === currentOutletId);
                      const effective = resolveFeatureState(toggles, f.key, currentOutletId);
                      return (
                        <tr key={f.key}>
                          <td>
                            <strong>{f.name}</strong>
                            {f.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.description}</div>}
                          </td>
                          <td>
                            <span className={`badge ${effective ? 'badge-success' : 'badge-danger'}`}>{effective ? 'Enabled' : 'Disabled'}</span>
                            {!explicitRow && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>(inherited)</span>}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-outline btn-icon btn-sm"
                                disabled={savingKey === f.key}
                                onClick={() => handleToggle(f)}
                                title={effective ? 'Disable' : 'Enable'}
                              >
                                <i className={`fas ${effective ? 'fa-toggle-on' : 'fa-toggle-off'}`} style={{ color: effective ? 'var(--success)' : 'var(--text-muted)' }} />
                              </button>
                              {explicitRow && (
                                <button className="btn btn-outline btn-sm" disabled={savingKey === f.key} onClick={() => handleReset(f)} title="Reset to default (inherit)">
                                  Reset
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          </>
        )}
      </div>
    </>
  );
}
