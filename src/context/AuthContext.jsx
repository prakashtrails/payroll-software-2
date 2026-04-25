import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { sendOtp as svcSendOtp, verifyOtp as svcVerifyOtp } from '@/services/otpService';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, tenants(*)')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('fetchProfile error:', error.message);
        return null;
      }

      // Guard against stale callbacks: if the active session already belongs to a
      // different user (e.g., admin restored session after creating an employee via
      // signUp()), discard this result rather than wiping out the correct state.
      const { data: { session: current } } = await supabase.auth.getSession();
      if (current?.user?.id !== userId) return null;

      if (data) {
        setProfile(data);
        setTenant(data.tenants);
      } else {
        setProfile(null);
        setTenant(null);
      }
      return data;
    } catch (err) {
      console.error('fetchProfile exception:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Hard timeout — never show spinner forever
      const timeoutId = setTimeout(() => {
        if (mounted) setLoading(false);
      }, 8000);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          await fetchProfile(session.user.id);
        }
      } finally {
        clearTimeout(timeoutId);
        if (mounted) setLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            setUser(session.user);
            setTimeout(async () => {
              if (mounted) await fetchProfile(session.user.id);
            }, 300);
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          setTenant(null);
        }
        if (mounted) setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, []);

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setTenant(null);
  }, []);

  const refreshProfile = useCallback(() => {
    if (user?.id) return fetchProfile(user.id);
    return Promise.resolve(null);
  }, [user, fetchProfile]);

  // ── OTP helpers (delegated to otpService) ──────────────────────────────────
  const sendOtp = useCallback((identifier, options) => svcSendOtp(identifier, options), []);
  const verifyOtp = useCallback(
    (identifier, token, isSignup, password, firstName, lastName) =>
      svcVerifyOtp(identifier, token, isSignup, password, firstName, lastName),
    []
  );

  const value = useMemo(() => ({
    user, profile, tenant, loading,
    signIn, signUp, signOut,
    fetchProfile, refreshProfile,
    sendOtp, verifyOtp,
  }), [user, profile, tenant, loading, signIn, signUp, signOut, fetchProfile, refreshProfile, sendOtp, verifyOtp]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);