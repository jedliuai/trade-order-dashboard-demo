const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    'upgrade-insecure-requests',
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export function withSecurityHeaders(response: Response, publicAsset = false): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set('Cache-Control', publicAsset ? 'public, max-age=86400' : 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function json(payload: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

export function redirect(location: string, status = 303, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', location);
  return new Response(null, { status, headers: responseHeaders });
}

export function accountPage(content: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>个人订单驾驶舱</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f3ed; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #fff 0, #f6f3ed 58%); }
    main { width: min(100%, 420px); padding: 32px; border: 1px solid #ded8cc; border-radius: 20px; background: rgba(255,255,255,.96); box-shadow: 0 18px 50px rgba(31,45,61,.12); }
    .eyebrow { margin: 0 0 8px; color: #087f5b; font-size: 13px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 28px; line-height: 1.2; }
    h2 { margin: 22px 0 0; font-size: 18px; }
    details { margin-top: 22px; border-top: 1px solid #ded8cc; padding-top: 16px; }
    summary { cursor: pointer; font-weight: 700; }
    .hint { margin: 12px 0 24px; color: #617083; line-height: 1.7; }
    label { display: block; margin: 14px 0 6px; font-weight: 700; }
    input { width: 100%; padding: 12px 14px; border: 1px solid #c9c4bb; border-radius: 10px; background: #fff; color: inherit; font: inherit; }
    input:focus { outline: 3px solid rgba(8,127,91,.18); border-color: #087f5b; }
    button { width: 100%; margin-top: 22px; padding: 12px 16px; border: 0; border-radius: 10px; background: #087f5b; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
    button:hover { background: #066c4d; }
    .notice { padding: 10px 12px; border-radius: 9px; background: #fff0f0; color: #b42318; font-size: 14px; }
    code { display:block; overflow-wrap:anywhere; user-select:all; font-size:18px; padding:14px; background:#f0f4f7; }
    footer { margin-top: 20px; color: #7b8795; font-size: 12px; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>个人订单驾驶舱</h1>
    ${content}
  </main></body></html>`;
  return new Response(html, {status, headers: {"Content-Type": "text/html; charset=utf-8"}});
}
