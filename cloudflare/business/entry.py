"""Private service binding. Input contains exactly one account's business graph."""
import copy
import json
from contextlib import contextmanager

from workers import WorkerEntrypoint, Response
from local_api.actions import READS, WRITES
from local_api.metrics import shipment_profits
from local_api.store import ApiError, Store, Transaction, TABLES, normalize_validate

MEMBER = 'personal'


class Workspace(Store):
    def __init__(self, data):
        self.rows = {table: data.get(table, []) for table in TABLES}
        self.changed = False

    def snapshot(self, user=None):
        return self.rows

    def table_rows(self, table, user):
        return self.rows[table]

    @contextmanager
    def transaction(self, user=MEMBER):
        before = copy.deepcopy(self.rows)
        yield Transaction(self.rows, user)
        normalize_validate(self.rows, before)
        self.changed = before != self.rows


def process(message):
    store = Workspace(message['workspace'])
    path, method, query, body = (message[k] for k in ('path', 'method', 'query', 'body'))
    if path == '/api/bootstrap' and method == 'GET':
        result = {**store.rows, 'v_shipment_profit': shipment_profits(store.rows)}
    elif path.startswith('/api/data/rpc/'):
        name = path.removeprefix('/api/data/rpc/')
        if not ((name in READS and method in ('GET', 'POST')) or (name in WRITES and method == 'POST')):
            raise ApiError('业务动作不可用', 405)
        result = store.rpc(name, query if method == 'GET' else body, MEMBER)
    elif path.startswith('/api/data/'):
        table = path.removeprefix('/api/data/')
        if method == 'GET':
            result = store.query(table, query, MEMBER)
        elif method == 'POST':
            result = store.insert(table, body, query, MEMBER)
        elif method == 'PATCH':
            result = store.update(table, query, body, MEMBER)
        elif method == 'DELETE':
            result = store.delete(table, query, MEMBER)
        else:
            raise ApiError('请求方法不可用', 405)
    else:
        raise ApiError('未开放此功能', 404)
    return {'result': result, 'workspace': store.rows if store.changed else None}


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        try:
            result = process(json.loads(await request.text()))
            return Response(json.dumps(result, ensure_ascii=False, allow_nan=False))
        except ApiError as error:
            return Response(json.dumps({'message': str(error), 'code': error.code}), status=error.status)
        except (KeyError, TypeError, ValueError, ArithmeticError, RecursionError):
            return Response('{"message":"业务字段或数据格式无效"}', status=400)
