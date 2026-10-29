"""HTTP boundaries: exercise real sockets and an isolated SQLite file."""
import http.client
import importlib
import io
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

    def populate_organization(self):
        return {f'demo-sales-{n}': self.store.insert('customers', {'name': f'虚构区域客户{n}'}, user=f'demo-sales-{n}')[0] for n in range(1, 5)}

    def test_region_and_owner_drilldown_are_enforced_by_http_for_every_read_route(self):
        self.populate_organization()
        expected = {'demo-sales-1': 1, 'demo-sales-4': 1, 'demo-manager': 2, 'demo-manager-2': 2, 'demo-owner': 4}
        for actor, count in expected.items():
            with self.subTest(actor=actor):
                headers = {'X-Demo-User': actor}
                for route in ('/api/bootstrap', '/api/backup'):
                    code, _, body = self.request('GET', route, headers=headers)
                    self.assertEqual(code, 200)
                    self.assertEqual(len(json.loads(body)['customers']), count)
                body = self.request('GET', '/api/health', headers=headers)[2]
                self.assertEqual(json.loads(body)['counts']['customers'], count)
                body = self.request('GET', '/api/data/customers', headers=headers)[2]
                self.assertEqual(len(json.loads(body)), count)
        for actor, scope, count in [('demo-owner', 'demo-manager-2', 2), ('demo-owner', 'demo-sales-4', 1), ('demo-manager', 'demo-sales-2', 1)]:
            headers = {'X-Demo-User': actor, 'X-Demo-Scope': scope}
            body = self.request('GET', '/api/bootstrap', headers=headers)[2]
            self.assertEqual(len(json.loads(body)['customers']), count)
        for actor, scope in [('demo-sales-1', 'demo-sales-2'), ('demo-manager', 'demo-manager-2'), ('demo-manager', 'demo-sales-3'), ('demo-manager-2', 'demo-owner'), ('demo-owner', 'unknown')]:
            headers = {'X-Demo-User': actor, 'X-Demo-Scope': scope}
            self.assertEqual(self.request('GET', '/api/bootstrap', headers=headers)[0], 403)

    def test_manager_viewing_salesperson_remains_readonly_and_cannot_modify_any_record(self):
        customers = self.populate_organization()
        before = self.store.snapshot()
        for actor, scope in [('demo-manager', 'demo-sales-1'), ('demo-manager-2', 'demo-sales-4'), ('demo-owner', 'demo-sales-2')]:
            headers = {'X-Demo-User': actor, 'X-Demo-Scope': scope}
            cid = customers[scope]['id']
            for method, route, payload in [
                ('POST', '/api/data/customers', {'name': '禁止新增'}),
                ('PATCH', '/api/data/customers?id=eq.' + cid, {'notes': '禁止修改'}),
                ('DELETE', '/api/data/customers?id=eq.' + cid, {}),
                ('POST', '/api/data/rpc/refresh_alerts', {}),
                ('POST', '/api/reset', {'confirm': 'RESET_DEMO'}),
            ]:
                self.assertEqual(self.request(method, route, payload, headers)[0], 403)
        self.assertEqual(self.store.snapshot(), before)
        own = customers['demo-sales-4']['id']
        headers = {'X-Demo-User': 'demo-sales-4'}
        self.assertEqual(self.request('PATCH', '/api/data/customers?id=eq.' + own, {'notes': '本人保存'}, headers)[0], 200)
        self.assertEqual(self.request('PATCH', '/api/data/customers?id=eq.' + customers['demo-sales-3']['id'], {'notes': '越权'}, headers)[0], 409)
        self.assertEqual(self.store.query('customers', {'id': 'eq.' + own}, user='demo-sales-4')[0]['notes'], '本人保存')

    def test_export_and_metrics_cannot_escape_current_region_or_selected_salesperson(self):
        customers = self.populate_organization()
        for owner, customer in customers.items():
            self.store.insert('contracts', {'contract_no': '虚构-' + owner, 'customer_id': customer['id'], 'currency': 'USD', 'export_type': '自营', 'incoterm': 'FOB', 'contract_date': '2026-10-29'}, user=owner)
        from openpyxl import load_workbook
        for actor, scope, expected in [('demo-manager', 'demo-manager', {1, 2}), ('demo-owner', 'demo-manager-2', {3, 4}), ('demo-owner', 'demo-sales-4', {4})]:
            headers = {'X-Demo-User': actor, 'X-Demo-Scope': scope}
            code, _, content = self.request('POST', '/api/export/export-original-contracts', {}, headers)
            self.assertEqual(code, 200)
            workbook = load_workbook(io.BytesIO(content))
            cells = ' '.join(str(cell.value) for row in workbook.active for cell in row)
            for n in range(1, 5):
                self.assertEqual(f'虚构区域客户{n}' in cells, n in expected)
        self.assertEqual(self.request('POST', '/api/data/rpc/get_operating_metrics', {'p_start_date': '2026-10-01', 'p_end_date': '2026-10-29', 'p_owner_id': 'demo-sales-4'}, {'X-Demo-User': 'demo-manager'})[0], 403)

    def test_member_reset_preserves_every_other_owners_records(self):
        customers = self.populate_organization()
        untouched = {t: [r for r in rs if r['owner_id'] != 'demo-sales-1'] for t, rs in self.store.snapshot().items()}
        code, _, _ = self.request('POST', '/api/reset', {'confirm': 'RESET_DEMO'})
        self.assertEqual(code, 200)
        after = {t: [r for r in rs if r['owner_id'] != 'demo-sales-1'] for t, rs in self.store.snapshot().items()}
        self.assertEqual(after, untouched)
        self.assertEqual(self.store.query('customers', user='demo-sales-2')[0]['id'], customers['demo-sales-2']['id'])
