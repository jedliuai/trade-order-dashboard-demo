"""Small shared input guards; all writers receive the same live transaction."""
import copy
from .store import ApiError, SHARED, now


def object_data(value, user):
    if not isinstance(value, dict):
        raise ApiError('动作数据必须为 JSON 对象')
    if value.get('owner_id', user) != user:
        raise ApiError('不能伪造数据所有者', 403)
    if any(k in value for k in ('id', 'created_at')):
        raise ApiError('不能通过动作指定主键或创建时间', 403)
    return {k: copy.deepcopy(v) for k, v in value.items() if k not in ('owner_id', 'updated_at')}


def row_list(value, user, nonempty=True):
    if not isinstance(value, list) or len(value) > 5000 or (nonempty and not value):
        raise ApiError('动作明细必须为有效数组' + ('且至少有一行' if nonempty else ''))
    return [object_data(row, user) for row in value]


def owned(tx, table, id):
    row = tx.get(table, id)
    if row['owner_id'] != tx.user and not (row['owner_id'] == SHARED and table.startswith(('mdc_', 'packaging_'))):
        raise ApiError('无权修改该记录', 403)
    return row


def update(row, data):
    row.update(data)
    row['updated_at'] = now()


def trimmed(value, required=False):
    if value is not None and not isinstance(value, str):
        raise ApiError('文本字段必须为字符串')
    text = (value or '').strip()
    if required and not text:
        raise ApiError('必填文本不能为空')
    return text or None


def remove_children(tx, table, field, parent):
    for row in list(tx.rows[table]):
        if row.get(field) == parent:
            tx.remove(table, row['id'])
