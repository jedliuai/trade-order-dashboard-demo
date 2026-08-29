"""Pure local equivalents of the shipment-profit view and operating-metrics RPC.

The legacy SQL taxes *cost*, not sales, for RMB/re-export business. Period
turnover uses exact monthly rates; profit and closing balances use the latest
nonfuture rate. The demo requires an exact invoice-month cost: missing costs
remain NULL, never an invented or silently confirmed fallback.
"""
from collections import defaultdict
from datetime import date
from decimal import Decimal

from .store import ApiError, SHARED


ZERO = Decimal(0)


def _decimal(value):
    return ZERO if value is None or value == '' else Decimal(str(value))


def _value(value):
    return None if value is None else float(value)


def _index(rows, table):
    return {row['id']: row for row in rows.get(table, [])}


def _item_amount(item):
    stored = _decimal(item.get('amount'))
    return stored if stored > 0 else _decimal(item.get('shipped_quantity')) * _decimal(item.get('unit_price'))


class _Rates:
    def __init__(self, rows):
        self.by_owner = defaultdict(dict)
        for row in rows.get('exchange_rates', []):
            if row.get('currency_pair') == 'USD/CNY' and _decimal(row.get('rate')) > 0:
                self.by_owner[row.get('owner_id')][row['effective_month']] = _decimal(row['rate'])
        self.cache = {}

    def get(self, owner, month, latest=False):
        key = (owner, month, latest)
        if key not in self.cache:
            rates = {**self.by_owner[SHARED], **self.by_owner[owner]}
            if latest:
                prior = [m for m in rates if m <= month]
                self.cache[key] = rates[max(prior)] if prior else None
            else:
                self.cache[key] = rates.get(month)
        return self.cache[key]


def shipment_profits(rows) -> list:
    """One row per invoiced, dispatched shipment item, with frontend metadata."""
    contracts, customers = _index(rows, 'contracts'), _index(rows, 'customers')
    sheets, batches = _index(rows, 'contact_sheets'), _index(rows, 'batches')
    groups = _index(rows, 'shipment_groups')
    items = defaultdict(list)
    for item in rows.get('shipment_items', []):
        items[item['shipment_id']].append(item)
    links = defaultdict(list)
    for link in rows.get('invoice_shipments', []):
        links[link['invoice_id']].append(link['shipment_id'])
    invoice_dates = defaultdict(list)
    for invoice in rows.get('invoices', []):
        if invoice.get('invoice_date'):
            for shipment_id in links[invoice['id']] or [invoice.get('shipment_id')]:
                invoice_dates[shipment_id].append(invoice['invoice_date'])
    costs = {}
    for cost in rows.get('product_costs', []):
        key = (cost.get('owner_id'), str(cost.get('material_no', '')).strip().upper(), cost.get('cost_month'))
        costs[key] = cost
    rates = _Rates(rows)
    result = []
    for shipment in rows.get('shipments', []):
        if shipment.get('status') != '已发货' or not invoice_dates[shipment['id']]:
            continue
        contract = contracts.get(shipment.get('contract_id'))
        if contract is None:
            continue
        customer = customers.get(contract.get('customer_id'), {})
        group = groups.get(shipment.get('shipment_group_id'), {})
        month = min(invoice_dates[shipment['id']])[:7]
        owner = shipment.get('owner_id')
        currency = contract.get('currency', 'USD')
        terms = (shipment.get('incoterm_snapshot') or contract.get('incoterm') or 'FOB') if currency == 'USD' else None
        is_cif = currency == 'USD' and terms == 'CIF'
        rate = rates.get(owner, month, latest=True)
        shipment_items = items[shipment['id']]
        total = sum((_item_amount(item) for item in shipment_items), ZERO)
        for item in shipment_items:
            sheet = sheets.get(item.get('contact_sheet_id'))
            if sheet is None:
                continue
            batch = batches.get(item.get('batch_id'), {})
            material = str(item.get('material_no') or '').strip() or str(sheet.get('material_no') or '').strip()
            cost = costs.get((owner, material.upper(), month)) or costs.get((SHARED, material.upper(), month))
            unit_cost = _decimal(cost['unit_cost_no_tax']) if cost and cost.get('unit_cost_no_tax') is not None else None
            quantity, price = _decimal(item.get('shipped_quantity')), _decimal(item.get('unit_price'))
            sales = _item_amount(item)
            freight = _decimal(shipment.get('freight_insurance_amount')) * sales / total if is_cif and total > 0 else ZERO
            sales_rmb = (sales * rate if rate is not None else None) if currency == 'USD' else sales
            basis = ((sales - freight) * rate if rate is not None else None) if currency == 'USD' else sales
            taxed_cost = contract.get('export_type') == '转口' or currency == 'RMB'
            cost_total = unit_cost * quantity * (Decimal('1.13') if taxed_cost else Decimal(1)) if unit_cost is not None else None
            missing = unit_cost is None or (currency == 'USD' and rate is None) or (is_cif and shipment.get('freight_insurance_amount') is None)
            profit = None if missing else price * quantity - cost_total if taxed_cost else basis - cost_total
            result.append({
                'shipment_id': shipment['id'], 'owner_id': owner,
                'shipment_no': group.get('shipment_no') or shipment.get('shipment_no', ''),
                'shipment_date': shipment.get('shipment_date'), 'contract_no': contract.get('contract_no', ''),
                'customer_name': customer.get('name', ''), 'export_type': contract.get('export_type', '自营'),
                'currency': currency, 'contact_sheet_no': sheet.get('contact_sheet_no', ''),
                'batch_no': batch.get('batch_no'), 'material_no': material,
                'product_name': sheet.get('product_name', ''), 'specification': sheet.get('specification', ''),
                'unit': sheet.get('unit', ''), 'shipped_quantity': _value(quantity), 'unit_price': _value(price),
                'sales_amount': _value(sales), 'invoice_month': month,
                'cost_month': cost.get('cost_month') if cost else None,
                'unit_cost': _value(unit_cost), 'exchange_rate': _value(rate),
                'sales_amount_rmb': _value(sales_rmb), 'profit': _value(profit),
                'gross_margin': _value(profit / basis) if profit is not None and basis else None,
                'is_estimated_profit': bool(missing), 'incoterm': terms,
                'cif_amount': _value(sales) if is_cif else None,
                'freight_insurance_amount': _value(freight) if is_cif else None,
                'fob_amount': _value(sales - freight) if currency == 'USD' else None,
                'freight_insurance_rmb': _value(freight * rate) if currency == 'USD' and rate is not None else None,
                'profit_basis_amount_rmb': _value(basis), 'product_cost_total_rmb': _value(cost_total),
            })
    return result


