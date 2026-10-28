"""Versioned local upgrades. Back up the committed SQLite snapshot before changes."""
from datetime import datetime, timezone
from contextlib import closing
import sqlite3

SCHEMA_VERSION = 3


def backfill(rows):
    from .store import number
    profiles = {p['id']: p for p in rows['packaging_profiles']}
    for contract in rows['contracts']:
        ratio = number(contract.get('prepayment_ratio') if contract.get('prepayment_ratio') is not None else '.3')
        if 1 < ratio <= 100:
            contract['prepayment_ratio'] = float(ratio / 100)
    for payment in rows['payments']:
        payment['allocation_effective_date'] = payment.get('allocation_effective_date') or payment.get('payment_date')
    for version in rows['packaging_profile_versions']:
        version.setdefault('workshop', profiles[version['profile_id']].get('workshop') or '')
    for sheet in rows['contact_sheets']:
        # Retain the date field for backward-compatible manually maintained schedules.
        sheet['aps_auto_query_enabled'] = False
    # A single legacy shipment is also one physical shipment. Materializing its
    # header keeps child IDs/invoices/payments intact and enables the new editor.
    contracts = {c['id']: c for c in rows['contracts']}
    numbers = {(g['owner_id'], g['shipment_no'].strip().casefold()) for g in rows['shipment_groups']}
    for shipment in rows['shipments']:
        if shipment.get('shipment_group_id'):
            continue
        contract = contracts[shipment['contract_id']]
        group_id = 'local-group-' + shipment['id']
        name = shipment['shipment_no']
        index = 1
        while (shipment['owner_id'], name.strip().casefold()) in numbers:
            name = f"{shipment['shipment_no']}-LOCAL-{index}"
            index += 1
        numbers.add((shipment['owner_id'], name.strip().casefold()))
        rows['shipment_groups'].append({
            'id': group_id, 'owner_id': shipment['owner_id'], 'shipment_no': name,
            'customer_id': contract['customer_id'], 'currency': contract['currency'],
            'incoterm': shipment.get('incoterm_snapshot', contract.get('incoterm')),
            'shipment_date': shipment.get('shipment_date'), 'status': shipment['status'],
            'notes': shipment.get('notes'), 'created_at': shipment.get('created_at'),
            'updated_at': shipment.get('updated_at'),
            'freight_insurance_amount': shipment.get('freight_insurance_amount'),
        })
        shipment['shipment_group_id'] = group_id


def migrate(store, conn):
    version = conn.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
    current = int(version[0]) if version else 1
    if current > SCHEMA_VERSION:
        raise ValueError('数据库版本较新，请使用相同或更新版本的本地程序。')
    if current == SCHEMA_VERSION:
        return
    directory = store.path.parent / 'backups'
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = directory / f'before-v{SCHEMA_VERSION}-{stamp}.sqlite3'
    # Use a separate reader: conn already holds the migration's write reservation.
    # SQLite backup includes committed WAL contents and never copies partial files.
    with closing(sqlite3.connect(store.path)) as source, closing(sqlite3.connect(backup)) as destination:
        source.backup(destination)
    rows = store.load(conn)
    backfill(rows)
    from .store import normalize_validate
    normalize_validate(rows)
    store.persist(conn, rows)
    conn.execute("INSERT INTO metadata VALUES ('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (str(SCHEMA_VERSION),))
