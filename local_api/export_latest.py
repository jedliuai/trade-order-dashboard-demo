"""Local-only adapters for the latest release and shipment-based invoice reports."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import math
import re

from .store import ApiError, iso_date
from .payment_progress import china_today
from .invoice_export import build_invoice_export_rows, _natural_batch_sort_key, summarize_batch_numbers


def release_rows(context):
    requested = context['filters'].get('contact_sheet_ids')
    if not isinstance(requested, list) or not requested:
        raise ApiError('请至少选择一条已入库未放行联系单')
    wanted = set(requested)
    sheets = [s for s in context['rows']['contact_sheets'] if s['id'] in wanted]
    if len(sheets) != len(wanted):
        raise ApiError('所选联系单不存在或无权访问')
    versions = {v['id']: v for v in context['rows']['packaging_profile_versions']}
    result = []
    for sheet in sheets:
        if not sheet.get('actual_warehousing_date') or sheet.get('actual_release_date'):
            raise ApiError('放行申请只允许选择已入库且未放行的联系单')
        if not str(sheet.get('material_no') or '').strip():
            raise ApiError('正式业务文件导出前请先补齐物料号')
        batches = [b for b in context['rows']['batches'] if b['contact_sheet_id'] == sheet['id']]
        names = sorted({b['batch_no'] for b in batches}, key=_natural_batch_sort_key)
        version = versions.get(sheet.get('packaging_profile_version_id'), {})
        result.append({
            '申请部门': '演示业务部', '联系单号': sheet.get('contact_sheet_no'),
            '车间': version.get('workshop') or '', '物料号': sheet.get('material_no'),
            '产品名称规格': f"{sheet.get('product_name') or ''}{sheet.get('specification') or ''}",
            '批号': summarize_batch_numbers(names), '批次数': len(names),
            '生产时间': sheet['actual_warehousing_date'], '数量（万）': round(sheet['quantity'] / 10000, 3),
            '是否全部发货': '是', '标准制造周期': '', '实际入库天数': '',
            '入库时间': sheet['actual_warehousing_date'], '申请日期': china_today().isoformat(),
            '申请入库间隔': '', '计划发货日期': '', '理论放行日期': '',
            '是否在高架库': '否', '申请人': '演示业务员', '申请时间': china_today().isoformat(),
        })
    return result


def invoice_rows(context, usd_only=False):
    filters, rows = context['filters'], context['rows']
    start, end = filters.get('date_from'), filters.get('date_to')
    iso_date(start, '起始日期')
    iso_date(end, '截止日期')
    if start > end:
        raise ApiError('起始日期不能晚于截止日期')
    month = filters.get('rate_month')
    if not isinstance(month, str) or not re.fullmatch(r'\d{4}-\d{2}', month):
        raise ApiError('请选择有效的汇率月份')
    iso_date(month + '-01', '汇率月份')
    def created_day(shipment):
        value = shipment.get('created_at') or ''
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=8))).date().isoformat()
        except ValueError:
            return ''
    selected = [s['id'] for s in rows['shipments'] if s['status'] != '取消' and start <= created_day(s) <= end]
    rates = [r for r in rows['exchange_rates'] if r.get('effective_month') == month and r.get('currency_pair') == 'USD/CNY']
    rate = rates[0]['rate'] if rates else None
    coverage = list(rows['invoice_shipments'])
    bridged = {i['invoice_id'] for i in coverage}
    coverage.extend({'invoice_id': i['id'], 'shipment_id': i['shipment_id'], 'allocated_amount': i['amount']}
                    for i in rows['invoices'] if i['id'] not in bridged)
    try:
        data = build_invoice_export_rows(rows['shipments'], rows['shipment_items'], rows['contact_sheets'],
                                        rows['contracts'], rows['customers'], rows['packaging_profile_versions'],
                                        coverage, rows['invoices'], selected, rate, usd_only)
    except RuntimeError as error:
        raise ApiError(str(error)) from None
    result = []
    for row in data:
        price = row['unit_price'] * Decimal(str(row['exchange_rate'])) if row['currency'] == 'USD' else row['unit_price'] / Decimal('1.13')
        if usd_only:
            result.append({'客户名称': row['customer_name'], '合同号': row['contract_no'], '联系单号': row['contact_sheet_no'],
                           '物料号': row['material_no'], '商品名': row['product_name'], '规格': row['specification'],
                           '单位': row['unit'], '单价': float(price), '数量': float(row['quantity']), '金额': float(price * row['quantity'])})
        else:
            result.append({'业务员': '演示业务员', '客户名称': row['customer_name'], '联系单号': row['contact_sheet_no'],
                           '物料号': row['material_no'], '产品名称规格': row['product_with_specification'], '财务不含税成本': None,
                           '数量（万）': float(row['quantity_wan']), '合同不含税价格': float(price), '总利润（万元）': None,
                           '是否为同一张发票': None, '车间': row['workshop'], '备注': row['invoice_note'], '合同号': row['contract_no']})
    return result


def shipment_plan_rows(context, lines):
    mode = context['filters'].get('detail_mode', 'batch')
    if mode not in ('batch', 'contact-sheet'):
        raise ApiError('发货安排明细模式无效')
    versions = {v['id']: v for v in context['rows']['packaging_profile_versions']}
    for line in lines:
        sheet = context['sheets'][line['_contact_sheet_id']]
        if not str(sheet.get('material_no') or '').strip():
            raise ApiError('正式发货安排导出前请先补齐物料号')
        version = versions.get(sheet.get('packaging_profile_version_id'), {})
        capacity = sheet.get('pcs_per_carton') or version.get('quantity_per_carton')
        matching_units = not version.get('quantity_unit') or version['quantity_unit'].removesuffix('/箱') == sheet['unit']
        cartons = max(1, math.ceil(line['数量'] / capacity - 1e-10)) if capacity and matching_units else None
        volume = version.get('carton_volume_m3')
        line.update({'物料号': sheet.get('material_no'), '规格': sheet.get('specification'),
                     '箱数': cartons, '体积（m³）': round(cartons * volume, 6) if cartons and volume else None,
                     '生产日期': sheet.get('production_date'), '失效日期': sheet.get('expiry_date')})
    if mode == 'contact-sheet':
        groups = {}
        for line in lines:
            groups.setdefault((line['_shipment_id'], line['_contact_sheet_id']), []).append(line)
        merged = []
        for group in groups.values():
            row = dict(group[0])
            row.update({'批号': summarize_batch_numbers([r.get('批号') for r in group]),
                        '数量': sum(r['数量'] for r in group), '金额': sum(r['金额'] for r in group),
                        '箱数': sum(r['箱数'] for r in group) if all(r['箱数'] is not None for r in group) else None,
                        '体积（m³）': round(sum(r['体积（m³）'] for r in group), 6) if all(r['体积（m³）'] is not None for r in group) else None})
            row['单价'] = row['金额'] / row['数量']
            merged.append(row)
        lines = merged
    return sorted(lines, key=lambda r: (_natural_batch_sort_key(r.get('合同号')), _natural_batch_sort_key(r.get('联系单号')), _natural_batch_sort_key(r.get('批号'))))
