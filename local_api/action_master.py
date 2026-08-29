"""Customer merges, product lifecycle and immutable packaging versions."""
from decimal import Decimal
from .store import ApiError, RELATIONS, now, normalize_specification, number
from .action_common import object_data, owned, update, trimmed


def merge_customer_records(tx, source_customer_id, target_customer_id):
    if source_customer_id == target_customer_id:
        raise ApiError('不能把客户合并到自身')
    source = owned(tx, 'customers', source_customer_id)
    target = owned(tx, 'customers', target_customer_id)
    if source['default_currency'] != target['default_currency']:
        raise ApiError('不同默认币种的客户不能合并')
    counts = {}
    for table, relations in RELATIONS.items():
        for field, (parent, _, _) in relations.items():
            if parent != 'customers':
                continue
            moved = [r for r in tx.rows[table] if r.get(field) == source['id']]
            for row in moved:
                owned(tx, table, row['id'])
                update(row, {field: target['id']})
                if table == 'packaging_profiles':
                    row['customer_name'] = target['name']
            counts[table] = len(moved)
    # shipments have denormalized customer IDs too, outside FK relations.
    for row in tx.rows['shipments']:
        if row.get('customer_id') == source['id']:
            update(row, {'customer_id': target['id']})
    for pref in tx.rows['user_ui_preferences']:
        if pref['owner_id'] == tx.user:
            order = pref.get('customer_display_order', [])
            pref['customer_display_order'] = list(dict.fromkeys(target['id'] if id == source['id'] else id for id in order))
    tx.remove('customers', source['id'])
    return {'source_name': source['name'], 'target_name': target['name'],
            'moved_contracts': counts.get('contracts', 0),
            'moved_payment_receipts': counts.get('payment_receipts', 0),
            'moved_shipment_groups': counts.get('shipment_groups', 0), 'deleted_customers': 1}


def revise_mdc_product_variant(tx, target_variant_id, replacement_specification):
    variant = owned(tx, 'mdc_product_variants', target_variant_id)
    specification = normalize_specification(trimmed(replacement_specification, True))
    referenced = any(r.get('product_variant_id') == variant['id']
                     for table in ('contact_sheets', 'packaging_profiles') for r in tx.rows[table])
    if not referenced:
        update(variant, {'specification': specification, 'updated_by': tx.user})
        return {'variant_id': variant['id'], 'preserved_historical_variant': False}
    update(variant, {'status': 'inactive', 'updated_by': tx.user,
                    'notes': '; '.join(filter(None, [variant.get('notes'), f'已由规格“{specification}”替代']))})
    replacement = tx.add('mdc_product_variants', {
        'owner_id': variant['owner_id'], 'product_id': variant['product_id'],
        'specification': specification, 'dosage_form_override': variant.get('dosage_form_override'),
        'status': 'active', 'notes': f"替代历史规格：{variant['specification']}",
        'created_by': tx.user, 'updated_by': tx.user,
    })
    return {'variant_id': replacement['id'], 'preserved_historical_variant': True}


def set_mdc_product_variant_status(tx, target_variant_id, next_status):
    if next_status not in ('active', 'inactive'):
        raise ApiError('规格启停状态无效')
    update(owned(tx, 'mdc_product_variants', target_variant_id), {'status': next_status, 'updated_by': tx.user})
    return None


def set_mdc_product_display_order(tx, product_ids):
    if not isinstance(product_ids, list) or len(product_ids) > 5000 or any(not isinstance(i, str) for i in product_ids):
        raise ApiError('产品顺序必须为 ID 数组')
    if len(set(product_ids)) != len(product_ids):
        raise ApiError('产品顺序不能重复')
    for id in product_ids:
        owned(tx, 'mdc_products', id)
    positions = {id: index for index, id in enumerate(product_ids, 1)}
    for product in tx.rows['mdc_products']:
        if product['owner_id'] in (tx.user, 'demo-shared'):
            update(product, {'manual_sort_order': positions.get(product['id']), 'updated_by': tx.user})
    return None


def add_packaging_version(tx, profile, version_data):
    data = object_data(version_data, tx.user)
    dims = [data.get(f'{kind}_inner_{axis}_mm') for kind in ('box', 'carton') for axis in ('length', 'width', 'height')]
    if all(v is not None for v in dims) and data.get('boxes_per_carton') is not None:
        values = [number(v, '包装尺寸', True) for v in dims]
        ratio = values[3] * values[4] * values[5] / (values[0] * values[1] * values[2] * number(data['boxes_per_carton'], '每箱盒数', True))
        if not Decimal('1.08') <= ratio <= Decimal('1.20') and not trimmed(data.get('fill_ratio_override_reason')):
            raise ApiError('装箱填充比超出 1.08–1.20，请填写放行原因')
    versions = [v for v in tx.rows['packaging_profile_versions'] if v['profile_id'] == profile['id']]
    effective = now()
    for previous in versions:
        if previous.get('is_current', True):
            update(previous, {'is_current': False, 'effective_to': effective})
    data.update(profile_id=profile['id'], owner_id=profile['owner_id'],
                version_no=max((v['version_no'] for v in versions), default=0) + 1,
                is_current=True, effective_from=effective, effective_to=None)
    data.setdefault('source_type', 'manual')
    data.setdefault('review_status', 'pending')
    data.setdefault('created_by', tx.user)
    version = tx.add('packaging_profile_versions', data)
    return version['id']


def create_packaging_profile_with_version(tx, profile_data, version_data):
    data = object_data(profile_data, tx.user)
    data['product_name'] = trimmed(data.get('product_name'), True)
    profile = tx.add('packaging_profiles', data)
    add_packaging_version(tx, profile, version_data)
    return profile['id']


def create_packaging_version(tx, target_profile_id, profile_data, version_data):
    profile = owned(tx, 'packaging_profiles', target_profile_id)
    data = object_data(profile_data, tx.user)
    if 'packaging_code' in data and data['packaging_code'] != profile['packaging_code']:
        raise ApiError('包装编码不能通过新增版本更改')
    if 'product_name' in data:
        data['product_name'] = trimmed(data['product_name'], True)
    update(profile, data)
    return add_packaging_version(tx, profile, version_data)


def resolve_packaging_issue(tx, target_issue_id, note):
    issue = owned(tx, 'packaging_data_issues', target_issue_id)
    update(issue, {'status': 'resolved', 'resolution_note': trimmed(note, True),
                   'resolved_at': now(), 'resolved_by': tx.user})
    return None
