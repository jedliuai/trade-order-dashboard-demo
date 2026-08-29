export interface CustomerReferenceSummary {
  contracts: number;
  paymentReceipts: number;
  shipmentGroups: number;
  total: number;
}

interface CustomerReferenceRow {
  customer_id?: string | null;
}

export function normalizeCustomerIdentity(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s,，.。]+/g, '');
}

export function summarizeCustomerReferences(
  customerId: string,
  contracts: CustomerReferenceRow[],
  paymentReceipts: CustomerReferenceRow[],
  shipmentGroups: CustomerReferenceRow[]
): CustomerReferenceSummary {
  const summary = {
    contracts: contracts.filter((row) => row.customer_id === customerId).length,
    paymentReceipts: paymentReceipts.filter((row) => row.customer_id === customerId).length,
    shipmentGroups: shipmentGroups.filter((row) => row.customer_id === customerId).length
  };

  return {
    ...summary,
    total: summary.contracts + summary.paymentReceipts + summary.shipmentGroups
  };
}
