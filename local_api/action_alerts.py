"""Local business reminders; no APS, mailbox, or other remote data sources."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from .store import number, iso_date
from .action_common import update


ALERT_TYPES = {
    '请填写合同交货期', '请填写 / 提起联系单', '请关注 QA 审批',
    '请协调生产，防止晚交货', '请跟进客户付款并准备发货单据',
    '请检查放行情况', '请开票', '请催收货款', '请核对批次数量',
    '请确认 DEMO_PACKAGING 盒子制版稿',
}


def refresh_alerts(tx):
    today = datetime.now(timezone(timedelta(hours=8))).date()
    rows = {t: [r for r in rs if r['owner_id'] == tx.user] for t, rs in tx.rows.items()}
    sheets_by_contract, payments_by_contract = defaultdict(list), defaultdict(list)
    for sheet in rows['contact_sheets']:
        sheets_by_contract[sheet['contract_id']].append(sheet)
    for payment in rows['payments']:
        payments_by_contract[payment['contract_id']].append(payment)
    invoices = {i['id']: i for i in rows['invoices']}
    customers = {c['id']: c for c in rows['customers']}
    invoiced_amounts = defaultdict(Decimal)
    links_by_invoice = defaultdict(list)
    for link in rows['invoice_shipments']:
        links_by_invoice[link['invoice_id']].append(link)
    for invoice in invoices.values():
        if not invoice.get('invoice_date'):
            continue
        links = links_by_invoice[invoice['id']] or [{
            'shipment_id': invoice['shipment_id'], 'allocated_amount': invoice['amount']}]
        for link in links:
            invoiced_amounts[link['shipment_id']] += Decimal(str(link['allocated_amount']))
    completed = {shipment['id'] for shipment in rows['shipments']
                 if invoiced_amounts[shipment['id']] >= Decimal(str(shipment.get('amount') or 0)) - Decimal('.01')}
    wanted = {}

    def add(type, related_type, row, message, priority='medium'):
        wanted[(type, related_type, row['id'])] = {
            'alert_type': type, 'related_type': related_type, 'related_id': row['id'],
            'priority': priority, 'message': message, 'status': '未处理',
        }

    for contract in rows['contracts']:
        if contract.get('is_historical') or contract.get('archived'):
            continue
        sheets = sheets_by_contract[contract['id']]
        production = [s for s in sheets if s.get('business_type') != '原料药' and not s.get('is_historical')]
        payments = payments_by_contract[contract['id']]
        total = sum((number(s['quantity']) * number(s['unit_price']) for s in sheets), Decimal(0))
        paid = sum((number(p['amount']) for p in payments), Decimal(0))
        prep = min((p['payment_date'] for p in payments if p.get('payment_type') == '预付款' and p.get('payment_date')), default=None)
        if (production or not sheets) and not contract.get('delivery_days') and not contract.get('agreed_delivery_date'):
            add('请填写合同交货期', 'contract', contract, f"{contract['contract_no']} 缺少合同交货期天数。")
        due = contract.get('agreed_delivery_date')
        if not due and prep and contract.get('packaging_confirmed_date') and contract.get('delivery_days'):
            due = (max(iso_date(prep), iso_date(contract['packaging_confirmed_date'])) + timedelta(days=int(contract['delivery_days']))).isoformat()
        for sheet in production:
            label = sheet.get('contact_sheet_no') or sheet.get('product_name') or '联系单'
            if not sheet.get('contact_sheet_no') and prep and contract.get('packaging_confirmed_date'):
                add('请填写 / 提起联系单', 'contact_sheet', sheet, f'{label} 尚未填写联系单号。')
            if sheet.get('contact_sheet_no') and not any(sheet.get(k) for k in (
                    'qa_approval_date', 'scheduled_date', 'aps_scheduled_date', 'actual_warehousing_date', 'actual_release_date')):
                add('请关注 QA 审批', 'contact_sheet', sheet, f'{label} QA 审批日期尚未回填。')
            scheduled = sheet.get('scheduled_date') or sheet.get('aps_scheduled_date')
            if (customers[contract['customer_id']]['name'].strip().upper() == 'DEMO PACKAGING PARTNER'
                    and scheduled and not sheet.get('actual_release_date') and not sheet.get('box_artwork_confirmed_date')
                    and today >= iso_date(scheduled) - timedelta(days=25)):
                add('请确认 DEMO_PACKAGING 盒子制版稿', 'contact_sheet', sheet,
                    f'{label} 盒子制版稿尚未确认；手工排产日 {scheduled}，提前 25 天提醒。', 'high')
            if due and scheduled and iso_date(scheduled) > iso_date(due) + timedelta(days=15):
                add('请协调生产，防止晚交货', 'contact_sheet', sheet, f'{label} 手工排产日期晚于应交货日期超过 15 天。', 'high')
            if sheet.get('estimated_release_date') and iso_date(sheet['estimated_release_date']) <= today and not sheet.get('actual_release_date'):
                add('请检查放行情况', 'contact_sheet', sheet, f'{label} 已到预计放行日期，实际放行日期尚未回填。')
            terms = str(contract.get('payment_terms') or '').lower()
            blocked = ('30%' in terms and '70%' in terms and ('发货前' in terms or 'shipment' in terms) and paid < total)
            blocked |= ('40%' in terms and '60%' in terms and any(k in terms for k in ('提单', 'bl', 'b/l')) and paid < total * Decimal('.4'))
            if sheet.get('actual_warehousing_date') and not sheet.get('actual_release_date') and blocked:
                add('请跟进客户付款并准备发货单据', 'contact_sheet', sheet, f'{label} 已入库，收款不足以满足发货前付款条件。', 'high')
            batches = [b for b in rows['batches'] if b['contact_sheet_id'] == sheet['id']]
            if batches and sum(number(b['batch_quantity']) for b in batches) != number(sheet['quantity']):
                add('请核对批次数量', 'contact_sheet', sheet, f'{label} 批次合计与联系单数量不一致。')
        for shipment in rows['shipments']:
            if shipment['contract_id'] != contract['id'] or shipment['status'] != '已发货':
                continue
            if shipment['id'] not in completed:
                add('请开票', 'shipment', shipment, f"{shipment['shipment_no']} 已发货，尚未填写实际开完票日期。")
            if paid < total:
                add('请催收货款', 'shipment', shipment, f"{contract['contract_no']} 仍有 {total - paid:.2f} {contract['currency']} 未收。", 'high')

    existing = defaultdict(list)
    for alert in rows['alerts']:
        existing[(alert.get('alert_type'), alert.get('related_type'), alert.get('related_id'))].append(alert)
    for key, data in wanted.items():
        records = existing.get(key, [])
        if any(r.get('status') == '稍后提醒' for r in records):
            continue
        pending = next((r for r in records if r.get('status') == '未处理'), None)
        if pending:
            update(pending, data)
        else:
            tx.add('alerts', data)
    # Only obsolete pending auto-reminders disappear; snoozes and handled history remain.
    tx.rows['alerts'] = [r for r in tx.rows['alerts'] if not (
        r['owner_id'] == tx.user and r.get('status') == '未处理' and r.get('alert_type') in ALERT_TYPES
        and (r.get('alert_type'), r.get('related_type'), r.get('related_id')) not in wanted)]
    return len(wanted)
