export interface ShipmentBatchAvailability {
  batch_quantity: number;
  warehouse_date?: string | null;
  contact_warehouse_date?: string | null;
}

const SHIPMENT_QUANTITY_SCALE = 1000;

/** Database quantities use numeric(18,3); normalize JS floating-point residue to the same precision. */
export function normalizeShipmentQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round((value + Number.EPSILON) * SHIPMENT_QUANTITY_SCALE) / SHIPMENT_QUANTITY_SCALE);
}

/** Calculate the unreserved quantity without applying production/warehouse eligibility. */
export function getRemainingShipmentQuantity(
  batchQuantity: number,
  alreadyReserved: number
): number {
  const quantity = Number(batchQuantity);
  const reservedQuantity = Number(alreadyReserved);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(reservedQuantity)) return 0;

  return normalizeShipmentQuantity(quantity - Math.max(0, reservedQuantity));
}

export function isShipmentBatchWarehoused(batch: ShipmentBatchAvailability): boolean {
  return Boolean(String(batch.warehouse_date || batch.contact_warehouse_date || '').trim());
}

export function getAvailableShipmentQuantity(
  batch: ShipmentBatchAvailability,
  alreadyReserved: number
): number {
  if (!isShipmentBatchWarehoused(batch)) return 0;
  return getRemainingShipmentQuantity(batch.batch_quantity, alreadyReserved);
}
