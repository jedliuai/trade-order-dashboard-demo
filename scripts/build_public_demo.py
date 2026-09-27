"""Build an immutable, fictional public-demo artifact tree.

The builder always creates a fresh temporary SQLite Store from ``build_seed``.
It never opens the normal runtime database under ``data/``.
"""

from __future__ import annotations

import argparse
from calendar import monthrange
from datetime import date
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import uuid


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from local_api.exports import COMMANDS, DOCX_MIME, XLSX_MIME, export_file  # noqa: E402
from local_api.metrics import operating_metrics, shipment_profits  # noqa: E402
from local_api.seed import build_seed  # noqa: E402
from local_api.store import Store  # noqa: E402
from local_api.telegram import preview  # noqa: E402


MAX_FILE_BYTES = 25 * 1024 * 1024
PUBLIC_IDENTITIES = (
    ("demo-sales-1", "demo-sales-1"),
    ("demo-sales-2", "demo-sales-2"),
    ("demo-sales-3", "demo-sales-3"),
    ("demo-manager", "demo-manager"),
    ("demo-owner", "demo-owner"),
)
TELEGRAM_MODES = ("current_month", "previous_month", "fiscal_year")
TELEGRAM_RECIPIENTS = ("manager", "owner")
EXPORT_COMMANDS = (
    "export-production",
    "export-monthly",
    "export-original-contracts",
    "export-helper",
    "export-payments",
    "export-customer-monthly-sales",
    "export-rmb-invoice",
    "export-shipment-plan",
    "export-receipt-confirmation",
    "export-shipment-details",
)


def _month_start(value: date, offset: int = 0) -> date:
    index = value.year * 12 + value.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def _parse_date(value: str) -> date:
    try:
        if len(value) != 10 or value[4] != "-" or value[7] != "-":
            raise ValueError
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("日期必须为有效的 YYYY-MM-DD") from None


def _month_end(value: date) -> date:
    return value.replace(day=monthrange(value.year, value.month)[1])


def _same_day(value: date, year: int, month: int) -> date:
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def dashboard_ranges(as_of: date) -> list[tuple[date, date]]:
    """Mirror the unique range set requested by Dashboard.tsx for ``as_of``."""
    previous_month = _month_start(as_of, -1)
    fiscal_start_year = as_of.year if as_of.month == 12 else as_of.year - 1
    fiscal_start = date(fiscal_start_year, 12, 1)

    requested = [
        (as_of.replace(day=1), as_of),
        (previous_month, _same_day(as_of, previous_month.year, previous_month.month)),
        (date(as_of.year - 1, as_of.month, 1), _same_day(as_of, as_of.year - 1, as_of.month)),
        (fiscal_start, as_of),
        (date(fiscal_start_year - 1, 12, 1), date(fiscal_start_year, 11, 30)),
    ]

    month = fiscal_start
    while month <= as_of.replace(day=1):
        requested.append((month, as_of if (month.year, month.month) == (as_of.year, as_of.month) else _month_end(month)))
        month = _month_start(month, 1)

    # Dashboard stores ranges in a Map keyed by start/end, so duplicates are
    # intentionally removed while preserving first-seen order.
    return list(dict.fromkeys(requested))


