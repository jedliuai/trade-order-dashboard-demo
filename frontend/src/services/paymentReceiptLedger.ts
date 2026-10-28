import type { Contract, Customer, Payment, PaymentReceipt } from './dataStore.ts';
import { normalizeMoneyAmount } from './financialRules.ts';
import { deriveContractPaymentProgress, type ContractPaymentProgressStatus } from './paymentProgress.ts';

export interface ReceiptLedgerAllocation extends Payment {
  contract_total: number;
  contract_search_text: string;
  progress_status: ContractPaymentProgressStatus;
}

export interface ReceiptLedgerRow {
  id: string;
  receipt_id?: string | null;
  receipt?: PaymentReceipt;
  customer_id: string;
  customer_name: string;
  receipt_no: string;
  payment_date: string;
  total_amount: number;
  currency: 'USD' | 'RMB';
  exchange_rate?: number;
  amount_rmb?: number;
  notes: string;
  created_at: string;
  allocations: ReceiptLedgerAllocation[];
  allocated_amount: number;
  deposit_amount: number;
  contract_nos: string[];
  export_types: Array<'自营' | '转口'>;
  is_composite: boolean;
  is_expandable: boolean;
  matched_allocation_ids: string[];
  matched_amount: number;
  matched_amount_rmb?: number;
}

export interface ReceiptLedgerFilters {
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  contractId?: string;
  exportType?: string;
  currency?: string;
  keyword?: string;
}

function receiptAmountRmb(receipt: PaymentReceipt): number | undefined {
  if (receipt.amount_rmb !== undefined && receipt.amount_rmb !== null) return receipt.amount_rmb;
  if (receipt.currency === 'RMB') return receipt.total_amount;
  return receipt.exchange_rate ? normalizeMoneyAmount(receipt.total_amount * receipt.exchange_rate) : undefined;
}

function enrichAllocations(
  allocations: Payment[],
  contractTotals: ReadonlyMap<string, number>,
  contractById: ReadonlyMap<string, Contract>,
  allPayments: Payment[]
): ReceiptLedgerAllocation[] {
  return allocations.map((allocation) => {
    const contractTotal = contractTotals.get(allocation.contract_id) || 0;
    return {
      ...allocation,
      contract_total: contractTotal,
      contract_search_text: `${contractById.get(allocation.contract_id)?.internal_contract_seq || ''} ${contractById.get(allocation.contract_id)?.notes || ''}`.trim(),
      progress_status: deriveContractPaymentProgress(allocation, contractTotal, allPayments),
    };
  });
}

