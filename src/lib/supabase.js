import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Apply an 8-second timeout to every database (REST) request.
// Auth requests (/auth/) are excluded — they handle their own retries.
// Without this, hanging RLS queries consume all 6 browser connections to
// the Supabase domain, making every subsequent request (including sign-out
// and navigation) queue indefinitely and freeze the UI.
const fetchWithTimeout = (url, options = {}) => {
  if (options.signal) return fetch(url, options);
  if (typeof url === 'string' && url.includes('/auth/')) return fetch(url, options);
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 8000);
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

// Disconnect the Supabase realtime WebSocket when the page enters bfcache
// (back/forward cache) so the browser can cache it. Reconnect on restore.
window.addEventListener('pagehide', (event) => {
  if (event.persisted) supabase.realtime.disconnect();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) supabase.realtime.connect();
});
