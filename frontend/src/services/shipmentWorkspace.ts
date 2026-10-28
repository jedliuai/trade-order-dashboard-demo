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

export interface ShipmentVolumeContactSheetLike {
  id: string;
  contact_sheet_no?: string | null;
  unit?: string | null;
  pcs_per_carton?: number | null;
  packaging_profile_version_id?: string | null;
}

export interface ShipmentVolumePackagingVersionLike {
  id: string;
  quantity_per_carton?: number | null;
  quantity_unit?: string | null;
  carton_volume_m3?: number | null;
}

export interface ShipmentDraftVolumeSummary {
  totalCartons: number;
  totalVolumeM3: number;
  calculatedItemCount: number;
  missingItemCount: number;
  missingContactSheetNos: string[];
}

export interface ShipmentDraftVolumeLine {
  cartons: number;
  volumeM3: number;
  isCalculated: boolean;
  contactSheetNo: string;
}

export type ShipmentPlanDetailMode = 'batch' | 'contact-sheet';

export interface ShipmentPlanDisplayItemLike {
  id: string;
  shipment_id: string;
  contact_sheet_id: string;
  contract_no?: string | null;
  contact_sheet_no?: string | null;
  batch_no?: string | null;
  material_no?: string | null;
  product_name?: string | null;
  specification?: string | null;
  unit?: string | null;
  shipped_quantity: number;
  amount: number;
  volume: ShipmentDraftVolumeLine;
}

export interface ShipmentPlanDisplayRow {
  rowKey: string;
  sourceItemIds: string[];
  contract_no: string;
  contact_sheet_id: string;
  contact_sheet_no: string;
  batch_no: string;
  material_no: string;
  product_name: string;
  specification: string;
  unit: string;
  shipped_quantity: number;
  amount: number;
  batchCount: number;
  volume: ShipmentDraftVolumeLine;
}

const normalizeDraftQuantity = (value: number) => (
  Number.isFinite(value) ? Math.max(0, Math.round((value + Number.EPSILON) * 1000) / 1000) : 0
);

const naturalTextCompare = (leftValue: string | null | undefined, rightValue: string | null | undefined) => {
  const left = String(leftValue || '').trim();
  const right = String(rightValue || '').trim();
  if (!left || !right) {
    if (!left && !right) return 0;
    return left ? -1 : 1;
  }
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
};

const shipmentPlanRowCompare = (
  left: Pick<ShipmentPlanDisplayRow, 'contract_no' | 'contact_sheet_no' | 'batch_no'>,
  right: Pick<ShipmentPlanDisplayRow, 'contract_no' | 'contact_sheet_no' | 'batch_no'>
) => naturalTextCompare(left.contract_no, right.contract_no)
  || naturalTextCompare(left.contact_sheet_no, right.contact_sheet_no)
  || naturalTextCompare(left.batch_no, right.batch_no);

export function summarizeShipmentBatchNumbers(values: Array<string | null | undefined>): string {
  const unique = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort(naturalTextCompare);
  if (unique.length < 2) return unique[0] || '';

  const parsed = unique.map((value) => value.match(/^(.*?)(\d+)$/));
  if (parsed.every((matched): matched is RegExpMatchArray => Boolean(matched))) {
    const firstPrefix = parsed[0][1];
    const firstNumber = parsed[0][2];
    const numberWidth = firstNumber.length;
    const numbers = parsed.map((matched) => Number(matched[2]));
    const sameSequence = parsed.every((matched) => matched[1] === firstPrefix && matched[2].length === numberWidth)
      && numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
    if (sameSequence) {
      const endNumber = parsed.at(-1)![2];
      let commonPrefixLength = 0;
      while (
        commonPrefixLength < firstNumber.length
        && firstNumber[commonPrefixLength] === endNumber[commonPrefixLength]
      ) commonPrefixLength += 1;
      const suffixWidth = Math.min(numberWidth, Math.max(2, numberWidth - commonPrefixLength));
      return `${unique[0]}-${endNumber.slice(-suffixWidth)}`;
    }
  }

  return unique.join('/');
}

const joinedUnique = (values: Array<string | null | undefined>) => Array.from(new Set(
  values.map((value) => String(value || '').trim()).filter(Boolean)
)).join('、');

