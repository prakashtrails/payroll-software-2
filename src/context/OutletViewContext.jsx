import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { listOutlets } from '@/services/tenantService';

const OutletViewContext = createContext({});

const storageKey = (tenantId, profileId) => `outlet_view:${tenantId}:${profileId}`;

export function OutletViewProvider({ children }) {
  const { tenant, profile } = useAuth();
  const canScope = profile?.role === 'admin' || profile?.role === 'superadmin';

  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState(undefined); // undefined = not loaded yet
  const [outletProfileIds, setOutletProfileIds] = useState(null);
  const [ready, setReady] = useState(false);

  // Load outlets + restore the stored selection whenever the tenant changes.
  useEffect(() => {
    if (!tenant?.id || !profile?.id) return;
    if (!canScope) {
      setOutlets([]);
      setSelectedOutletId(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    listOutlets(tenant.id).then(({ data }) => {
      if (cancelled) return;
      setOutlets(data || []);
      const stored = localStorage.getItem(storageKey(tenant.id, profile.id));
      if (stored === null) {
        setSelectedOutletId(undefined); // still "not chosen yet" — triggers the gate
      } else {
        setSelectedOutletId(stored === 'combined' ? null : stored);
      }
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [tenant?.id, profile?.id, canScope]);

  // Recompute the outlet's employee-id set whenever the selection changes.
  useEffect(() => {
    if (!tenant?.id || !selectedOutletId) {
      setOutletProfileIds(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('outlet_id', selectedOutletId)
      .then(({ data }) => {
        if (!cancelled) setOutletProfileIds(new Set((data || []).map((r) => r.id)));
      });
    return () => { cancelled = true; };
  }, [tenant?.id, selectedOutletId]);

  const selectOutlet = useCallback((id) => {
    if (!tenant?.id || !profile?.id) return;
    localStorage.setItem(storageKey(tenant.id, profile.id), id || 'combined');
    setSelectedOutletId(id || null);
  }, [tenant?.id, profile?.id]);

  const selectedOutletName = selectedOutletId
    ? outlets.find((o) => o.id === selectedOutletId)?.name || ''
    : '';

  const needsSelection = ready && canScope && outlets.length > 0 && selectedOutletId === undefined;

  const value = useMemo(() => ({
    outlets,
    selectedOutletId: selectedOutletId || null,
    selectedOutletName,
    outletProfileIds,
    needsSelection,
    ready,
    selectOutlet,
  }), [outlets, selectedOutletId, selectedOutletName, outletProfileIds, needsSelection, ready, selectOutlet]);

  return (
    <OutletViewContext.Provider value={value}>
      {children}
    </OutletViewContext.Provider>
  );
}

export const useOutletView = () => useContext(OutletViewContext);
