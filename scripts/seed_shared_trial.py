"""Build one fictional, writable showcase. Running the SQL again preserves visitor edits."""
import argparse
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path

from local_api.demo_catalog import MEDICINES
from local_api.seed import _month
from local_api.store import SALES, SHARED, TABLES, normalize_validate


CUSTOMERS = (
    ('青禾医贸', '肯尼亚', 'USD'), ('星舟药业', '越南', 'USD'), ('云帆供应', '秘鲁', 'USD'),
    ('松岚商贸', '中国', 'RMB'), ('月泉医贸', '埃及', 'USD'), ('南栀分销', '智利', 'USD'),
)
# Month offset, day, customer, stage, receipt percentage, freight in USD, order lines.
# Prices use the customer's original currency. The normal accounting code derives profit.
ORDERS = (
    (-12, 12, 0, '已开票', 100, 0, [(0, 2200, 3.70)]),
    (-7, 16, 1, '已开票', 100, 0, [(1, 3000, 4.80)]),
    (-5, 18, 3, '已开票', 100, 0, [(2, 2600, 25), (3, 1000, 16)]),
    (-3, 14, 4, '已开票', 100, 0, [(4, 1700, 7.90)]),
    (-2, 12, 0, '已开票', 100, 0, [(0, 3200, 4.10)]),
    (-1, 8, 2, '已开票', 100, 420, [(5, 600, 17.50)]),
    (-1, 17, 1, '已开票', 60, 0, [(1, 3500, 4.95)]),
    (0, 5, 0, '已开票', 110, 0, [(0, 2800, 4.30), (3, 1400, 3.85)]),
    (0, 9, 5, '已开票', 40, 650, [(4, 1600, 6.10)]),
    (0, 13, 3, '部分发货', 40, 0, [(2, 2400, 26)]),
    (0, 15, 2, '待开票', 100, 0, [(6, 180, 27)]),
    (0, 16, 1, '待发货', 40, 0, [(1, 1800, 5.25)]),
    (0, 18, 4, '待放行', 0, 0, [(5, 800, 18)]),
    (0, 20, 5, '待审批', 0, 0, [(3, 1500, 4.10)]),
)
# Six standard presentation products and one raw material. All commercial values are invented.
PRODUCTS = [MEDICINES[i] for i in (0, 1, 2, 3, 4, 8)] + [
    ('维生素C原料', 'Vitamin C', '', 'kg', ('25kg/桶',))]
COSTS_RMB = (21, 25, 16, 17, 44, 85, 120)


