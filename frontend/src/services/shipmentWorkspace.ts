export interface ShipmentSourceItemLike {
  shipment_id: string;
  contact_sheet_id: string;
  batch_id: string;
  contact_sheet_no?: string | null;
  batch_no?: string | null;
  shipped_quantity?: number | null;
}

export interface ShipmentSourceSummary {
  contractNos: string[];
  contactSheetNos: string[];
  batchNos: string[];
  itemCount: number;
  totalQuantity: number;
}

export interface ShipmentFilterCandidate {
  shipmentNo: string;
  customerId?: string | null;
  customerName: string;
  contractNos: string[];
  contactSheetNos: string[];
  batchNos: string[];
  shipmentDate: string;
  status: string;
}

export interface ShipmentFilters {
  query: string;
  customerId: string;
  contractNo: string;
  dateFrom: string;
  dateTo: string;
  status: string;
}

export interface ShipmentDraftAllocationLike {
  contract_no?: string;
  contact_sheet_id: string;
  batch_id: string;
  availableQty: number;
  shippedQty: number;
}

const normalizeDraftQuantity = (value: number) => (
  Number.isFinite(value) ? Math.max(0, Math.round((value + Number.EPSILON) * 1000) / 1000) : 0
);

export type ShipmentWorklistInvoiceState = 'not-shipped' | 'pending' | 'invoiced' | 'inconsistent';

export interface ShipmentWorklistRowLike {
  shipment_date: string;
  shipment_no: string;
  status: string;
  invoice_state: ShipmentWorklistInvoiceState;
}

export function canExportReceiptConfirmation(
  shipment: { status: string; currency: string }
): boolean {
  return shipment.status === '已发货' && shipment.currency === 'RMB';
}

const uniqueValues = (values: Array<string | null | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value))));

export function summarizeShipmentSources(
  shipmentIds: string[],
  contractNos: string[],
  items: ShipmentSourceItemLike[]
): ShipmentSourceSummary {
  const shipmentIdSet = new Set(shipmentIds);
  const sourceItems = items.filter(item => shipmentIdSet.has(item.shipment_id));
  return {
    contractNos: uniqueValues(contractNos),
    contactSheetNos: uniqueValues(sourceItems.map(item => item.contact_sheet_no)),
    batchNos: uniqueValues(sourceItems.map(item => item.batch_no)),
    itemCount: sourceItems.length,
    totalQuantity: sourceItems.reduce((sum, item) => sum + Number(item.shipped_quantity || 0), 0)
  };
}

export function matchesShipmentFilters(candidate: ShipmentFilterCandidate, filters: ShipmentFilters): boolean {
  const query = filters.query.trim().toLocaleLowerCase();
  const matchesQuery = !query || [
    candidate.shipmentNo,
    candidate.customerName,
    ...candidate.contractNos,
    ...candidate.contactSheetNos,
    ...candidate.batchNos
  ].some(value => value.toLocaleLowerCase().includes(query));

  return matchesQuery
    && (!filters.customerId || candidate.customerId === filters.customerId)
    && (!filters.contractNo || candidate.contractNos.includes(filters.contractNo))
    && (!filters.dateFrom || candidate.shipmentDate >= filters.dateFrom)
    && (!filters.dateTo || candidate.shipmentDate <= filters.dateTo)
    && (!filters.status || candidate.status === filters.status);
}

export function summarizeShipmentDraft(allocations: ShipmentDraftAllocationLike[]) {
  const selected = allocations.filter(allocation => allocation.shippedQty > 0);
  return {
    contractCount: uniqueValues(selected.map(allocation => allocation.contract_no)).length,
    contactSheetCount: new Set(selected.map(allocation => allocation.contact_sheet_id)).size,
    batchCount: new Set(selected.map(allocation => allocation.batch_id)).size,
    totalShippedQuantity: normalizeDraftQuantity(selected.reduce((sum, allocation) => sum + allocation.shippedQty, 0)),
    remainingAvailableQuantity: normalizeDraftQuantity(allocations.reduce(
      (sum, allocation) => sum + Math.max(0, allocation.availableQty - allocation.shippedQty),
      0
    ))
  };
}

export function setAllShipmentAllocationQuantities<T extends ShipmentDraftAllocationLike>(
  allocations: readonly T[],
  mode: 'full' | 'clear'
): T[] {
  return allocations.map(allocation => ({
    ...allocation,
    shippedQty: mode === 'full' ? normalizeDraftQuantity(allocation.availableQty) : 0
  }));
}

const shipmentWorkPriority: Record<ShipmentWorklistInvoiceState, number> = {
  pending: 0,
  inconsistent: 1,
  invoiced: 2,
  'not-shipped': 3
};

/**
 * 发货与开票是行动台账：最新创建的准备中安排是下一步待办，固定置于已发货记录之前；
 * 其余记录先把待开票工作放到前面，再按发货日期由晚到早排列。
 * 取消记录始终沉底，避免干扰当前工作；编号作为同日记录的稳定次序。
 */
export function sortShipmentWorklist<T extends ShipmentWorklistRowLike>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftCancelled = left.status === '取消';
    const rightCancelled = right.status === '取消';
    if (leftCancelled !== rightCancelled) return leftCancelled ? 1 : -1;

    const leftPreparing = left.status === '准备中';
    const rightPreparing = right.status === '准备中';
    if (leftPreparing !== rightPreparing) return leftPreparing ? -1 : 1;

    const priorityDiff = shipmentWorkPriority[left.invoice_state] - shipmentWorkPriority[right.invoice_state];
    if (priorityDiff !== 0) return priorityDiff;

    const dateDiff = right.shipment_date.localeCompare(left.shipment_date);
    if (dateDiff !== 0) return dateDiff;

    return right.shipment_no.localeCompare(left.shipment_no, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}