function finalizeRow(row: Omit<ReceiptLedgerRow, 'allocated_amount' | 'deposit_amount' | 'contract_nos' | 'export_types' | 'is_composite' | 'is_expandable' | 'matched_allocation_ids' | 'matched_amount' | 'matched_amount_rmb'>): ReceiptLedgerRow {
  const allocatedAmount = normalizeMoneyAmount(row.allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const depositAmount = normalizeMoneyAmount(Math.max(0, row.total_amount - allocatedAmount));
  const contractNos = [...new Set(row.allocations.map((allocation) => allocation.contract_no).filter(Boolean))];
  const exportTypes = [...new Set(row.allocations.map((allocation) => allocation.export_type))];
  const isComposite = row.allocations.length > 1 || (row.allocations.length > 0 && depositAmount > 0.005);
  return {
    ...row,
    allocated_amount: allocatedAmount,
    deposit_amount: depositAmount,
    contract_nos: contractNos,
    export_types: exportTypes,
    is_composite: isComposite,
    is_expandable: isComposite,
    matched_allocation_ids: row.allocations.map((allocation) => allocation.id),
    matched_amount: row.total_amount,
    matched_amount_rmb: row.amount_rmb,
  };
}

export function buildPaymentReceiptLedger({
  payments,
  receipts,
  customers,
  contracts,
  contractTotals,
}: {
  payments: Payment[];
  receipts: PaymentReceipt[];
  customers: Customer[];
  contracts: Contract[];
  contractTotals: ReadonlyMap<string, number>;
}): ReceiptLedgerRow[] {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const paymentsByReceipt = new Map<string, Payment[]>();
  payments.forEach((payment) => {
    if (!payment.receipt_id) return;
    const current = paymentsByReceipt.get(payment.receipt_id) || [];
    current.push(payment);
    paymentsByReceipt.set(payment.receipt_id, current);
  });
  const knownReceiptIds = new Set(receipts.map((receipt) => receipt.id));

  const receiptRows = receipts.map((receipt) => {
    const allocations = enrichAllocations(paymentsByReceipt.get(receipt.id) || [], contractTotals, contractById, payments);
    const customer = customerById.get(receipt.customer_id);
    return finalizeRow({
      id: `receipt:${receipt.id}`,
      receipt_id: receipt.id,
      receipt,
      customer_id: receipt.customer_id,
      customer_name: customer?.name || allocations[0]?.customer_name || '未知客户',
      receipt_no: receipt.receipt_no || '',
      payment_date: receipt.payment_date,
      total_amount: receipt.total_amount,
      currency: receipt.currency,
      exchange_rate: receipt.exchange_rate,
      amount_rmb: receiptAmountRmb(receipt),
      notes: receipt.notes || '',
      created_at: receipt.created_at,
      allocations,
    });
  });

  const legacyRows = payments
    .filter((payment) => !payment.receipt_id)
    .map((payment) => {
      const allocation = enrichAllocations([payment], contractTotals, contractById, payments);
      return finalizeRow({
        id: `payment:${payment.id}`,
        receipt_id: null,
        customer_id: payment.customer_id || contractById.get(payment.contract_id)?.customer_id || '',
        customer_name: payment.customer_name || '未知客户',
        receipt_no: payment.receipt_no || '',
        payment_date: payment.payment_date,
        total_amount: payment.amount,
        currency: payment.currency,
        exchange_rate: payment.exchange_rate,
        amount_rmb: payment.amount_rmb ?? (payment.currency === 'RMB' ? payment.amount : undefined),
        notes: payment.notes || '',
        created_at: payment.created_at,
        allocations: allocation,
      });
    });

  const orphanRows = [...paymentsByReceipt.entries()]
    .filter(([receiptId]) => !knownReceiptIds.has(receiptId))
    .map(([receiptId, orphanPayments]) => {
      const allocations = enrichAllocations(orphanPayments, contractTotals, contractById, payments);
      const first = allocations[0];
      const totalAmount = normalizeMoneyAmount(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
      const amountRmb = allocations.every((allocation) => allocation.amount_rmb !== undefined || allocation.currency === 'RMB')
        ? normalizeMoneyAmount(allocations.reduce((sum, allocation) => sum + (allocation.amount_rmb ?? allocation.amount), 0))
        : undefined;
      return finalizeRow({
        id: `orphan-receipt:${receiptId}`,
        receipt_id: receiptId,
        customer_id: first?.customer_id || contractById.get(first?.contract_id || '')?.customer_id || '',
        customer_name: first?.customer_name || '未知客户',
        receipt_no: first?.receipt_no || '',
        payment_date: first?.payment_date || '',
        total_amount: totalAmount,
        currency: first?.currency || 'USD',
        exchange_rate: first?.exchange_rate,
        amount_rmb: amountRmb,
        notes: first?.notes || '',
        created_at: first?.created_at || '',
        allocations,
      });
    });

  return [...receiptRows, ...legacyRows, ...orphanRows].sort((left, right) => {
    const dateDiff = right.payment_date.localeCompare(left.payment_date);
    return dateDiff || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
  });
}

export function filterPaymentReceiptLedger(rows: ReceiptLedgerRow[], filters: ReceiptLedgerFilters): ReceiptLedgerRow[] {
  const childFilterActive = Boolean((filters.contractId && filters.contractId !== 'all') || (filters.exportType && filters.exportType !== 'all'));
  const query = String(filters.keyword || '').trim().toLocaleLowerCase();
  return rows.flatMap((row) => {
    if (filters.customerId && filters.customerId !== 'all' && row.customer_id !== filters.customerId) return [];
    if (filters.dateFrom && row.payment_date < filters.dateFrom) return [];
    if (filters.dateTo && row.payment_date > filters.dateTo) return [];
    if (filters.currency && filters.currency !== 'all' && row.currency !== filters.currency) return [];

    const matchedAllocations = row.allocations.filter((allocation) => {
      if (filters.contractId && filters.contractId !== 'all' && allocation.contract_id !== filters.contractId) return false;
      if (filters.exportType && filters.exportType !== 'all' && allocation.export_type !== filters.exportType) return false;
      return true;
    });
    if (childFilterActive && matchedAllocations.length === 0) return [];

    if (query) {
      const headerText = `${row.customer_name} ${row.receipt_no} ${row.notes}`.toLocaleLowerCase();
      const childText = row.allocations.map((allocation) => `${allocation.contract_no} ${allocation.contract_search_text} ${allocation.notes}`).join(' ').toLocaleLowerCase();
      if (!headerText.includes(query) && !childText.includes(query)) return [];
    }

    const matchedAmount = childFilterActive
      ? normalizeMoneyAmount(matchedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0))
      : row.total_amount;
    const matchedAmountRmb = childFilterActive
      ? matchedAllocations.every((allocation) => allocation.amount_rmb !== undefined || allocation.currency === 'RMB')
        ? normalizeMoneyAmount(matchedAllocations.reduce((sum, allocation) => sum + (allocation.amount_rmb ?? allocation.amount), 0))
        : undefined
      : row.amount_rmb;
    return [{
      ...row,
      matched_allocation_ids: matchedAllocations.map((allocation) => allocation.id),
      matched_amount: matchedAmount,
      matched_amount_rmb: matchedAmountRmb,
    }];
  });
}
