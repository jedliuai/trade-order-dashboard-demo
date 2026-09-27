interface AssetsBinding {
  fetch(input: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
  DEMO_PASSWORD: string;
  AUTH_SECRET: string;
}

const USERNAME = 'test';
const COOKIE_NAME = 'trade_demo_session';
const SESSION_SECONDS = 24 * 60 * 60;
const INTERNAL_ASSET_PREFIX = '/.cloudflare-demo';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEMO_USERS = new Set([
  'demo-sales-1',
  'demo-sales-2',
  'demo-sales-3',
  'demo-manager',
  'demo-owner',
]);

const TELEGRAM_MODES = new Set(['current_month', 'previous_month', 'fiscal_year']);
const TELEGRAM_RECIPIENTS = new Set(['manager', 'owner']);
const EXPORTS = new Map<string, { fileName: string; mime: string; extension: string }>([
  ['export-production', { fileName: '生产协调与催包材统计表-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-monthly', { fileName: '订单月度汇总表-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-original-contracts', { fileName: '正本合同登记统计表-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-helper', { fileName: '下联系单辅助表-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-payments', { fileName: '回款明细表-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-customer-monthly-sales', { fileName: '客户实际销售、回款及应收汇总-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-rmb-invoice', { fileName: '人民币增值税开票申请表-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-shipment-plan', { fileName: '发货安排表-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
  ['export-receipt-confirmation', { fileName: '收货确认函-演示.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' }],
  ['export-shipment-details', { fileName: '全部发货明细-演示.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' }],
]);

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com",
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

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(payload: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function redirect(location: string, status = 303, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', location);
  return new Response(null, { status, headers: responseHeaders });
}

function loginPage(message = '', status = 200): Response {
  const escapedMessage = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  const notice = escapedMessage ? `<p class="notice" role="alert">${escapedMessage}</p>` : '';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>登录 · 外贸订单驾驶舱演示</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f3ed; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #fff 0, #f6f3ed 58%); }
    main { width: min(100%, 420px); padding: 32px; border: 1px solid #ded8cc; border-radius: 20px; background: rgba(255,255,255,.96); box-shadow: 0 18px 50px rgba(31,45,61,.12); }
    .eyebrow { margin: 0 0 8px; color: #087f5b; font-size: 13px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 28px; line-height: 1.2; }
    .hint { margin: 12px 0 24px; color: #617083; line-height: 1.7; }
    label { display: block; margin: 14px 0 6px; font-weight: 700; }
    input { width: 100%; padding: 12px 14px; border: 1px solid #c9c4bb; border-radius: 10px; background: #fff; color: inherit; font: inherit; }
    input:focus { outline: 3px solid rgba(8,127,91,.18); border-color: #087f5b; }
    button { width: 100%; margin-top: 22px; padding: 12px 16px; border: 0; border-radius: 10px; background: #087f5b; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
    button:hover { background: #066c4d; }
    .notice { padding: 10px 12px; border-radius: 9px; background: #fff0f0; color: #b42318; font-size: 14px; }
    footer { margin-top: 20px; color: #7b8795; font-size: 12px; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Public Demo</p>
    <h1>外贸订单驾驶舱</h1>
    <p class="hint">请输入公开视频中提供的演示账号。站内公司、客户与业务数据均为虚构内容。</p>
    ${notice}
    <form method="post" action="/api/login">
      <label for="username">账号</label>
      <input id="username" name="username" type="text" value="test" autocomplete="username" required>
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">进入演示</button>
    </form>
    <footer>登录状态仅保留 24 小时。本演示不连接公司内网、NAS 或生产系统。</footer>
  </main>
</body>
</html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function issueSession(secret: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    version: 1,
    subject: USERNAME,
    issuedAt,
    expiresAt: issuedAt + SESSION_SECONDS,
    nonce: crypto.randomUUID(),
  })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifySession(token: string | null, secret: string | undefined): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    const [payload, signature] = parts;
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlToBytes(signature),
      encoder.encode(payload),
    );
    if (!validSignature) return false;
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payload))) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    return parsed.version === 1
      && parsed.subject === USERNAME
      && typeof parsed.issuedAt === 'number'
      && typeof parsed.expiresAt === 'number'
      && parsed.issuedAt <= now + 60
      && parsed.expiresAt > now
      && parsed.expiresAt - parsed.issuedAt === SESSION_SECONDS;
  } catch {
    return false;
  }
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

async function constantTimeTextEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function isWriteRequest(request: Request): boolean {
  return !['GET', 'HEAD'].includes(request.method.toUpperCase());
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === url.origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

function selectedDemoUser(request: Request): string {
  const requested = request.headers.get('X-Demo-User') || 'demo-sales-1';
  return DEMO_USERS.has(requested) ? requested : 'demo-sales-1';
}

async function parseSmallBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 4096) throw new Error('请求内容过大。');
  const source = await request.text();
  if (source.length > 4096) throw new Error('请求内容过大。');
  if ((request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求格式无效。');
    return parsed as Record<string, unknown>;
  }
  return Object.fromEntries(new URLSearchParams(source));
}

function internalAssetRequest(request: Request, path: string): Request {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = path;
  assetUrl.search = '';
  assetUrl.hash = '';
  return new Request(assetUrl.toString(), {
    method: 'GET',
    headers: { Accept: '*/*' },
  });
}

async function staticJson(request: Request, env: Env, path: string): Promise<Response> {
  const response = await env.ASSETS.fetch(internalAssetRequest(request, path));
  const contentType = response.headers.get('Content-Type') || '';
  if (!response.ok || !contentType.toLowerCase().includes('json')) {
    return json({ error: 'not_found', message: '演示快照尚未生成。' }, 404);
  }
  return response;
}

async function staticExport(
  request: Request,
  env: Env,
  user: string,
  command: string,
  metadata: { fileName: string; mime: string; extension: string },
): Promise<Response> {
  const path = `${INTERNAL_ASSET_PREFIX}/exports/${user}/${command}.${metadata.extension}`;
  const response = await env.ASSETS.fetch(internalAssetRequest(request, path));
  const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
  if (!response.ok || contentType.includes('text/html')) {
    return json({ error: 'not_found', message: '演示导出文件尚未生成。' }, 404);
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Type', metadata.mime);
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.DEMO_PASSWORD || !env.AUTH_SECRET) {
    return loginPage('演示站尚未完成安全配置，请稍后再试。', 503);
  }
  let body: Record<string, unknown>;
  try {
    body = await parseSmallBody(request);
  } catch {
    return loginPage('登录请求格式无效。', 400);
  }
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const [validUsername, validPassword] = await Promise.all([
    constantTimeTextEqual(username, USERNAME),
    constantTimeTextEqual(password, env.DEMO_PASSWORD),
  ]);
  if (!validUsername || !validPassword) return loginPage('账号或密码不正确。', 401);

  const session = await issueSession(env.AUTH_SECRET);
  return redirect('/', 303, {
    'Set-Cookie': `${COOKIE_NAME}=${session}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  });
}

async function routeAuthenticated(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const path = url.pathname;
  const user = selectedDemoUser(request);

  if (path.startsWith(`${INTERNAL_ASSET_PREFIX}/`) || path === INTERNAL_ASSET_PREFIX) {
    return json({ error: 'not_found', message: '页面不存在。' }, 404);
  }

  if (path === '/api/logout' && method === 'POST') {
    return redirect('/login', 303, {
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  if (path === '/api/bootstrap' && method === 'GET') {
    return staticJson(request, env, `${INTERNAL_ASSET_PREFIX}/bootstrap/${user}.json`);
  }

  if (path === '/api/health' && method === 'GET') {
    return staticJson(request, env, `${INTERNAL_ASSET_PREFIX}/manifest.json`);
  }

  if (path === '/api/data/rpc/get_operating_metrics' && method === 'GET') {
    const start = url.searchParams.get('p_start_date') || '';
    const end = url.searchParams.get('p_end_date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(start) || !/^\d{4}-\d{2}-\d{2}$/u.test(end)) {
      return json({ error: 'invalid_date_range', message: '经营指标日期范围无效。' }, 400);
    }
    return staticJson(request, env, `${INTERNAL_ASSET_PREFIX}/metrics/${user}/${start}--${end}.json`);
  }

  const tableMatch = path.match(/^\/api\/data\/([a-z][a-z0-9_]*)$/u);
  if (tableMatch && method === 'GET') {
    return staticJson(request, env, `${INTERNAL_ASSET_PREFIX}/tables/${user}/${tableMatch[1]}.json`);
  }

  if (path === '/api/telegram/status' && method === 'GET') {
    return json({ configured: false, recipients: { manager: false, owner: false } });
  }

  if (path === '/api/telegram/preview' && method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = await parseSmallBody(request);
    } catch {
      return json({ error: 'invalid_request', message: 'Telegram 预览请求无效。' }, 400);
    }
    const mode = typeof body.mode === 'string' ? body.mode : '';
    const recipient = typeof body.recipient === 'string' ? body.recipient : '';
    if (!TELEGRAM_MODES.has(mode) || !TELEGRAM_RECIPIENTS.has(recipient)) {
      return json({ error: 'invalid_preview', message: 'Telegram 预览参数无效。' }, 400);
    }
    return staticJson(request, env, `${INTERNAL_ASSET_PREFIX}/telegram/${user}/${mode}-${recipient}.json`);
  }

  const exportMatch = path.match(/^\/api\/export\/([a-z0-9-]+)$/u);
  if (exportMatch && method === 'POST') {
    const metadata = EXPORTS.get(exportMatch[1]);
    if (!metadata) return json({ error: 'unknown_export', message: '未知导出命令。' }, 404);
    return staticExport(request, env, user, exportMatch[1], metadata);
  }

  if (path === '/api/telegram/send' || path === '/api/backup' || path === '/api/reset') {
    return json({ error: 'disabled_in_public_demo', message: '公网演示已禁用此功能。' }, 403);
  }

  if (path.startsWith('/api/') && isWriteRequest(request)) {
    return json({ error: 'read_only_demo', message: '公网演示仅允许白名单操作。' }, 403);
  }

  if (path.startsWith('/api/')) {
    return json({ error: 'not_found', message: '接口不存在。' }, 404);
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    try {
      // Login only establishes the public-demo cookie and does not mutate data.
      // Some Edge form submissions report `Origin: null`, so CSRF enforcement
      // applies to every other write route while login relies on its credential.
      if (url.pathname !== '/api/login' && isWriteRequest(request) && !isSameOrigin(request, url)) {
        response = json({ error: 'forbidden_origin', message: '拒绝跨站写入请求。' }, 403);
      } else if (url.pathname === '/login' && request.method === 'GET') {
        const authenticated = await verifySession(cookieValue(request, COOKIE_NAME), env.AUTH_SECRET);
        response = authenticated ? redirect('/', 303) : loginPage();
      } else if (url.pathname === '/api/login' && request.method === 'POST') {
        response = await handleLogin(request, env);
      } else {
        const authenticated = await verifySession(cookieValue(request, COOKIE_NAME), env.AUTH_SECRET);
        if (!authenticated) {
          response = url.pathname.startsWith('/api/')
            ? json({ error: 'unauthorized', message: '请先登录演示站。' }, 401)
            : redirect('/login', 303);
        } else {
          response = await routeAuthenticated(request, env, url);
        }
      }
    } catch {
      response = json({ error: 'internal_error', message: '演示服务暂时不可用。' }, 500);
    }

    return withSecurityHeaders(response);
  },
};
