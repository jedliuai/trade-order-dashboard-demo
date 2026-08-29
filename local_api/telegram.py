"""Local-only Telegram reporting with explicit confirmation and secret hygiene."""
from calendar import monthrange
from datetime import date, datetime
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

from .store import ApiError


ENV_KEYS = ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_MANAGER_CHAT_ID', 'TELEGRAM_OWNER_CHAT_ID')
RECIPIENT_KEYS = {'manager': 'TELEGRAM_MANAGER_CHAT_ID', 'owner': 'TELEGRAM_OWNER_CHAT_ID'}


def _configuration(env_path=None):
    values = {key: os.environ.get(key, '') for key in ENV_KEYS}
    path = Path(env_path) if env_path is not None else Path.cwd() / '.env.local'
    if path.name != '.env.local':
        raise ApiError('Telegram 配置文件只能使用 .env.local')
    if path.is_file():
        for raw_line in path.read_text(encoding='utf-8-sig').splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            if key.strip() in ENV_KEYS:
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def status(env_path=None):
    values = _configuration(env_path)
    recipients = {recipient: bool(values[key]) for recipient, key in RECIPIENT_KEYS.items()}
    return {'configured': bool(values['TELEGRAM_BOT_TOKEN'] and any(recipients.values())), 'recipients': recipients}


def _as_date(value):
    if value is None:
        return date.today()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ApiError('as_of 必须是有效 YYYY-MM-DD 日期') from None


def _period(payload, as_of):
    mode = payload.get('mode')
    if mode == 'current_month':
        start = as_of.replace(day=1)
        end = as_of
    elif mode == 'previous_month':
        previous_end = as_of.replace(day=1).fromordinal(as_of.replace(day=1).toordinal() - 1)
        start = previous_end.replace(day=1)
        end = previous_end
    elif mode == 'fiscal_year':
        start = date(as_of.year if as_of.month == 12 else as_of.year - 1, 12, 1)
        end = as_of
    else:
        raise ApiError('汇报周期仅支持 current_month、previous_month 或 fiscal_year')
    return start.isoformat(), end.isoformat()


def preview(store, payload, user='demo-sales-1', as_of=None):
    if not isinstance(payload, dict):
        raise ApiError('Telegram 请求必须为 JSON 对象')
    recipient = payload.get('recipient')
    if recipient not in RECIPIENT_KEYS:
        raise ApiError('仅支持 manager 或 owner 接收人', 403, 'unauthorized_recipient')
    start, end = _period(payload, _as_date(as_of))
    report = store.rpc('get_operating_metrics', {'p_start_date': start, 'p_end_date': end}, user=user)
    report = {**report, 'period': {**report.get('period', {}), 'start_date': start, 'end_date': end}}
    shipments = report.get('shipments', {})
    payments = report.get('payments', {})
    text = (
        '【本地演示经营汇报】\n'
        f'汇报对象：{"经理" if recipient == "manager" else "老板"}\n'
        f'统计周期：{start} 至 {end}\n'
        f'发货：{shipments.get("count", 0)} 笔，人民币 {shipments.get("amount_rmb", 0)}\n'
        f'回款：{payments.get("count", 0)} 笔，人民币 {payments.get("amount_rmb", 0)}\n'
        f'已确认利润：人民币 {report.get("confirmed_profit_rmb", 0)}\n'
        '数据仅用于本地虚构演示。'
    )
    return {'text': text, 'report': report}


def send(store, payload, user='demo-sales-1', env_path=None, as_of=None):
    if not isinstance(payload, dict) or payload.get('confirmed') is not True:
        raise ApiError('发送 Telegram 汇报必须明确设置 confirmed=true')
    preview_result = preview(store, payload, user=user, as_of=as_of)
    values = _configuration(env_path)
    recipient = payload['recipient']
    chat_id = values[RECIPIENT_KEYS[recipient]]
    token = values['TELEGRAM_BOT_TOKEN']
    if not token or not chat_id:
        raise ApiError('Telegram 尚未在本地配置或该接收人未获授权', 503, 'telegram_unconfigured')
    request = urllib.request.Request(
        f'https://api.telegram.org/bot{token}/sendMessage',
        data=json.dumps({'chat_id': chat_id, 'text': preview_result['text']}, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json; charset=utf-8'}, method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = json.loads(response.read().decode('utf-8'))
        if not body.get('ok'):
            raise ValueError('Telegram rejected request')
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError, json.JSONDecodeError):
        raise ApiError('Telegram 发送失败，请检查本地配置或网络连接', 502, 'telegram_delivery_failed') from None
    return {'status': 'sent', 'recipient': recipient, 'report': preview_result['report']}