def _payment_events(rows, contracts, owner_id):
    events, known, orphaned = [], set(), defaultdict(list)
    for receipt in rows.get('payment_receipts', []):
        if owner_id is not None and receipt.get('owner_id') != owner_id:
            continue
        known.add(receipt['id'])
        events.append({**receipt, 'amount': receipt.get('total_amount')})
    for payment in rows.get('payments', []):
        if owner_id is not None and payment.get('owner_id') != owner_id:
            continue
        contract = contracts.get(payment.get('contract_id'))
        if contract is None:
            continue
        if payment.get('receipt_id') in known:
            continue
        event = {**payment, 'customer_id': contract['customer_id'],
                 'currency': payment.get('currency') or contract.get('currency', 'USD')}
        if payment.get('receipt_id'):
            orphaned[(payment.get('owner_id'), payment['receipt_id'], contract['customer_id'], event['currency'])].append(event)
        else:
            events.append(event)
    for parts in orphaned.values():
        dates = [p['payment_date'] for p in parts if p.get('payment_date')]
        events.append({**parts[0], 'payment_date': min(dates) if dates else None,
            'amount': sum((_decimal(p.get('amount')) for p in parts), ZERO),
            'amount_rmb': None if any(p.get('amount_rmb') is None for p in parts)
                else sum((_decimal(p['amount_rmb']) for p in parts), ZERO)})
    return events


