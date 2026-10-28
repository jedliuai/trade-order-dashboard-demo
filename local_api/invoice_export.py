"""Pure shipment-snapshot export validation ported from upstream 2edcc89.

No remote clients or production templates are used here.
"""
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Any
import re


def _natural_batch_sort_key(value: Any) -> tuple[int, tuple[tuple[int, Any], ...]]:
    text = str(value or "").strip()
    parts = tuple(
        (0, int(part)) if part.isdigit() else (1, part.casefold())
        for part in re.split(r"(\d+)", text)
        if part
    )
    return (0 if text else 1, parts)



def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")



def _invoice_export_sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        _natural_batch_sort_key(row.get("contract_no")),
        _natural_batch_sort_key(row.get("contact_sheet_no")),
        str(row.get("shipment_created_at") or ""),
        _natural_batch_sort_key(row.get("shipment_no")),
    )



def build_invoice_export_rows(
    shipments: list[dict],
    shipment_items: list[dict],
    contact_sheets: list[dict],
    contracts: list[dict],
    customers: list[dict],
    packaging_versions: list[dict],
    invoice_coverages: list[dict],
    invoices: list[dict],
    selected_shipment_ids: list[str],
    exchange_rate: Any = None,
    usd_only: bool = False,
) -> list[dict]:
    """Build one row per shipment and contact sheet, with strict invoice validation."""
    selected_ids = {str(value) for value in selected_shipment_ids if value}
    shipment_by_id = {str(row.get("id") or ""): row for row in shipments if row.get("id")}
    selected_shipments = [shipment_by_id[value] for value in selected_ids if value in shipment_by_id]
    if not selected_shipments:
        raise RuntimeError("所选日期内没有可导出的发货记录。")

    items_by_shipment: dict[str, list[dict]] = defaultdict(list)
    for item in shipment_items:
        items_by_shipment[str(item.get("shipment_id") or "")].append(item)

    physical_rows: dict[str, list[dict]] = defaultdict(list)
    for shipment in shipments:
        shipment_id = str(shipment.get("id") or "")
        group_id = str(shipment.get("shipment_group_id") or "").strip()
        physical_rows[f"group:{group_id}" if group_id else f"shipment:{shipment_id}"].append(shipment)

    coverages_by_invoice: dict[str, list[dict]] = defaultdict(list)
    invoice_ids_by_shipment: dict[str, set[str]] = defaultdict(set)
    for coverage in invoice_coverages:
        invoice_id = str(coverage.get("invoice_id") or "")
        shipment_id = str(coverage.get("shipment_id") or "")
        if invoice_id and shipment_id:
            coverages_by_invoice[invoice_id].append(coverage)
            invoice_ids_by_shipment[shipment_id].add(invoice_id)
    invoice_by_id = {str(row.get("id") or ""): row for row in invoices if row.get("id")}

    invoice_state_by_physical_key: dict[str, str] = {}
    selected_physical_keys = {
        f"group:{str(row.get('shipment_group_id') or '').strip()}"
        if row.get("shipment_group_id")
        else f"shipment:{row.get('id')}"
        for row in selected_shipments
    }
    tolerance = Decimal("0.005")
    for physical_key in selected_physical_keys:
        children = physical_rows.get(physical_key, [])
        child_ids = {str(row.get("id") or "") for row in children}
        shipment_label = str(children[0].get("shipment_no") or "未编号发货") if children else "未编号发货"
        statuses = {str(row.get("status") or "").strip() for row in children}
        if statuses == {"准备中"}:
            related_invoice_ids = set().union(*(invoice_ids_by_shipment[value] for value in child_ids)) if child_ids else set()
            if related_invoice_ids:
                raise RuntimeError(f"发货记录 {shipment_label} 尚未发货却已关联发票，请先修复开票关系。")
            invoice_state_by_physical_key[physical_key] = "未发货，未开票"
            continue
        if statuses != {"已发货"}:
            raise RuntimeError(f"发货记录 {shipment_label} 的子记录状态不一致，请先修复后再导出。")

        related_invoice_ids = set().union(*(invoice_ids_by_shipment[value] for value in child_ids)) if child_ids else set()
        if not related_invoice_ids:
            invoice_state_by_physical_key[physical_key] = "已发货，未开票"
            continue
        if len(related_invoice_ids) != 1:
            raise RuntimeError(f"发货记录 {shipment_label} 关联了多张发票，请先修复后再导出。")

        invoice_id = next(iter(related_invoice_ids))
        invoice = invoice_by_id.get(invoice_id)
        if not invoice or not invoice.get("invoice_date"):
            raise RuntimeError(f"发货记录 {shipment_label} 的发票缺少开票日期，请先补齐。")
        coverages = coverages_by_invoice.get(invoice_id, [])
        covered_shipment_ids = {str(row.get("shipment_id") or "") for row in coverages}
        if not covered_shipment_ids or not covered_shipment_ids.issubset(child_ids):
            raise RuntimeError(f"发货记录 {shipment_label} 的发票跨越了其他实际发货，请先修复开票关系。")
        for child in children:
            child_id = str(child.get("id") or "")
            expected_amount = sum(
                _decimal(item.get("amount"))
                if item.get("amount") is not None
                else _decimal(item.get("shipped_quantity")) * _decimal(item.get("unit_price"))
                for item in items_by_shipment.get(child_id, [])
            )
            allocated_amount = sum(
                _decimal(row.get("allocated_amount"))
                for row in coverages
                if str(row.get("shipment_id") or "") == child_id
            )
            if abs(expected_amount - allocated_amount) > tolerance:
                raise RuntimeError(
                    f"发货记录 {shipment_label} 的发票分摊金额与发货金额不一致，请先修复后再导出。"
                )
        invoice_state_by_physical_key[physical_key] = "已发货，已开票"

    contact_by_id = {str(row.get("id") or ""): row for row in contact_sheets if row.get("id")}
    contract_by_id = {str(row.get("id") or ""): row for row in contracts if row.get("id")}
    customer_by_id = {str(row.get("id") or ""): row for row in customers if row.get("id")}
    version_by_id = {str(row.get("id") or ""): row for row in packaging_versions if row.get("id")}

    result: list[dict] = []
    for shipment in selected_shipments:
        shipment_id = str(shipment.get("id") or "")
        grouped_items: dict[str, list[dict]] = defaultdict(list)
        for item in items_by_shipment.get(shipment_id, []):
            grouped_items[str(item.get("contact_sheet_id") or "")].append(item)
        if not grouped_items:
            raise RuntimeError(f"发货记录 {shipment.get('shipment_no') or '未编号'} 没有发货明细，无法导出。")

        group_id = str(shipment.get("shipment_group_id") or "").strip()
        physical_key = f"group:{group_id}" if group_id else f"shipment:{shipment_id}"
        for contact_id, item_rows in grouped_items.items():
            contact = contact_by_id.get(contact_id)
            if not contact:
                raise RuntimeError(f"发货记录 {shipment.get('shipment_no') or '未编号'} 存在已删除的联系单明细。")
            contract = contract_by_id.get(str(shipment.get("contract_id") or ""))
            if not contract or str(contact.get("contract_id") or "") != str(contract.get("id") or ""):
                raise RuntimeError(f"联系单 {contact.get('contact_sheet_no') or '未编号'} 与发货合同不一致。")
            currency = str(contract.get("currency") or "").strip().upper()
            if currency not in {"USD", "RMB"}:
                raise RuntimeError(f"合同 {contract.get('contract_no') or '未编号'} 的币种无效，无法导出。")
            if usd_only and currency != "USD":
                continue

            unit_prices = {_decimal(item.get("unit_price")) for item in item_rows}
            if len(unit_prices) != 1:
                raise RuntimeError(
                    f"发货记录 {shipment.get('shipment_no') or '未编号'} 中联系单 "
                    f"{contact.get('contact_sheet_no') or '未编号'} 的快照单价不一致，无法导出。"
                )
            unit_price = next(iter(unit_prices))
            quantity = sum(_decimal(item.get("shipped_quantity")) for item in item_rows)
            if quantity <= 0 or unit_price <= 0:
                raise RuntimeError(
                    f"发货记录 {shipment.get('shipment_no') or '未编号'} 的数量或单价无效，无法导出。"
                )
            customer = customer_by_id.get(str(contract.get("customer_id") or ""), {})
            version = version_by_id.get(str(contact.get("packaging_profile_version_id") or ""), {})
            result.append({
                "customer_name": customer.get("name") or "未知客户",
                "contract_no": contract.get("contract_no") or "",
                "contact_sheet_no": contact.get("contact_sheet_no") or "",
                "material_no": contact.get("material_no") or "",
                "product_name": contact.get("product_name") or "",
                "specification": contact.get("specification") or "",
                "product_with_specification": (
                    f"{str(contact.get('product_name') or '').strip()}"
                    f"{str(contact.get('specification') or '').strip()}"
                ),
                "packaging": contact.get("packaging") or "",
                "unit": contact.get("unit") or "",
                "workshop": version.get("workshop") or "",
                "currency": currency,
                "unit_price": unit_price,
                "quantity": quantity,
                "quantity_wan": quantity / Decimal("10000"),
                "invoice_note": invoice_state_by_physical_key[physical_key],
                "shipment_created_at": shipment.get("created_at") or "",
                "shipment_no": shipment.get("shipment_no") or "",
            })

    if not result:
        report_name = "美金实际开票" if usd_only else "预计开票"
        raise RuntimeError(f"所选日期内没有可导出的{report_name}数据。")
    if any(row["currency"] == "USD" for row in result):
        rate = _decimal(exchange_rate)
        if rate <= 0:
            raise RuntimeError("所选汇率月份没有有效的 USD/CNY 汇率，不能导出。")
        for row in result:
            row["exchange_rate"] = rate
    return sorted(result, key=_invoice_export_sort_key)



_BATCH_NUMBER_PATTERN = re.compile(r"^(.*?)(\d+)$")

def summarize_batch_numbers(values: list[Any]) -> str:
    """Sort batches and shorten only a fully consecutive set."""
    unique = sorted(
        {str(value or "").strip() for value in values if str(value or "").strip()},
        key=_natural_batch_sort_key,
    )
    if len(unique) < 2:
        return unique[0] if unique else ""

    parsed = [_BATCH_NUMBER_PATTERN.fullmatch(value) for value in unique]
    if all(parsed):
        first_prefix, first_number = parsed[0].groups()
        number_width = len(first_number)
        numbers = [int(matched.group(2)) for matched in parsed]
        if (
            all(
                matched.group(1) == first_prefix
                and len(matched.group(2)) == number_width
                for matched in parsed
            )
            and all(current == previous + 1 for previous, current in zip(numbers, numbers[1:]))
        ):
            end_number = parsed[-1].group(2)
            common_prefix_length = 0
            for start_char, end_char in zip(first_number, end_number):
                if start_char != end_char:
                    break
                common_prefix_length += 1
            suffix_width = min(number_width, max(2, number_width - common_prefix_length))
            return f"{unique[0]}-{end_number[-suffix_width:]}"

    return "/".join(unique)
