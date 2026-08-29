"""Hand-calculated accounting fixtures and real temporary SQLite seed checks."""
import copy
from collections import Counter, defaultdict
from datetime import date
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from local_api.store import Store, TABLES, normalize_validate
from local_api.tests.test_local_api import fixture


def financial_fixture():
    rows = {table: [] for table in TABLES}
    rows.update(fixture())
    rows['shipments'] = [dict(id='s', owner_id='demo-sales-1', contract_id='c',
        shipment_no='DEMO-S', shipment_date='2026-08-04', status='已发货')]
    rows['shipment_items'] = [dict(id='si', owner_id='demo-sales-1', shipment_id='s',
        contact_sheet_id='cs', batch_id='b', shipped_quantity=40, unit_price=10)]
    rows['invoices'] = [dict(id='i', owner_id='demo-sales-1', shipment_id='s',
        invoice_no='DEMO-I', invoice_date='2026-08-08', amount=400)]
    return rows


class ModulesTest(unittest.TestCase):
    def module(self, name):
        try:
            return importlib.import_module('local_api.' + name)
        except ModuleNotFoundError as exc:
            self.fail(f'{name} implementation is missing: {exc}')


class ProfitMetricsTest(ModulesTest):
    def setUp(self):
        self.metrics = self.module('metrics')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def sqlite_rows(self, rows):
        root = Path(self.temp.name)
        seed_path = root / 'fixture.json'
        seed_path.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
        return Store(root / ('test-' + str(len(list(root.glob('*.sqlite3')))) + '.sqlite3'), seed_path).snapshot()

    def report(self, rows, start='2026-08-01', end='2026-08-31', owner_id=None):
        return self.metrics.operating_metrics(rows, start, end, owner_id)

    def test_usd_profit_and_all_frontend_metadata(self):
        rows = self.sqlite_rows(financial_fixture())
        before = copy.deepcopy(rows)
        actual = self.metrics.shipment_profits(rows)[0]
        self.assertEqual(actual['profit'], 2000)
        self.assertEqual(actual['sales_amount_rmb'], 2800)
        self.assertEqual(actual['product_cost_total_rmb'], 800)
        self.assertAlmostEqual(actual['gross_margin'], 2000 / 2800)
        self.assertFalse(actual['is_estimated_profit'])
        keys = ('shipment_id owner_id shipment_no shipment_date contract_no customer_name export_type currency '
            'contact_sheet_no batch_no material_no product_name specification unit shipped_quantity unit_price '
            'sales_amount invoice_month cost_month unit_cost exchange_rate sales_amount_rmb profit gross_margin '
            'is_estimated_profit incoterm cif_amount freight_insurance_amount fob_amount freight_insurance_rmb '
            'profit_basis_amount_rmb product_cost_total_rmb').split()
        self.assertTrue(set(keys).issubset(actual))
        self.assertEqual(actual['batch_no'], 'DEMO-B')
        self.assertEqual(actual['customer_name'], '虚构客户')
        self.assertEqual(self.report(rows)['confirmed_profit_rmb'], 2000)
        self.assertEqual(rows, before, 'Reporting must not mutate the caller snapshot')

    def test_missing_invoice_date_preparing_and_cancelled_do_not_create_profit(self):
        for status, invoice_date in [('准备中', '2026-08-08'), ('取消', '2026-08-08'), ('已发货', None)]:
            rows = financial_fixture()
            rows['shipments'][0]['status'] = status
            rows['invoices'][0]['invoice_date'] = invoice_date
            self.assertEqual(self.metrics.shipment_profits(rows), [])
        rows['invoices'].clear()
        self.assertEqual(self.metrics.shipment_profits(rows), [])

    def test_missing_exact_invoice_month_cost_is_null_not_a_confirmed_fallback(self):
        rows = self.sqlite_rows(financial_fixture())
        for month in ['2026-07', '2026-09']:
            rows['product_costs'][0]['cost_month'] = month
            actual = self.metrics.shipment_profits(rows)[0]
            self.assertTrue(actual['is_estimated_profit'])
            self.assertIsNone(actual['profit'])
            self.assertIsNone(actual['unit_cost'])
            self.assertEqual(self.report(rows)['confirmed_profit_rmb'], 0)

    def test_material_normalization_and_owner_cost_rate_isolation(self):
        rows = self.sqlite_rows(financial_fixture())
        rows['shipment_items'][0]['material_no'] = '  demo-m  '
        rows['product_costs'].append(dict(rows['product_costs'][0], id='wrong', owner_id='demo-sales-2', unit_cost_no_tax=1))
        rows['exchange_rates'].append(dict(rows['exchange_rates'][0], id='wrong', owner_id='demo-sales-2', rate=9))
        self.assertEqual(self.metrics.shipment_profits(rows)[0]['profit'], 2000)
        rows['shipment_items'][0]['material_no'] = ' '
        self.assertEqual(self.metrics.shipment_profits(rows)[0]['profit'], 2000)

    def test_rate_uses_latest_nonfuture_month_and_missing_rate_nulls_profit(self):
        rows = self.sqlite_rows(financial_fixture())
        rows['exchange_rates'][0]['effective_month'] = '2026-07'
        rows['exchange_rates'].append(dict(rows['exchange_rates'][0], id='future', effective_month='2026-09', rate=9))
        self.assertEqual(self.metrics.shipment_profits(rows)[0]['profit'], 2000)
        rows['exchange_rates'] = rows['exchange_rates'][1:]
        actual = self.metrics.shipment_profits(rows)[0]
        self.assertIsNone(actual['profit'])
        self.assertIsNone(actual['sales_amount_rmb'])
        self.assertTrue(actual['is_estimated_profit'])

    def test_rmb_and_reexport_follow_legacy_taxed_cost_not_net_sales(self):
        for currency in ['RMB', 'USD']:
            rows = financial_fixture()
            if currency == 'RMB':
                rows['customers'][0]['default_currency'] = currency
                for contract in rows['contracts'][:2]:
                    contract.update(currency=currency, incoterm=None, export_type='转口')
            else:
                rows['contracts'][0]['export_type'] = '转口'
            rows['shipment_items'][0]['unit_price'] = 50
            rows['invoices'][0]['amount'] = 2000
            # USD + 转口 is retained only as a pure legacy formula fixture;
            # Store correctly rejects that now-invalid contract pairing.
            actual_rows = self.sqlite_rows(rows) if currency == 'RMB' else rows
            actual = self.metrics.shipment_profits(actual_rows)[0]
            self.assertEqual(actual['profit'], 1096)  # (50 - 20*1.13)*40
            self.assertEqual(actual['product_cost_total_rmb'], 904)

    def test_cif_freight_allocates_by_line_and_preserves_gross_receivable(self):
        rows = financial_fixture()
        rows['contracts'][0]['incoterm'] = 'CIF'
        rows['shipments'][0]['freight_insurance_amount'] = 40
        rows['shipment_items'][0]['shipped_quantity'] = 30
        rows['shipment_items'].append(dict(rows['shipment_items'][0], id='si2', shipped_quantity=10))
        rows = self.sqlite_rows(rows)
        actual = self.metrics.shipment_profits(rows)
        self.assertEqual([r['freight_insurance_amount'] for r in actual], [30, 10])
        self.assertEqual(sum(r['profit'] for r in actual), 1720)
        self.assertEqual(sum(r['profit_basis_amount_rmb'] for r in actual), 2520)
        self.assertEqual(self.report(rows)['customer_balance']['customer_owes_rmb'], 2800)
        rows['shipments'][0]['freight_insurance_amount'] = None
        self.assertTrue(all(r['profit'] is None and r['is_estimated_profit'] for r in self.metrics.shipment_profits(rows)))

    def test_invoice_links_earliest_month_and_physical_groups_do_not_duplicate_lines(self):
        rows = financial_fixture()
        rows['shipments'][0]['shipment_group_id'] = 'g'
        rows['shipment_groups'] = [dict(id='g', owner_id='demo-sales-1', customer_id='cu', currency='USD',
            incoterm='FOB', status='已发货', shipment_no='DEMO-G')]
        rows['shipments'].append(dict(rows['shipments'][0], id='s2', contract_id='c2', shipment_no='DEMO-S2'))
        rows['shipment_items'].append(dict(id='si2', owner_id='demo-sales-1', shipment_id='s2',
            contact_sheet_id='cs2', shipped_quantity=10, unit_price=10))
        rows['invoices'][0]['amount'] = 500
        rows['invoice_shipments'] = [dict(id='link1', owner_id='demo-sales-1', invoice_id='i', shipment_id='s', allocated_amount=400),
            dict(id='link2', owner_id='demo-sales-1', invoice_id='i', shipment_id='s2', allocated_amount=100)]
        rows = self.sqlite_rows(rows)
        rows['invoices'].append(dict(rows['invoices'][0], id='later', invoice_date='2026-09-08'))
        actual = self.metrics.shipment_profits(rows)
        self.assertEqual(len(actual), 2)
        self.assertEqual({r['invoice_month'] for r in actual}, {'2026-08'})
        self.assertEqual({r['shipment_no'] for r in actual}, {'DEMO-G'})
        self.assertEqual(self.report(rows)['shipments'], dict(count=1, original_usd=500, original_rmb=0, amount_rmb=3500))
        self.assertEqual(self.report(rows, '2026-08-20', '2026-08-21')['confirmed_profit_rmb'], 2500)

    def test_receipt_total_not_allocations_and_persisted_rmb_takes_precedence(self):
        rows = financial_fixture()
        rows['payment_receipts'] = [dict(id='r1', owner_id='demo-sales-1', customer_id='cu', total_amount=600,
            payment_date='2026-08-05', currency='USD', exchange_rate=8, payment_type='预付款')]
        rows['payments'] = [dict(id='p1', owner_id='demo-sales-1', contract_id='c', receipt_id='r1', amount=400,
            payment_date='2026-08-05', payment_type='预付款'),
            dict(id='p2', owner_id='demo-sales-1', contract_id='c', amount=20,
            payment_date='2026-08-06', payment_type='尾款')]
        actual = self.report(self.sqlite_rows(rows))
        self.assertEqual(actual['payments'], dict(count=2, original_usd=620, original_rmb=0, amount_rmb=4940))
        self.assertEqual(actual['customer_balance']['we_owe_customer_rmb'], 1540)

    def test_missing_receipt_fallback_groups_allocations_once_at_earliest_date(self):
        rows = financial_fixture()
        rows['payments'] = [dict(id='p1', owner_id='demo-sales-1', contract_id='c', receipt_id='missing',
            currency='USD', amount=100, amount_rmb=800, payment_date='2026-07-31'),
            dict(id='p2', owner_id='demo-sales-1', contract_id='c2', receipt_id='missing',
            currency='USD', amount=200, amount_rmb=None, payment_date='2026-08-01')]
        rows['exchange_rates'].append(dict(rows['exchange_rates'][0], id='july', effective_month='2026-07', rate=6))
        self.assertEqual(self.report(rows)['payments']['count'], 0)
        actual = self.report(rows, '2026-07-01', '2026-08-31')
        self.assertEqual(actual['payments'], dict(count=1, original_usd=300, original_rmb=0, amount_rmb=1800))

    def test_period_exact_rates_balance_latest_rate_and_owner_filter(self):
        rows = self.sqlite_rows(financial_fixture())
        rows['exchange_rates'][0]['effective_month'] = '2026-07'
        actual = self.report(rows)
        self.assertEqual(actual['orders'], dict(count=2, original_usd=1500, original_rmb=0, amount_rmb=0))
        self.assertEqual(actual['shipments']['amount_rmb'], 0)
        self.assertEqual(actual['missing_rate_months'], ['2026-08'])
        self.assertEqual(actual['customer_balance']['customer_owes_rmb'], 2800)
        self.assertEqual(self.report(rows, owner_id='demo-sales-2')['orders']['count'], 0)
        self.assertEqual(self.report(rows, owner_id='demo-sales-2')['confirmed_profit_rmb'], 0)
        rows['exchange_rates'].clear()
        actual = self.report(rows)
        self.assertEqual(actual['customer_balance']['missing_rate_count'], 1)
        self.assertEqual(actual['customer_balance']['customer_owes_count'], 0)

    def test_balance_is_cumulative_excludes_mixed_currency_and_future_events(self):
        rows = self.sqlite_rows(financial_fixture())
        rows['payments'] = [dict(id='p', owner_id='demo-sales-1', contract_id='c', currency='USD',
            amount=50, amount_rmb=None, payment_date='2026-07-01'),
            dict(id='future', owner_id='demo-sales-1', contract_id='c', currency='USD', amount=9999, payment_date='2026-09-01')]
        self.assertEqual(self.report(rows)['customer_balance']['customer_owes_rmb'], 2450)
        rows['payments'].append(dict(id='mixed', owner_id='demo-sales-1', contract_id='c', currency='RMB', amount=10, payment_date='2026-07-01'))
        balance = self.report(rows)['customer_balance']
        self.assertEqual(balance['currency_conflict_count'], 1)
        self.assertEqual(balance['customer_owes_rmb'], 0)

    def test_empty_ranges_and_invalid_dates(self):
        empty = self.report({})
        self.assertEqual(empty['orders'], dict(count=0, original_usd=0, original_rmb=0, amount_rmb=0))
        self.assertEqual(empty['missing_rate_months'], [])
        self.assertEqual(empty['period'], dict(start_date='2026-08-01', end_date='2026-08-31'))
        for start, end in [('2026-08-02', '2026-08-01'), ('2026-02-30', '2026-08-31'), (None, '2026-08-31')]:
            with self.assertRaises(ValueError):
                self.report({}, start, end)


