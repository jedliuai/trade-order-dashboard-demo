"""SQLite JSON documents with atomic validation and real deferred foreign keys.

Every public mutation is serialized by BEGIN IMMEDIATE, validates the complete
resulting graph, and commits documents and reference edges together. Readers
see a single committed snapshot; failed multi-document actions leave no traces.
"""
from collections import defaultdict
from contextlib import contextmanager
import copy
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import math
from pathlib import Path
import re
import sqlite3
import unicodedata
import uuid

SALES = ('demo-sales-1', 'demo-sales-2', 'demo-sales-3')
USERS = (*SALES, 'demo-manager', 'demo-owner')
SHARED = 'demo-shared'
TABLES = (
    'customers', 'contracts', 'contact_sheets', 'batches', 'shipments',
    'shipment_groups', 'shipment_items', 'payments', 'payment_receipts',
    'invoices', 'invoice_shipments', 'exchange_rates', 'product_costs',
    'alerts', 'sync_logs', 'analysis_templates', 'app_user_profiles',
    'user_ui_preferences', 'contact_sheet_change_history',
    'payment_receipt_change_history', 'mdc_products', 'mdc_product_aliases',
    'mdc_product_variants', 'packaging_profiles', 'packaging_profile_versions',
    'packaging_data_issues',
)
VIEWS = ('v_shipment_profit', 'packaging_current_profiles')
READ_ONLY = {'app_user_profiles', 'product_costs', 'contact_sheet_change_history',
             'payment_receipt_change_history', *VIEWS}
PAYMENT_TYPES = ('预付款', '尾款', '分批付款', '提单后付款', '信用证', '其他')
# field: (target table, required, delete policy). Never interpolate these from HTTP.
RELATIONS = {
    'contracts': {'customer_id': ('customers', True, 'restrict')},
    'contact_sheets': {'contract_id': ('contracts', True, 'cascade'),
                      'product_variant_id': ('mdc_product_variants', False, 'restrict'),
                      'packaging_profile_version_id': ('packaging_profile_versions', False, 'restrict')},
    'batches': {'contact_sheet_id': ('contact_sheets', True, 'cascade')},
    'shipment_groups': {'customer_id': ('customers', True, 'restrict')},
    'shipments': {'contract_id': ('contracts', True, 'cascade'), 'shipment_group_id': ('shipment_groups', False, 'cascade')},
    'shipment_items': {'shipment_id': ('shipments', True, 'cascade'), 'contact_sheet_id': ('contact_sheets', True, 'restrict'), 'batch_id': ('batches', False, 'restrict')},
    'payment_receipts': {'customer_id': ('customers', True, 'restrict')},
    'payments': {'contract_id': ('contracts', True, 'cascade'), 'shipment_id': ('shipments', False, 'null'), 'receipt_id': ('payment_receipts', False, 'cascade')},
    'invoices': {'shipment_id': ('shipments', True, 'cascade'), 'customer_id': ('customers', False, 'restrict')},
    'invoice_shipments': {'invoice_id': ('invoices', True, 'cascade'), 'shipment_id': ('shipments', True, 'cascade')},
    'contact_sheet_change_history': {'contact_sheet_id': ('contact_sheets', True, 'cascade')},
    'payment_receipt_change_history': {'receipt_id': ('payment_receipts', True, 'cascade')},
    'mdc_product_aliases': {'product_id': ('mdc_products', True, 'cascade')},
    'mdc_product_variants': {'product_id': ('mdc_products', True, 'cascade')},
    'packaging_profiles': {'product_variant_id': ('mdc_product_variants', False, 'restrict'), 'customer_id': ('customers', False, 'restrict')},
    'packaging_profile_versions': {'profile_id': ('packaging_profiles', True, 'cascade')},
    'packaging_data_issues': {'version_id': ('packaging_profile_versions', True, 'cascade')},
}


class ApiError(ValueError):
    def __init__(self, message, status=400, code='invalid_request'):
        super().__init__(message)
        self.status, self.code = status, code


def now():
    return datetime.now(timezone.utc).isoformat()


def number(value, label='数值', positive=False):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ApiError(f'{label}必须是有效数字') from None
    if not result.is_finite() or (positive and result <= 0):
        raise ApiError(f'{label}必须是有限数值' + ('且大于 0' if positive else ''))
    return result


def amount(value):
    try:
        result = float(value.quantize(Decimal('0.000001')))
        if not math.isfinite(result):
            raise ValueError()
        return result
    except (InvalidOperation, ValueError, OverflowError):
        raise ApiError('数值超出支持的精度范围') from None


def iso_date(value, label='日期'):
    try:
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError()
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ApiError(f'{label}须为有效 YYYY-MM-DD 日期') from None


def check_user(user, write=False):
    if user not in USERS:
        raise ApiError('未知演示角色', 403, 'forbidden')
    if write and user not in SALES:
        raise ApiError('经理和老板为只读演示角色', 403, 'read_only_role')


def visible(row, user, table=''):
    if table == 'user_ui_preferences':
        return row.get('owner_id') == user
    return row.get('owner_id') in ({user, SHARED} if user in SALES else {*USERS, SHARED})


def normalize_identity(text):
    return ''.join(c for c in str(text).casefold() if c.isalnum())