def build(as_of):
    rows = {table: [] for table in TABLES}
    owner = SALES[0]

    def add(table, key, when, *, shared=False, **fields):
        stamp = when.isoformat() + 'T09:00:00+08:00'
        row = dict(id=key, owner_id=SHARED if shared else owner, created_at=stamp, updated_at=stamp, **fields)
        rows[table].append(row)
        return row

    start = _month(as_of, -12)
    months = sorted({offset for offset, *_ in ORDERS})
    rates = {}
    for index, offset in enumerate(months):
        first = _month(as_of, offset)
        month = first.isoformat()[:7]
        rates[month] = round(7.08 + (index % 4) * .04, 2)
        add('exchange_rates', 'rate-' + month, first, shared=True, effective_month=month, currency_pair='USD/CNY',
            rate=rates[month], source='Manual', source_date=first.isoformat(), notes='虚构月度结算汇率')
    for index, (name, country, currency) in enumerate(CUSTOMERS):
        add('customers', f'customer-{index}', start, name=name, country=country, default_currency=currency,
            default_payment_terms='40%预付款，60%提单后付款', expiry_years=3, is_staggered_month=False,
            notes='虚构展示客户，供公开试用。')

    for i, (name, english, form, unit, specs) in enumerate(PRODUCTS):
        pid, vid, pack = f'product-{i}', f'variant-{i}', f'pack-{i}'
        add('mdc_products', pid, start, product_code=f'P-{101+i}', product_type='finished_product' if form else 'raw_material',
            chinese_name=name, english_name=english, dosage_form=form, status='active', is_pinned=i==0,
            manual_sort_order=i+1, notes='虚构产品档案', created_by=owner, updated_by=owner)
        add('mdc_product_aliases', pid+'-alias', start, product_id=pid, alias=english, alias_kind='common', language='en')
        add('mdc_product_variants', vid, start, product_id=pid, specification=specs[0], status='active',
            dosage_form_override=form or None)
        if form:
            add('packaging_profiles', pack, start, product_variant_id=vid, packaging_code=f'PK-{101+i}',
                product_name=name, material_no=f'M-{101+i}', specification=specs[0], business_type='制剂',
                workshop=f'{form}车间', packing_method='机装', scope_type='general', is_active=True)
            add('packaging_profile_versions', pack+'-v1', start, profile_id=pack, version_no=1, is_current=True,
                effective_from=start.isoformat(), change_reason='建立虚构标准包装', packaging_description=f'100{unit}/箱',
                quantity_per_carton=100, quantity_unit=unit+'/箱', carton_outer_length_mm=480,
                carton_outer_width_mm=330, carton_outer_height_mm=290, carton_gross_weight_kg=12,
                review_status='已复核', source_type='manual', created_by=owner)

    costs_written = set()
    for n, (offset, day, ci, stage, paid, freight, lines) in enumerate(ORDERS, 1):
        first = _month(as_of, offset)
        end = min(as_of, first + timedelta(days=day-1))
        order_day = max(first, end-timedelta(days=10))
        scheduled = max(order_day, end-timedelta(days=4))
        month = first.isoformat()[:7]
        code = f'HT-{first:%y%m}-{n:02}'
        customer_id = f'customer-{ci}'
        _, country, currency = CUSTOMERS[ci]
        terms = ('CIF' if freight else 'FOB') if currency == 'USD' else None
        add('contracts', code, order_day, contract_no=code, contract_date=order_day.isoformat(), customer_id=customer_id,
            destination_country=country, currency=currency, export_type='自营' if currency=='USD' else '转口',
            incoterm=terms, delivery_days=30, agreed_delivery_date=(order_day+timedelta(days=30)).isoformat(),
            prepayment_ratio=.4, payment_terms='40%预付款，60%提单后付款', internal_contract_seq=f'{n:03}',
            notes='小批量清库存，按约承担运保费。' if ci==5 and freight else '虚构展示合同。')
        shipping = stage in ('已开票','部分发货','待开票','待发货')
        dispatched = shipping and stage != '待发货'
        if shipping:
            status = '已发货' if dispatched else '准备中'
            shipno = f'FH-{first:%y%m}-{n:02}'
            for table, suffix in [('shipment_groups','-g'),('shipments','-s')]:
                relation = dict(incoterm=terms) if table=='shipment_groups' else dict(
                    contract_id=code, shipment_group_id=code+'-g', incoterm_snapshot=terms, payment_check_status='需人工确认')
                add(table, code+suffix, end, customer_id=customer_id, currency=currency, shipment_no=shipno,
                    shipment_date=end.isoformat(), status=status, freight_insurance_amount=freight or None, **relation)
        total = shipped_amount = 0
        for line, (pi, qty, price) in enumerate(lines, 1):
            name, _, form, unit, specs = PRODUCTS[pi]
            key = f'{code}-{line}'
            lno = f'LX-{first:%y%m}-{n:02}{chr(64+line)}'
            material = f'M-{101+pi}'
            warehoused = shipping or stage=='待放行'
            released = shipping
            add('contact_sheets', key, order_day, contact_sheet_no=lno, contract_id=code,
                business_type='制剂' if form else '原料药', product_variant_id=f'variant-{pi}', product_name=name,
                specification=specs[0], material_no=material, unit=unit, quantity=qty, unit_price=price,
                packaging_profile_version_id=f'pack-{pi}-v1' if form else None, pcs_per_carton=100 if form else None,
                packaging=f'100{unit}/箱' if form else '25kg/桶', quality_standard='合同约定',
                packaging_confirmed_date=order_day.isoformat(), qa_approval_date=scheduled.isoformat() if stage!='待审批' else None,
                aps_scheduled_date=scheduled.isoformat() if stage!='待审批' else None,
                actual_warehousing_date=scheduled.isoformat() if warehoused else None,
                estimated_release_date=end.isoformat() if warehoused else None, actual_release_date=end.isoformat() if released else None,
                production_date=month if warehoused else None, expiry_date=_month(first,36).isoformat()[:7] if warehoused else None)
            batch = None
            if form and warehoused:
                batch = add('batches', key+'-b', scheduled, contact_sheet_id=key, batch_no=f'B{first:%y%m}{n:02}{line}',
                    batch_quantity=qty, warehouse_date=scheduled.isoformat(), release_date=end.isoformat() if released else None)
            if shipping:
                shipped = qty//2 if stage=='部分发货' else qty
                add('shipment_items', key+'-i', end, shipment_id=code+'-s', contact_sheet_id=key, batch_id=batch['id'] if batch else None,
                    material_no=material, shipped_quantity=shipped, unit_price=price)
                shipped_amount += shipped*price
            total += qty*price
            if dispatched and (material, month) not in costs_written:
                # One older invoice lacks a cost so the pending-cost view is populated as well.
                if not (offset==-5 and line==2):
                    add('product_costs', f'{material}-{month}', first, shared=True, material_no=material,
                        product_name=name, cost_month=month, unit_cost_no_tax=COSTS_RMB[pi], notes='虚构月度成本')
                    costs_written.add((material, month))
        if stage in ('已开票','部分发货'):
            add('invoices', code+'-inv', end, shipment_id=code+'-s', invoice_no=f'FP-{first:%y%m}-{n:02}',
                invoice_date=end.isoformat(), amount=round(shipped_amount,2), status='已收到电子发票')
            add('invoice_shipments', code+'-link', end, invoice_id=code+'-inv', shipment_id=code+'-s', allocated_amount=round(shipped_amount,2))
        if paid:
            kind = '预付款' if paid<=40 else '分批付款' if paid<100 else '其他'
            fields = dict(payment_date=end.isoformat(), currency=currency, payment_type=kind,
                          exchange_rate=rates[month] if currency=='USD' else None)
            add('payment_receipts', code+'-r', end, customer_id=customer_id, receipt_no=f'SK-{first:%y%m}-{n:02}',
                total_amount=round(total*paid/100,2), **fields)
            add('payments', code+'-p', end, receipt_id=code+'-r', contract_id=code, amount=round(total*min(100,paid)/100,2),
                allocation_effective_date=end.isoformat(), **fields)
        if stage in ('待开票','待审批','待放行'):
            reminder = {'待开票':'请开票','待审批':'请关注 QA 审批','待放行':'请检查放行情况'}[stage]
            is_shipment = stage=='待开票'
            add('alerts', code+'-alert', end, alert_type=reminder, related_type='shipment' if is_shipment else 'contact_sheet',
                related_id=code+('-s' if is_shipment else '-1'), priority='medium', status='未处理',
                message=f'{code} · {reminder}')
    add('analysis_templates', 'monthly-sales', start, name='月度销售与利润', filters={}, metrics=['sales','profit'],
        dimension='month', chart_type='composed', currency_mode='RMB')
    normalize_validate(rows)
    for entries in rows.values():
        for row in entries:
            for field in ('owner_id','created_by','updated_by'):
                if row.get(field)==owner:
                    row[field]='personal'
    return rows


def seed_sql(rows):
    data = json.dumps(rows, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace("'", "''")
    # This non-digest marker cannot be used by the personal login-code route.
    return ("INSERT INTO workspaces(id,login_hash,contents) VALUES('shared-trial','public:trial','"
            + data + "') ON CONFLICT(id) DO NOTHING;\n")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--as-of', type=date.fromisoformat, default=datetime.now(timezone(timedelta(hours=8))).date())
    args = parser.parse_args()
    out = Path(__file__).resolve().parents[1] / '.wrangler/shared-trial.sql'
    out.parent.mkdir(exist_ok=True)
    out.write_text(seed_sql(build(args.as_of)), encoding='utf-8')
