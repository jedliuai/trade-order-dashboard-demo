"""Deterministic, entirely fictional local demo; no network or secrets.

Run ``python -m local_api.seed --as-of 2026-08-28`` to regenerate the JSON
artifact. Dates, IDs and random choices depend only on the supplied date.
"""
import argparse
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path
from random import Random

from .store import SALES, SHARED, TABLES, normalize_validate


def _month(value, offset=0):
    index = value.year * 12 + value.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def _money(value):
    return float(Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))


def build_seed(as_of: date) -> dict:
    """Build the complete Store table graph, including frontend master data."""
    if type(as_of) is not date:
        raise ValueError('as_of must be a datetime.date')
    rng = Random(20260827)
    data = {table: [] for table in TABLES}
    beginning = _month(as_of, -30)
    timestamp = beginning.isoformat() + 'T08:00:00+08:00'

    def add(table, id, owner=SHARED, **fields):
        row = dict(id=id, owner_id=owner, created_at=timestamp, updated_at=timestamp, **fields)
        data[table].append(row)
        return row

    for index, (user, display) in enumerate(zip((*SALES, 'demo-manager', 'demo-owner'),
            ('DEMO 虚构业务员甲', 'DEMO 虚构业务员乙', 'DEMO 虚构业务员丙', 'DEMO 虚构销售经理', 'DEMO 虚构负责人'))):
        add('app_user_profiles', 'DEMO-PROFILE-' + str(index + 1), user_id=user,
            login_name=user, display_name=display, role='member' if index < 3 else 'leader',
            app_role='member' if index < 3 else 'leader', is_active=True,
            manager_id='demo-manager' if index < 3 else 'demo-owner' if index == 3 else None,
            reporting_to='demo-manager' if index < 3 else 'demo-owner' if index == 3 else None)

    countries = ('肯尼亚', '秘鲁', '越南', '埃及', '智利', '印度尼西亚', '乌兹别克斯坦', '加纳', '中国', '墨西哥', '马来西亚', '坦桑尼亚')
    customers = []
    for n in range(72):
        owner = SALES[0 if n < 36 else 1 if n < 60 else 2]
        customers.append(add('customers', f'DEMO-CUSTOMER-{n + 1:03}', owner,
            name='DEMO PACKAGING PARTNER' if n == 1 else f'DEMO 虚构客户 {n + 1:03}', country=countries[n % len(countries)],
            default_currency='RMB' if n % 5 == 0 else 'USD',
            is_staggered_month=n % 4 == 0, expiry_years=2 if n % 3 == 0 else 3,
            default_payment_terms='40%预付款，60%提单后付款',
            notes='纯虚构演示客户，不对应任何实际企业或个人。'))

    # Shared master data can be referenced by all three sales owners.
    variants = []
    dosage_forms = ('粉针剂', '水针剂', '片剂', '胶囊剂', '气雾剂', '口服补液盐', '干混悬剂', '软胶囊剂')
    for n in range(24):
        raw = n >= 20
        dosage = '' if raw else dosage_forms[n % len(dosage_forms)]
        product = add('mdc_products', f'DEMO-PRODUCT-{n + 1:02}',
            product_code=f'DEMO-P{n + 1:03}', product_type='raw_material' if raw else 'finished_product',
            chinese_name=f'DEMO 虚构原料 {n - 19:02}' if raw else f'DEMO 虚构{dosage} {n + 1:02}',
            english_name=f'DEMO Fictional Product {n + 1:02}', dosage_form=dosage,
            status='active', is_pinned=n < 4, manual_sort_order=n + 1, source='demo',
            notes='仅用于软件演示的虚构产品，不是真实药品。', created_by=SALES[0], updated_by=SALES[0])
        add('mdc_product_aliases', f'DEMO-ALIAS-{n + 1:02}', product_id=product['id'],
            alias=f'DEMO 虚构系列 {n + 1:02}', alias_kind='trade', language='zh', created_by=SALES[0])
        for v in range(3):
            k = n * 3 + v
            unit = 'kg' if raw else '支' if dosage in ('粉针剂', '水针剂') else '瓶' if dosage in ('气雾剂', '干混悬剂') else '盒'
            specification = (f'{10 + v * 5} kg/桶' if raw else f'{10 + v * 5} ml' if unit != '盒' else f'{10 + v * 5}片/盒')
            variant = add('mdc_product_variants', f'DEMO-VARIANT-{k + 1:03}', product_id=product['id'],
                specification=specification, dosage_form_override=dosage or None, status='active',
                created_by=SALES[0], updated_by=SALES[0])
            packing = version = None
            per_carton = (100, 200, 400)[v]
            if not raw:
                packing = add('packaging_profiles', f'DEMO-PACK-{k + 1:03}',
                    packaging_code=f'DEMO-PKG-{k + 1:03}', product_variant_id=variant['id'],
                    product_name=product['chinese_name'], material_no=f'DEMO-M{k + 1:03}',
                    specification=specification, business_type='制剂', workshop=f'DEMO 虚构车间 {n % 4 + 1}',
                    packing_method='机装' if n % 3 else '非机装', scope_type='general',
                    customer_id=None, customer_name='', is_active=True, created_by=SALES[0], updated_by=SALES[0],
                    version_count=1, open_issue_count=0)
                version = add('packaging_profile_versions', f'DEMO-PACK-V-{k + 1:03}', profile_id=packing['id'],
                    version_no=1, is_current=True, effective_from=beginning.isoformat(), effective_to=None,
                    change_reason='建立纯虚构演示包装', packaging_description=f'DEMO 通用纸箱；{per_carton}{unit}/箱',
                    quantity_per_carton=per_carton, quantity_unit=f'{unit}/箱',
                    units_per_box=10 if unit == '盒' else None,
                    boxes_per_carton=per_carton if unit == '盒' else None,
                    derived_base_units_per_carton=per_carton * 10 if unit == '盒' else None,
                    box_inner_length_mm=50, box_inner_width_mm=30, box_inner_height_mm=20,
                    carton_inner_length_mm=580, carton_inner_width_mm=380, carton_inner_height_mm=280,
                    carton_outer_length_mm=600, carton_outer_width_mm=400, carton_outer_height_mm=300,
                    carton_gross_weight_kg=12 + v, carton_volume_m3=.072,
                    fill_ratio=round(per_carton * 50 * 30 * 20 / (580 * 380 * 280), 6),
                    fill_ratio_status='normal', fill_ratio_override_reason=None,
                    review_status='verified', source_type='manual', created_by=SALES[0],
                    version_created_at=timestamp)
            variants.append(dict(product=product, variant=variant, packing=packing, version=version,
                material_no=f'DEMO-M{k + 1:03}', unit=unit, per_carton=per_carton, raw=raw, index=k))

    monthly_rates = {}
    for offset in range(31):
        month = _month(beginning, offset).strftime('%Y-%m')
        rate = round(6.85 + (offset % 9) * .055, 4)
        monthly_rates[month] = rate
        add('exchange_rates', f'DEMO-FX-{month}', effective_month=month,
            currency_pair='USD/CNY', rate=rate, notes='纯虚构月度汇率，仅用于演示')
        for entry in variants:
            # Missing current costs are intentional, visible pending calculations.
            if offset >= 29 and entry['index'] % 13 == 0:
                continue
            add('product_costs', f'DEMO-COST-{month}-{entry["index"] + 1:03}',
                material_no=entry['material_no'], product_name=entry['product']['chinese_name'],
                cost_month=month, unit_cost_no_tax=_money(8 + entry['index'] % 15 + (offset % 5) * .25),
                notes='纯虚构未税单位成本；未使用任何真实成本表')

    historical_end = as_of - timedelta(days=86)
    duration = (historical_end - beginning).days
    weights = [10 if n % 12 < 3 else 3 if n % 12 < 8 else 1 for n in range(72)]
    for n in range(1200):
        customer = customers[n] if n < len(customers) else rng.choices(customers, weights=weights, k=1)[0]
        if n in (1180, 1181):
            customer = customers[1]
        owner, currency = customer['owner_id'], customer['default_currency']
        contract_date = beginning + timedelta(days=rng.randrange(duration + 1)) if n < 1080 else as_of - timedelta(days=(1199 - n) * 80 // 119)
        if n == 0:
            contract_date = beginning
        age = (as_of - contract_date).days
        # Weighted history plus a dense current pipeline, not a flat stage cycle.
        stage = 6 if n % 20 >= 5 else n % 20
        if n >= 1080:
            stage = 0 if age < 8 else 1 if age < 18 else 2 if age < 28 else 3 if age < 36 else 4 if age < 46 else 6
        terms = ('CIF' if n % 4 == 0 else 'FOB') if currency == 'USD' else None
        contract = add('contracts', f'DEMO-CONTRACT-{n + 1:04}', owner,
            contract_no=f'DEMO-C-{contract_date:%Y%m}-{n + 1:04}', customer_id=customer['id'],
            contract_date=contract_date.isoformat(), destination_country=customer['country'], currency=currency,
            export_type='转口' if currency == 'RMB' else '自营', incoterm=terms,
            delivery_days=55, agreed_delivery_date=(contract_date + timedelta(days=55)).isoformat(),
            payment_terms=customer['default_payment_terms'], prepayment_ratio=40,
            internal_contract_seq=f'DEMO-SEQ-{n + 1:04}', is_historical=age > 730,
            notes='DEMO 纯虚构本地合同；所有金额、客户和批号均为生成数据。')
        contract['created_at'] = contract['updated_at'] = contract_date.isoformat() + 'T09:00:00+08:00'

        def day(offset):
            return (contract_date + timedelta(days=offset)).isoformat()

        total = Decimal(0)
        group_ids = {}
        for line in range(2 + n % 2):
            entry = rng.choices(variants, weights=[7 if v['index'] < 18 else 3 if v['index'] < 45 else 1 for v in variants], k=1)[0]
            if n in (1180, 1181):
                entry = variants[line]
            quantity = (rng.randrange(4, 26) * 100) if not entry['raw'] else rng.randrange(4, 30) * 20
            price = _money((5 + entry['index'] % 12 + rng.randrange(4) * .25) * (7.6 if currency == 'RMB' else 1))
            total += Decimal(str(price)) * quantity
            sheet_id = f'DEMO-CS-{n + 1:04}-{line + 1}'
            expiry = _month(contract_date, customer['expiry_years'] * 12 - int(customer['is_staggered_month'])).strftime('%Y-%m')
            sheet = add('contact_sheets', sheet_id, owner, contract_id=contract['id'],
                contact_sheet_no=f'DEMO-L-{n + 1:04}-{line + 1}', business_type='原料药' if entry['raw'] else '制剂',
                material_no=entry['material_no'], product_name=entry['product']['chinese_name'],
                specification=entry['variant']['specification'], product_variant_id=entry['variant']['id'],
                packaging_profile_version_id=entry['version']['id'] if entry['version'] else None,
                packaging=entry['version']['packaging_description'] if entry['version'] else 'DEMO 通用密封桶',
                packaging_confirmed_date=day(2) if age >= 2 else None,
                quality_standard='DEMO 虚构质量标准', quantity=quantity, unit_price=price, unit=entry['unit'],
                pcs_per_carton=entry['per_carton'] if not entry['raw'] else None,
                gross_weight_kg=13 if not entry['raw'] else None,
                qa_approval_date=day(4) if stage >= 1 else None,
                # Compatibility name retained by the frontend; never auto-queried.
                aps_scheduled_date=day(8) if stage >= 1 else None,
                scheduled_production_date=day(8) if stage >= 1 else None,
                aps_auto_query_enabled=False,
                box_artwork_confirmed_date=day(5) if stage >= 1 and n != 1180 else None,
                production_date=contract_date.strftime('%Y-%m') if stage >= 1 else None,
                expiry_date=expiry if stage >= 1 else None, is_staggered_month=customer['is_staggered_month'],
                actual_warehousing_date=day(18) if stage >= 2 else None,
                estimated_release_date=day(28) if stage >= 2 else None,
                actual_release_date=day(28) if stage >= 3 else None,
                is_historical=age > 730, reference_contact_sheet='',
                notes='DEMO 虚构联系单；排产日期为手工演示字段。')
            sheet['created_at'] = sheet['updated_at'] = day(0) + 'T10:00:00+08:00'
            if n == 1180:
                add('alerts', f'DEMO-ARTWORK-{sheet_id}', owner,
                    alert_type='请确认 DEMO_PACKAGING 盒子制版稿', related_type='contact_sheet',
                    related_id=sheet_id, priority='high', status='未处理',
                    message=f'DEMO PACKAGING PARTNER 的虚构联系单 {sheet["contact_sheet_no"]} 请确认盒子制版稿。',
                    handled_at=None, snoozed_until=None)
            if stage < 1:
                continue
            for part in range(2):
                batch = add('batches', f'{sheet_id}-B{part + 1}', owner, contact_sheet_id=sheet_id,
                    batch_no=f'DEMO-B-{n + 1:04}-{line + 1}-{part + 1}', batch_quantity=quantity // 2,
                    production_date=day(8), expiry_date=expiry,
                    warehouse_date=day(18) if stage >= 2 else None,
                    release_date=day(28) if stage >= 3 else None, notes='DEMO 虚构批次')
                if stage < 3 or (stage == 4 and part == 1):
                    continue
                dispatched = stage >= 4
                shipment_day = day(32 + part * 8) if dispatched else None
                group_key = part
                if n % 7 == 0 and group_key not in group_ids:
                    group = add('shipment_groups', f'DEMO-GROUP-{n + 1:04}-{part + 1}', owner,
                        customer_id=customer['id'], currency=currency, incoterm=terms,
                        shipment_no=f'DEMO-G-{n + 1:04}-{part + 1}', shipment_date=shipment_day,
                        status='已发货' if dispatched else '准备中', notes='DEMO 多联系单合并物理发货')
                    group_ids[group_key] = group['id']
                sale = _money(Decimal(str(price)) * (quantity // 2))
                freight = _money(Decimal(str(sale)) * Decimal('.045')) if terms == 'CIF' and dispatched else None
                shipment = add('shipments', f'{sheet_id}-S{part + 1}', owner, contract_id=contract['id'],
                    shipment_group_id=group_ids.get(group_key), shipment_no=f'DEMO-S-{n + 1:04}-{line + 1}-{part + 1}',
                    shipment_date=shipment_day, status='已发货' if dispatched else '准备中',
                    incoterm_snapshot=terms, freight_insurance_amount=freight,
                    payment_check_status='已通过' if dispatched else '需人工确认', notes='DEMO 虚构发货')
                add('shipment_items', f'{shipment["id"]}-ITEM', owner, shipment_id=shipment['id'],
                    contact_sheet_id=sheet_id, batch_id=batch['id'], material_no=entry['material_no'],
                    shipped_quantity=quantity // 2, unit_price=price, notes='DEMO 虚构发货明细')
                if dispatched and n % 17 != 0:
                    invoice_date = day(34 + part * 8) if n % 19 != 0 and day(34 + part * 8) <= as_of.isoformat() else None
                    invoice = add('invoices', f'{shipment["id"]}-INV', owner, shipment_id=shipment['id'],
                        invoice_no=f'DEMO-I-{n + 1:04}-{line + 1}-{part + 1}', amount=sale,
                        invoice_date=invoice_date, application_date=shipment_day, status='已申请',
                        notes='DEMO 虚构发票；不是实际税务凭证')
                    add('invoice_shipments', f'{invoice["id"]}-LINK', owner,
                        invoice_id=invoice['id'], shipment_id=shipment['id'], allocated_amount=sale)
        # Receipt is the actual cash event; payments are allocations only.
        paid_parts = [_money(total * Decimal('.4')), _money(total * Decimal('.3'))]
        paid_parts.append(_money(total - Decimal(str(paid_parts[0])) - Decimal(str(paid_parts[1]))))
        payment_offsets = (3, 22, 46)
        count = 3 if stage == 6 and age >= 46 else 2 if stage >= 3 else 1 if age >= 3 else 0
        if count == 3 and int(customer['id'].rsplit('-', 1)[1]) % 6 == 3:
            # These fictional customers have dispatched orders with 30% still
            # outstanding, while meeting the existing 40% pre-shipment term.
            count = 2
        for part in range(count):
            paid_date = day(payment_offsets[part])
            amount = paid_parts[part]
            extra_deposit = _money(total * Decimal('.05')) if part == 2 and n % 23 == 0 else 0
            rate = monthly_rates[paid_date[:7]] if currency == 'USD' else None
            receipt = add('payment_receipts', f'DEMO-RECEIPT-{n + 1:04}-{part + 1}', owner,
                receipt_no=f'DEMO-R-{n + 1:04}-{part + 1}', customer_id=customer['id'],
                payment_date=paid_date, total_amount=_money(amount + extra_deposit), currency=currency,
                payment_type='预付款' if part == 0 else '分批付款' if part == 1 else '尾款',
                exchange_rate=rate, notes='DEMO 虚构收款；含少量未分配客户预存款')
            add('payments', f'DEMO-PAYMENT-{n + 1:04}-{part + 1}', owner,
                receipt_id=receipt['id'], contract_id=contract['id'], payment_date=paid_date,
                amount=amount, currency=currency, exchange_rate=rate,
                payment_type=receipt['payment_type'], notes='DEMO 主单分摊，不重复计入经营回款')

    freight_by_group = defaultdict(Decimal)
    for shipment in data['shipments']:
        if shipment.get('shipment_group_id') and shipment.get('freight_insurance_amount'):
            freight_by_group[shipment['shipment_group_id']] += Decimal(str(shipment['freight_insurance_amount']))
    for group in data['shipment_groups']:
        group['freight_insurance_amount'] = float(freight_by_group[group['id']]) if freight_by_group[group['id']] else None
    for owner in SALES:
        add('analysis_templates', 'DEMO-ANALYSIS-' + owner, owner,
            name='DEMO 月度虚构经营趋势', filters={}, metrics=['sales', 'profit'],
            dimension='month', chart_type='composed', currency_mode='RMB')
    normalize_validate(data)
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description='Generate fictional local SQLite demo seed JSON')
    parser.add_argument('--as-of', type=date.fromisoformat, default=date.today(), help='Anchor date (YYYY-MM-DD)')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data/demo-seed.json')
    args = parser.parse_args(argv)
    data = build_seed(args.as_of)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'as_of': args.as_of.isoformat(), 'counts': {t: len(v) for t, v in data.items()}}, ensure_ascii=True))


if __name__ == '__main__':
    main()
