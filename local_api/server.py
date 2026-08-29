"""Single-machine demo server. Never expose this service on a public interface."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qsl, quote, unquote, urlsplit

from .store import ApiError, SALES, Store, check_user

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 1_048_576
READ_ACTIONS = {
    'get_operating_metrics', 'get_global_contact_sheet_number_conflict',
    'get_global_contract_number_conflict', 'get_global_batch_number_conflicts',
}


def make_server(store, port=8765, env_path=None, static_dir=None):
    """Create, but do not start, a loopback-only server (port=0 for tests)."""
    static_root = Path(static_dir or ROOT / 'frontend/dist').resolve()
    config_path = Path(env_path or ROOT / '.env.local')

    class Handler(BaseHTTPRequestHandler):
        server_version = 'LocalTradeDemo/1'
        sys_version = ''

        def log_message(self, _format, *args):
            # Do not log query payloads, customer values, environment data or bot secrets.
            pass

        def send_bytes(self, code, content, mime, filename=None):
            self.send_response(code)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            if filename:
                self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(filename, safe=''))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(content)

        def send_json(self, code, body, filename=None):
            content = json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_bytes(code, content, 'application/json; charset=utf-8', filename)

        def check_boundary(self):
            hosts = self.headers.get_all('Host', [])
            allowed = {f'{host}:{port}' for host in ('localhost', '127.0.0.1')
                       for port in (self.server.server_port, 5180)}
            if len(hosts) != 1 or hosts[0] not in allowed:
                raise ApiError('只允许本机访问', 403)
            origin = self.headers.get('Origin')
            if origin and origin not in {'http://' + host for host in allowed}:
                raise ApiError('拒绝跨站请求', 403)
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise ApiError('拒绝跨站请求', 403)
            self.user = self.headers.get('X-Demo-User', SALES[0])
            check_user(self.user)

        def read_body(self):
            if self.headers.get('Transfer-Encoding'):
                raise ApiError('不支持分块请求体', 400)
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise ApiError('Content-Length 无效') from None
            if length < 0:
                raise ApiError('请求长度无效')
            if length > MAX_BODY:
                # Drain a bounded, already-sent small overrun so Windows TCP
                # delivers the 413 response instead of resetting the connection.
                remaining = min(length, MAX_BODY * 2)
                while remaining:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                raise ApiError('请求体超过 1 MiB', 413)
            if not length:
                return {}
            if self.headers.get_content_type() != 'application/json':
                raise ApiError('请求体必须使用 application/json', 415)
            def reject_constant(_value):
                raise ValueError('Nonfinite number')
            try:
                return json.loads(self.rfile.read(length), parse_constant=reject_constant)
            except (ValueError, UnicodeDecodeError):
                raise ApiError('请求体不是有效 JSON') from None

        def dispatch(self):
            self.check_boundary()
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            if parsed.scheme or parsed.netloc or '\\' in path or '%' in path or '..' in path.split('/'):
                raise ApiError('无效路径', 400)
            pairs = parse_qsl(parsed.query, keep_blank_values=True)
            if len({key for key, _ in pairs}) != len(pairs):
                raise ApiError('不允许重复查询参数')
            query = dict(pairs)
            method = self.command
            payload = self.read_body() if method in ('POST', 'PATCH', 'DELETE') else {}
            if path.startswith('/api/'):
                self.api(path, method, query, payload)
            elif method in ('GET', 'HEAD'):
                self.static(path)
            else:
                raise ApiError('不支持此方法', 405)

        def api(self, path, method, query, payload):
            if path.startswith('/api/data/rpc/'):
                name = path.removeprefix('/api/data/rpc/')
                if method not in ('GET', 'POST') or (method == 'GET' and name not in READ_ACTIONS):
                    raise ApiError('该动作不支持此方法', 405)
                params = query if method == 'GET' else payload
                if not isinstance(params, dict):
                    raise ApiError('动作参数必须是 JSON 对象')
                self.send_json(200, store.rpc(name, params, self.user))
                return
            if path.startswith('/api/data/'):
                table = path.removeprefix('/api/data/')
                if not re.fullmatch(r'[a-z][a-z0-9_]*', table):
                    raise ApiError('无效数据表', 404)
                if method == 'GET':
                    self.send_json(200, store.query(table, query, self.user))
                elif method == 'POST':
                    self.send_json(201, store.insert(table, payload, query, self.user))
                elif method == 'PATCH':
                    self.send_json(200, store.update(table, query, payload, self.user))
                elif method == 'DELETE':
                    self.send_json(200, store.delete(table, query, self.user))
                else:
                    raise ApiError('不支持此方法', 405)
                return
            if path == '/api/bootstrap' and method == 'GET':
                # One database snapshot avoids decoding the full graph once per
                # table/page, and ensures the UI never combines different writes.
                from .metrics import shipment_profits
                snapshot = store.snapshot(self.user)
                self.send_json(200, {**snapshot, 'v_shipment_profit': shipment_profits(snapshot)})
            elif path == '/api/health' and method == 'GET':
                snapshot = store.snapshot()
                self.send_json(200, {'status': 'ok', 'counts': {t: len(rows) for t, rows in snapshot.items()}})
            elif path == '/api/backup' and method == 'GET':
                self.send_json(200, store.snapshot(), '演示数据备份.json')
            elif path == '/api/reset' and method == 'POST':
                if not isinstance(payload, dict):
                    raise ApiError('重置参数必须是 JSON 对象')
                self.send_json(200, store.reset(payload.get('confirm'), self.user))
            elif path.startswith('/api/export/') and method == 'POST':
                from .exports import export_file
                if not isinstance(payload, dict):
                    raise ApiError('导出筛选必须是 JSON 对象')
                name, mime, content = export_file(store, path.removeprefix('/api/export/'), payload, self.user)
                self.send_bytes(200, content, mime, name)
            elif path == '/api/telegram/status' and method == 'GET':
                from .telegram import status
                self.send_json(200, status(env_path=config_path))
            elif path in ('/api/telegram/preview', '/api/telegram/send') and method == 'POST':
                from .telegram import preview, send
                if not isinstance(payload, dict):
                    raise ApiError('汇报参数必须是 JSON 对象')
                result = (preview(store, payload, user=self.user) if path.endswith('/preview')
                          else send(store, payload, user=self.user, env_path=config_path))
                self.send_json(200, result)
            else:
                raise ApiError('本地接口不存在或请求方法不正确', 404)

        def static(self, path):
            relative = path.lstrip('/') or 'index.html'
            if any(part.startswith('.') for part in relative.split('/')):
                raise ApiError('文件不存在', 404)
            target = (static_root / relative).resolve()
            if not target.is_relative_to(static_root):
                raise ApiError('禁止访问项目文件', 403)
            if not target.is_file():
                # UI uses tab state, not arbitrary server-side route fallbacks.
                if path == '/' and not static_root.exists():
                    raise ApiError('请先运行 npm run build，或使用 npm run dev', 503)
                raise ApiError('静态资源不存在', 404)
            mime = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
            if target.suffix == '.js':
                mime = 'text/javascript'
            self.send_bytes(200, target.read_bytes(), mime)

        def handle_request(self):
            self.connection.settimeout(15)
            try:
                self.dispatch()
            except ApiError as error:
                self.send_json(error.status, {'message': str(error), 'code': error.code})
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                self.close_connection = True
            except sqlite3.Error:
                self.send_json(500, {'message': '本地数据库操作失败，请稍后重试。'})
            except Exception:
                # Never echo exceptions that may contain token-bearing upstream URLs.
                self.send_json(500, {'message': '本地服务处理失败，请检查本地配置或联系维护者。'})

        do_GET = do_HEAD = do_POST = do_PATCH = do_DELETE = do_OPTIONS = do_PUT = handle_request

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main():
    parser = argparse.ArgumentParser(description='本地订单驾驶舱演示服务（仅本机）')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--database', type=Path, default=ROOT / 'data/demo.sqlite3')
    parser.add_argument('--seed', type=Path, default=ROOT / 'data/demo-seed.json')
    args = parser.parse_args()
    store = Store(args.database, args.seed)
    with make_server(store, port=args.port) as server:
        print(f'Local demo ready: http://127.0.0.1:{server.server_port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
