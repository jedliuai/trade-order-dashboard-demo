"""RPC contracts against disposable real SQLite files, never external services."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from contextlib import contextmanager

from local_api.store import ApiError, Store
from local_api.tests.test_local_api import fixture


class ActionTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        seed = self.root / 'seed.json'
        seed.write_text(json.dumps(fixture(), ensure_ascii=False), encoding='utf-8')
        self.store = Store(self.root / 'test.sqlite3', seed_path=seed)

    def rpc(self, name, user='demo-sales-1', **params):
        try:
            return self.store.rpc(name, params, user=user)
        except ModuleNotFoundError as error:
            self.fail(f'Missing RPC implementation: {error}')

    def item(self, quantity=40, sheet='cs', batch='b', price=10):
        return dict(contact_sheet_id=sheet, batch_id=batch,
                    shipped_quantity=quantity, unit_price=price)

    def shipment(self, quantity=40, status='已发货', number='S'):
        return self.rpc('create_shipment_with_items', shipment_data={
            'contract_id': 'c', 'shipment_no': number,
            'shipment_date': '2026-08-04', 'status': status},
            item_rows=[self.item(quantity)])

    def receipt(self):
        return self.rpc('create_payment_receipt_with_allocations', receipt_data={
            'customer_id': 'cu', 'total_amount': 600, 'currency': 'USD',
            'payment_date': '2026-08-05', 'exchange_rate': 7, 'payment_type': '预付款'},
            allocation_rows=[{'contract_id': 'c', 'amount': 200, 'payment_type': '预付款'},
                             {'contract_id': 'c2', 'amount': 100, 'payment_type': '尾款'}])

    def assertRollback(self, action, *args, **kwargs):
        before = self.store.snapshot()
        with self.assertRaises(ApiError):
            action(*args, **kwargs)
        self.assertEqual(before, self.store.snapshot())
        self.assertEqual(before, Store(self.store.path).snapshot())

    def product(self, name='虚构品'):
        product = self.store.insert('mdc_products', {
            'chinese_name': name, 'product_type': 'finished_product'})[0]
        variant = self.store.insert('mdc_product_variants', {
            'product_id': product['id'], 'specification': '10ml', 'status': 'active'})[0]
        return product, variant

    def test_batch_replace_then_tracking_and_referenced_rollback(self):
        self.assertEqual(self.rpc('replace_contact_sheet_batches', target_contact_sheet_id='cs',
            batch_rows=[{'batch_no': ' A ', 'batch_quantity': 60, 'warehouse_date': '2026-08-01'},
                        {'batch_no': 'B', 'batch_quantity': 40}]), 2)
        batch = self.store.query('batches')[0]
        self.assertEqual(batch['batch_no'], 'A')
        self.assertEqual(self.rpc('update_batch_tracking', target_batch_id=batch['id'],
            target_warehouse_date='2026-08-02', target_release_date='2026-08-03', target_notes='  放行  '), 1)
        self.assertEqual(self.store.query('batches')[0]['notes'], '放行')
        self.rpc('create_shipment_with_items', shipment_data={'contract_id': 'c', 'shipment_no': 'A'},
                 item_rows=[self.item(10, batch=batch['id'])])
        self.assertRollback(self.rpc, 'replace_contact_sheet_batches', target_contact_sheet_id='cs', batch_rows=[])

    def test_shipment_replace_validates_and_persists_all_items(self):
        sid = self.shipment(status='准备中')
        self.assertEqual(self.rpc('replace_shipment_items', target_shipment_id=sid,
            target_payment_status='可发货', item_rows=[self.item(100)]), 1)
        saved = Store(self.store.path).query('shipments')[0]
        self.assertEqual((saved['amount'], saved['payment_check_status']), (1000, '可发货'))
        for items in ([], [self.item(101)], [self.item(10, sheet='cs3', batch=None)], [self.item(-1)]):
            self.assertRollback(self.rpc, 'replace_shipment_items', target_shipment_id=sid,
                                item_rows=items, target_payment_status='需人工确认')
        self.assertEqual(self.rpc('update_shipment_with_items', target_shipment_id=sid,
            shipment_data={'status': '已发货', 'shipment_date': '2026-08-06'},
            item_rows=[self.item(80)], target_payment_status='可发货'), 1)
        self.assertEqual(self.store.query('contact_sheets', {'id': 'eq.cs'})[0]['shipped_quantity'], 80)

    def test_group_dispatch_preserves_group_and_enforces_original_scope(self):
        gid = self.rpc('create_shipment_group_with_items', group_data={
            'customer_id': 'cu', 'shipment_no': 'G', 'status': '准备中'},
            item_rows=[self.item(20), self.item(10, 'cs2', None)],
            contract_status_rows=[{'contract_id': 'c', 'payment_check_status': '不建议发货'}])
        children = self.store.query('shipments', {'order': 'shipment_no.asc'})
        self.assertEqual([r['shipment_no'] for r in children], ['G-01', 'G-02'])
        self.assertEqual(children[0]['payment_check_status'], '不建议发货')
        self.assertRollback(self.rpc, 'replace_shipment_items', target_shipment_id=children[0]['id'], item_rows=[self.item()])
        self.assertRollback(self.rpc, 'confirm_shipment_group_dispatched', target_group_id=gid,
                            actual_shipment_date='2026-08-07', item_rows=[self.item(10, 'cs3', None)])
        self.assertEqual(self.rpc('confirm_shipment_group_dispatched', target_group_id=gid,
            actual_shipment_date='2026-08-07', actual_notes='真实数量', item_rows=[self.item(25)]), gid)
        children = self.store.query('shipments')
        self.assertEqual(len(children), 1)
        self.assertEqual((children[0]['shipment_no'], children[0]['shipment_date'], children[0]['amount']), ('G', '2026-08-07', 250))
        self.assertRollback(self.rpc, 'confirm_shipment_group_dispatched', target_group_id=gid,
                            actual_shipment_date='2026-08-08', item_rows=[self.item()])

    def test_receipt_mixed_types_history_and_return_to_deposit(self):
        rid = self.receipt()
        header = self.store.query('payment_receipts')[0]
        self.assertEqual((header['payment_type'], header['amount_rmb']), ('其他', 4200))
        self.assertEqual([p['payment_type'] for p in self.store.query('payments')], ['预付款', '尾款'])
        self.assertEqual(self.rpc('update_payment_receipt_with_allocations', target_receipt_id=rid,
            receipt_data={'total_amount': 700, 'exchange_rate': 8, 'change_reason': '核对到账'},
            allocation_rows=[{'contract_id': 'c', 'amount': 500, 'payment_type': '尾款'}]), rid)
        history = self.store.query('payment_receipt_change_history')[0]
        self.assertEqual(history['before_data']['total_amount'], 600)
        self.assertEqual(history['after_data']['allocations'][0]['amount_rmb'], 4000)
        self.assertEqual(history['reason'], '核对到账')
        pid = self.store.query('payments')[0]['id']
        self.assertEqual(self.rpc('return_payment_allocation_to_deposit', target_payment_id=pid), rid)
        self.assertEqual(self.store.query('payments'), [])
        self.assertEqual(self.store.query('payment_receipts')[0]['total_amount'], 700)
        self.assertEqual(self.store.query('payment_receipt_change_history')[-1]['action'], 'return_to_customer_deposit')

    def test_receipt_bad_allocations_do_not_modify_header_or_history(self):
        rid = self.receipt()
        bad = [[{'contract_id': 'c', 'amount': 701}],
               [{'contract_id': 'c3', 'amount': 10}],
               [{'contract_id': 'c', 'amount': 1}, {'contract_id': 'c', 'amount': 2}],
               [{'contract_id': 'c', 'amount': 1, 'payment_type': 'bad'}],
               [{'contract_id': 'c', 'amount': 'NaN'}]]
        for allocations in bad:
            self.assertRollback(self.rpc, 'update_payment_receipt_with_allocations', target_receipt_id=rid,
                                receipt_data={'total_amount': 700}, allocation_rows=allocations)
        self.assertRollback(self.rpc, 'update_payment_receipt_with_allocations', target_receipt_id=rid,
                            receipt_data={'customer_id': 'cu2', 'total_amount': 700}, allocation_rows=[])

    def test_invoice_allocation_update_keeps_identity_and_graph(self):
        sid = self.shipment()
        other = self.rpc('create_shipment_with_items', shipment_data={
            'contract_id': 'c2', 'shipment_no': 'S2', 'status': '已发货', 'shipment_date': '2026-08-06'},
            item_rows=[self.item(10, 'cs2', None)])
        iid = self.rpc('create_invoice_with_shipments', invoice_data={'amount': 500, 'status': '已申请'},
            shipment_rows=[{'shipment_id': sid, 'allocated_amount': 400}, {'shipment_id': other, 'allocated_amount': 100}])
        self.assertEqual(len(self.store.query('invoice_shipments')), 2)
        self.assertRollback(self.rpc, 'update_invoice_with_shipments', target_invoice_id=iid,
            invoice_data={'amount': 500}, shipment_rows=[{'shipment_id': sid, 'allocated_amount': 499}])
        self.assertEqual(self.rpc('update_invoice_with_shipments', target_invoice_id=iid,
            invoice_data={'amount': 400, 'invoice_date': '2026-08-09'},
            shipment_rows=[{'shipment_id': sid, 'allocated_amount': 400}]), iid)
        self.assertEqual(len(self.store.query('invoice_shipments')), 1)
        self.assertEqual(self.store.query('invoices')[0]['status'], '已收到电子发票')

    def test_physical_invoice_cif_split_and_bad_edit_roll_back_every_document(self):
        self.store.update('contracts', {'customer_id': 'eq.cu'}, {'incoterm': 'CIF'})
        gid = self.rpc('create_shipment_group_with_items', group_data={
            'customer_id': 'cu', 'shipment_no': 'CIF', 'status': '已发货', 'shipment_date': '2026-08-04'},
            item_rows=[self.item(20), self.item(10, 'cs2', None)])
        sid = self.store.query('shipments')[0]['id']
        self.assertRollback(self.rpc, 'mark_physical_shipment_invoiced', target_shipment_id=sid,
                            invoice_data={'invoice_date': '2026-08-05'})
        iid = self.rpc('mark_physical_shipment_invoiced', target_shipment_id=sid,
                      invoice_data={'invoice_date': '2026-08-05', 'freight_insurance_amount': 30})
        self.assertEqual(self.store.query('invoices')[0]['amount'], 300)
        self.assertEqual(sorted(s['freight_insurance_amount'] for s in self.store.query('shipments')), [10, 20])
        self.assertEqual(self.store.query('shipment_groups')[0]['freight_insurance_amount'], 30)
        self.assertEqual(len(self.store.query('invoice_shipments')), 2)
        self.assertRollback(self.rpc, 'mark_physical_shipment_invoiced', target_shipment_id=sid,
                            invoice_data={'invoice_date': '2026-08-05', 'freight_insurance_amount': 30})
        self.assertRollback(self.rpc, 'update_physical_shipment_invoice', target_invoice_id=iid,
                            invoice_data={'invoice_date': '2026-08-06', 'freight_insurance_amount': 300})
        self.assertEqual(self.rpc('update_physical_shipment_invoice', target_invoice_id=iid,
            invoice_data={'invoice_date': '2026-08-07', 'freight_insurance_amount': 60}), iid)
        self.assertEqual(sorted(s['freight_insurance_amount'] for s in self.store.query('shipments')), [20, 40])
        self.assertEqual(self.store.query('shipment_groups')[0]['id'], gid)

    def test_partial_invoice_cannot_be_edited_as_whole_physical_group(self):
        self.rpc('create_shipment_group_with_items', group_data={
            'customer_id': 'cu', 'shipment_no': 'G', 'status': '已发货', 'shipment_date': '2026-08-04'},
            item_rows=[self.item(20), self.item(10, 'cs2', None)])
        sid = self.store.query('shipments')[0]['id']
        iid = self.rpc('create_invoice_with_shipments', invoice_data={'amount': 200},
                      shipment_rows=[{'shipment_id': sid, 'allocated_amount': 200}])
        self.assertRollback(self.rpc, 'update_physical_shipment_invoice', target_invoice_id=iid,
                            invoice_data={'invoice_date': '2026-08-05'})

    def test_customer_merge_moves_every_reference_and_rejects_currency_mismatch(self):
        sid = self.shipment()
        iid = self.rpc('mark_physical_shipment_invoiced', target_shipment_id=sid, invoice_data={'invoice_date': '2026-08-05'})
        self.receipt()
        self.store.insert('packaging_profiles', {'product_name': '客户包装', 'customer_id': 'cu'})
        result = self.rpc('merge_customer_records', source_customer_id='cu', target_customer_id='cu2')
        self.assertEqual(result['moved_contracts'], 2)
        self.assertEqual(result['moved_payment_receipts'], 1)
        self.assertEqual(result['deleted_customers'], 1)
        self.assertEqual(self.store.query('invoices')[0]['customer_id'], 'cu2')
        self.assertEqual(self.store.query('packaging_profiles')[0]['customer_id'], 'cu2')
        self.assertEqual(self.store.query('invoices')[0]['id'], iid)
        yuan = self.store.insert('customers', {'name': '人民币演示', 'default_currency': 'RMB'})[0]
        self.assertRollback(self.rpc, 'merge_customer_records', source_customer_id='cu2', target_customer_id=yuan['id'])

    def test_global_identifier_checks_return_only_bounded_identifier_metadata(self):
        customer = self.store.insert('customers', {'name': '别人的客户', 'notes': '不应泄漏'}, user='demo-sales-2')[0]
        other = self.store.insert('contracts', {'customer_id': customer['id'], 'contract_no': 'OTHER'}, user='demo-sales-2')[0]
        result = self.rpc('get_global_contract_number_conflict', p_contract_no=' other ')
        self.assertEqual(set(result), {'owner_display_name', 'contract_no'})
        self.assertEqual(result['contract_no'], 'OTHER')
        self.assertIsNone(self.rpc('get_global_contract_number_conflict', p_contract_no='DEMO-C'))
        result = self.rpc('get_global_contact_sheet_number_conflict', p_contact_sheet_no=' demo-cs ')
        self.assertEqual(set(result), {'owner_display_name', 'contract_no', 'contact_sheet_no'})
        self.assertIsNone(self.rpc('get_global_contact_sheet_number_conflict', p_contact_sheet_no='DEMO-CS', p_exclude_contact_sheet_id='cs'))
        found = self.rpc('get_global_batch_number_conflicts', p_batch_numbers=['DEMO-B', 'demo-b', 'none'])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['contact_sheet_no'], 'DEMO-CS')
        self.assertEqual(self.rpc('get_global_batch_number_conflicts', p_batch_numbers=['DEMO-B'], p_exclude_contact_sheet_id='cs'), [])
        self.assertRollback(self.rpc, 'get_global_batch_number_conflicts', p_batch_numbers=['x'] * 501)
        self.assertEqual(self.store.query('contracts', {'id': 'eq.' + other['id']}), [])

    def test_contract_number_is_owner_unique_not_global_unique(self):
        other = self.store.insert('customers', {'name': '乙客户'}, user='demo-sales-2')[0]
        self.store.insert('contracts', {'customer_id': other['id'], 'contract_no': 'DEMO-C'}, user='demo-sales-2')
        self.assertEqual(len(self.store.query('contracts', {'contract_no': 'eq.DEMO-C'}, user='demo-manager')), 2)
        self.assertRollback(self.store.insert, 'contracts', {'customer_id': 'cu', 'contract_no': ' demo-c '})

    def test_original_currency_export_type_pair_is_preserved(self):
        self.assertRollback(self.store.update, 'contracts', {'id': 'eq.c'}, {'export_type': '转口'})

    def test_finished_product_cannot_ship_before_warehousing(self):
        self.store.update('batches', {'id': 'eq.b'}, {'warehouse_date': None})
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'actual_warehousing_date': None})
        self.assertRollback(self.rpc, 'create_shipment_with_items',
                            shipment_data={'contract_id': 'c', 'shipment_no': 'NO-STOCK',
                                           'shipment_date': '2026-08-04', 'status': '已发货'},
                            item_rows=[self.item(10)])
        # A preparation reserves capacity but is not a physical dispatch.
        self.rpc('create_shipment_with_items', shipment_data={'contract_id': 'c',
                 'shipment_no': 'PLAN', 'status': '准备中'}, item_rows=[self.item(10)])

    def test_explicit_delivery_date_does_not_request_delivery_days(self):
        self.store.update('contracts', {'id': 'eq.c'}, {
            'agreed_delivery_date': '2026-12-01', 'delivery_days': None})
        self.rpc('refresh_alerts')
        alerts = self.store.query('alerts', {'alert_type': 'eq.请填写合同交货期'})
        self.assertEqual(alerts, [])

    def test_product_revision_status_order_and_usage_counts(self):
        product, variant = self.product()
        changed = self.rpc('revise_mdc_product_variant', target_variant_id=variant['id'], replacement_specification=' 20 ml ')
        self.assertEqual(changed, {'variant_id': variant['id'], 'preserved_historical_variant': False})
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'product_variant_id': variant['id']})
        revised = self.rpc('revise_mdc_product_variant', target_variant_id=variant['id'], replacement_specification='20ML')
        self.assertTrue(revised['preserved_historical_variant'])
        self.assertRollback(self.rpc, 'set_mdc_product_variant_status', target_variant_id=variant['id'], next_status='active')
        self.rpc('set_mdc_product_variant_status', target_variant_id=revised['variant_id'], next_status='inactive')
        self.rpc('set_mdc_product_variant_status', target_variant_id=variant['id'], next_status='active')
        self.assertEqual(self.store.query('mdc_products')[0]['contact_sheet_count'], 1)
        second, _ = self.product('第二产品')
        self.rpc('set_mdc_product_display_order', product_ids=[second['id'], product['id']])
        self.assertEqual([r['id'] for r in self.store.query('mdc_products', {'order': 'manual_sort_order.asc'})], [second['id'], product['id']])
        self.assertRollback(self.rpc, 'set_mdc_product_display_order', product_ids=[second['id'], second['id']])
        self.rpc('set_mdc_product_display_order', product_ids=[])
        self.assertTrue(all(r['manual_sort_order'] is None for r in self.store.query('mdc_products')))

    def test_specification_decimal_point_and_unit_normalization(self):
        product, _ = self.product()
        self.store.insert('mdc_product_variants', {'product_id': product['id'], 'specification': '1.5mg'})
        self.store.insert('mdc_product_variants', {'product_id': product['id'], 'specification': '15mg'})
        self.assertRollback(self.store.insert, 'mdc_product_variants', {'product_id': product['id'], 'specification': '１０.０ ML'})

    def test_packaging_versions_preserve_history_and_compute_view_fields(self):
        pid = self.rpc('create_packaging_profile_with_version', profile_data={'product_name': '演示包装'},
            version_data={'quantity_per_carton': 10, 'quantity_unit': '盒/箱', 'units_per_box': 5,
                          'carton_outer_length_mm': 500, 'carton_outer_width_mm': 400, 'carton_outer_height_mm': 300})
        first = self.store.query('packaging_current_profiles')[0]
        self.assertTrue(first['packaging_code'])
        self.assertEqual(first['derived_base_units_per_carton'], 50)
        self.assertAlmostEqual(first['carton_volume_m3'], .06)
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'packaging_profile_version_id': first['version_id']})
        vid = self.rpc('create_packaging_version', target_profile_id=pid, profile_data={'workshop': '演示车间'},
                       version_data={'quantity_per_carton': 20, 'quantity_unit': '瓶/箱'})
        current = self.store.query('packaging_current_profiles')[0]
        self.assertEqual((current['version_no'], current['version_count'], current['version_id']), (2, 2, vid))
        self.assertEqual(self.store.query('contact_sheets', {'id': 'eq.cs'})[0]['packaging_profile_version_id'], first['version_id'])
        versions = self.store.query('packaging_profile_versions')
        self.assertFalse(versions[0]['is_current'])
        self.assertTrue(versions[0]['effective_to'])
        self.assertTrue(versions[1]['is_current'])
        self.assertRollback(self.rpc, 'create_packaging_version', target_profile_id=pid, profile_data={'workshop': '不应保存'},
                            version_data={'quantity_per_carton': 20, 'quantity_unit': '瓶/箱', 'carton_inner_length_mm': 100, 'carton_outer_length_mm': 50})
        issue = self.store.insert('packaging_data_issues', {'version_id': vid, 'issue_type': 'review', 'status': 'open'})[0]
        self.assertEqual(self.store.query('packaging_current_profiles')[0]['open_issue_count'], 1)
        self.rpc('resolve_packaging_issue', target_issue_id=issue['id'], note=' 人工核对完成 ')
        self.assertEqual(self.store.query('packaging_data_issues')[0]['resolution_note'], '人工核对完成')
        self.assertEqual(self.store.query('packaging_current_profiles')[0]['open_issue_count'], 0)

    def test_template_upsert_is_scoped_and_does_not_duplicate(self):
        first = self.store.insert('analysis_templates', {'name': '模板', 'filters': {'a': 1}}, params={'on_conflict': 'owner_id,name'})[0]
        self.store.insert('analysis_templates', {'name': '模板', 'filters': {'a': 2}}, params={'on_conflict': 'owner_id,name'})
        rows = self.store.query('analysis_templates')
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['id'], rows[0]['filters']), (first['id'], {'a': 2}))
        self.store.insert('analysis_templates', {'name': '模板'}, params={'on_conflict': 'owner_id,name'}, user='demo-sales-2')
        self.assertEqual(len(self.store.query('analysis_templates', user='demo-manager')), 2)

    def test_refresh_alerts_is_scoped_and_keeps_snoozes_and_completed_history(self):
        sid = self.shipment()
        self.assertGreater(self.rpc('refresh_alerts'), 0)
        invoice_alert = next(r for r in self.store.query('alerts') if r['related_id'] == sid and r['alert_type'] == '请开票')
        self.store.update('alerts', {'id': 'eq.' + invoice_alert['id']}, {'status': '稍后提醒', 'snoozed_until': '2099-01-01'})
        self.rpc('refresh_alerts')
        invoice_alerts = [r for r in self.store.query('alerts') if r['related_id'] == sid and r['alert_type'] == '请开票']
        self.assertEqual(len(invoice_alerts), 1)
        self.assertEqual(invoice_alerts[0]['status'], '稍后提醒')
        self.store.update('alerts', {'id': 'eq.' + invoice_alert['id']}, {'status': '已处理'})
        self.rpc('mark_physical_shipment_invoiced', target_shipment_id=sid, invoice_data={'invoice_date': '2026-08-05'})
        self.rpc('refresh_alerts')
        self.assertEqual(self.store.query('alerts', {'id': 'eq.' + invoice_alert['id']})[0]['status'], '已处理')
        self.assertFalse(any(r['related_id'] == 'cs2' for r in self.store.query('alerts')))
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'actual_warehousing_date': '2026-08-03'})
        self.rpc('refresh_alerts')
        self.assertFalse(any(r['related_id'] == 'cs' and r['alert_type'] == '请关注 QA 审批' and r['status'] == '未处理' for r in self.store.query('alerts')))

    def test_rpc_unknown_roles_spoofed_rows_and_cross_owner_are_rejected(self):
        self.assertRollback(self.rpc, 'unknown_action')
        for user in ('demo-manager', 'demo-owner', 'unknown'):
            self.assertRollback(self.rpc, 'refresh_alerts', user=user)
        self.assertRollback(self.rpc, 'create_shipment_with_items', shipment_data={
            'owner_id': 'demo-sales-2', 'contract_id': 'c', 'shipment_no': 'FAKE'}, item_rows=[self.item()])
        item = {**self.item(), 'owner_id': 'demo-sales-2'}
        self.assertRollback(self.rpc, 'create_shipment_with_items', shipment_data={
            'contract_id': 'c', 'shipment_no': 'FAKE'}, item_rows=[item])
        self.assertRollback(self.rpc, 'update_batch_tracking', target_batch_id='b', user='demo-sales-2',
                            target_warehouse_date=None, target_release_date=None, target_notes='越权')

    def test_metrics_owner_scope_is_validated_before_evaluation(self):
        self.assertRollback(self.rpc, 'get_operating_metrics', p_start_date='2026-08-01', p_end_date='2026-08-31', p_owner_id='demo-sales-2')
        self.assertRollback(self.rpc, 'get_operating_metrics', user='demo-manager', p_start_date='2026-08-01', p_end_date='2026-08-31', p_owner_id='unknown')

    def test_fictional_artwork_reminder_uses_25_day_boundary_and_confirmation(self):
        today = datetime.now(timezone(timedelta(hours=8))).date()
        self.store.update('customers', {'id': 'eq.cu'}, {'name': 'DEMO PACKAGING PARTNER'})
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'aps_scheduled_date': (today + timedelta(days=26)).isoformat()})
        self.rpc('refresh_alerts')
        label = '请确认 DEMO_PACKAGING 盒子制版稿'
        self.assertFalse(any(r['alert_type'] == label for r in self.store.query('alerts')))
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'aps_scheduled_date': (today + timedelta(days=25)).isoformat()})
        self.rpc('refresh_alerts')
        alerts = [r for r in self.store.query('alerts') if r['alert_type'] == label]
        self.assertEqual(len(alerts), 1)
        self.assertEqual((alerts[0]['related_id'], alerts[0]['priority']), ('cs', 'high'))
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'box_artwork_confirmed_date': today.isoformat()})
        self.rpc('refresh_alerts')
        self.assertFalse(any(r['alert_type'] == label for r in self.store.query('alerts')))

    def test_packaging_fill_ratio_and_override_match_form(self):
        version = dict(quantity_per_carton=10, quantity_unit='盒/箱', boxes_per_carton=10,
            box_inner_length_mm=100, box_inner_width_mm=100, box_inner_height_mm=100,
            carton_inner_length_mm=200, carton_inner_width_mm=200, carton_inner_height_mm=275)
        pid = self.rpc('create_packaging_profile_with_version', profile_data={'product_name': '装箱核对'}, version_data=version)
        self.assertEqual(self.store.query('packaging_current_profiles')[0]['fill_ratio'], 1.1)
        self.assertRollback(self.rpc, 'create_packaging_version', target_profile_id=pid, profile_data={},
                            version_data={**version, 'carton_inner_height_mm': 500})
        vid = self.rpc('create_packaging_version', target_profile_id=pid, profile_data={},
                      version_data={**version, 'carton_inner_height_mm': 500, 'fill_ratio_override_reason': '人工确认特例'})
        current = self.store.query('packaging_current_profiles')[0]
        self.assertEqual((current['version_id'], current['fill_ratio']), (vid, 2))
        self.assertEqual(current['fill_ratio_override_reason'], '人工确认特例')
        self.assertRollback(self.store.update, 'packaging_profile_versions', {'id': 'eq.' + vid}, {'quantity_per_carton': 500})

    def test_product_without_specification_matches_frontend_creation_flow(self):
        product = self.store.insert('mdc_products', {'chinese_name': '待补规格产品', 'product_type': 'finished_product'})[0]
        blank = self.store.insert('mdc_product_variants', {'product_id': product['id'], 'specification': '', 'status': 'active'})[0]
        changed = self.rpc('revise_mdc_product_variant', target_variant_id=blank['id'], replacement_specification='1.0 MG')
        self.assertEqual(changed['variant_id'], blank['id'])
        self.assertEqual(self.store.query('mdc_product_variants')[0]['specification'], '1mg')

    def test_contact_product_snapshot_preserves_history_and_rejects_new_inactive_link(self):
        product, variant = self.product()
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'product_variant_id': variant['id']})
        sheet = self.store.query('contact_sheets', {'id': 'eq.cs'})[0]
        self.assertEqual((sheet['product_name'], sheet['specification']), ('虚构品', '10ml'))
        self.rpc('revise_mdc_product_variant', target_variant_id=variant['id'], replacement_specification='20ml')
        self.store.update('contact_sheets', {'id': 'eq.cs'}, {'notes': '修改备注，保留历史规格'})
        self.assertEqual(self.store.query('contact_sheets', {'id': 'eq.cs'})[0]['specification'], '10ml')
        self.assertRollback(self.store.insert, 'contact_sheets', {'contract_id': 'c', 'quantity': 10,
            'unit_price': 10, 'unit': '瓶', 'product_variant_id': variant['id']})
        self.assertEqual(self.store.query('mdc_products')[0]['contact_sheet_count'], 1)

    def test_metadata_only_filters_cannot_update_or_delete_whole_table(self):
        for params in ({'on_conflict': 'name'}, {'select': '*', 'on_conflict': 'id'}):
            self.assertRollback(self.store.update, 'customers', params, {'notes': '不能批量覆盖'})
            self.assertRollback(self.store.delete, 'customers', params)

    def test_query_numeric_order_and_null_placement(self):
        product, _ = self.product()
        other, _ = self.product('未排序')
        self.store.update('mdc_products', {'id': 'eq.' + product['id']}, {'manual_sort_order': 0})
        rows = self.store.query('mdc_products', {'order': 'manual_sort_order.asc.nullslast'})
        self.assertEqual([r['id'] for r in rows], [product['id'], other['id']])

    def test_invalid_graph_references_and_nonfinite_precision_raise_api_errors(self):
        for data in ({'customer_id': [], 'contract_no': 'bad'}, {'customer_id': {'id': 'cu'}, 'contract_no': 'bad'}):
            self.assertRollback(self.store.insert, 'contracts', data)
        for value in ('1e9999', '0.0000000001'):
            self.assertRollback(self.store.insert, 'payments', {'contract_id': 'c', 'amount': value})

    def test_shipment_groups_and_invoice_primary_anchor_are_validated(self):
        self.assertRollback(self.store.insert, 'shipment_groups', {'customer_id': 'cu', 'shipment_no': 'BAD', 'status': 'invalid'})
        sid = self.shipment()
        other = self.shipment(10, number='S2')
        iid = self.rpc('create_invoice_with_shipments', invoice_data={'amount': 400},
                      shipment_rows=[{'shipment_id': sid, 'allocated_amount': 400}])
        self.assertRollback(self.store.update, 'invoices', {'id': 'eq.' + iid}, {'shipment_id': other})
        self.assertRollback(self.store.update, 'shipments', {'id': 'eq.' + sid}, {'incoterm_snapshot': 'CIF'})

    def test_freight_rpc_validates_fob_and_distributes_rounding_remainder(self):
        sid = self.shipment()
        self.assertRollback(self.rpc, 'set_physical_shipment_freight', target_shipment_id=sid, requested_freight=1)
        self.assertIsNone(self.rpc('set_physical_shipment_freight', target_shipment_id=sid, requested_freight=0))
        self.store.delete('shipments', {'id': 'eq.' + sid})
        self.store.update('contracts', {'customer_id': 'eq.cu'}, {'incoterm': 'CIF'})
        self.rpc('create_shipment_group_with_items', group_data={'customer_id': 'cu', 'shipment_no': 'ROUND', 'status': '准备中'},
                 item_rows=[self.item(20), self.item(10, 'cs2', None)])
        sid = self.store.query('shipments')[0]['id']
        self.rpc('set_physical_shipment_freight', target_shipment_id=sid, requested_freight=1)
        parts = self.store.query('shipments', {'order': 'id.asc'})
        self.assertAlmostEqual(sum(p['freight_insurance_amount'] for p in parts), 1, places=6)

    def test_receipt_derived_money_cannot_be_overridden_by_extra_amount_field(self):
        rid = self.rpc('create_payment_receipt_with_allocations', receipt_data={
            'customer_id': 'cu', 'total_amount': 600, 'amount': 1, 'exchange_rate': 7,
            'amount_rmb': 1, 'payment_type': '预付款'}, allocation_rows=[])
        self.assertEqual(self.store.query('payment_receipts', {'id': 'eq.' + rid})[0]['amount_rmb'], 4200)

    def test_parallel_shipments_cannot_overreserve_and_database_has_real_foreign_keys(self):
        barrier = Barrier(2)
        def reserve(index):
            barrier.wait(timeout=5)
            try:
                self.shipment(60, '准备中', f'CONCURRENT-{index}')
                return True
            except ApiError:
                return False
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(reserve, range(2)))
        self.assertEqual(sorted(results), [False, True])
        self.assertEqual(len(self.store.query('shipment_items')), 1)
        with self.store.connection() as connection:
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertGreater(connection.execute('SELECT count(*) FROM refs').fetchone()[0], 0)

    def test_metrics_read_uses_role_snapshot_and_costs_stay_queryable_read_only(self):
        self.shipment()
        before = self.store.snapshot()
        report = self.rpc('get_operating_metrics', p_start_date='2026-08-01', p_end_date='2026-08-31')
        self.assertEqual(report['shipments']['amount_rmb'], 2800)
        empty = self.rpc('get_operating_metrics', user='demo-manager', p_owner_id='demo-sales-2',
                         p_start_date='2026-08-01', p_end_date='2026-08-31')
        self.assertEqual(empty['shipments']['amount_rmb'], 0)
        self.assertEqual(before, self.store.snapshot())
        self.assertEqual(self.store.query('product_costs', {'select': 'unit_cost_no_tax'})[0]['unit_cost_no_tax'], 20)
        self.assertRollback(self.store.update, 'product_costs', {'id': 'eq.cost'}, {'unit_cost_no_tax': 1})

    def test_legacy_group_optional_date_and_free_text_payment_check_survive(self):
        sid = self.shipment()
        self.store.update('shipments', {'id': 'eq.' + sid}, {'payment_check_status': '已通过'})
        with self.store.transaction() as tx:
            tx.add('shipment_groups', {'id': 'legacy-group', 'customer_id': 'cu', 'currency': 'USD',
                   'incoterm': 'FOB', 'status': '已发货', 'shipment_no': 'LEGACY'})
            tx.get('shipments', sid)['shipment_group_id'] = 'legacy-group'
        self.assertEqual(Store(self.store.path).query('shipments')[0]['payment_check_status'], '已通过')

    def test_plain_query_reads_only_requested_table_with_real_sqlite_trace(self):
        statements = []
        connection = self.store.connection
        @contextmanager
        def traced_connection():
            with connection() as conn:
                conn.set_trace_callback(statements.append)
                yield conn
        self.store.connection = traced_connection
        rows = self.store.query('customers', {'id': 'eq.cu', 'select': 'id,name'})
        self.assertEqual(rows, [{'id': 'cu', 'name': '虚构客户'}])
        reads = [sql for sql in statements if sql.startswith('SELECT') and 'documents' in sql]
        self.assertEqual(len(reads), 1)
        self.assertIn("WHERE table_name='customers'", reads[0])


if __name__ == '__main__':
    unittest.main()
