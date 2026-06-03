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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, tenants(*)')
        .eq('id', userId)
        .maybeSingle()
        .abortSignal(controller.signal);

      clearTimeout(timer);
      if (error) { console.error('fetchProfile error:', error.message); return null; }
      setProfile(data);
      setTenant(data?.tenants ?? null);
      return data;
    } catch (err) {
      clearTimeout(timer);
      console.error('fetchProfile exception:', err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Safety net — releases loading if nothing else does within 10 s.
      const timeoutId = setTimeout(() => { if (mounted) setLoading(false); }, 10000);
      const release = () => { clearTimeout(timeoutId); if (mounted) setLoading(false); };

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) { clearTimeout(timeoutId); return; }

        if (!session?.user) { release(); return; }

        setUser(session.user);
        const profileData = await fetchProfile(session.user.id);

        if (profileData) {
          release();
        } else {
          // Profile fetch failed (DB timeout / RLS issue / stale token).
          // Clear the user so PrivateRoute redirects to /login cleanly and the
          // user can re-authenticate. Without this, the user gets stuck on a
          // spinner that never resolves because TOKEN_REFRESHED may not fire
          // (the token might still be valid, just the DB query timed out).
          setUser(null);
          release();
        }
      } catch (err) {
        console.error('init error:', err);
        release();
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        // INITIAL_SESSION fires immediately on registration with the same session
        // init() already reads — skip it to avoid calling setLoading(false) with
        // user=null before init() finishes and bouncing logged-in users to /login.
        if (event === 'INITIAL_SESSION') return;

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            setUser(session.user);
            if (mounted) await fetchProfile(session.user.id);
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
    // Clear local state immediately so the UI responds at once even if the
    // server call is queued behind hung DB connections.
    setUser(null);
    setProfile(null);
    setTenant(null);
    supabase.auth.signOut().catch(console.error);
  }, []);

  const refreshProfile = useCallback(() => {
    if (user?.id) return fetchProfile(user.id);
    return Promise.resolve(null);
  }, [user, fetchProfile]);

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
