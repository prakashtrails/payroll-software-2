// Cloudflare Worker for api.crewcore.in
//
// Purpose: api.crewcore.in is a CNAME straight to Supabase
// (yxueywgrqrfgynqknsqs.supabase.co). Hit at "/" with a plain browser/crawler
// request, it returns Supabase's bare gateway response with no real content,
// which is why some corporate web-filters classify it as "uncategorized" and
// block it outright. This worker serves a real landing page at "/" only, and
// passes every other path (auth, rest, functions, storage, realtime,
// websockets) straight through to Supabase unchanged.
//
// Deploy this in front of api.crewcore.in via a Cloudflare Worker Route
// (api.crewcore.in/*) on a zone you control.

const ORIGIN = 'https://yxueywgrqrfgynqknsqs.supabase.co';

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CrewCore API</title>
<meta name="robots" content="index,follow">
<meta name="description" content="CrewCore API backend service. Visit crewcore.in for the CrewCore workforce and payroll application.">
</head>
<body style="font-family: system-ui, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; color:#1f2937;">
<h1>CrewCore API</h1>
<p>This is the backend API service for <strong>CrewCore</strong>, a workforce &amp; payroll management platform.</p>
<p>The application itself is at <a href="https://crewcore.in">crewcore.in</a>.</p>
<p>This host serves authenticated API traffic only and is not meant for direct browsing.</p>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(LANDING_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // Everything else (auth/rest/functions/storage/realtime, including
    // websocket upgrades) passes straight through to Supabase unmodified.
    const originRequest = new Request(ORIGIN + url.pathname + url.search, request);
    return fetch(originRequest);
  },
};
