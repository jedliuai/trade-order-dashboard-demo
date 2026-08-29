"""Explicit frontend RPC registry. Reads never enter a write transaction."""
import copy
import inspect

from .store import ApiError, SALES, USERS, check_user, iso_date
from .action_common import trimmed
from . import action_shipments as shipments, action_finance as finance, action_master as master
from .action_alerts import refresh_alerts


WRITES = {fn.__name__: fn for fn in (
    shipments.replace_contact_sheet_batches, shipments.update_batch_tracking,
    shipments.create_shipment_with_items, shipments.replace_shipment_items,
    shipments.update_shipment_with_items, shipments.create_shipment_group_with_items,
    shipments.confirm_shipment_group_dispatched,
    finance.create_payment_receipt_with_allocations, finance.update_payment_receipt_with_allocations,
    finance.return_payment_allocation_to_deposit, finance.create_invoice_with_shipments,
    finance.update_invoice_with_shipments, finance.mark_physical_shipment_invoiced,
    finance.update_physical_shipment_invoice, finance.set_physical_shipment_freight,
    master.merge_customer_records, master.revise_mdc_product_variant,
    master.set_mdc_product_variant_status, master.set_mdc_product_display_order,
    master.create_packaging_profile_with_version, master.create_packaging_version,
    master.resolve_packaging_issue, refresh_alerts,
)}


def get_operating_metrics(store, user, p_start_date, p_end_date, p_owner_id=None):
    if p_owner_id is not None and (p_owner_id not in USERS or (user in SALES and p_owner_id != user)):
        raise ApiError('无权查看所选账号的经营指标', 403)
    if iso_date(p_start_date) > iso_date(p_end_date):
        raise ApiError('开始日期不能晚于结束日期')
    from .metrics import operating_metrics
    return operating_metrics(store.snapshot(user), p_start_date, p_end_date, p_owner_id)


def identity_conflicts(store, user, table, values, exclude=None):
    # These company-wide lookups intentionally return ONLY existing identifier
    # metadata, not row IDs, amounts, customer names, or arbitrary projections.
    if not isinstance(values, list) or len(values) > 500:
        raise ApiError('每次最多检查 500 个业务标识')
    wanted = {}
    for value in values:
        text = trimmed(value)
        if text:
            if len(text) > 200:
                raise ApiError('业务标识过长')
            wanted.setdefault(text.casefold(), text)
    if not wanted:
        return []
    rows = store.snapshot()
    contracts = {r['id']: r for r in rows['contracts']}
    sheets = {r['id']: r for r in rows['contact_sheets']}
    names = {r.get('user_id', r['id']): r.get('display_name', '演示同事') for r in rows['app_user_profiles']}
    field = {'contracts': 'contract_no', 'contact_sheets': 'contact_sheet_no', 'batches': 'batch_no'}[table]
    result = {}
    for row in sorted(rows[table], key=lambda r: (r.get('created_at') or '', r['id'])):
        key = str(row.get(field) or '').strip().casefold()
        if key not in wanted or key in result:
            continue
        if (row.get('contact_sheet_id') if table == 'batches' else row['id']) == exclude:
            continue
        if table == 'contracts' and row['owner_id'] == user:
            continue
        sheet = row if table == 'contact_sheets' else sheets[row['contact_sheet_id']] if table == 'batches' else None
        contract = contracts[sheet['contract_id']] if sheet else row
        item = {'owner_display_name': names.get(row['owner_id'], '演示同事'), 'contract_no': contract['contract_no']}
        if sheet:
            item['contact_sheet_no'] = sheet.get('contact_sheet_no')
        if table == 'batches':
            item['batch_no'] = wanted[key]
        result[key] = item
    return [result[k] for k in sorted(result)]


def get_global_contact_sheet_number_conflict(store, user, p_contact_sheet_no, p_exclude_contact_sheet_id=None):
    found = identity_conflicts(store, user, 'contact_sheets', [p_contact_sheet_no], p_exclude_contact_sheet_id)
    return found[0] if found else None


def get_global_contract_number_conflict(store, user, p_contract_no, p_exclude_contract_id=None):
    found = identity_conflicts(store, user, 'contracts', [p_contract_no], p_exclude_contract_id)
    return found[0] if found else None


def get_global_batch_number_conflicts(store, user, p_batch_numbers, p_exclude_contact_sheet_id=None):
    return identity_conflicts(store, user, 'batches', p_batch_numbers, p_exclude_contact_sheet_id)


READS = {fn.__name__: fn for fn in (get_operating_metrics, get_global_contact_sheet_number_conflict,
                                   get_global_contract_number_conflict, get_global_batch_number_conflicts)}


def dispatch(store, name, params, user):
    check_user(user)
    if not isinstance(params, dict):
        raise ApiError('RPC 参数必须是 JSON 对象')
    if name not in READS and name not in WRITES:
        raise ApiError(f'未知业务动作：{name}', 404, 'unknown_action')
    function = READS.get(name) or WRITES[name]
    leading = (store, user) if name in READS else (None,)
    try:
        inspect.signature(function).bind(*leading, **params)
    except TypeError as error:
        raise ApiError(f'动作参数不匹配：{error}') from None
    if name in READS:
        return function(store, user, **params)
    check_user(user, True)
    with store.transaction(user) as tx:
        result = function(tx, **params)
    return copy.deepcopy(result)
