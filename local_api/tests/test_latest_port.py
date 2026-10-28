"""Latest local workflow regression tests using fictional disposable SQLite data."""
import copy
import io
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from contextlib import closing
import tempfile
import unittest

from local_api.store import ApiError, Store
from local_api.tests.test_local_api import fixture


class LatestPortTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        seed = self.root / 'seed.json'
        seed.write_text(json.dumps(fixture(), ensure_ascii=False), encoding='utf-8')
        self.store = Store(self.root / 'local.sqlite3', seed)

    def rpc(self, name, **params):
        return self.store.rpc(name, params)

    def group(self, status='准备中', no='DEMO-PLAN', quantity=20):
        return self.rpc('create_shipment_group_with_items', group_data={
            'customer_id': 'cu', 'shipment_no': no, 'status': status, 'shipment_date': '2026-08-10'},
            item_rows=[self.item(quantity)])

    def item(self, quantity=20):
        return dict(contact_sheet_id='cs', batch_id='b', shipped_quantity=quantity, unit_price=10)

    def receipt(self, allocations):
        return self.rpc('create_payment_receipt_with_allocations', receipt_data={
            'customer_id': 'cu', 'total_amount': 600, 'currency': 'USD', 'payment_date': '2026-08-05'},
            allocation_rows=allocations)

    def test_receipt_contract_only_and_new_allocation_effective_date(self):
        rid = self.receipt([{'contract_id': 'c', 'amount': 200}])
        payment = self.store.query('payments')[0]
        self.assertEqual(payment['allocation_effective_date'], '2026-08-05')
        self.assertIsNone(payment.get('shipment_id'))
        self.rpc('update_payment_receipt_with_allocations', target_receipt_id=rid,
                 receipt_data={'payment_date': '2026-08-06', 'total_amount': 600},
                 allocation_rows=[{'contract_id': 'c', 'amount': 250}, {'contract_id': 'c2', 'amount': 100}])
        allocations = {p['contract_id']: p for p in self.store.query('payments')}
        self.assertEqual(allocations['c']['allocation_effective_date'], '2026-08-06')
        today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
        self.assertEqual(allocations['c2']['allocation_effective_date'], today)
        self.assertEqual(len(self.store.query('payment_receipt_change_history')), 1)

    def test_receipt_rejects_shipment_assignment_with_rollback(self):
        gid = self.group()
        sid = self.store.query('shipments')[0]['id']
        before = self.store.snapshot()
        with self.assertRaisesRegex(ApiError, '合同'):
            self.receipt([{'contract_id': 'c', 'shipment_id': sid, 'amount': 100}])
        self.assertEqual(self.store.snapshot(), before)

    def test_receipt_before_contact_sheets_and_zero_prepayment_ratio(self):
        self.store.insert('contracts', {'id': 'empty', 'contract_no': 'DEMO-EMPTY', 'customer_id': 'cu',
                                      'contract_date': '2026-08-02', 'prepayment_ratio': 0})
        self.receipt([{'contract_id': 'empty', 'amount': 100}])
        self.assertEqual(self.store.query('contracts', {'id': 'eq.empty'})[0]['prepayment_ratio'], 0)
        with self.assertRaises(ApiError):
            self.store.update('contracts', {'id': 'eq.empty'}, {'prepayment_ratio': 1.01})

    def test_preparing_group_edit_release_capacity_and_atomic_rollback(self):
        gid = self.group(quantity=80)
        self.rpc('update_preparing_shipment_group_with_items', target_group_id=gid,
                 group_data={'shipment_no': 'DEMO-EDITED', 'shipment_date': '2026-08-11'},
                 item_rows=[self.item(90)])
        self.assertEqual(self.store.query('shipments')[0]['amount'], 900)
        self.assertEqual(self.store.query('shipment_groups')[0]['shipment_no'], 'DEMO-EDITED')
        before = self.store.snapshot()
        with self.assertRaises(ApiError):
            self.rpc('update_preparing_shipment_group_with_items', target_group_id=gid,
                     group_data={'shipment_no': 'DEMO-FAILED'}, item_rows=[self.item(101)])
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(self.rpc('delete_preparing_shipment_group', target_group_id=gid), gid)
        self.assertEqual(self.store.query('shipment_items'), [])

    def test_dispatch_requires_material_and_rolls_back(self):
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'material_no': ''})
        gid = self.group()
        before = self.store.snapshot()
        with self.assertRaisesRegex(ApiError, '物料号'):
            self.rpc('confirm_shipment_group_dispatched', target_group_id=gid,
                     actual_shipment_date='2026-08-12', item_rows=[self.item()])
        self.assertEqual(self.store.snapshot(), before)

    def test_void_copy_preserves_original_and_reserves_replacement(self):
        gid = self.group(status='已发货', quantity=80)
        before = copy.deepcopy(self.store.query('shipment_items'))
        replacement = self.rpc('void_and_copy_shipment_group', target_group_id=gid,
                              replacement_shipment_no='DEMO-REPLACEMENT', replacement_shipment_date='2026-08-12')
        groups = {g['id']: g for g in self.store.query('shipment_groups')}
        self.assertEqual(groups[gid]['status'], '取消')
        self.assertEqual(groups[replacement]['status'], '准备中')
        self.assertTrue(all(item in self.store.query('shipment_items') for item in before))
        self.assertEqual(self.store.query('contact_sheets', {'id': 'eq.cs'})[0]['shipped_quantity'], 0)
        with self.assertRaises(ApiError):
            self.rpc('delete_preparing_shipment_group', target_group_id=gid)

    def test_invoiced_shipment_cannot_void(self):
        gid = self.group(status='已发货')
        sid = self.store.query('shipments')[0]['id']
        self.rpc('mark_physical_shipment_invoiced', target_shipment_id=sid,
                 invoice_data={'invoice_no': 'DEMO-INV', 'invoice_date': '2026-08-11'})
        before = self.store.snapshot()
        with self.assertRaises(ApiError):
            self.rpc('void_and_copy_shipment_group', target_group_id=gid,
                     replacement_shipment_no='DEMO-INVALID', replacement_shipment_date='2026-08-12')
        self.assertEqual(self.store.snapshot(), before)

    def test_rest_cannot_change_confirmed_facts_or_delete_them_by_contract(self):
        gid = self.group(status='已发货')
        item = self.store.query('shipment_items')[0]
        for table, params, data in [('shipment_items', {'id': 'eq.' + item['id']}, {'shipped_quantity': 1}),
                                    ('shipment_groups', {'id': 'eq.' + gid}, {'status': '取消'})]:
            with self.assertRaises(ApiError):
                self.store.update(table, params, data)
        with self.assertRaises(ApiError):
            self.store.delete('contracts', {'id': 'eq.c'})

    def test_legacy_migration_backups_and_is_idempotent(self):
        self.receipt([{'contract_id': 'c', 'amount': 100}])
        with closing(sqlite3.connect(self.store.path)) as conn, conn:
            conn.execute("DELETE FROM metadata WHERE key='schema_version'")
            for table, id, body in conn.execute('SELECT table_name,id,body FROM documents').fetchall():
                row = json.loads(body)
                row.pop('allocation_effective_date', None)
                if table == 'contracts':
                    row['prepayment_ratio'] = 40
                conn.execute('UPDATE documents SET body=? WHERE table_name=? AND id=?', (json.dumps(row), table, id))
        migrated = Store(self.store.path)
        backups = list((self.root / 'backups').glob('*.sqlite3'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(migrated.query('payments')[0]['allocation_effective_date'], '2026-08-05')
        self.assertEqual(migrated.query('contracts')[0]['prepayment_ratio'], .4)
        self.assertEqual(Store(self.store.path).snapshot(), migrated.snapshot())
        self.assertEqual(len(list((self.root / 'backups').glob('*.sqlite3'))), 1)

    def export_rows(self, command, filters):
        from local_api.exports import export_file
        from openpyxl import load_workbook
        _, _, content = export_file(self.store, command, filters)
        workbook = load_workbook(io.BytesIO(content), data_only=False)
        values = list(workbook.active.values)
        workbook.close()
        return [dict(zip(values[3], row)) for row in values[4:] if any(v is not None for v in row)]

    def test_invoice_export_uses_created_date_shipment_prices_and_selected_rate(self):
        self.group(quantity=20)
        from local_api.payment_progress import china_today
        today = china_today().isoformat()
        filters = {'date_from': today, 'date_to': today, 'rate_month': '2026-08'}
        rows = self.export_rows('export-usd-actual-invoice', filters)
        self.assertEqual((rows[0]['数量'], rows[0]['单价'], rows[0]['金额']), (20, 70, 1400))
        rows = self.export_rows('export-expected-invoice', filters)
        self.assertEqual(rows[0]['备注'], '未发货，未开票')
        self.assertEqual(rows[0]['总利润（万元）'], '=(H5-F5)*G5')
        from local_api.exports import export_file
        with self.assertRaisesRegex(ApiError, '汇率'):
            export_file(self.store, 'export-expected-invoice', {**filters, 'rate_month': '2026-09'})

    def test_invoice_export_validates_full_physical_invoice_and_cancellation(self):
        gid = self.group(status='已发货')
        sid = self.store.query('shipments')[0]['id']
        self.rpc('create_invoice_with_shipments', invoice_data={'invoice_no': 'DEMO-PARTIAL', 'invoice_date': '2026-08-11', 'amount': 50},
                 shipment_rows=[{'shipment_id': sid, 'allocated_amount': 50}])
        from local_api.payment_progress import china_today
        today = china_today().isoformat()
        from local_api.exports import export_file
        with self.assertRaisesRegex(ApiError, '金额不一致'):
            export_file(self.store, 'export-expected-invoice', {'date_from': today, 'date_to': today, 'rate_month': '2026-08'})

    def test_release_export_requires_inbound_and_uses_version_workshop(self):
        from local_api.exports import export_file
        with self.assertRaisesRegex(ApiError, '已入库'):
            export_file(self.store, 'export-release-application', {'contact_sheet_ids': ['cs']})
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'actual_warehousing_date': '2026-08-03'})
        rows = self.export_rows('export-release-application', {'contact_sheet_ids': ['cs']})
        self.assertEqual(rows[0]['批号'], 'DEMO-B')
        self.assertIsNone(rows[0]['车间'])
        self.assertIsNone(rows[0]['标准制造周期'])
        with self.assertRaises(ApiError):
            export_file(self.store, 'export-release-application', {'contact_sheet_ids': ['foreign-id']})

    def test_payment_export_includes_unallocated_receipt_without_double_counting(self):
        self.receipt([])
        self.receipt([{'contract_id': 'c', 'amount': 200}])
        rows = self.export_rows('export-payments', {})
        self.assertEqual(len(rows), 2)
        self.assertEqual(sum(row['金额'] for row in rows), 1200)
        self.assertEqual(sum(row['客户预存款'] for row in rows), 1000)
        self.assertIn('DEMO-C', str(rows[1]['合同分摊明细']))
        matched = self.export_rows('export-payments', {'contract_id': 'c'})
        self.assertEqual(matched[0]['金额'], 200)
        self.assertEqual(matched[0]['实际到账总额'], 600)

    def test_legacy_shipment_gains_one_to_one_header_without_changing_financial_facts(self):
        sid = self.rpc('create_shipment_with_items', shipment_data={'contract_id': 'c',
                       'shipment_no': 'DEMO-LEGACY', 'shipment_date': '2026-08-12', 'status': '已发货'},
                       item_rows=[self.item(20)])
        with closing(sqlite3.connect(self.store.path)) as conn, conn:
            conn.execute("DELETE FROM metadata WHERE key='schema_version'")
        upgraded = Store(self.store.path)
        shipment = upgraded.query('shipments')[0]
        self.assertEqual((shipment['id'], shipment['amount'], shipment['shipment_no']), (sid, 200, 'DEMO-LEGACY'))
        gid = shipment['shipment_group_id']
        self.assertEqual(upgraded.query('shipment_groups')[0]['shipment_no'], 'DEMO-LEGACY')
        new = upgraded.rpc('void_and_copy_shipment_group', {'target_group_id': gid,
                           'replacement_shipment_no': 'DEMO-LEGACY-REPLACEMENT'})
        self.assertTrue(new)


if __name__ == '__main__':
    unittest.main()
