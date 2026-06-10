import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Timeout every outbound fetch:
//   DB / REST  →  8 s  (prevents hung RLS queries consuming all 6 browser connections)
//   Auth       → 15 s  (longer, because token-refresh is legitimate and usually fast;
//                       without ANY timeout a slow auth server holds Supabase's internal
//                       lock indefinitely, making signInWithPassword appear frozen)
// Requests that already carry a caller-supplied AbortSignal pass through unchanged.
const fetchWithTimeout = (url, options = {}) => {
  if (options.signal) return fetch(url, options);
  const isAuth = typeof url === 'string' && url.includes('/auth/');
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), isAuth ? 15000 : 8000);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 0 } },
  global: {
    headers: { 'x-app-name': 'payrollpro' },
    fetch: fetchWithTimeout,
  },
});

// Disconnect realtime WebSocket when the page enters bfcache so the browser
// can cache the page, reconnect on restore.
window.addEventListener('pagehide', (event) => {
  if (event.persisted) supabase.realtime.disconnect();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) supabase.realtime.connect();
});