export function buildShipmentPlanDisplayRows(
  items: readonly ShipmentPlanDisplayItemLike[],
  mode: ShipmentPlanDetailMode
): ShipmentPlanDisplayRow[] {
  const batchRows = items.map((item): ShipmentPlanDisplayRow => ({
    rowKey: item.id,
    sourceItemIds: [item.id],
    contract_no: String(item.contract_no || '').trim(),
    contact_sheet_id: item.contact_sheet_id,
    contact_sheet_no: String(item.contact_sheet_no || '').trim(),
    batch_no: String(item.batch_no || '').trim(),
    material_no: String(item.material_no || '').trim(),
    product_name: String(item.product_name || '').trim(),
    specification: String(item.specification || '').trim(),
    unit: String(item.unit || '').trim(),
    shipped_quantity: Number(item.shipped_quantity || 0),
    amount: Number(item.amount || 0),
    batchCount: 1,
    volume: item.volume
  })).sort(shipmentPlanRowCompare);

  if (mode === 'batch') return batchRows;

  const groups = new Map<string, ShipmentPlanDisplayRow[]>();
  batchRows.forEach((row) => {
    const key = `${row.contract_no}\u0000${row.contact_sheet_id}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  });

  return Array.from(groups.values()).map((group): ShipmentPlanDisplayRow => {
    const first = group[0];
    const calculatedVolumeRows = group.filter((row) => row.volume.isCalculated);
    return {
      ...first,
      rowKey: `${first.contract_no}:${first.contact_sheet_id}`,
      sourceItemIds: group.flatMap((row) => row.sourceItemIds),
      batch_no: summarizeShipmentBatchNumbers(group.map((row) => row.batch_no)),
      material_no: joinedUnique(group.map((row) => row.material_no)),
      product_name: joinedUnique(group.map((row) => row.product_name)),
      specification: joinedUnique(group.map((row) => row.specification)),
      unit: joinedUnique(group.map((row) => row.unit)),
      shipped_quantity: normalizeDraftQuantity(group.reduce((sum, row) => sum + row.shipped_quantity, 0)),
      amount: group.reduce((sum, row) => sum + row.amount, 0),
      batchCount: group.length,
      volume: {
        cartons: calculatedVolumeRows.reduce((sum, row) => sum + row.volume.cartons, 0),
        volumeM3: Math.round((calculatedVolumeRows.reduce((sum, row) => sum + row.volume.volumeM3, 0) + Number.EPSILON) * 1e6) / 1e6,
        isCalculated: calculatedVolumeRows.length === group.length,
        contactSheetNo: first.contact_sheet_no || '未填写联系单号'
      }
    };
  }).sort(shipmentPlanRowCompare);
}

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

function normalizeCartonUnit(value: string | null | undefined) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\/箱$/, '');
}

export function calculateShipmentDraftVolumeLines(
  allocations: readonly ShipmentDraftAllocationLike[],
  contactSheets: readonly ShipmentVolumeContactSheetLike[],
  packagingVersions: readonly ShipmentVolumePackagingVersionLike[]
): ShipmentDraftVolumeLine[] {
  const sheetById = new Map(contactSheets.map((sheet) => [sheet.id, sheet]));
  const versionById = new Map(packagingVersions.map((version) => [version.id, version]));

  return allocations.map((allocation) => {
    const sheet = sheetById.get(allocation.contact_sheet_id);
    const version = sheet?.packaging_profile_version_id
      ? versionById.get(sheet.packaging_profile_version_id)
      : undefined;
    const quantityPerCarton = Number(sheet?.pcs_per_carton || version?.quantity_per_carton || 0);
    const cartonVolumeM3 = Number(version?.carton_volume_m3 || 0);
    const shipmentUnit = normalizeCartonUnit(sheet?.unit);
    const packagingUnit = normalizeCartonUnit(version?.quantity_unit);
    const unitsMatch = !shipmentUnit || !packagingUnit || shipmentUnit === packagingUnit;
    const contactSheetNo = sheet?.contact_sheet_no || '未填写联系单号';

    if (!sheet || !version || allocation.shippedQty <= 0 || quantityPerCarton <= 0 || cartonVolumeM3 <= 0 || !unitsMatch) {
      return { cartons: 0, volumeM3: 0, isCalculated: false, contactSheetNo };
    }

    const cartons = Math.max(1, Math.ceil((allocation.shippedQty / quantityPerCarton) - 1e-10));
    return {
      cartons,
      volumeM3: Math.round(((cartons * cartonVolumeM3) + Number.EPSILON) * 1e6) / 1e6,
      isCalculated: true,
      contactSheetNo
    };
  });
}

/**
 * Container planning uses a conservative physical-volume estimate: each batch is rounded up
 * to a whole outer carton, so remainders from different batches are never silently co-packed.
 */
export function summarizeShipmentDraftVolume(
  allocations: readonly ShipmentDraftAllocationLike[],
  contactSheets: readonly ShipmentVolumeContactSheetLike[],
  packagingVersions: readonly ShipmentVolumePackagingVersionLike[]
): ShipmentDraftVolumeSummary {
  const selectedAllocations = allocations.filter((allocation) => allocation.shippedQty > 0);
  const lines = calculateShipmentDraftVolumeLines(selectedAllocations, contactSheets, packagingVersions);
  const missingContactSheetNos = new Set<string>();
  let totalCartons = 0;
  let totalVolumeM3 = 0;
  let calculatedItemCount = 0;
  let missingItemCount = 0;

  lines.forEach((line) => {
    if (!line.isCalculated) {
      missingItemCount += 1;
      missingContactSheetNos.add(line.contactSheetNo);
      return;
    }

    totalCartons += line.cartons;
    totalVolumeM3 += line.volumeM3;
    calculatedItemCount += 1;
  });

  return {
    totalCartons,
    totalVolumeM3: Math.round((totalVolumeM3 + Number.EPSILON) * 1e6) / 1e6,
    calculatedItemCount,
    missingItemCount,
    missingContactSheetNos: Array.from(missingContactSheetNos)
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
