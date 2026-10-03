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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// True only for a request that never reached the server at all (DNS failure,
// offline, blocked by an extension/VPN/proxy) — never for our own timeout abort
// or for an HTTP error response, both of which resolve normally instead of
// throwing this.
const isNetworkError = (err) =>
  err instanceof TypeError && /Failed to fetch|NetworkError|Load failed/i.test(err.message);

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
//
// On top of the timeout, retry up to twice (400ms, then 800ms backoff) when the
// error is a genuine network failure rather than a slow/erroring server — this
// smooths over the brief Wi-Fi/mobile-network blips that otherwise surface as
// "Failed to fetch" on the first tap. Retrying is only safe for requests with no
// side effect if duplicated, so it's limited to GET reads and auth calls (a
// resent login/OTP/refresh is harmless); REST mutations and edge-function
// invokes are never retried here, since a dropped response after the write
// already landed would otherwise resend it and risk a duplicate record.
const fetchWithTimeout = async (url, options = {}) => {
  if (options.signal) return fetch(url, options);
  const isAuth = typeof url === 'string' && url.includes('/auth/');
  const isFunctions = typeof url === 'string' && url.includes('/functions/');
  const timeoutMs = isFunctions ? 30000 : isAuth ? 15000 : 8000;
  const method = (options.method || 'GET').toUpperCase();
  const retryable = method === 'GET' || isAuth;
  const maxAttempts = retryable ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (attempt === maxAttempts || !isNetworkError(err)) throw err;
      await sleep(attempt * 400);
    } finally {
      clearTimeout(id);
    }
  }
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
