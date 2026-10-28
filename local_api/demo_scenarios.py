"""Small, entirely invented business scenarios. Chart positions are never stored.

Each sales scope has eight customers: two each with high/high, high/low,
low/high and low/low receipts/profit. Real invoices, costs and receipts drive
the existing analytics without changing any business calculation.
"""
import copy
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from .store import SALES, SHARED, TABLES, normalize_validate


def build_compact_seed(base, as_of):
    from .seed import _month
    data = {table: [] for table in TABLES}
    for table in ('app_user_profiles', 'mdc_products', 'mdc_product_aliases', 'mdc_product_variants',
                  'packaging_profiles', 'packaging_profile_versions', 'exchange_rates', 'analysis_templates'):
        data[table] = copy.deepcopy(base[table])
    for rate in data['exchange_rates']:
        rate.update(source='Manual', source_date=rate['effective_month'] + '-01',
                    notes='预置的纯虚构月度汇率，可手动修改；不读取外部行情。')
    products = {p['id']: p for p in data['mdc_products']}
    versions = {v['id']: v for v in data['packaging_profile_versions']}
    profiles = {p.get('product_variant_id'): p for p in data['packaging_profiles']}
    current_versions = {v['profile_id']: v for v in versions.values() if v['is_current']}
    rates = {r['effective_month']: Decimal(str(r['rate'])) for r in data['exchange_rates']}
    stamp = as_of.isoformat() + 'T08:00:00+08:00'

    def add(table, id, owner, **fields):
        row = dict(id=id, owner_id=owner, created_at=stamp, updated_at=stamp, **fields)
        data[table].append(row)
        return row

    def money(value):
        return float(Decimal(str(value)).quantize(Decimal('.000001'), rounding=ROUND_HALF_UP))

    names = ('青禾', '星舟', '云帆', '松岚', '晨露', '澄海', '月泉', '远山',
             '星野', '白榆', '晴川', '竹溪', '青穗', '南栀', '山岚', '云汀',
             '明溪', '秋实', '朝晖', '清越', '望舒', '海棠', '映雪', '长风')
    # Invented scenarios only; these are input prices/margins, never chart scores.
    prices = (20, 18, 16, 10)
    margins = (Decimal('.32'), Decimal('.04'), Decimal('.23'), Decimal('.09'))
    receipt_ratios = (Decimal('1.10'), Decimal('1.00'), Decimal('.12'), Decimal('.18'))
    for n, name in enumerate(names):
        owner = SALES[n // 8]
        q = n % 4
        factor = Decimal('1.00') if n % 8 < 4 else Decimal('1.35')
        currency = 'RMB' if n % 8 == 7 else 'USD'
        customer = add('customers', f'DEMO-SC-CUSTOMER-{n + 1:02}', owner,
                       name='DEMO PACKAGING PARTNER' if n == 1 else f'虚构·{name}',
                       country=('肯尼亚', '秘鲁', '越南', '埃及')[q], default_currency=currency,
                       default_payment_terms='40%预付款，60%提单后付款', is_staggered_month=False,
                       expiry_years=3, notes='纯虚构演示客户，由本地场景生成器创建，不对应真实企业或个人。')
        ratio = receipt_ratios[q] if n % 8 < 4 or q != 1 else Decimal('.95')
        margin = Decimal('.12') if n % 8 == 7 else margins[q]
        for offset in (0, -1, -5, -11, -17, -25):
            month_start = _month(as_of, offset)
            # All actual events remain within this month and no later than as_of.
            event_day = month_start + timedelta(days=min(18 + n % 7, (as_of - month_start).days))
            when = event_day.isoformat()
            key = f'DEMO-SC-{n + 1:02}-{month_start:%Y%m}'
            total = Decimal(0)
            contract = add('contracts', key + '-C', owner, customer_id=customer['id'],
                           contract_no=key, contract_date=month_start.isoformat(), destination_country=customer['country'],
                           currency=currency, export_type='转口' if currency == 'RMB' else '自营',
                           incoterm=None if currency == 'RMB' else 'FOB', delivery_days=45, prepayment_ratio=.4,
                           agreed_delivery_date=(month_start + timedelta(days=45)).isoformat(),
                           payment_terms=customer['default_payment_terms'], internal_contract_seq=key + '-SEQ',
                           is_historical=offset <= -25, notes='纯虚构：供演示回款、利润和客户分层。')
            group = add('shipment_groups', key + '-G', owner, customer_id=customer['id'],
                        shipment_no=key + '-SHIP', shipment_date=when, status='已发货', currency=currency,
                        incoterm=contract['incoterm'], notes='纯虚构发货安排')
            shipment = add('shipments', key + '-S', owner, contract_id=contract['id'], shipment_group_id=group['id'],
                           shipment_no=group['shipment_no'], shipment_date=when, status='已发货',
                           incoterm_snapshot=contract['incoterm'], payment_check_status='需人工确认', notes='纯虚构发货事实')
            for line in range(2):
                variant = data['mdc_product_variants'][(n * 3 + line) % len(data['mdc_product_variants'])]
                product = products[variant['product_id']]
                profile = profiles.get(variant['id'])
                version = current_versions[profile['id']] if profile else None
                raw = product['product_type'] == 'raw_material'
                unit = 'kg' if raw else version['quantity_unit'].removesuffix('/箱')
                price = Decimal(prices[q]) * factor * (Decimal('7.2') if currency == 'RMB' else 1)
                quantity = 500 + line * 100
                sale = price * quantity
                total += sale
                material = f'DEMO-SC-M-{n + 1:02}-{line + 1}'
                sheet = add('contact_sheets', key + f'-CS{line}', owner, contract_id=contract['id'],
                            contact_sheet_no=key + f'-L{line + 1}', product_name=product['chinese_name'],
                            product_variant_id=variant['id'], specification=variant['specification'], material_no=material,
                            business_type='原料药' if raw else '制剂', quantity=quantity, unit_price=float(price), unit=unit,
                            packaging_profile_version_id=version['id'] if version else None,
                            packaging=version['packaging_description'] if version else 'DEMO 虚构密封桶',
                            pcs_per_carton=version['quantity_per_carton'] if version else None,
                            quality_standard='DEMO 虚构质量标准', packaging_confirmed_date=month_start.isoformat(),
                            qa_approval_date=month_start.isoformat(), aps_scheduled_date=month_start.isoformat(),
                            aps_auto_query_enabled=False, production_date=month_start.strftime('%Y-%m'),
                            expiry_date=_month(month_start, 36).strftime('%Y-%m'), is_staggered_month=False,
                            actual_warehousing_date=when, estimated_release_date=when, actual_release_date=when,
                            is_historical=offset <= -25, box_artwork_confirmed_date=when, reference_contact_sheet='',
                            notes='纯虚构产品行，利润来自本行开票金额与对应月份成本。')
                batch = None if raw else add('batches', sheet['id'] + '-B', owner, contact_sheet_id=sheet['id'],
                                             batch_no=key + f'-B{line + 1}', batch_quantity=quantity,
                                             warehouse_date=when, release_date=when, notes='纯虚构批次')
                add('shipment_items', sheet['id'] + '-ITEM', owner, shipment_id=shipment['id'], contact_sheet_id=sheet['id'],
                    batch_id=batch['id'] if batch else None, material_no=material, shipped_quantity=quantity,
                    unit_price=float(price), notes='纯虚构发货明细')
                if not (n == 0 and offset == -17 and line == 0):
                    # The existing RMB rule taxes cost by 1.13; preserve it here.
                    unit_cost = price * (1 - margin) / Decimal('1.13') if currency == 'RMB' else price * rates[when[:7]] * (1 - margin)
                    add('product_costs', material + '-' + when[:7], SHARED, material_no=material,
                        product_name=product['chinese_name'], cost_month=when[:7], unit_cost_no_tax=money(unit_cost),
                        notes='纯虚构月度成本，专用于演示四种客户经营情景。')
            invoice = add('invoices', key + '-INV', owner, shipment_id=shipment['id'], invoice_no=key + '-INV',
                          invoice_date=when, amount=money(total), status='已收到电子发票', notes='纯虚构开票记录')
            add('invoice_shipments', key + '-LINK', owner, invoice_id=invoice['id'], shipment_id=shipment['id'], allocated_amount=money(total))
            paid_ratio = Decimal(1) if offset == -25 else ratio
            paid = total * paid_ratio
            allocated = min(total, paid)
            receipt = add('payment_receipts', key + '-R', owner, customer_id=customer['id'], receipt_no=key + '-BANK',
                          payment_date=when, total_amount=money(paid), currency=currency, payment_type='其他',
                          exchange_rate=float(rates[when[:7]]) if currency == 'USD' else None,
                          notes='纯虚构银行到账；超出合同分配的金额作为客户预存款。')
            add('payments', key + '-P', owner, receipt_id=receipt['id'], contract_id=contract['id'], shipment_id=None,
                payment_date=when, allocation_effective_date=when, amount=money(allocated), currency=currency,
                payment_type='其他', exchange_rate=receipt['exchange_rate'], notes='纯虚构合同分配')
            for row in (group, shipment, invoice, receipt):
                row['created_at'] = row['updated_at'] = when + 'T10:00:00+08:00'

        # One small current work-in-progress order per customer keeps CRUD demos useful.
        key = f'DEMO-SC-PIPE-{n + 1:02}'
        contract = add('contracts', key + '-C', owner, customer_id=customer['id'], contract_no=key,
                       contract_date=as_of.isoformat(), destination_country=customer['country'], currency=currency,
                       export_type='转口' if currency == 'RMB' else '自营', incoterm='FOB' if currency == 'USD' else None,
                       delivery_days=45, prepayment_ratio=.4, payment_terms=customer['default_payment_terms'],
                       is_historical=False, notes='纯虚构当前订单，供新增、排产、批次和发货演示。')
        variant = data['mdc_product_variants'][n % 20 * 3]
        product = products[variant['product_id']]
        profile = profiles[variant['id']]
        version = current_versions[profile['id']]
        sheet = add('contact_sheets', key + '-CS', owner, contract_id=contract['id'], contact_sheet_no=key + '-L',
                    material_no=f'DEMO-SC-PIPE-M-{n + 1:02}', product_name=product['chinese_name'],
                    product_variant_id=variant['id'], specification=variant['specification'], business_type='制剂',
                    quantity=100, unit_price=10, unit=version['quantity_unit'].removesuffix('/箱'),
                    packaging_profile_version_id=version['id'], packaging=version['packaging_description'],
                    pcs_per_carton=version['quantity_per_carton'], is_historical=False, is_staggered_month=False,
                    qa_approval_date=as_of.isoformat() if q >= 1 else None,
                    aps_scheduled_date=(as_of + timedelta(days=10)).isoformat() if q >= 1 else None,
                    aps_auto_query_enabled=False, production_date=as_of.strftime('%Y-%m') if q >= 1 else None,
                    expiry_date=_month(as_of, 36).strftime('%Y-%m') if q >= 1 else None,
                    actual_warehousing_date=as_of.isoformat() if q >= 2 else None,
                    estimated_release_date=as_of.isoformat() if q >= 2 else None,
                    actual_release_date=as_of.isoformat() if q >= 3 else None,
                    box_artwork_confirmed_date=as_of.isoformat() if n != 1 else None,
                    notes='纯虚构进行中联系单，所有日期在本地手工维护。')
        if q >= 1:
            add('batches', key + '-B', owner, contact_sheet_id=sheet['id'], batch_no=key + '-B',
                batch_quantity=100, warehouse_date=sheet['actual_warehousing_date'], release_date=sheet['actual_release_date'], notes='纯虚构在制批次')
        if n == 1:
            confirmed = copy.deepcopy(sheet)
            confirmed.update(id=key + '-CS-CONFIRMED', contact_sheet_no=key + '-L2',
                             box_artwork_confirmed_date=as_of.isoformat(), notes='纯虚构：盒子版式已经确认的对照样例。')
            data['contact_sheets'].append(confirmed)
            add('batches', key + '-B-CONFIRMED', owner, contact_sheet_id=confirmed['id'], batch_no=key + '-B2',
                batch_quantity=100, warehouse_date=None, release_date=None, notes='纯虚构在制批次')
            # Due artwork reminder, while the other historical lines are confirmed.
            add('alerts', key + '-ART', owner, alert_type='请确认 DEMO_PACKAGING 盒子制版稿', related_type='contact_sheet',
                related_id=sheet['id'], priority='high', status='未处理', message='虚构包装客户的盒子制版稿待确认。')
    normalize_validate(data)
    return data