def _json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _write_file(root: Path, relative: Path, content: bytes) -> int:
    if len(content) >= MAX_FILE_BYTES:
        raise ValueError(f"{relative.as_posix()} 达到 {len(content)} 字节，必须小于 25 MiB")
    destination = root / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("xb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    return len(content)


def _write_json(root: Path, relative: Path, value: object) -> int:
    return _write_file(root, relative, _json_bytes(value))


def _replace_directory(staging: Path, output: Path) -> None:
    """Publish a complete directory, restoring the prior output on failure."""
    backup = output.parent / f".{output.name}.previous-{uuid.uuid4().hex}"
    had_output = output.exists()
    if had_output and (output.is_symlink() or not output.is_dir()):
        raise ValueError(f"输出路径必须是普通目录：{output}")
    try:
        if had_output:
            os.replace(output, backup)
        os.replace(staging, output)
    except BaseException:
        if had_output and backup.exists() and not output.exists():
            os.replace(backup, output)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def build(output: Path, as_of: date) -> list[str]:
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent))
    published = False

    try:
        seed = build_seed(as_of)
        table_counts = {table: len(rows) for table, rows in seed.items()}
        ranges = dashboard_ranges(as_of)
        export_manifest: dict[str, dict[str, dict[str, object]]] = {}
        artifact_counts = {
            "bootstrap": 0,
            "tables": 0,
            "metrics": 0,
            "telegram": 0,
            "exports": 0,
        }

        with tempfile.TemporaryDirectory(prefix="public-demo-store-", dir=output.parent) as store_dir_text:
            store_dir = Path(store_dir_text)
            seed_path = store_dir / "seed.json"
            seed_path.write_bytes(_json_bytes(seed))
            store = Store(store_dir / "demo.sqlite3", seed_path=seed_path)

            for public_user, store_user in PUBLIC_IDENTITIES:
                snapshot = store.snapshot(store_user)
                bootstrap = {**snapshot, "v_shipment_profit": shipment_profits(snapshot)}
                _write_json(staging, Path("bootstrap", f"{public_user}.json"), bootstrap)
                artifact_counts["bootstrap"] += 1

                for table in snapshot:
                    rows = store.query(table, user=store_user)
                    _write_json(staging, Path("tables", public_user, f"{table}.json"), rows)
                    artifact_counts["tables"] += 1
                packaging = store.query("packaging_current_profiles", user=store_user)
                _write_json(
                    staging,
                    Path("tables", public_user, "packaging_current_profiles.json"),
                    packaging,
                )
                artifact_counts["tables"] += 1

                for start, end in ranges:
                    metrics = operating_metrics(snapshot, start.isoformat(), end.isoformat())
                    relative = Path("metrics", public_user, f"{start.isoformat()}--{end.isoformat()}.json")
                    _write_json(staging, relative, metrics)
                    artifact_counts["metrics"] += 1

                for mode in TELEGRAM_MODES:
                    for recipient in TELEGRAM_RECIPIENTS:
                        telegram_preview = preview(
                            store,
                            {"mode": mode, "recipient": recipient},
                            user=store_user,
                            as_of=as_of,
                        )
                        relative = Path("telegram", public_user, f"{mode}-{recipient}.json")
                        _write_json(staging, relative, telegram_preview)
                        artifact_counts["telegram"] += 1

                user_exports: dict[str, dict[str, object]] = {}
                if set(EXPORT_COMMANDS) != COMMANDS:
                    raise RuntimeError("导出命令集合已变化，请先确认公网演示产物口径")
                for command in EXPORT_COMMANDS:
                    filename, mime, content = export_file(store, command, {}, store_user)
                    if mime == DOCX_MIME:
                        extension = ".docx"
                    elif mime == XLSX_MIME:
                        extension = ".xlsx"
                    else:
                        raise RuntimeError(f"{command} 返回了不支持的 MIME：{mime}")
                    relative = Path("exports", public_user, f"{command}{extension}")
                    size = _write_file(staging, relative, content)
                    user_exports[command] = {
                        "path": relative.as_posix(),
                        "filename": filename,
                        "mime": mime,
                        "size": size,
                    }
                    artifact_counts["exports"] += 1
                export_manifest[public_user] = user_exports

        manifest = {
            "status": "ok",
            "as_of": as_of.isoformat(),
            "counts": table_counts,
            "public_mode": True,
            "identities": {public: store_user for public, store_user in PUBLIC_IDENTITIES},
            "metric_ranges": [
                {"start": start.isoformat(), "end": end.isoformat()} for start, end in ranges
            ],
            "artifact_counts": artifact_counts,
            "exports": export_manifest,
        }
        _write_json(staging, Path("manifest.json"), manifest)

        files = sorted(path.relative_to(staging).as_posix() for path in staging.rglob("*") if path.is_file())
        _replace_directory(staging, output)
        published = True
        return files
    finally:
        if not published and staging.exists():
            shutil.rmtree(staging)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="构建 Cloudflare 公网演示静态数据")
    parser.add_argument("--output", type=Path, required=True, help="完整产物目录")
    parser.add_argument("--as-of", type=_parse_date, required=True, help="截止日期 YYYY-MM-DD")
    args = parser.parse_args(argv)

    files = build(args.output, args.as_of)
    print(json.dumps({"status": "ok", "as_of": args.as_of.isoformat(), "files": len(files)}, ensure_ascii=False))
    for filename in files:
        print(filename)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
