"""Receipts, allocation audit, invoices and six-decimal CIF freight allocation."""
import copy
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from .store import ApiError, amount, iso_date, normalize_validate, number, now
from .action_common import object_data, row_list, owned, update, trimmed, remove_children


def receipt_snapshot(tx, receipt):
    return copy.deepcopy({**receipt, 'allocations': [p for p in tx.rows['payments'] if p.get('receipt_id') == receipt['id']]})


def receipt_history(tx, receipt, before, action, reason):
    # Capture the normalized financial result, not caller-supplied amount_rmb.
    normalize_validate(tx.rows)
    tx.add('payment_receipt_change_history', {
        'receipt_id': receipt['id'], 'action': action, 'changed_at': now(),
        'before_data': before, 'after_data': receipt_snapshot(tx, receipt), 'reason': reason,
    })


def write_receipt_allocations(tx, receipt, allocation_rows, fallback_type):
    allocations = row_list(allocation_rows, tx.user, nonempty=False)
    types = set()
    for data in allocations:
        contract = owned(tx, 'contracts', data.get('contract_id'))
        if contract['customer_id'] != receipt['customer_id'] or contract['currency'] != receipt['currency']:
            raise ApiError('合同分摊必须属于收款客户和币种')
        payment_type = data.get('payment_type') or fallback_type or '其他'
        types.add(payment_type)
        tx.add('payments', {
            **data, 'receipt_id': receipt['id'], 'currency': receipt['currency'],
            'payment_date': receipt['payment_date'], 'payment_type': payment_type,
            'exchange_rate': receipt.get('exchange_rate'), 'notes': receipt.get('notes'),
        })
    receipt['payment_type'] = next(iter(types)) if len(types) == 1 else '其他'


def create_payment_receipt_with_allocations(tx, receipt_data, allocation_rows):
    data = object_data(receipt_data, tx.user)
    customer = owned(tx, 'customers', data.get('customer_id'))
    data.setdefault('currency', customer['default_currency'])
    data['payment_date'] = data.get('payment_date') or date.today().isoformat()
    data['receipt_no'] = trimmed(data.get('receipt_no'))
    receipt = tx.add('payment_receipts', data)
    write_receipt_allocations(tx, receipt, allocation_rows, data.get('payment_type'))
    return receipt['id']


def update_payment_receipt_with_allocations(tx, target_receipt_id, receipt_data, allocation_rows):
    receipt = owned(tx, 'payment_receipts', target_receipt_id)
    data = object_data(receipt_data, tx.user)
    if data.get('customer_id', receipt['customer_id']) != receipt['customer_id']:
        raise ApiError('编辑整笔收款不能变更客户')
    before = receipt_snapshot(tx, receipt)
    reason = trimmed(data.pop('change_reason', None)) or '编辑整笔收款及合同分摊'
    if 'receipt_no' in data:
        data['receipt_no'] = trimmed(data['receipt_no'])
    update(receipt, data)
    receipt['payment_date'] = receipt.get('payment_date') or date.today().isoformat()
    remove_children(tx, 'payments', 'receipt_id', receipt['id'])
    write_receipt_allocations(tx, receipt, allocation_rows, data.get('payment_type'))
    receipt_history(tx, receipt, before, 'update', reason)
    return receipt['id']


def return_payment_allocation_to_deposit(tx, target_payment_id):
    payment = owned(tx, 'payments', target_payment_id)
    if not payment.get('receipt_id'):
        raise ApiError('该记录不属于整笔收款中的合同分摊')
    receipt = owned(tx, 'payment_receipts', payment['receipt_id'])
    before = receipt_snapshot(tx, receipt)
    contract = owned(tx, 'contracts', payment['contract_id'])
    tx.remove('payments', payment['id'])
    receipt_history(tx, receipt, before, 'return_to_customer_deposit',
                    f"撤回合同 {contract['contract_no']} 的分摊，退回客户预存款")
    return receipt['id']


def invoice_parts(tx, shipment_rows):
    parts = row_list(shipment_rows, tx.user)
    shipments = [owned(tx, 'shipments', r.get('shipment_id')) for r in parts]
    if len({s['id'] for s in shipments}) != len(parts):
        raise ApiError('发票关联项必须是不同的已发货记录')
    if any(s['status'] != '已发货' for s in shipments):
        raise ApiError('发票只能关联已发货记录')
    contracts = [owned(tx, 'contracts', s['contract_id']) for s in shipments]
    if len({(c['customer_id'], c['currency']) for c in contracts}) != 1:
        raise ApiError('一张发票只能覆盖同一客户、币种的发货记录')
    return parts, min(s['id'] for s in shipments)


def create_invoice_with_shipments(tx, invoice_data, shipment_rows):
    data = object_data(invoice_data, tx.user)
    parts, primary = invoice_parts(tx, shipment_rows)
    data['shipment_id'] = primary
    data['invoice_no'] = trimmed(data.get('invoice_no'))
    invoice = tx.add('invoices', data)
    for part in parts:
        tx.add('invoice_shipments', {**part, 'invoice_id': invoice['id']})
    return invoice['id']


