"""Atomic batch, single shipment, and physical shipment-group actions."""
from collections import defaultdict
from .store import ApiError, iso_date
from .action_common import object_data, row_list, owned, update, trimmed, remove_children


def replace_contact_sheet_batches(tx, target_contact_sheet_id, batch_rows):
    owned(tx, 'contact_sheets', target_contact_sheet_id)
    batches = row_list(batch_rows, tx.user, nonempty=False)
    remove_children(tx, 'batches', 'contact_sheet_id', target_contact_sheet_id)
    for row in batches:
        row['batch_no'] = trimmed(row.get('batch_no'), True)
        tx.add('batches', {**row, 'contact_sheet_id': target_contact_sheet_id})
    return len(batches)


def update_batch_tracking(tx, target_batch_id, target_warehouse_date=None, target_release_date=None, target_notes=None):
    batch = owned(tx, 'batches', target_batch_id)
    update(batch, dict(warehouse_date=target_warehouse_date or None,
                       release_date=target_release_date or None, notes=trimmed(target_notes)))
    return 1


def add_items(tx, shipment, item_rows):
    items = row_list(item_rows, tx.user)
    for item in items:
        sheet = owned(tx, 'contact_sheets', item.get('contact_sheet_id'))
        if sheet['contract_id'] != shipment['contract_id']:
            raise ApiError('发货明细不属于当前合同')
        if item.get('batch_id'):
            owned(tx, 'batches', item['batch_id'])
        item['batch_id'] = item.get('batch_id') or None
        item['material_no'] = item.get('material_no') or sheet.get('material_no', '')
        tx.add('shipment_items', {**item, 'shipment_id': shipment['id']})
    return len(items)


def create_shipment_with_items(tx, shipment_data, item_rows):
    data = object_data(shipment_data, tx.user)
    contract = owned(tx, 'contracts', data.get('contract_id'))
    if data.get('shipment_group_id'):
        raise ApiError('合并发货必须通过整单动作创建')
    data['shipment_no'] = trimmed(data.get('shipment_no'), True)
    data['incoterm_snapshot'] = contract['incoterm']
    data.setdefault('payment_check_status', '需人工确认')
    shipment = tx.add('shipments', data)
    add_items(tx, shipment, item_rows)
    return shipment['id']


def replace_shipment_items(tx, target_shipment_id, item_rows, target_payment_status='需人工确认'):
    shipment = owned(tx, 'shipments', target_shipment_id)
    if shipment.get('shipment_group_id'):
        raise ApiError('合并发货必须整单维护')
    remove_children(tx, 'shipment_items', 'shipment_id', target_shipment_id)
    count = add_items(tx, shipment, item_rows)
    update(shipment, {'payment_check_status': target_payment_status})
    return count


def update_shipment_with_items(tx, target_shipment_id, shipment_data, item_rows, target_payment_status='需人工确认'):
    shipment = owned(tx, 'shipments', target_shipment_id)
    data = object_data(shipment_data, tx.user)
    if set(data) - {'shipment_no', 'shipment_date', 'status', 'notes'}:
        raise ApiError('发货编辑不能改变合同、分组或贸易术语快照')
    if 'shipment_no' in data:
        data['shipment_no'] = trimmed(data['shipment_no'], True)
    update(shipment, data)
    return replace_shipment_items(tx, target_shipment_id, item_rows, target_payment_status)


def grouped_items(tx, customer_id, items, currency=None, incoterm=None):
    owned(tx, 'customers', customer_id)
    grouped = defaultdict(list)
    for item in row_list(items, tx.user):
        sheet = owned(tx, 'contact_sheets', item.get('contact_sheet_id'))
        contract = owned(tx, 'contracts', sheet['contract_id'])
        if not grouped and currency is None:
            currency, incoterm = contract['currency'], contract['incoterm']
        if (contract['customer_id'], contract['currency'], contract['incoterm']) != (customer_id, currency, incoterm):
            raise ApiError('合并发货明细必须属于同一客户、币种和贸易术语')
        grouped[contract['id']].append(item)
    return grouped, currency, incoterm


def add_group_children(tx, group, grouped, contract_status_rows):
    statuses = {}
    for row in row_list(contract_status_rows, tx.user, nonempty=False):
        if row.get('contract_id') not in grouped or row['contract_id'] in statuses:
            raise ApiError('付款核对状态必须对应不同的有效发货合同')
        statuses[row['contract_id']] = row.get('payment_check_status', '需人工确认')
    contracts = sorted((owned(tx, 'contracts', id) for id in grouped), key=lambda c: (c['contract_no'], c['id']))
    for index, contract in enumerate(contracts, 1):
        shipment = tx.add('shipments', {
            'shipment_group_id': group['id'], 'contract_id': contract['id'],
            'shipment_no': group['shipment_no'] if len(contracts) == 1 else f"{group['shipment_no']}-{index:02}",
            'shipment_date': group.get('shipment_date'), 'status': group['status'],
            'incoterm_snapshot': group['incoterm'], 'notes': group.get('notes'),
            'payment_check_status': statuses.get(contract['id'], '需人工确认'),
        })
        add_items(tx, shipment, grouped[contract['id']])


def create_shipment_group_with_items(tx, group_data, item_rows, contract_status_rows=None):
    data = object_data(group_data, tx.user)
    grouped, currency, incoterm = grouped_items(tx, data.get('customer_id'), item_rows)
    data.update(shipment_no=trimmed(data.get('shipment_no'), True), currency=currency, incoterm=incoterm)
    data.setdefault('status', '已发货')
    group = tx.add('shipment_groups', data)
    add_group_children(tx, group, grouped, contract_status_rows or [])
    return group['id']


def confirm_shipment_group_dispatched(tx, target_group_id, actual_shipment_date, item_rows,
                                     contract_status_rows=None, actual_notes=None):
    group = owned(tx, 'shipment_groups', target_group_id)
    if group['status'] != '准备中':
        raise ApiError('只有准备中的发货安排可以确认实际发货')
    iso_date(actual_shipment_date, '实际发货日期')
    grouped, _, _ = grouped_items(tx, group['customer_id'], item_rows, group['currency'], group['incoterm'])
    ids = {s['id'] for s in tx.rows['shipments'] if s.get('shipment_group_id') == group['id']}
    if any(i['shipment_id'] in ids for i in tx.rows['invoices']) or any(i['shipment_id'] in ids for i in tx.rows['invoice_shipments']):
        raise ApiError('发货安排已有开票记录，不能重新确认')
    remove_children(tx, 'shipments', 'shipment_group_id', group['id'])
    update(group, {'status': '已发货', 'shipment_date': actual_shipment_date,
                   'notes': actual_notes if actual_notes is not None else group.get('notes')})
    add_group_children(tx, group, grouped, contract_status_rows or [])
    return group['id']
