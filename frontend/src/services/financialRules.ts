export interface InvoiceAllocationLike {
  shipment_id: string;
  allocated_amount: number;
}

export interface InvoiceLike {
  id?: string;
  invoice_date?: string | null;
  shipment_allocations?: InvoiceAllocationLike[];
}

export type ShipmentPaymentDisplayStatus = '已收全款' | '部分收款' | string;

export interface ReceivableContractLike {
  id: string;
  customer_id: string;
  archived?: boolean;
}

export interface ContractAmountLineLike {
  contract_id: string;
  quantity: number;
  unit_price: number;
}

export interface ContractPaymentLike {
  contract_id: string;
  amount: number;
}

export interface PaymentLedgerRowLike {
  id: string;
  payment_date: string;
}

export interface CustomerDepositLedgerInput {
  id: string;
  customer_id: string;
  customer_name: string;
  receipt_no?: string;
  payment_date: string;
  deposit_amount: number;
  currency: 'USD' | 'RMB';
  exchange_rate?: number;
  notes?: string;
  created_at: string;
}

const MONEY_SCALE = 10000;

/** Payment and sales amount columns use four decimal places in the database. */
export function normalizeMoneyAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * MONEY_SCALE) / MONEY_SCALE;
}

export function getContractOutstandingAmount(
  contractId: string,
  contactSheets: ContractAmountLineLike[],
  payments: ContractPaymentLike[]
): number {
  const contractAmount = contactSheets
    .filter((sheet) => sheet.contract_id === contractId)
    .reduce((sum, sheet) => sum + Number(sheet.quantity || 0) * Number(sheet.unit_price || 0), 0);
  const paidAmount = payments
    .filter((payment) => payment.contract_id === contractId)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return Math.max(0, normalizeMoneyAmount(contractAmount - paidAmount));
}

export function getReceivableContracts<T extends ReceivableContractLike>(
  customerId: string,
  contracts: T[],
  contactSheets: ContractAmountLineLike[],
  payments: ContractPaymentLike[],
  preservedContractIds: Iterable<string> = []
): T[] {
  const preserved = new Set(preservedContractIds);
  return contracts.filter((contract) => {
    if (contract.customer_id !== customerId) return false;
    if (preserved.has(contract.id)) return true;
    if (contract.archived) return false;
    return getContractOutstandingAmount(contract.id, contactSheets, payments) > 0.005;
  });
}

export function getDatedInvoiceCoverage(
  shipmentId: string,
  invoices: InvoiceLike[]
): number {
  return invoices.reduce((total, invoice) => {
    if (!invoice.invoice_date) return total;
    const allocated = (invoice.shipment_allocations || [])
      .filter((row) => row.shipment_id === shipmentId)
      .reduce((sum, row) => sum + Number(row.allocated_amount || 0), 0);
    return total + allocated;
  }, 0);
}

export function isShipmentFullyInvoiced(
  shipmentId: string,
  shipmentAmount: number,
  invoices: InvoiceLike[]
): boolean {
  return shipmentAmount > 0
    && getDatedInvoiceCoverage(shipmentId, invoices) >= shipmentAmount;
}

export function summarizePaymentAllocations(
  receiptTotal: number,
  allocations: Array<{ amount: number }>
): { allocated: number; unallocated: number; isBalanced: boolean } {
  const allocated = normalizeMoneyAmount(allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const unallocated = normalizeMoneyAmount(Number(receiptTotal || 0) - allocated);
  return { allocated, unallocated, isBalanced: Math.abs(unallocated) <= 0.005 };
}

export function balanceLastPaymentAllocation<T extends { amount: number }>(
  receiptTotal: number,
  allocations: readonly T[]
): T[] {
  if (!allocations.length) return [];
  const rows = allocations.map((row) => ({ ...row }));
  const lastIndex = rows.length - 1;
  const allocatedBeforeLast = rows
    .slice(0, lastIndex)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  rows[lastIndex].amount = normalizeMoneyAmount(Math.max(0, Number(receiptTotal || 0) - allocatedBeforeLast));
  return rows;
}

export function updatePaymentAllocationWithAutoRemainder<T extends { amount: number }>(
  receiptTotal: number,
  allocations: readonly T[],
  changedIndex: number,
  amount: number
): T[] {
  const rows = allocations.map((row, index) => (
    index === changedIndex ? { ...row, amount: normalizeMoneyAmount(amount) } : { ...row }
  ));
  return changedIndex < rows.length - 1
    ? balanceLastPaymentAllocation(receiptTotal, rows)
    : rows;
}

export function resolveShipmentPaymentDisplayStatus(
  shipmentAmount: number,
  linkedPaidAmount: number,
  preShipmentStatus: string
): ShipmentPaymentDisplayStatus {
  if (shipmentAmount > 0 && linkedPaidAmount >= shipmentAmount) return '已收全款';
  if (linkedPaidAmount > 0) return '部分收款';
  return preShipmentStatus || '需人工确认';
}

export function sortPaymentLedger<T extends PaymentLedgerRowLike>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const dateDiff = right.payment_date.localeCompare(left.payment_date);
    return dateDiff || right.id.localeCompare(left.id, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

export function createCustomerDepositLedgerRow(receipt: CustomerDepositLedgerInput) {
  return {
    id: `customer-deposit:${receipt.id}`,
    receipt_id: receipt.id,
    receipt_no: receipt.receipt_no || '',
    contract_id: '',
    shipment_id: null,
    contract_no: '',
    customer_id: receipt.customer_id,
    customer_name: receipt.customer_name,
    export_type: '' as const,
    payment_date: receipt.payment_date,
    amount: receipt.deposit_amount,
    currency: receipt.currency,
    payment_type: '客户预存款' as const,
    exchange_rate: receipt.exchange_rate,
    amount_rmb: receipt.currency === 'RMB'
      ? receipt.deposit_amount
      : receipt.exchange_rate
        ? normalizeMoneyAmount(receipt.deposit_amount * receipt.exchange_rate)
        : undefined,
    notes: receipt.notes || '',
    created_at: receipt.created_at,
    is_customer_deposit: true as const
  };
}
