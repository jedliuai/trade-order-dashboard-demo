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
        self.assertEqual(len(rows['customers']), 24)
        self.assertLess(len(rows['contracts']), 200)
        self.assertLess(len(rows['contact_sheets']), 400)
        self.assertEqual({r['owner_id'] for r in rows['customers']}, {'demo-sales-1', 'demo-sales-2', 'demo-sales-3'})
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
