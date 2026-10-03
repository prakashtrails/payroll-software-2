import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { listCompanyFeatureToggles, listFeatures, resolveFeatureState } from '@/services/featureService';
import { isRaniwalaTenant } from '@/lib/helpers';

const FeatureContext = createContext({});

export function FeatureProvider({ children }) {
  const { profile, tenant } = useAuth();
  const { selectedOutletId } = useOutletView();

  const [toggles, setToggles] = useState([]);
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenant?.id) {
      setToggles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: toggleData }, { data: featureData }] = await Promise.all([
      listCompanyFeatureToggles(tenant.id),
      listFeatures(),
    ]);
    setToggles(toggleData || []);
    setFeatures(featureData || []);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  // Admin/superadmin scope by whichever outlet they're currently viewing;
  // everyone else is scoped to their own assigned outlet.
  const effectiveOutletId = (profile?.role === 'admin' || profile?.role === 'superadmin')
    ? selectedOutletId
    : profile?.outlet_id || null;

  // A premium feature (features.is_premium) defaults to OFF absent an
  // explicit toggle row; every ordinary feature keeps defaulting to ON,
  // unchanged from before this map existed.
  const defaultByKey = useMemo(() => new Map(features.map((f) => [f.key, !f.is_premium])), [features]);

  const isEnabled = useCallback((featureKey) => {
    if (!featureKey) return true;
    // Superadmin isn't scoped to any single company — never gate the Platform console.
    if (!tenant?.id) return true;
    // Raniwala doesn't use special requests — hidden regardless of any toggle
    // row (sidebar, routes, search, dashboards). The CrewCore app's
    // FeatureContext applies the same rule.
    if (featureKey === 'special_requests' && isRaniwalaTenant(tenant)) return false;
    const defaultEnabled = defaultByKey.has(featureKey) ? defaultByKey.get(featureKey) : true;
    return resolveFeatureState(toggles, featureKey, effectiveOutletId, defaultEnabled);
  }, [tenant, toggles, effectiveOutletId, defaultByKey]);

  const value = useMemo(() => ({
    isEnabled,
    loading,
    refresh: load,
  }), [isEnabled, loading, load]);

  return (
    <FeatureContext.Provider value={value}>
      {children}
    </FeatureContext.Provider>
  );
}

export const useFeatures = () => useContext(FeatureContext);