def normalize_specification(value):
    text = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value)).strip())
    units = r'(?:miu|mcg|iu|kg|mg|ug|ml|g|l|u)'
    text = re.sub(r'(^|[^A-Za-z])(' + units + r')(?=$|[^A-Za-z])',
                  lambda m: m[1] + m[2].lower(), text, flags=re.I)
    text = re.sub(r'(\d)\s+(?=' + units + r'(?:$|[^A-Za-z]))', r'\1', text, flags=re.I)
    return re.sub(r'(\d+\.\d+)(?=' + units + r'(?:$|[^A-Za-z]))',
                  lambda m: format(Decimal(m[1]).normalize(), 'f'), text, flags=re.I)


def specification_key(value):
    return re.sub(r'\s+', '', normalize_specification(value)).casefold()


def split_fields(text):
    depth, start, result = 0, 0, []
    for index, char in enumerate(text):
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif char == ',' and depth == 0:
            result.append(text[start:index])
            start = index + 1
        if depth < 0:
            raise ApiError('select 括号不匹配')
    if depth:
        raise ApiError('select 括号不匹配')
    return result + [text[start:]]


def filtered(rows, params=None, paginate=True):
    params = params or {}
    selected = list(rows)
    for field, expression in params.items():
        if field in {'select', 'order', 'limit', 'offset', 'on_conflict'}:
            continue
        if not re.fullmatch(r'[a-z_][a-z0-9_]*', field):
            raise ApiError('不支持的筛选字段')
        if not isinstance(expression, str) or '.' not in expression:
            raise ApiError('筛选需使用 eq./in./gte. 等运算符')
        op, value = expression.split('.', 1)
        negate = op == 'not'
        if negate:
            if '.' not in value:
                raise ApiError('无效 not 筛选')
            op, value = value.split('.', 1)
        if op not in {'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'}:
            raise ApiError(f'不支持筛选运算符：{op}')
        if op == 'in' and not (value.startswith('(') and value.endswith(')')):
            raise ApiError('in 筛选需要括号列表')
        def matches(row):
            raw = row.get(field)
            actual = str(raw).lower() if isinstance(raw, bool) else str(raw) if raw is not None else 'null'
            if op == 'is':
                if value not in ('null', 'true', 'false'):
                    raise ApiError('is 只支持 null/true/false')
                hit = actual == value
            elif op == 'in':
                hit = actual in [v.strip().strip('"') for v in split_fields(value[1:-1])]
            elif op in ('like', 'ilike'):
                pattern = re.escape(value).replace(r'\*', '.*').replace('%', '.*')
                hit = re.fullmatch(pattern, actual, flags=re.I if op == 'ilike' else 0) is not None
            elif op in ('eq', 'neq'):
                hit = actual == value
                if op == 'neq':
                    hit = not hit
            elif raw is None:
                hit = False
            else:
                left, right = (number(raw), number(value)) if isinstance(raw, (int, float)) else (actual, value)
                hit = {'gt': left > right, 'gte': left >= right, 'lt': left < right, 'lte': left <= right}[op]
            return not hit if negate else hit
        selected = [row for row in selected if matches(row)]
    for term in reversed(params.get('order', '').split(',')):
        if not term:
            continue
        parts = term.split('.')
        if len(parts) > 3 or any(p not in ('asc', 'desc', 'nullsfirst', 'nullslast') for p in parts[1:]):
            raise ApiError('无效排序参数')
        present = [row for row in selected if row.get(parts[0]) is not None]
        absent = [row for row in selected if row.get(parts[0]) is None]
        try:
            present.sort(key=lambda row: row[parts[0]], reverse='desc' in parts)
        except TypeError:
            raise ApiError('排序字段类型不一致') from None
        nulls_first = 'nullsfirst' in parts or ('desc' in parts and 'nullslast' not in parts)
        selected = absent + present if nulls_first else present + absent
    if paginate:
        try:
            offset = int(params.get('offset', 0))
            limit = int(params.get('limit', 100000))
        except (ValueError, TypeError):
            raise ApiError('limit/offset 必须为整数') from None
        if offset < 0 or limit < 0 or limit > 100000:
            raise ApiError('limit/offset 超出允许范围')
        selected = selected[offset:offset + limit]
    return selected


class Transaction:
    def __init__(self, rows, user):
        self.rows, self.user = rows, user

    def get(self, table, id):
        row = next((r for r in self.rows[table] if r['id'] == id), None)
        if not row or not visible(row, self.user, table):
            raise ApiError(f'{table} 记录不存在或无权访问', 404, 'not_found')
        return row

    def add(self, table, data):
        if not isinstance(data, dict):
            raise ApiError('数据行必须为 JSON 对象')
        row = copy.deepcopy(data)
        row.setdefault('id', str(uuid.uuid4()))
        row.setdefault('owner_id', self.user)
        row.setdefault('created_at', now())
        row.setdefault('updated_at', row['created_at'])
        self.rows[table].append(row)
        return row

    def remove(self, table, id):
        self.get(table, id)
        # Cascade closure first, then restrict checks (parent and children may
        # both be scheduled for deletion within the same transaction).
        targets = {(table, id)}
        changed = True
        while changed:
            changed = False
            for child, relations in RELATIONS.items():
                for row in self.rows[child]:
                    if (child, row['id']) in targets:
                        continue
                    if any(policy == 'cascade' and (parent, row.get(field)) in targets
                           for field, (parent, _, policy) in relations.items()):
                        targets.add((child, row['id']))
                        changed = True
        for child, relations in RELATIONS.items():
            for row in self.rows[child]:
                if (child, row['id']) in targets:
                    continue
                for field, (parent, _, policy) in relations.items():
                    if (parent, row.get(field)) in targets:
                        if policy == 'restrict':
                            raise ApiError(f'记录仍被 {child} 引用，不能删除', 409, 'referenced')
                        if policy == 'null':
                            row[field] = None
        for child in TABLES:
            self.rows[child] = [r for r in self.rows[child] if (child, r['id']) not in targets]


