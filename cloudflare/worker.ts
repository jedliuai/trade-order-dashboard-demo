import { login, loginPage, logout, register, session } from './accounts.ts';
import { json, redirect, withSecurityHeaders } from './responses.ts';

interface Env {
  ASSETS: Fetcher;
  BUSINESS: Fetcher;
  DB: D1Database;
  AUTH_LIMIT: RateLimit;
  SIGNUP_LIMIT: RateLimit;
}

async function boundedText(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new RangeError(); }
    text += decoder.decode(value, { stream: true });
  }
}

async function business(request: Request, env: Env, url: URL, id: string) {
  const method = request.method;
  const path = url.pathname;
  const bodyText = await boundedText(request, 64 * 1024);
  let body: unknown = {};
  if (bodyText) {
    try { body = JSON.parse(bodyText); }
    catch { return json({message: '请发送有效 JSON'}, 400); }
  }
  const query = Object.fromEntries(url.searchParams);
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await env.DB.prepare('SELECT contents,revision FROM workspaces WHERE id=?')
      .bind(id).first<{ contents: string; revision: number }>();
    if (!row) return json({message:'工作区不存在'}, 404);
    const execution = await env.BUSINESS.fetch('https://business.internal/run', {
      method: 'POST', body: JSON.stringify({ path, method, query, body, workspace: JSON.parse(row.contents) }),
    });
    if (!execution.ok) {
      if (execution.status >= 500) throw new Error('Business service unavailable');
      return json(await execution.json(), execution.status);
    }
    const { result, workspace } = await execution.json<{ result: unknown; workspace: object | null }>();
    if (workspace !== null) {
      const contents = JSON.stringify(workspace);
      if (new TextEncoder().encode(contents).length > 1024 * 1024) {
        return json({message:'工作区已达 1 MiB 试用容量，请减少记录后保存。'}, 413);
      }
      const saved = await env.DB.prepare('UPDATE workspaces SET contents=?, revision=revision+1 WHERE id=? AND revision=?')
        .bind(contents, id, row.revision).run();
      if (!saved.meta.changes) continue;
    }
    return json(result);
  }
  return json({message:'其他操作正在保存，请刷新后重试。'}, 409);
}

function isStaticAsset(path: string) {
  return /^\/(?:assets\/[A-Za-z0-9._-]+\.(?:css|js)|brand\/[a-z0-9-]+\.svg|(?:icons|favicon)\.svg)$/.test(path);
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!['GET','HEAD'].includes(method)) {
    const origin = request.headers.get('origin');
    if (origin !== url.origin && !((origin === 'null' || !origin) && request.headers.get('sec-fetch-site') === 'same-origin')) {
      return json({message:'请求来源无效'}, 403);
    }
  }
  if (method === 'POST' && (path === '/api/register' || path === '/api/login')) {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const limit = path === '/api/register' ? env.SIGNUP_LIMIT : env.AUTH_LIMIT;
    if (!(await limit.limit({key: ip})).success) return new Response('请求过于频繁，请一分钟后再试。', {status:429,headers:{'Retry-After':'60'}});
    const text = await boundedText(request, 1024);
    return path === '/api/register' ? register(env.DB) : login(env.DB, text);
  }
  if (['GET','HEAD'].includes(method) && isStaticAsset(path)) return env.ASSETS.fetch(request);
  const current = await session(request, env.DB);
  if (path === '/login' && method === 'GET') return current ? redirect('/') : loginPage();
  if (!current) return path.startsWith('/api/') ? json({message:'请先登录'}, 401) : redirect('/login');
  if (path.startsWith('/api/')) {
    // Pin the open tab to its original account even if another tab signs in.
    if (request.headers.get('X-Workspace') !== current.id) return json({message:'工作区已切换，请重新打开页面。'}, 401);
    if (path === '/api/logout' && method === 'POST') return logout(env.DB, current.hash);
    if (path === '/api/bootstrap' || /^\/api\/data\/(rpc\/)?[a-z][a-z0-9_]*$/.test(path)) {
      return business(request, env, url, current.id);
    }
    return json({message:'试用版未开放此功能'}, 404);
  }
  if (!['GET', 'HEAD'].includes(method)) return json({message:'请求方法无效'}, 405);
  if (path === '/' || path === '/index.html') {
    const index = await env.ASSETS.fetch(new Request(new URL('/', url), { method }));
    return new HTMLRewriter().on('head', {element(head) {
      head.append(`<meta name="desk-workspace" content="${current.id}">`, {html:true});
    }}).transform(index);
  }
  return new Response(null,{status:404});
}

export default {
  async fetch(request: Request, env: Env) {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) {
      response = error instanceof RangeError ? json({message:'请求内容过大'},413) : json({message:'服务暂时不可用，请稍后重试。'},500);
    }
    const cacheable = response.ok && ['GET','HEAD'].includes(request.method) && isStaticAsset(new URL(request.url).pathname);
    return withSecurityHeaders(response, cacheable);
  },
};
