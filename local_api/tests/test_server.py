"""HTTP boundaries: exercise real sockets and an isolated SQLite file."""
import http.client
import importlib
import json
from pathlib import Path
import tempfile
import threading
import unittest

from local_api.store import Store


class ServerBoundaryTest(unittest.TestCase):
    def setUp(self):
        try:
            module = importlib.import_module('local_api.server')
        except ModuleNotFoundError:
            self.fail('Local HTTP server is not implemented yet (RED)')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        seed = self.root / 'seed.json'
        seed.write_text('{}', encoding='utf-8')
        static = self.root / 'dist'
        static.mkdir()
        (static / 'index.html').write_text('<h1>Local demo</h1>', encoding='utf-8')
        (self.root / '.env.local').write_text('TEST_ONLY=not-public', encoding='utf-8')
        self.store = Store(self.root / 'demo.sqlite3', seed_path=seed)
        self.server = module.make_server(self.store, port=0, static_dir=static, env_path=self.root / '.env.local')
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, payload=None, headers=None, raw=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            body = raw if raw is not None else json.dumps(payload).encode() if payload is not None else None
            connection.request(method, path, body, {'Content-Type': 'application/json', **(headers or {})})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_http_writes_persist_and_owner_isolation_is_enforced(self):
        code, _, body = self.request('POST', '/api/data/customers', {'name': 'HTTP虚构客户'})
        self.assertEqual(code, 201)
        created = json.loads(body)[0]
        self.assertEqual(self.store.query('customers')[0]['name'], 'HTTP虚构客户')
        self.assertEqual(json.loads(self.request('GET', '/api/data/customers', headers={'X-Demo-User': 'demo-sales-2'})[2]), [])
        self.assertEqual(self.request('PATCH', '/api/data/customers?id=eq.' + created['id'], {'notes': '拒绝'}, {'X-Demo-User': 'demo-manager'})[0], 403)

    def test_bootstrap_is_one_consistent_role_scoped_graph(self):
        self.store.insert('customers', {'name': '虚构一组'}, user='demo-sales-1')
        self.store.insert('customers', {'name': '虚构二组'}, user='demo-sales-2')
        code, headers, body = self.request('GET', '/api/bootstrap')
        self.assertEqual(code, 200)
        data = json.loads(body)
        self.assertEqual([row['name'] for row in data['customers']], ['虚构一组'])
        self.assertEqual(data['v_shipment_profit'], [])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        manager = json.loads(self.request('GET', '/api/bootstrap', headers={'X-Demo-User': 'demo-manager'})[2])
        self.assertEqual(len(manager['customers']), 2)
        self.assertEqual(self.request('POST', '/api/bootstrap', {})[0], 404)

    def test_host_origin_and_fetch_metadata_cannot_bypass_loopback_boundary(self):
        for headers in [{'Host': 'evil.example'}, {'Origin': 'https://evil.example'}, {'Sec-Fetch-Site': 'cross-site'}, {'Origin': 'http://127.0.0.1:9999'}]:
            self.assertEqual(self.request('POST', '/api/data/customers', {'name': '拒绝'}, headers)[0], 403)
        self.assertEqual(self.store.query('customers'), [])

    def test_invalid_json_body_and_ambiguous_queries_are_rejected(self):
        for raw in [b'{broken', b'{"amount": NaN}', b'[]']:
            self.assertEqual(self.request('POST', '/api/reset', raw=raw)[0], 400)
        self.assertEqual(self.request('POST', '/api/data/customers', {'name': 'bad'}, {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('GET', '/api/data/customers?id=eq.a&id=eq.b')[0], 400)
        self.assertEqual(self.request('POST', '/api/data/customers', raw=b' ' * (1_048_577))[0], 413)

    def test_unknown_routes_wrong_methods_and_secrets_are_not_served(self):
        self.assertEqual(self.request('GET', '/api/data/rpc/refresh_alerts')[0], 405)
        self.assertEqual(self.request('GET', '/api/not-a-route')[0], 404)
        for path in ['/../.env.local', '/%2e%2e/.env.local', '/.env.local', '/data/demo.sqlite3']:
            code, _, content = self.request('GET', path)
            self.assertIn(code, (400, 403, 404))
            self.assertNotIn(b'not-public', content)
        code, _, content = self.request('GET', '/')
        self.assertEqual(code, 200)
        self.assertIn(b'Local demo', content)

    def test_health_and_backup_are_noncacheable_and_reset_requires_confirmation(self):
        code, headers, body = self.request('GET', '/api/health')
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)['status'], 'ok')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.request('POST', '/api/reset', {'confirm': 'NO'})[0], 400)
        self.assertEqual(self.request('POST', '/api/reset', {'confirm': 'RESET_DEMO'}, {'X-Demo-User': 'demo-owner'})[0], 403)
        self.assertEqual(json.loads(self.request('GET', '/api/backup')[2])['customers'], [])