class SeedTest(ModulesTest):
    def setUp(self):
        self.seed = self.module('seed')

    def test_deterministic_volume_history_variety_and_reference_integrity(self):
        data = self.seed.build_seed(date(2026, 8, 27))
        self.assertEqual(data, self.seed.build_seed(date(2026, 8, 27)))
        self.assertEqual(set(data), set(TABLES))
        normalize_validate(copy.deepcopy(data))
        for table, minimum in [('customers', 60), ('contracts', 1000), ('contact_sheets', 2000),
                ('batches', 3000), ('shipments', 2000), ('payments', 2000), ('invoices', 2000), ('product_costs', 2000)]:
            self.assertGreaterEqual(len(data[table]), minimum, table)
        counts = Counter(r['customer_id'] for r in data['contracts'])
        self.assertGreater(max(counts.values()), min(counts.values()) * 2)
        self.assertEqual(len(counts), len(data['customers']))
        self.assertEqual({r['owner_id'] for r in data['contracts']}, {'demo-sales-1', 'demo-sales-2', 'demo-sales-3'})
        self.assertGreaterEqual(len({r['status'] for r in data['contracts']}), 4)
        self.assertTrue(any(r['contract_date'][:7] == '2026-08' for r in data['contracts']))
        self.assertLessEqual(min(r['contract_date'] for r in data['contracts']), '2024-08-01')
        self.assertTrue(all(r['contract_date'] <= '2026-08-27' for r in data['contracts']))
        self.assertTrue(all('DEMO' in r['name'] and '虚构' in r['notes'] for r in data['customers']))
        self.assertTrue(all(r['material_no'].startswith('DEMO-') for r in data['contact_sheets']))
        used = defaultdict(float)
        for item in data['shipment_items']:
            used[item['contact_sheet_id']] += item['shipped_quantity']
        for sheet in data['contact_sheets']:
            self.assertLessEqual(used[sheet['id']], sheet['quantity'])

    def test_seed_frontend_profiles_product_and_packaging_arrays_survive_sqlite(self):
        data = self.seed.build_seed(date(2026, 8, 27))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            seed_path = root / 'seed.json'
            seed_path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            store = Store(root / 'demo.sqlite3', seed_path)
            with store.connection() as conn:
                self.assertEqual(conn.execute('PRAGMA foreign_key_check').fetchall(), [])
                self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(Store(store.path).snapshot(), store.snapshot())
            products = store.query('mdc_products', {'select': '*,aliases:mdc_product_aliases(*),variants:mdc_product_variants(*)'}, user='demo-manager')
            self.assertTrue(products)
            self.assertTrue(all(p['aliases'] and p['variants'] and p['product_code'] for p in products))
            profiles = store.query('packaging_current_profiles', user='demo-manager')
            self.assertTrue(profiles)
            self.assertTrue(all(p['packaging_code'] and p['version_id'] and p['quantity_unit'] in ('支/箱', '盒/箱', '瓶/箱') for p in profiles))
            users = store.query('app_user_profiles', user='demo-manager')
            self.assertEqual({p['user_id'] for p in users}, {'demo-sales-1', 'demo-sales-2', 'demo-sales-3', 'demo-manager', 'demo-owner'})
            self.assertTrue(all(p['display_name'] and p['login_name'] for p in users))
            profits = store.query('v_shipment_profit', user='demo-manager')
            self.assertGreater(len(profits), 2000)
            self.assertTrue(any(p['profit'] is not None for p in profits))
            self.assertTrue(any(p['is_estimated_profit'] for p in profits))

    def test_as_of_leap_day_month_boundary_and_cli_writes_same_seed(self):
        for as_of in [date(2024, 2, 29), date(2026, 1, 1)]:
            data = self.seed.build_seed(as_of)
            normalize_validate(data)
            self.assertTrue(any(r['contract_date'] == as_of.isoformat() for r in data['contracts']))
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'seed.json'
            result = subprocess.run([sys.executable, '-m', 'local_api.seed', '--as-of', '2026-08-27', '--output', str(output)],
                capture_output=True, text=True, encoding='utf-8', errors='replace', check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')), self.seed.build_seed(date(2026, 8, 27)))

    def test_demo_packaging_partner_has_current_confirmed_and_due_artwork(self):
        data = self.seed.build_seed(date(2026, 8, 28))
        customer = next((r for r in data['customers'] if r['name'] == 'DEMO PACKAGING PARTNER'), None)
        self.assertIsNotNone(customer, 'The frontend requires this exact fictional customer name')
        contracts = {r['id'] for r in data['contracts'] if r['customer_id'] == customer['id']}
        sheets = [r for r in data['contact_sheets'] if r['contract_id'] in contracts
            and r['business_type'] == '制剂' and not r['is_historical'] and r['aps_scheduled_date']
            and not r['actual_release_date']]
        self.assertTrue(any(r['box_artwork_confirmed_date'] for r in sheets))
        due = [r for r in sheets if not r['box_artwork_confirmed_date']]
        self.assertTrue(due)
        alerts = [r for r in data['alerts'] if r['alert_type'] == '请确认 DEMO_PACKAGING 盒子制版稿']
        self.assertTrue(alerts)
        self.assertTrue(all(r['related_id'] in {s['id'] for s in due} for r in alerts))

    def test_seed_has_both_receivables_and_deposits_and_no_future_actual_cash(self):
        as_of = date(2026, 8, 28)
        data = self.seed.build_seed(as_of)
        report = self.module('metrics').operating_metrics(data, '2026-08-01', as_of)
        balance = report['customer_balance']
        self.assertGreater(balance['customer_owes_count'], 0)
        self.assertGreater(balance['we_owe_customer_count'], 0)
        self.assertGreater(balance['balanced_count'], 0)
        self.assertEqual(balance['currency_conflict_count'], 0)
        for table, field in [('payment_receipts', 'payment_date'), ('payments', 'payment_date'),
                ('shipments', 'shipment_date'), ('invoices', 'invoice_date')]:
            self.assertTrue(all(not row.get(field) or row[field] <= as_of.isoformat() for row in data[table]), table)


if __name__ == '__main__':
    unittest.main()
