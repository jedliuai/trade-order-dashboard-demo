import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../cloudflare/worker.ts';

const origin = 'https://trial.example';

test('sessions isolate D1 reads and writes, reject stale tabs, and revoke on logout', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../cloudflare/migrations/0001_workspaces.sql', import.meta.url), 'utf8'));
    const db = {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        const bound = (...args) => ({
          first: () => statement.get(...args),
          run: () => ({ meta: statement.run(...args) }),
        });
        return { ...bound(), bind: bound };
      },
      batch: statements => statements.map(s => s.run()),
    };
    const limit = { limit: async () => ({ success: true }) };
    const env = { DB: db, AUTH_LIMIT: limit, SIGNUP_LIMIT: limit, BUSINESS: {
      async fetch(_, init) {
        const {method, workspace, body} = JSON.parse(init.body);
        if (method === 'GET') return Response.json({result: workspace.products ?? [], workspace: null});
        const products = [...(workspace.products ?? []), body.name];
        return Response.json({result: products, workspace: {products}});
      }
    }};
    const call = (path, method, headers = {}, body) => worker.fetch(new Request(origin + path, {
      method, headers: { origin, ...headers }, body,
    }), env);
    async function signup() {
      const registered = await call('/api/register', 'POST');
      assert.equal(registered.status, 201);
      const key = (await registered.text()).match(/<code>([0-9a-f]{48})<\/code>/)[1];
      const login = await call('/api/login', 'POST', {}, new URLSearchParams({key}));
      assert.equal(login.status, 303);
      const session = login.headers.get('set-cookie');
      assert.match(session, /HttpOnly; Secure/);
      const {id} = sqlite.prepare('SELECT id FROM workspaces ORDER BY rowid DESC LIMIT 1').get();
      return {cookie: session.split(';')[0], 'X-Workspace': id};
    }
    const a = await signup(), b = await signup();
    const path = '/api/data/mdc_products';
    assert.equal((await call(path, 'GET')).status, 401);
    assert.equal((await call(path, 'POST', {...b, 'X-Workspace':a['X-Workspace']}, '{}')).status, 401);
    assert.equal((await call(path, 'POST', {...a,origin:'https://elsewhere.example'}, '{}')).status, 403);
    const demoId = 'shared-trial';
    const publicPassword = crypto.randomUUID();
    env.PUBLIC_TRIAL_PASSWORD = publicPassword;
    sqlite.prepare('INSERT INTO workspaces(id,login_hash) VALUES(?,?)').run(demoId, 'public:trial');
    const publicLogin = (username, password) => call('/api/login', 'POST', {}, new URLSearchParams({username, password}));
    assert.equal((await publicLogin('test', 'invalid')).status, 401);
    assert.equal((await publicLogin('someone', publicPassword)).status, 401);
    const demoHeaders = async () => {
      const response = await publicLogin('test', publicPassword);
      assert.equal(response.status, 303);
      return {cookie: response.headers.get('set-cookie').split(';')[0], 'X-Workspace': demoId};
    };
    const demoA = await demoHeaders();
    const demoB = await demoHeaders();
    assert.notEqual(demoA.cookie, demoB.cookie);
    assert.ok((await call(path, 'POST', demoA, JSON.stringify({name:'shared sample'}))).ok);
    assert.deepEqual(await (await call(path, 'GET', demoB)).json(), ['shared sample']);
    assert.equal((await call(path, 'GET', {...demoB, 'X-Workspace': a['X-Workspace']})).status, 401);
    assert.equal((await call(path, 'GET', {...a, 'X-Workspace': demoId})).status, 401);
    assert.ok((await call('/api/logout', 'POST', demoA)).ok);
    assert.equal((await call(path, 'GET', demoB)).status, 200);
    const writes = await Promise.all(['product-a','product-b'].map(name => call(path, 'POST', a, JSON.stringify({name}))));
    assert.ok(writes.every(r => r.ok));
    assert.deepEqual((await (await call(path, 'GET', a)).json()).sort(), ['product-a','product-b']);
    assert.deepEqual(await (await call(path, 'GET', b)).json(), []);
    assert.equal((await call('/api/logout', 'POST', a)).status, 200);
    assert.equal((await call(path, 'GET', a)).status, 401);
    assert.equal((await call(path, 'GET', b)).status, 200);
  } finally { sqlite.close(); }
});
