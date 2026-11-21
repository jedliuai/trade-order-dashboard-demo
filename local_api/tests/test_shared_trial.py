import json
import sqlite3
import unittest
from datetime import date
from pathlib import Path

from local_api.metrics import shipment_profits
from scripts.seed_shared_trial import build, seed_sql


class SharedTrialTest(unittest.TestCase):
    def test_showcase_covers_profit_payment_and_fulfilment(self):
        rows = build(date(2026, 11, 21))
        self.assertEqual([len(rows[k]) for k in ('customers','mdc_products','contracts')], [6,7,14])
        profits = shipment_profits(rows)
        current = [r for r in profits if r['invoice_month']=='2026-11']
        self.assertTrue(any(r['profit']>0 for r in current))
        loss = next(r for r in current if r['profit']<0)
        self.assertEqual((loss['customer_name'], round(loss['profit'],2)), ('南栀分销', -5172.40))
        self.assertTrue(any(r['profit'] is None for r in profits))
        self.assertTrue({'部分发货','已归档','进行中'} <= {r['status'] for r in rows['contracts']})
        self.assertEqual({r['status'] for r in rows['shipments']}, {'准备中','已发货'})
        self.assertEqual({r['currency'] for r in rows['payment_receipts']}, {'USD','RMB'})
        self.assertTrue(any(r['total_amount'] > sum(p['amount'] for p in rows['payments'] if p['receipt_id']==r['id'])
                            for r in rows['payment_receipts']))
        self.assertEqual({r['owner_id'] for values in rows.values() for r in values}, {'personal','demo-shared'})

    def test_repeat_provision_preserves_shared_and_private_edits(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        migration = Path(__file__).resolve().parents[2] / 'cloudflare/migrations/0001_workspaces.sql'
        db.executescript(migration.read_text(encoding='utf-8'))
        db.execute("INSERT INTO workspaces(id,login_hash) VALUES('private','private-fixture')")
        sql = seed_sql(build(date(2026,11,21)))
        self.assertLess(len(sql.encode('utf-8')), 100_000)
        db.executescript(sql)
        self.assertEqual(len(json.loads(db.execute("SELECT contents FROM workspaces WHERE id='shared-trial'").fetchone()[0])['customers']), 6)
        db.execute("UPDATE workspaces SET contents='{\"edited\":true}' WHERE id='shared-trial'")
        db.executescript(sql)
        self.assertEqual(dict(db.execute('SELECT id,contents FROM workspaces')),
                         {'private':'{}','shared-trial':'{"edited":true}'})
