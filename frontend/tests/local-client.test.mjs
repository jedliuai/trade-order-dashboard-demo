import test from 'node:test';
import assert from 'node:assert/strict';
import { localRest, localRequest, setDemoAccount, getLocalSession, getCurrentAccountIdentity, downloadFileName } from '../src/services/localClient.ts';

const storage = new Map();
globalThis.window = { localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, dispatchEvent() {} };

test('local data requests are same-origin and carry the chosen demo identity', async () => {
  setDemoAccount('demo-sales-2');
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => { request = {url, options}; return Response.json([{id:'customer-demo'}]); };
  try {
    assert.deepEqual(await localRest('customers?id=eq.customer-demo'), [{id:'customer-demo'}]);
    assert.equal(request.url, '/api/data/customers?id=eq.customer-demo');
    assert.equal(new Headers(request.options.headers).get('X-Demo-User'), 'demo-sales-2');
    assert.equal(new Headers(request.options.headers).has('Authorization'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('unknown identities cannot be persisted and leadership is read-only', () => {
  assert.throws(() => setDemoAccount('someone-else'), /演示/);
  setDemoAccount('demo-manager');
  assert.equal(getCurrentAccountIdentity().isReadOnly, true);
  setDemoAccount('demo-sales-1');
  assert.equal(getLocalSession().user.id, 'demo-sales-1');
  assert.equal(getCurrentAccountIdentity().isReadOnly, false);
});

test('client refuses remote or path-traversal endpoints before fetching', async () => {
  for (const path of ['https://example.com', '//example.com', '../private', 'data/../../secret']) {
    await assert.rejects(localRequest(path), /本地接口/);
  }
});

test('server validation errors are shown rather than treated as successful writes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({message:'批次数量超出联系单数量'}, {status:400});
  try { await assert.rejects(localRest('batches', {method:'POST',body:'{}'}), /批次数量超出/); }
  finally { globalThis.fetch = originalFetch; }
});

test('download parses encoded Chinese file names and strips unsafe separators', () => {
  assert.equal(downloadFileName("attachment; filename*=UTF-8''%E6%BC%94%E7%A4%BA%E6%8A%A5%E8%A1%A8.xlsx", 'report.xlsx'), '演示报表.xlsx');
  assert.equal(downloadFileName('attachment; filename="../../report.xlsx"', 'report.xlsx'), '.._.._report.xlsx');
  assert.equal(downloadFileName("attachment; filename*=UTF-8''%ZZ", 'report.xlsx'), 'report.xlsx');
});
