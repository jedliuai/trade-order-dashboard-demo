export interface PhysicalShipmentRowLike {
  id: string;
  shipment_group_id?: string | null;
  status: string;
  amount: number;
}

export interface ShipmentInvoiceLike {
  id: string;
  invoice_date?: string | null;
  shipment_allocations: { shipment_id: string; allocated_amount: number }[];
}

export type PhysicalShipmentInvoiceState = 'not-shipped' | 'pending' | 'invoiced' | 'inconsistent';

export function getPhysicalShipmentRows<T extends PhysicalShipmentRowLike>(
  representative: T,
  shipments: T[]
): T[] {
  if (!representative.shipment_group_id) return [representative];
  return shipments.filter((row) => row.shipment_group_id === representative.shipment_group_id);
}

export function resolvePhysicalShipmentInvoice<T extends ShipmentInvoiceLike>(
  rows: PhysicalShipmentRowLike[],
  invoices: T[]
): { state: PhysicalShipmentInvoiceState; invoice: T | null } {
  if (rows.some((row) => row.status !== '已发货')) return { state: 'not-shipped', invoice: null };

  const shipmentIds = new Set(rows.map((row) => row.id));
  const relatedInvoices = invoices.filter((invoice) =>
    invoice.shipment_allocations.some((allocation) => shipmentIds.has(allocation.shipment_id))
  );
  if (relatedInvoices.length === 0) return { state: 'pending', invoice: null };
  if (relatedInvoices.length !== 1) return { state: 'inconsistent', invoice: relatedInvoices[0] || null };

  const invoice = relatedInvoices[0];
  const allocations = invoice.shipment_allocations;
  const coversOnlyThisPhysicalShipment = allocations.every((allocation) => shipmentIds.has(allocation.shipment_id));
  const fullyCoversEveryChild = rows.every((row) => {
    const allocated = allocations
      .filter((allocation) => allocation.shipment_id === row.id)
      .reduce((sum, allocation) => sum + Number(allocation.allocated_amount || 0), 0);
    return Math.abs(allocated - Number(row.amount || 0)) <= 0.005;
  });

  if (!invoice.invoice_date || !coversOnlyThisPhysicalShipment || !fullyCoversEveryChild) {
    return { state: 'inconsistent', invoice };
  }
  return { state: 'invoiced', invoice };
}
