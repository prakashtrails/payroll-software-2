import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// This project has rotated to Supabase's newer JWT signing-key system — the
// legacy `anon` JWT key (VITE_SUPABASE_ANON_KEY) was minted with the old
// static secret and no longer verifies session tokens signed by the
// currently-active signing key, causing every authenticated request (login,
// edge functions) to fail with an "invalid JWT signature" error. The newer
// `sb_publishable_...` key is tied to the active signing keys and must be
// used instead. Falls back to the legacy anon key only if publishable isn't set.
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Timeout every outbound fetch:
//   DB / REST  →  8 s  (prevents hung RLS queries consuming all 6 browser connections)
//   Auth       → 15 s  (longer, because token-refresh is legitimate and usually fast;
//                       without ANY timeout a slow auth server holds Supabase's internal
//                       lock indefinitely, making signInWithPassword appear frozen)
//   Functions  → 30 s  (Deno edge functions cold-start — a function that hasn't run
//                       recently, or right after a deploy/project resume, can take
//                       20+ seconds to boot before it ever responds; the 8s default
//                       aborted that as a false "Failed to send a request" network error)
// Requests that already carry a caller-supplied AbortSignal pass through unchanged.
const fetchWithTimeout = (url, options = {}) => {
  if (options.signal) return fetch(url, options);
  const isAuth = typeof url === 'string' && url.includes('/auth/');
  const isFunctions = typeof url === 'string' && url.includes('/functions/');
  const timeoutMs = isFunctions ? 30000 : isAuth ? 15000 : 8000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
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
    // No custom headers here — a previous 'x-app-name' header (unused by any
    // server-side code, confirmed by grep; it only appeared in CORS allow-lists)
    // reproducibly broke supabase.functions.invoke() calls to create-employee-user
    // with a bare "TypeError: Failed to fetch", even though the identical request
    // succeeded with that one header removed. Every edge-function-backed employee
    // creation (bulk import and the manual "Add Employee" form) depends on this.
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
