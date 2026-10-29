/** Local demo identities are presentation scopes, not production authentication. */
import organization from '../data/demoOrganization.json' with { type: 'json' };
export type DemoAccount = { id: string; name: string; role: 'member' | 'leader'; parentId: string | null; region: string; level: string };
export const DEMO_ACCOUNTS = organization as DemoAccount[];

export function getScopeAccounts(actorId: string): DemoAccount[] {
  const allowed = new Set([actorId]);
  let previous = 0;
  while (previous !== allowed.size) {
    previous = allowed.size;
    for (const account of DEMO_ACCOUNTS) if (account.parentId && allowed.has(account.parentId)) allowed.add(account.id);
  }
  return DEMO_ACCOUNTS.filter(account => allowed.has(account.id));
}

export const IS_PUBLIC_DEMO = import.meta.env?.VITE_PUBLIC_DEMO === 'true';

const accountKey = 'trade-demo-account';
export type DemoSession = {
  user: { id: string; email: string; app_metadata: { app_role: 'member' | 'leader'; login_name: string; display_name: string } };
};
export type AccountIdentity = { loginName: string; displayName: string; role: 'member' | 'leader'; isReadOnly: boolean };

export function getLocalSession(): DemoSession {
  const id = typeof window === 'undefined' ? null : window.localStorage.getItem(accountKey);
  const account = DEMO_ACCOUNTS.find(item => item.id === id) || DEMO_ACCOUNTS.find(item => item.id === 'demo-sales-1')!;
  return { user: { id: account.id, email: `${account.id}@example.invalid`, app_metadata: {
    app_role: account.role, login_name: account.id, display_name: account.name,
  } } };
}

export function setDemoAccount(id: string) {
  if (!DEMO_ACCOUNTS.some(item => item.id === id)) throw new Error('无效的演示身份。');
  window.localStorage.setItem(accountKey, id);
  window.dispatchEvent(new Event('demo-account-changed'));
}

export function getDemoScope(actorId = getLocalSession().user.id): DemoAccount {
  const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(`trade-demo-scope:${actorId}`);
  return getScopeAccounts(actorId).find(account => account.id === stored) || DEMO_ACCOUNTS.find(account => account.id === actorId)!;
}

export function setDemoScope(id: string) {
  const actorId = getLocalSession().user.id;
  if (!getScopeAccounts(actorId).some(account => account.id === id)) throw new Error('无权查看所选区域或业务员。');
  window.localStorage.setItem(`trade-demo-scope:${actorId}`, id);
}

export function getAccountPath(id: string): DemoAccount[] {
  const path: DemoAccount[] = [];
  const seen = new Set<string>();
  let current = DEMO_ACCOUNTS.find(account => account.id === id);
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = DEMO_ACCOUNTS.find(account => account.id === current!.parentId);
  }
  return path;
}

export function getCurrentAccountIdentity(session = getLocalSession()): AccountIdentity {
  const metadata = session.user.app_metadata;
  return {
    loginName: metadata.login_name,
    displayName: metadata.display_name,
    role: metadata.app_role,
    isReadOnly: IS_PUBLIC_DEMO || metadata.app_role === 'leader'
  };
}

export function isReadOnlySession(session = getLocalSession()) {
  return getCurrentAccountIdentity(session).isReadOnly;
}

function apiPath(path: string) {
  const pathname = path.split('?')[0];
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { throw new Error('无效的本地接口路径。'); }
  if (!/^[a-z][a-z0-9_/-]*$/i.test(decoded) || decoded.includes('..') || decoded.includes('//')) {
    throw new Error('只允许访问本地接口。');
  }
  return `/api/${path}`;
}

export async function localResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const url = apiPath(path);
  const method = (init.method || 'GET').toUpperCase();
  const readActions = ['get_operating_metrics', 'get_global_contact_sheet_number_conflict', 'get_global_contract_number_conflict', 'get_global_batch_number_conflicts'];
  const readRequest = ['GET', 'HEAD'].includes(method) || (method === 'POST' && (
    path.startsWith('export/') || path === 'telegram/preview' ||
    readActions.some(action => path === `data/rpc/${action}`)
  ));
  if (isReadOnlySession() && !readRequest) throw new Error('当前身份只读，请由所属业务员维护业务。');
  const headers = new Headers(init.headers);
  headers.set('X-Demo-User', getLocalSession().user.id);
  headers.set('X-Demo-Scope', getDemoScope().id);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(url, { ...init, headers, credentials: 'same-origin' }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(IS_PUBLIC_DEMO
      ? '公网演示服务暂时无法连接，请刷新页面后重试。'
      : '本地服务无法连接，请确认已运行 npm run dev 或 npm start。');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || `本地请求失败（${response.status}）。`);
  }
  return response;
}

export async function localRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await localResponse(path, init);
  return response.status === 204 ? undefined as T : response.json();
}

export function localRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return localRequest<T>(`data/${path}`, init);
}

export function downloadFileName(disposition: string | null, fallback: string) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="([^"]+)"/i)?.[1];
  let name = plain || fallback;
  if (encoded) { try { name = decodeURIComponent(encoded); } catch { name = fallback; } }
  return Array.from(name, character => character.charCodeAt(0) < 32 || /[\\/<>:"|?*]/.test(character) ? '_' : character).join('');
}

export async function downloadLocalFile(path: string, init: RequestInit = {}, fallback = '演示报表.xlsx') {
  const response = await localResponse(path, init);
  const fileName = downloadFileName(response.headers.get('Content-Disposition'), fallback);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { download_name: fileName, stdout: `本地文件已生成：${fileName}` };
}