def operating_metrics(rows, start_date, end_date, owner_id=None) -> dict:
    """RPC-compatible KPI payload. Access authorization remains Store's job."""
    try:
        start = date.fromisoformat(start_date) if isinstance(start_date, str) else start_date
        end = date.fromisoformat(end_date) if isinstance(end_date, str) else end_date
        if not isinstance(start, date) or not isinstance(end, date) or start > end:
            raise ValueError()
    except (TypeError, ValueError):
        raise ApiError('经营指标统计日期范围无效') from None
    start_text, end_text = start.isoformat(), end.isoformat()
    start_month, end_month = start_text[:7], end_text[:7]
    rates, missing_months = _Rates(rows), set()
    contracts = _index(rows, 'contracts')
    selected_contracts = {key: c for key, c in contracts.items() if owner_id is None or c.get('owner_id') == owner_id}

    def in_period(value):
        return bool(value and start_text <= value <= end_text)

    def metric(events, count, use_paid_rmb=False):
        total = dict(count=count, original_usd=ZERO, original_rmb=ZERO, amount_rmb=ZERO)
        for event in events:
            amount, currency = _decimal(event.get('amount')), event.get('currency')
            if currency == 'RMB':
                total['original_rmb'] += amount
                total['amount_rmb'] += amount
            elif currency == 'USD':
                total['original_usd'] += amount
                month = event['business_date'][:7]
                rate = rates.get(event.get('owner_id'), month)
                if use_paid_rmb and event.get('amount_rmb') is not None:
                    total['amount_rmb'] += _decimal(event['amount_rmb'])
                elif rate is not None:
                    total['amount_rmb'] += amount * rate
                else:
                    missing_months.add(month)
        return {key: value if key == 'count' else _value(value) for key, value in total.items()}

    period_contracts = {key: c for key, c in selected_contracts.items() if in_period(c.get('contract_date'))}
    order_events = []
    for sheet in rows.get('contact_sheets', []):
        contract = period_contracts.get(sheet.get('contract_id'))
        if contract and (owner_id is None or sheet.get('owner_id') == owner_id):
            order_events.append({**contract, 'amount': _decimal(sheet.get('quantity')) * _decimal(sheet.get('unit_price')),
                                 'business_date': contract['contract_date']})
    orders = metric(order_events, len(period_contracts))
    payment_events = _payment_events(rows, contracts, owner_id)
    period_payments = [{**p, 'business_date': p['payment_date']} for p in payment_events
                       if in_period(p.get('payment_date')) and _decimal(p.get('amount')) > 0]
    payments = metric(period_payments, len(period_payments), use_paid_rmb=True)
    shipment_totals = defaultdict(Decimal)
    for item in rows.get('shipment_items', []):
        if owner_id is None or item.get('owner_id') == owner_id:
            shipment_totals[item['shipment_id']] += _item_amount(item)
    shipment_events = []
    for shipment in rows.get('shipments', []):
        contract = selected_contracts.get(shipment.get('contract_id'))
        if not contract or shipment.get('status') != '已发货' or (owner_id is not None and shipment.get('owner_id') != owner_id):
            continue
        shipment_events.append({**shipment, 'customer_id': contract['customer_id'], 'currency': contract.get('currency'),
            'amount': shipment_totals[shipment['id']], 'business_date': shipment.get('shipment_date'),
            'physical_id': shipment.get('shipment_group_id') or shipment['id']})
    period_shipments = [s for s in shipment_events if in_period(s['business_date'])]
    shipments = metric(period_shipments, len({s['physical_id'] for s in period_shipments}))
    profit = sum((_decimal(p['profit']) for p in shipment_profits(rows)
                 if (owner_id is None or p['owner_id'] == owner_id)
                 and start_month <= p['invoice_month'] <= end_month
                 and not p['is_estimated_profit'] and p['profit'] is not None
                 and p['profit_basis_amount_rmb'] is not None), ZERO)
    balances = defaultdict(lambda: defaultdict(Decimal))
    for event, sign, date_field in [(s, 1, 'business_date') for s in shipment_events] + [(p, -1, 'payment_date') for p in payment_events]:
        if event.get(date_field) and event[date_field] <= end_text and _decimal(event.get('amount')) > 0:
            balances[(event.get('owner_id'), event['customer_id'])][event.get('currency')] += sign * _decimal(event['amount'])
    balance_summary = dict(customer_owes_rmb=ZERO, we_owe_customer_rmb=ZERO,
        customer_owes_count=0, we_owe_customer_count=0, balanced_count=0,
        missing_rate_count=0, currency_conflict_count=0)
    for (owner, _), currencies in balances.items():
        if len(currencies) > 1:
            balance_summary['currency_conflict_count'] += 1
            continue
        currency, amount = next(iter(currencies.items()))
        rate = rates.get(owner, end_month, latest=True) if currency == 'USD' else Decimal(1)
        if rate is None:
            balance_summary['missing_rate_count'] += 1
            missing_months.add(end_month)
            continue
        if amount > 0:
            balance_summary['customer_owes_rmb'] += amount * rate
        elif amount < 0:
            balance_summary['we_owe_customer_rmb'] += abs(amount) * rate
        if amount > Decimal('.01'):
            balance_summary['customer_owes_count'] += 1
        elif amount < Decimal('-.01'):
            balance_summary['we_owe_customer_count'] += 1
        else:
            balance_summary['balanced_count'] += 1
    return {'period': {'start_date': start_text, 'end_date': end_text},
        'orders': orders, 'payments': payments, 'shipments': shipments,
        'confirmed_profit_rmb': _value(profit),
        'customer_balance': {k: _value(v) if isinstance(v, Decimal) else v for k, v in balance_summary.items()},
        'missing_rate_months': sorted(missing_months)}