class Store:
    def __init__(self, path, seed_path=None):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.uses_default_seed = seed_path is None
        self.seed_path = Path(seed_path).resolve() if seed_path else Path(__file__).resolve().parents[1] / 'data/demo-seed.json'
        with self.connection() as conn:
            conn.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS documents (
                    table_name TEXT NOT NULL, id TEXT NOT NULL,
                    body TEXT NOT NULL CHECK(json_valid(body)),
                    PRIMARY KEY(table_name,id));
                CREATE TABLE IF NOT EXISTS refs (
                    source_table TEXT NOT NULL, source_id TEXT NOT NULL, field TEXT NOT NULL,
                    target_table TEXT NOT NULL, target_id TEXT NOT NULL,
                    PRIMARY KEY(source_table,source_id,field),
                    FOREIGN KEY(source_table,source_id) REFERENCES documents(table_name,id)
                        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
                    FOREIGN KEY(target_table,target_id) REFERENCES documents(table_name,id)
                        DEFERRABLE INITIALLY DEFERRED);
            ''')
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if not conn.execute("SELECT 1 FROM metadata WHERE key='initialized'").fetchone():
                rows = self.read_seed()
                normalize_validate(rows)
                self.persist(conn, rows)
                conn.execute("INSERT INTO metadata VALUES ('initialized','1')")

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=20)
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=20000')
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def read_seed(self):
        if self.uses_default_seed:
            from .seed import build_seed
            source = build_seed(date.today())
        elif self.seed_path.is_file():
            source = json.loads(self.seed_path.read_text(encoding='utf-8-sig'))
        else:
            from .seed import build_seed
            source = build_seed(date.today())
        if not isinstance(source, dict) or any(table not in TABLES for table in source):
            raise ApiError('种子包含未知表')
        result = {table: copy.deepcopy(source.get(table, [])) for table in TABLES}
        return result

    @staticmethod
    def load(conn):
        rows = {table: [] for table in TABLES}
        for table, body in conn.execute('SELECT table_name,body FROM documents ORDER BY rowid'):
            rows[table].append(json.loads(body))
        return rows

    @staticmethod
    def persist(conn, rows):
        # Delta documents; reference index is rebuilt in the same SQLite tx.
        old = {(t, i): b for t, i, b in conn.execute('SELECT table_name,id,body FROM documents')}
        new = {(t, r['id']): json.dumps(r, ensure_ascii=False, sort_keys=True, allow_nan=False) for t in TABLES for r in rows[t]}
        conn.execute('DELETE FROM refs')
        conn.executemany('DELETE FROM documents WHERE table_name=? AND id=?', old.keys() - new.keys())
        conn.executemany('INSERT INTO documents VALUES (?,?,?) ON CONFLICT(table_name,id) DO UPDATE SET body=excluded.body',
                         [(t, i, b) for (t, i), b in new.items() if old.get((t, i)) != b])
        edges = []
        for table, relations in RELATIONS.items():
            for row in rows[table]:
                for field, (target, _, _) in relations.items():
                    if row.get(field):
                        edges.append((table, row['id'], field, target, row[field]))
        conn.executemany('INSERT INTO refs VALUES (?,?,?,?,?)', edges)

    def snapshot(self, user=None):
        if user:
            check_user(user)
        with self.connection() as conn:
            rows = self.load(conn)
        return {table: [row for row in values if user is None or visible(row, user, table)] for table, values in rows.items()}

    @contextmanager
    def transaction(self, user=SALES[0]):
        check_user(user, write=True)
        try:
            with self.connection() as conn:
                conn.execute('BEGIN IMMEDIATE')
                rows = self.load(conn)
                before = copy.deepcopy(rows)
                tx = Transaction(rows, user)
                yield tx
                normalize_validate(rows, before)
                self.persist(conn, rows)
        except sqlite3.IntegrityError:
            raise ApiError('关联约束冲突，整笔操作已回滚', 409, 'integrity_error') from None

    def query(self, table, params=None, user=SALES[0]):
        check_user(user)
        if table not in (*TABLES, *VIEWS):
            raise ApiError(f'未知数据表：{table}', 404, 'unknown_table')
        select = (params or {}).get('select', '*')
        fields = split_fields(select)
        if table in VIEWS or any('(' in field for field in fields):
            rows = self.snapshot(user)
        else:
            # One indexed, parameterized read avoids deserializing the entire
            # demo graph for every ordinary table/page request.
            with self.connection() as conn:
                values = [json.loads(body) for (body,) in conn.execute(
                    'SELECT body FROM documents WHERE table_name=? ORDER BY rowid', (table,))]
            rows = {table: [row for row in values if visible(row, user, table)]}
        if table == 'v_shipment_profit':
            from .metrics import shipment_profits
            result = shipment_profits(rows)
        elif table == 'packaging_current_profiles':
            result = []
            for profile in rows['packaging_profiles']:
                versions = [v for v in rows['packaging_profile_versions'] if v['profile_id'] == profile['id']]
                if versions:
                    version = max(versions, key=lambda v: v['version_no'])
                    result.append({**profile, **version, 'id': profile['id'], 'profile_id': profile['id'],
                                   'version_id': version['id'], 'version_count': len(versions),
                                   'version_created_at': version.get('created_at'),
                                   'updated_at': profile.get('updated_at'),
                                   'open_issue_count': sum(i.get('status') == 'open' for i in rows['packaging_data_issues']
                                       if i['version_id'] in {v['id'] for v in versions})})
        else:
            result = rows[table]
        result = filtered(result, params)
        output = []
        for row in result:
            item = copy.deepcopy(row) if '*' in fields else {}
            for field in fields:
                if field == '*':
                    continue
                if '(' in field:
                    match = re.fullmatch(r'(aliases|variants):(mdc_product_aliases|mdc_product_variants)\((.*)\)', field)
                    if table != 'mdc_products' or not match:
                        raise ApiError('不支持该嵌套 select')
                    alias, child, columns = match.groups()
                    item[alias] = [{k: v.get(k) for k in columns.split(',')} for v in rows[child] if v['product_id'] == row['id']]
                elif re.fullmatch(r'[a-z_][a-z0-9_]*', field):
                    item[field] = row.get(field)
                else:
                    raise ApiError('不支持该 select')
            output.append(item)
        return output

    def writable(self, table, user):
        check_user(user, True)
        if table not in TABLES:
            raise ApiError('未知或不可写数据表', 404, 'unknown_table')
        if table in READ_ONLY:
            raise ApiError('该表只读', 403, 'read_only_table')

    def insert(self, table, data, params=None, user=SALES[0]):
        self.writable(table, user)
        values = data if isinstance(data, list) else [data]
        if not values:
            raise ApiError('至少需要一条数据')
        saved = []
        with self.transaction(user) as tx:
            conflict = (params or {}).get('on_conflict')
            if conflict and (table, conflict) not in {('user_ui_preferences', 'owner_id'), ('exchange_rates', 'owner_id,effective_month,currency_pair'), ('analysis_templates', 'owner_id,name')}:
                raise ApiError('不支持该 on_conflict')
            for value in values:
                if not isinstance(value, dict):
                    raise ApiError('数据行必须是对象')
                if value.get('owner_id', user) != user and not (table == 'exchange_rates' and value.get('owner_id') == SHARED):
                    raise ApiError('不能伪造数据所有者', 403)
                value = {**value, 'owner_id': SHARED if table == 'exchange_rates' else user}
                found = next((r for r in tx.rows[table] if all(r.get(k) == value.get(k) for k in conflict.split(','))), None) if conflict else None
                if found:
                    found.update({k: v for k, v in value.items() if k not in ('id', 'created_at')})
                    found['updated_at'] = now()
                    saved.append(found)
                else:
                    saved.append(tx.add(table, value))
        return copy.deepcopy(saved)

    def update(self, table, params, data, user=SALES[0]):
        self.writable(table, user)
        if table == 'packaging_profile_versions':
            raise ApiError('包装参数版本不可变，请创建新版本')
        if not isinstance(data, dict) or not params or not any(k not in ('select', 'order', 'limit', 'offset', 'on_conflict') for k in params):
            raise ApiError('更新必须提供对象和明确筛选')
        if any(k in data for k in ('id', 'owner_id', 'created_at')):
            raise ApiError('不能修改主键或所有者', 403)
        with self.transaction(user) as tx:
            selected = filtered([r for r in tx.rows[table] if visible(r, user, table)], params, False)
            if not selected:
                raise ApiError('记录不存在、无权访问或版本已变化', 409, 'stale_write')
            for row in selected:
                if table == 'payments' and row.get('receipt_id'):
                    raise ApiError('组合收款必须通过整笔收款动作修改')
                if table == 'shipments' and row.get('shipment_group_id'):
                    raise ApiError('合并发货必须整单维护')
                row.update(copy.deepcopy(data))
                row['updated_at'] = now()
        return copy.deepcopy(selected)

    def delete(self, table, params, user=SALES[0]):
        self.writable(table, user)
        if not params or not any(k not in ('select', 'order', 'limit', 'offset', 'on_conflict') for k in params):
            raise ApiError('删除必须提供明确筛选')
        with self.transaction(user) as tx:
            selected = filtered([r for r in tx.rows[table] if visible(r, user, table)], params, False)
            if not selected:
                raise ApiError('记录不存在或无权访问', 404)
            for row in selected:
                if table == 'payments' and row.get('receipt_id'):
                    raise ApiError('请从收款主单删除分摊或退回预存款')
                if table == 'shipments' and row.get('shipment_group_id'):
                    raise ApiError('合并发货必须整单删除')
                tx.remove(table, row['id'])
        return selected

    def rpc(self, name, params=None, user=SALES[0]):
        from .actions import dispatch
        return dispatch(self, name, params or {}, user)

    def reset(self, confirm, user=SALES[0]):
        check_user(user, True)
        if confirm != 'RESET_DEMO':
            raise ApiError('重置需要 confirm=RESET_DEMO')
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            before = self.load(conn)
            replacement = self.read_seed()
            normalize_validate(replacement)
            directory = self.path.parent / 'backups'
            directory.mkdir(parents=True, exist_ok=True)
            backup = directory / f'demo-{datetime.now().strftime("%Y%m%d-%H%M%S")}-{uuid.uuid4().hex[:8]}.json'
            with backup.open('x', encoding='utf-8') as handle:
                json.dump(before, handle, ensure_ascii=False, indent=2)
                handle.flush()
                import os
                os.fsync(handle.fileno())
            self.persist(conn, replacement)
        return {'status': 'ok', 'backup_path': str(backup), 'counts': {t: len(v) for t, v in replacement.items()}}


def normalize_validate(rows, before=None):
    """Validate final graph, not individual SQL statement ordering."""
    indexed = {}
    for table in TABLES:
        indexed[table] = {}
        for row in rows[table]:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id']:
                raise ApiError(f'{table} 缺少有效 ID')
            if row['id'] in indexed[table]:
                raise ApiError(f'{table} ID 重复', 409)
            if row.get('owner_id') not in (*USERS, SHARED):
                raise ApiError(f'{table} 所有者无效', 403)
            indexed[table][row['id']] = row
            for key, value in row.items():
                if key.endswith('_date') and value not in (None, ''):
                    if key in ('production_date', 'expiry_date') and re.fullmatch(r'\d{4}-\d{2}', str(value)):
                        iso_date(value + '-01')
                    else:
                        iso_date(value, key)
    for table, relations in RELATIONS.items():
        for row in rows[table]:
            for field, (target, required, _) in relations.items():
                id = row.get(field)
                if id in (None, '') and not required:
                    continue
                if not isinstance(id, str):
                    raise ApiError(f'{table}.{field} 必须是有效关联 ID')
                parent = indexed[target].get(id)
                if parent is None:
                    raise ApiError(f'{table}.{field} 引用不存在的 {target}', 409, 'foreign_key')
                if parent['owner_id'] not in (row['owner_id'], SHARED):
                    raise ApiError('关联数据所有者不一致', 403, 'cross_owner')
    def positive(row, field, required=True):
        if required or row.get(field) not in (None, ''):
            row[field] = amount(number(row.get(field), field, True))
            if row[field] <= 0:
                raise ApiError(f'{field} 不能小于支持的正数精度')
    def unique(table, fields, normal=lambda x: str(x).strip().casefold(), optional=False, active=False):
        seen = set()
        for row in rows[table]:
            if active and row.get('status', 'active') != 'active':
                continue
            if optional and not str(row.get(fields[-1]) or '').strip():
                continue
            key = tuple(normal(row.get(f, '')) for f in fields)
            if key in seen:
                raise ApiError(f'{table} 的 {fields[-1]} 重复', 409, 'duplicate')
            seen.add(key)
    unique('customers', ('owner_id', 'name'), normalize_identity)
    unique('contracts', ('owner_id', 'contract_no'))
    unique('contact_sheets', ('contact_sheet_no',), optional=True)
    for table, field in [('shipments', 'shipment_no'), ('shipment_groups', 'shipment_no'), ('invoices', 'invoice_no'), ('payment_receipts', 'receipt_no')]:
        unique(table, ('owner_id', field), optional=table in ('invoices', 'payment_receipts'))
    unique('batches', ('contact_sheet_id', 'batch_no'))
    unique('exchange_rates', ('owner_id', 'effective_month', 'currency_pair'))
    unique('user_ui_preferences', ('owner_id',))
    unique('analysis_templates', ('owner_id', 'name'))
    unique('mdc_product_variants', ('product_id', 'specification'), specification_key, active=True, optional=True)
    unique('mdc_product_aliases', ('product_id', 'alias'))
    unique('invoice_shipments', ('invoice_id', 'shipment_id'))
    sheets_by_contract, batches_by_sheet = defaultdict(list), defaultdict(list)
    for customer in rows['customers']:
        if not str(customer.get('name', '')).strip():
            raise ApiError('客户名称不能为空')
        customer.setdefault('default_currency', 'USD')
        if customer['default_currency'] not in ('USD', 'RMB'):
            raise ApiError('客户币种无效')
    for contract in rows['contracts']:
        customer = indexed['customers'][contract['customer_id']]
        contract.setdefault('currency', customer['default_currency'])
        if contract['currency'] != customer['default_currency']:
            raise ApiError('同一客户必须使用默认币种')
        contract.setdefault('export_type', '自营' if contract['currency'] == 'USD' else '转口')
        contract.setdefault('incoterm', 'FOB' if contract['currency'] == 'USD' else None)
        if (contract['currency'] == 'USD' and contract['incoterm'] not in ('FOB', 'CIF')) or (contract['currency'] == 'RMB' and contract['incoterm'] is not None):
            raise ApiError('贸易术语与币种不匹配')
        if not str(contract.get('contract_no', '')).strip() or contract['export_type'] not in ('自营', '转口'):
            raise ApiError('合同号或出口类型无效')
        if (contract['currency'], contract['export_type']) not in (('USD', '自营'), ('RMB', '转口')):
            raise ApiError('出口类型与客户币种不匹配')
    old_sheets = {r['id']: r for r in before['contact_sheets']} if before is not None else {}
    for sheet in rows['contact_sheets']:
        positive(sheet, 'quantity')
        positive(sheet, 'unit_price')
        for field in ('pcs_per_carton', 'gross_weight_kg'):
            positive(sheet, field, False)
        sheet.setdefault('business_type', '制剂')
        if sheet['business_type'] not in ('制剂', '原料药') or sheet.get('unit') not in ('支', '盒', '瓶', 'kg', '十亿'):
            raise ApiError('联系单业务类型或计量单位无效')
        if before is not None and sheet.get('product_variant_id'):
            old = old_sheets.get(sheet['id'], {})
            changed = not old or any(sheet.get(k) != old.get(k) for k in ('product_variant_id', 'business_type', 'product_name', 'specification'))
            if changed:
                variant = indexed['mdc_product_variants'][sheet['product_variant_id']]
                product = indexed['mdc_products'][variant['product_id']]
                expected = 'raw_material' if sheet['business_type'] == '原料药' else 'finished_product'
                if product.get('product_type') != expected:
                    raise ApiError('所选产品规格与联系单业务类型不一致')
                if not sheet.get('is_historical') and variant.get('status', 'active') != 'active':
                    raise ApiError('所选产品规格已停用，请选择启用规格')
                sheet['product_name'], sheet['specification'] = product['chinese_name'], variant.get('specification', '')
        sheets_by_contract[sheet['contract_id']].append(sheet)
    for batch in rows['batches']:
        positive(batch, 'batch_quantity')
        if not str(batch.get('batch_no', '')).strip():
            raise ApiError('批号不能为空')
        batches_by_sheet[batch['contact_sheet_id']].append(batch)
    for id, batches in batches_by_sheet.items():
        sheet = indexed['contact_sheets'][id]
        if not sheet.get('is_historical') and sum(number(b['batch_quantity']) for b in batches) != number(sheet['quantity']):
            raise ApiError('批次数量合计必须等于联系单数量', 409)
    items_by_shipment, used_sheet, used_batch, shipped_sheet = defaultdict(list), defaultdict(Decimal), defaultdict(Decimal), defaultdict(Decimal)
    for group in rows['shipment_groups']:
        customer = indexed['customers'][group['customer_id']]
        group.setdefault('currency', customer['default_currency'])
        group.setdefault('incoterm', 'FOB' if group['currency'] == 'USD' else None)
        group.setdefault('status', '准备中')
        if not str(group.get('shipment_no') or '').strip() or group['status'] not in ('准备中', '已发货', '取消'):
            raise ApiError('合并发货单号或状态无效')
        if group['currency'] != customer['default_currency'] or (group['currency'] == 'USD' and group['incoterm'] not in ('FOB', 'CIF')) or (group['currency'] == 'RMB' and group['incoterm'] is not None):
            raise ApiError('合并发货币种或贸易术语无效')
        positive(group, 'freight_insurance_amount', False)
    for shipment in rows['shipments']:
        contract = indexed['contracts'][shipment['contract_id']]
        shipment.setdefault('status', '准备中')
        shipment.setdefault('incoterm_snapshot', contract['incoterm'])
        shipment['currency'] = contract['currency']
        shipment['customer_id'] = contract['customer_id']
        if shipment['status'] not in ('准备中', '已发货', '取消'):
            raise ApiError('发货状态无效')
        if not str(shipment.get('shipment_no') or '').strip() or shipment['incoterm_snapshot'] not in (None, 'FOB', 'CIF'):
            raise ApiError('发货单号或贸易术语快照无效')
        if shipment['status'] == '已发货' and not shipment.get('shipment_date'):
            raise ApiError('已发货必须填写实际发货日期')
        positive(shipment, 'freight_insurance_amount', False)
        if shipment.get('shipment_group_id'):
            group = indexed['shipment_groups'][shipment['shipment_group_id']]
            # Older group headers may omit the date; the actual child shipment
            # date remains required. Payment checks are free text in the schema.
            if any(group.get(f) != shipment.get(f) for f in ('customer_id', 'currency', 'status')) or group.get('incoterm') != shipment['incoterm_snapshot'] or (group.get('shipment_date') and group['shipment_date'] != shipment.get('shipment_date')):
                raise ApiError('合并发货客户、币种、贸易术语或状态不一致')
    for item in rows['shipment_items']:
        positive(item, 'shipped_quantity')
        positive(item, 'unit_price')
        item['amount'] = amount(number(item['shipped_quantity']) * number(item['unit_price']))
        shipment = indexed['shipments'][item['shipment_id']]
        sheet = indexed['contact_sheets'][item['contact_sheet_id']]
        if shipment['contract_id'] != sheet['contract_id']:
            raise ApiError('发货明细不属于当前合同')
        if item.get('batch_id'):
            batch = indexed['batches'][item['batch_id']]
            if batch['contact_sheet_id'] != sheet['id']:
                raise ApiError('批次不属于当前联系单')
        elif sheet['business_type'] != '原料药' and not sheet.get('is_historical'):
            raise ApiError('非历史制剂发货必须指定批次')
        items_by_shipment[shipment['id']].append(item)
        if shipment['status'] != '取消':
            used_sheet[sheet['id']] += number(item['shipped_quantity'])
            if item.get('batch_id'):
                used_batch[item['batch_id']] += number(item['shipped_quantity'])
        if shipment['status'] == '已发货':
            if (sheet['business_type'] != '原料药' and not sheet.get('is_historical')
                    and not sheet.get('actual_warehousing_date')
                    and not (item.get('batch_id') and indexed['batches'][item['batch_id']].get('warehouse_date'))):
                raise ApiError('非历史制剂实际发货前必须完成入库')
            shipped_sheet[sheet['id']] += number(item['shipped_quantity'])
    for id, used in used_sheet.items():
        if used > number(indexed['contact_sheets'][id]['quantity']):
            raise ApiError('发货数量超过联系单可用数量', 409, 'capacity')
    for id, used in used_batch.items():
        if used > number(indexed['batches'][id]['batch_quantity']):
            raise ApiError('发货数量超过批次可用数量', 409, 'capacity')
    for shipment in rows['shipments']:
        shipment['amount'] = amount(sum((number(i['amount']) for i in items_by_shipment[shipment['id']]), Decimal(0)))
    for receipt in rows['payment_receipts']:
        receipt.pop('amount', None)
        positive(receipt, 'total_amount')
        customer = indexed['customers'][receipt['customer_id']]
        receipt.setdefault('currency', customer['default_currency'])
        if receipt['currency'] != customer['default_currency']:
            raise ApiError('收款币种与客户默认币种不符')
    allocations, payments_by_contract = defaultdict(list), defaultdict(list)
    for payment in rows['payments']:
        positive(payment, 'amount')
        contract = indexed['contracts'][payment['contract_id']]
        payment['currency'] = contract['currency']
        if payment.get('shipment_id') and indexed['shipments'][payment['shipment_id']]['contract_id'] != payment['contract_id']:
            raise ApiError('收款关联发货不属于当前合同')
        if payment.get('receipt_id'):
            receipt = indexed['payment_receipts'][payment['receipt_id']]
            if receipt['customer_id'] != contract['customer_id'] or receipt['currency'] != payment['currency']:
                raise ApiError('收款分摊必须属于同一客户、币种')
            allocations[receipt['id']].append(payment)
        payments_by_contract[payment['contract_id']].append(payment)
    for row in [*rows['payments'], *rows['payment_receipts']]:
        if row.get('payment_type', '其他') not in PAYMENT_TYPES:
            raise ApiError('收款类型无效')
        positive(row, 'exchange_rate', False)
        value = number(row.get('amount', row.get('total_amount')))
        if row['currency'] == 'RMB':
            row['exchange_rate'], row['amount_rmb'] = None, amount(value)
        else:
            row['amount_rmb'] = amount(value * number(row['exchange_rate'])) if row.get('exchange_rate') else None
    for receipt in rows['payment_receipts']:
        parts = allocations[receipt['id']]
        if len({p['contract_id'] for p in parts}) != len(parts):
            raise ApiError('同一合同只能分摊一次')
        if sum((number(p['amount']) for p in parts), Decimal(0)) > number(receipt['total_amount']) + Decimal('.01'):
            raise ApiError('分摊合计不能超过收款总额')
    coverage = defaultdict(list)
    links_by_invoice = defaultdict(list)
    for link in rows['invoice_shipments']:
        positive(link, 'allocated_amount')
        links_by_invoice[link['invoice_id']].append(link)
    for invoice in rows['invoices']:
        positive(invoice, 'amount')
        shipment = indexed['shipments'][invoice['shipment_id']]
        contract = indexed['contracts'][shipment['contract_id']]
        invoice.update(currency=contract['currency'], customer_id=contract['customer_id'], invoice_type='国内增值税发票' if contract['currency'] == 'RMB' or contract['export_type'] == '转口' else '外贸内部发票')
        invoice.setdefault('status', '未申请')
        if invoice.get('invoice_date'):
            invoice['status'] = '已收到电子发票'
        elif invoice['status'] == '已收到电子发票':
            raise ApiError('填写实际开完票日期后才能确认已开票')
        if invoice['status'] not in ('未申请', '已申请', '已收到电子发票'):
            raise ApiError('发票状态无效')
        links = links_by_invoice[invoice['id']] or [{'shipment_id': shipment['id'], 'allocated_amount': invoice['amount']}]
        if invoice['shipment_id'] not in {link['shipment_id'] for link in links}:
            raise ApiError('发票主发货记录必须属于开票分摊关联')
        if abs(sum(number(l['allocated_amount']) for l in links) - number(invoice['amount'])) > Decimal('.01'):
            raise ApiError('发票分摊合计必须等于发票金额')
        for link in links:
            covered = indexed['shipments'][link['shipment_id']]
            if covered['status'] != '已发货' or covered['customer_id'] != invoice['customer_id'] or covered['currency'] != invoice['currency']:
                raise ApiError('发票只能覆盖同一客户、币种的已发货记录')
            coverage[covered['id']].append((invoice, number(link['allocated_amount'])))
    for rate in rows['exchange_rates']:
        positive(rate, 'rate')
        iso_date(str(rate.get('effective_month')) + '-01', '汇率月份')
        if rate.get('currency_pair') != 'USD/CNY':
            raise ApiError('只支持 USD/CNY 月汇率')
    for cost in rows['product_costs']:
        positive(cost, 'unit_cost_no_tax')
        iso_date(str(cost.get('cost_month')) + '-01', '成本月份')
    for product in rows['mdc_products']:
        product.setdefault('product_code', 'DEMO-P-' + product['id'][:8])
        product.setdefault('status', 'active')
        product.setdefault('manual_sort_order', None)
        product.setdefault('is_pinned', False)
        variants = {v['id'] for v in rows['mdc_product_variants'] if v['product_id'] == product['id']}
        linked = [s for s in rows['contact_sheets'] if s.get('product_variant_id') in variants]
        product['contact_row_count'] = len(linked)
        product['contact_sheet_count'] = len({s['contact_sheet_no'].strip() for s in linked if str(s.get('contact_sheet_no') or '').strip()})
    for variant in rows['mdc_product_variants']:
        variant.setdefault('status', 'active')
        if variant['status'] not in ('active', 'inactive') or not isinstance(variant.get('specification', ''), str):
            raise ApiError('规格或启停状态无效')
    for profile in rows['packaging_profiles']:
        profile.setdefault('packaging_code', 'DEMO-PKG-' + profile['id'][:8])
        profile.setdefault('is_active', True)
    unique('packaging_profile_versions', ('profile_id', 'version_no'))
    for version in rows['packaging_profile_versions']:
        positive(version, 'quantity_per_carton')
        if version.get('quantity_unit') not in ('支/箱', '盒/箱', '瓶/箱'):
            raise ApiError('装箱单位只能选择支/箱、盒/箱或瓶/箱')
        for field in version:
            if field.endswith(('_mm', '_kg')) or field in ('units_per_box', 'boxes_per_carton'):
                positive(version, field, False)
        for axis in ('length', 'width', 'height'):
            inner, outer = version.get(f'carton_inner_{axis}_mm'), version.get(f'carton_outer_{axis}_mm')
            if inner is not None and outer is not None and number(outer) < number(inner):
                raise ApiError(f'outer_{axis}_mm_gte_inner_check: 外箱外径不能小于内径')
        dims = [version.get(f'carton_outer_{axis}_mm') for axis in ('length', 'width', 'height')]
        version['carton_volume_m3'] = amount(number(dims[0]) * number(dims[1]) * number(dims[2]) / Decimal(10**9)) if all(dims) else None
        version['derived_base_units_per_carton'] = amount(number(version['quantity_per_carton']) * number(version['units_per_box'])) if version['quantity_unit'] == '盒/箱' and version.get('units_per_box') else None
        box = [version.get(f'box_inner_{axis}_mm') for axis in ('length', 'width', 'height')]
        carton = [version.get(f'carton_inner_{axis}_mm') for axis in ('length', 'width', 'height')]
        ratio = None
        if all(box + carton) and version.get('boxes_per_carton'):
            ratio = number(carton[0]) * number(carton[1]) * number(carton[2]) / (number(box[0]) * number(box[1]) * number(box[2]) * number(version['boxes_per_carton']))
        version['fill_ratio'] = amount(ratio) if ratio is not None else None
        version['fill_ratio_status'] = 'incomplete' if ratio is None else 'normal' if Decimal('1.08') <= ratio <= Decimal('1.20') else 'out_of_range'
    for alert in rows['alerts']:
        if alert.get('status') == '稍后提醒' and not alert.get('snoozed_until'):
            raise ApiError('稍后提醒必须填写日期')
    for sheet in rows['contact_sheets']:
        sheet['shipped_quantity'] = amount(shipped_sheet[sheet['id']])
    for contract in rows['contracts']:
        sheets = sheets_by_contract[contract['id']]
        quantity = sum(number(s['quantity']) for s in sheets)
        shipped = sum(shipped_sheet[s['id']] for s in sheets)
        total = sum(number(s['quantity']) * number(s['unit_price']) for s in sheets)
        paid = sum(number(p['amount']) for p in payments_by_contract[contract['id']])
        shipments = [s for s in rows['shipments'] if s['contract_id'] == contract['id'] and s['status'] == '已发货']
        fully_invoiced = all(
            sum((allocated for invoice, allocated in coverage[s['id']] if invoice.get('invoice_date')), Decimal(0))
            >= number(s['amount']) - Decimal('.01')
            for s in shipments
        )
        archived = bool(quantity > 0 and shipped >= quantity and paid >= total and shipments and fully_invoiced)
        contract['archived'] = archived
        contract['status'] = '已归档' if archived else '发货完成' if quantity and shipped >= quantity else '部分发货' if shipped > 0 else '生产完成' if sheets and all(s.get('actual_release_date') for s in sheets) else '进行中'
        if sheets:
            contract['packaging_confirmed_date'] = max(s['packaging_confirmed_date'] for s in sheets) if all(s.get('packaging_confirmed_date') for s in sheets) else None
    if before:
        old_shipments = {r['id']: r for r in before['shipments']}
        for shipment in rows['shipments']:
            old = old_shipments.get(shipment['id'])
            if old and old.get('incoterm_snapshot') != shipment.get('incoterm_snapshot'):
                raise ApiError('不能修改已经记录的发货贸易术语快照')
        old_contracts = {r['id']: r for r in before['contracts']}
        for contract in rows['contracts']:
            old = old_contracts.get(contract['id'])
            if old and old.get('incoterm') != contract.get('incoterm') and any(s['contract_id'] == contract['id'] and s['status'] != '取消' for s in rows['shipments']):
                raise ApiError('进入发货流程后不能修改合同贸易术语')
        old_sheets = {r['id']: r for r in before['contact_sheets']}
        for sheet in rows['contact_sheets']:
            old = old_sheets.get(sheet['id'])
            if old and old != sheet and any(old.get(k) != sheet.get(k) for k in set(old) | set(sheet) if k not in ('updated_at', 'shipped_quantity')):
                rows['contact_sheet_change_history'].append({'id': str(uuid.uuid4()), 'owner_id': sheet['owner_id'], 'contact_sheet_id': sheet['id'], 'changed_at': now(), 'old_data': copy.deepcopy(old), 'new_data': copy.deepcopy(sheet)})