def update_invoice_with_shipments(tx, target_invoice_id, invoice_data, shipment_rows):
    invoice = owned(tx, 'invoices', target_invoice_id)
    data = object_data(invoice_data, tx.user)
    parts, primary = invoice_parts(tx, shipment_rows)
    data['shipment_id'] = primary
    if 'invoice_no' in data:
        data['invoice_no'] = trimmed(data['invoice_no'])
    # Derived customer/currency fields follow the new primary shipment.
    contract = owned(tx, 'contracts', owned(tx, 'shipments', primary)['contract_id'])
    data.update(customer_id=contract['customer_id'], currency=contract['currency'])
    update(invoice, data)
    remove_children(tx, 'invoice_shipments', 'invoice_id', invoice['id'])
    for part in parts:
        tx.add('invoice_shipments', {**part, 'invoice_id': invoice['id']})
    return invoice['id']


def physical_shipments(tx, shipment_id):
    shipment = owned(tx, 'shipments', shipment_id)
    group_id = shipment.get('shipment_group_id')
    if group_id:
        owned(tx, 'shipment_groups', group_id)
        return sorted((owned(tx, 'shipments', s['id']) for s in tx.rows['shipments']
                       if s.get('shipment_group_id') == group_id), key=lambda s: s['id'])
    return [shipment]


def set_physical_shipment_freight(tx, target_shipment_id, requested_freight):
    shipments = physical_shipments(tx, target_shipment_id)
    terms = set()
    totals = {}
    for shipment in shipments:
        contract = owned(tx, 'contracts', shipment['contract_id'])
        terms.add((contract['currency'], shipment.get('incoterm_snapshot', contract['incoterm'])))
        totals[shipment['id']] = sum((number(i['shipped_quantity']) * number(i['unit_price'])
            for i in tx.rows['shipment_items'] if i['shipment_id'] == shipment['id']), Decimal(0))
    if len(terms) != 1:
        raise ApiError('同一物理发货的币种、贸易术语不一致')
    total = sum(totals.values(), Decimal(0))
    if total <= 0:
        raise ApiError('发货没有有效金额')
    currency, incoterm = next(iter(terms))
    if (currency, incoterm) == ('USD', 'CIF'):
        freight = number(requested_freight, '整笔运保费', True).quantize(Decimal('.000001'), rounding=ROUND_HALF_UP)
        if freight <= 0 or freight >= total:
            raise ApiError('整笔运保费必须大于 0 且小于 CIF 发货金额')
    else:
        if requested_freight is not None and number(requested_freight) != 0:
            raise ApiError('只有美元 CIF 发货可以填写运保费')
        freight = None
    allocated = Decimal(0)
    for index, shipment in enumerate(shipments):
        part = None if freight is None else freight - allocated if index == len(shipments) - 1 else (
            freight * totals[shipment['id']] / total).quantize(Decimal('.000001'), rounding=ROUND_HALF_UP)
        if part is not None:
            allocated += part
        update(shipment, {'freight_insurance_amount': amount(part) if part is not None else None})
    group_id = shipments[0].get('shipment_group_id')
    if group_id:
        update(owned(tx, 'shipment_groups', group_id), {'freight_insurance_amount': amount(freight) if freight is not None else None})
    return None


def mark_physical_shipment_invoiced(tx, target_shipment_id, invoice_data):
    data = object_data(invoice_data, tx.user)
    iso_date(data.get('invoice_date'), '开票日期')
    shipments = physical_shipments(tx, target_shipment_id)
    ids = {s['id'] for s in shipments}
    if any(s['status'] != '已发货' for s in shipments):
        raise ApiError('只有整笔已发货的记录才能确认开票')
    if any(i['shipment_id'] in ids for i in tx.rows['invoices']) or any(i['shipment_id'] in ids for i in tx.rows['invoice_shipments']):
        raise ApiError('这笔发货已有开票记录', 409)
    set_physical_shipment_freight(tx, target_shipment_id, data.pop('freight_insurance_amount', None))
    parts = [{'shipment_id': s['id'], 'allocated_amount': s['amount']} for s in shipments]
    data['amount'] = amount(sum(number(p['allocated_amount']) for p in parts))
    data['status'] = '已收到电子发票'
    return create_invoice_with_shipments(tx, data, parts)


def update_physical_shipment_invoice(tx, target_invoice_id, invoice_data):
    invoice = owned(tx, 'invoices', target_invoice_id)
    data = object_data(invoice_data, tx.user)
    iso_date(data.get('invoice_date'), '开票日期')
    shipments = physical_shipments(tx, invoice['shipment_id'])
    ids = {s['id'] for s in shipments}
    links = [i for i in tx.rows['invoice_shipments'] if i['invoice_id'] == invoice['id']]
    if ids != {i['shipment_id'] for i in links}:
        raise ApiError('发票与物理发货关联不完整，不能整笔修改')
    if set(data) - {'invoice_no', 'invoice_date', 'notes', 'freight_insurance_amount'}:
        raise ApiError('整笔开票编辑不能改变发货关联或金额')
    set_physical_shipment_freight(tx, invoice['shipment_id'], data.pop('freight_insurance_amount', None))
    if 'invoice_no' in data:
        data['invoice_no'] = trimmed(data['invoice_no'])
    update(invoice, {**data, 'status': '已收到电子发票'})
    return invoice['id']
