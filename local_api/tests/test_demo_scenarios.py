import copy
from datetime import date
from pathlib import Path
import tempfile
import unittest

from local_api.seed import build_seed
from local_api.store import ApiError, Store, normalize_validate
from local_api.tests.test_local_api import fixture
import json


class CompactDemoTest(unittest.TestCase):
    def test_small_seed_is_deterministic_fictional_and_integral(self):
        rows = build_seed(date(2026, 10, 28))
        self.assertEqual(rows, build_seed(date(2026, 10, 28)))
        self.assertEqual(len(rows['customers']), 48)
        self.assertLess(len(rows['contracts']), 400)
        self.assertLess(len(rows['contact_sheets']), 700)
        self.assertEqual({r['owner_id'] for r in rows['customers']}, {'demo-sales-1', 'demo-sales-2', 'demo-sales-3', 'demo-sales-4'})
        self.assertEqual(len(rows['mdc_products']), 33)
        from local_api.demo_catalog import MEDICINES
        product_ids = {p['id'] for p in rows['mdc_products'] if p['chinese_name'] in {m[0] for m in MEDICINES}}
        self.assertEqual(len(product_ids), 9)
        variant_products = {v['id']: v['product_id'] for v in rows['mdc_product_variants']}
        for owner in ('demo-sales-1', 'demo-sales-2', 'demo-sales-3', 'demo-sales-4'):
            used = {variant_products[s['product_variant_id']] for s in rows['contact_sheets'] if s['owner_id'] == owner}
            self.assertTrue(product_ids <= used, f'{owner} must actually trade every named medicine')
        self.assertTrue(all('虚构' in r['notes'] for r in rows['customers']))
        self.assertTrue(all(r['source'] == 'Manual' for r in rows['exchange_rates']))
        self.assertTrue(any(r['effective_month'] == '2026-10' for r in rows['exchange_rates']))
        normalize_validate(copy.deepcopy(rows))

    def test_manual_exchange_rate_persists_and_external_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            seed = root / 'seed.json'
            seed.write_text(json.dumps(fixture()), encoding='utf-8')
            store = Store(root / 'local.sqlite3', seed)
            store.update('exchange_rates', {'id': 'eq.r'}, {'rate': 7.1234, 'source': 'Manual'})
            self.assertEqual(Store(store.path).query('exchange_rates')[0]['rate'], 7.1234)
            before = store.snapshot()
            with self.assertRaisesRegex(ApiError, '手动'):
                store.update('exchange_rates', {'id': 'eq.r'}, {'source': 'RemoteFeed', 'rate': 8})
            self.assertEqual(store.snapshot(), before)
