import { accountPage, json, redirect } from './responses.ts';

const COOKIE = '__Host-desk_session';
const lifetime = 7 * 24 * 3600;
const cookie = (value: string, seconds: number) =>
  `${COOKIE}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;

function randomKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
}

async function digest(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

export async function session(request: Request, db: D1Database) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-desk_session=([a-f0-9]{48})(?:;|$)/)?.[1];
  if (!token) return null;
  const hash = await digest(token);
  const row = await db.prepare('SELECT workspace_id FROM sessions WHERE token_hash=? AND expires>unixepoch()')
    .bind(hash).first<{ workspace_id: string }>();
  return row ? { id: row.workspace_id, hash } : null;
}

export function loginPage(failed = false) {
  return accountPage(`<p class="hint">用个人登录码打开你的工作区。第一次来，可以创建一个空工作区。每个工作区可保存 1 MiB 业务记录。</p>
    ${failed ? '<p class="notice" role="alert">登录码无效，请核对后重试。</p>' : ''}
    <form method="post" action="/api/login"><label for="key">个人登录码</label>
    <input id="key" name="key" type="password" autocomplete="current-password" required maxlength="64">
    <button>登录</button></form>
    <form method="post" action="/api/register"><button>创建个人工作区</button></form>`, failed ? 401 : 200);
}

export async function register(db: D1Database) {
  const key = randomKey();
  await db.prepare('INSERT INTO workspaces(id,login_hash) VALUES(?,?)')
    .bind(crypto.randomUUID(), await digest(key)).run();
  return accountPage(`<p class="hint">工作区已创建。请把下面的个人登录码保存到密码管理器，换设备时用它登录。持码者可以访问全部记录，遗失后暂时无法找回。</p>
    <code>${key}</code><form method="post" action="/api/login">
    <input type="hidden" name="key" value="${key}"><button>已保存，进入工作区</button></form>`, 201);
}

export async function login(db: D1Database, body: string) {
  const key = new URLSearchParams(body).get('key')?.trim();
  if (!key || !/^[0-9a-f]{48}$/.test(key)) return loginPage(true);
  const row = await db.prepare('SELECT id FROM workspaces WHERE login_hash=?').bind(await digest(key)).first<{id: string}>();
  if (!row) return loginPage(true);
  const token = randomKey();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires<=unixepoch()'),
    db.prepare('INSERT INTO sessions VALUES(?,?,unixepoch()+?)').bind(await digest(token), row.id, lifetime),
  ]);
  return redirect('/', 303, { 'Set-Cookie': cookie(token, lifetime) });
}

export async function logout(db: D1Database, tokenHash: string) {
  await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run();
  return json({ok: true}, 200, { 'Set-Cookie': cookie('', 0), 'Clear-Site-Data': '"cache", "storage"' });
}
