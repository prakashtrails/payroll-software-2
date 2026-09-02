import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOutletView } from '@/context/OutletViewContext';
import { listCompanyFeatureToggles, resolveFeatureState } from '@/services/featureService';

const FeatureContext = createContext({});

export function FeatureProvider({ children }) {
  const { profile, tenant } = useAuth();
  const { selectedOutletId } = useOutletView();

  const [toggles, setToggles] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenant?.id) {
      setToggles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await listCompanyFeatureToggles(tenant.id);
    setToggles(data || []);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  // Admin/superadmin scope by whichever outlet they're currently viewing;
  // everyone else is scoped to their own assigned outlet.
  const effectiveOutletId = (profile?.role === 'admin' || profile?.role === 'superadmin')
    ? selectedOutletId
    : profile?.outlet_id || null;

  const isEnabled = useCallback((featureKey) => {
    if (!featureKey) return true;
    // Superadmin isn't scoped to any single company — never gate the Platform console.
    if (!tenant?.id) return true;
    return resolveFeatureState(toggles, featureKey, effectiveOutletId);
  }, [tenant?.id, toggles, effectiveOutletId]);

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
