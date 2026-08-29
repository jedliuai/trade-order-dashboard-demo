import type { ContactSheet, Contract, Payment, Shipment, ShipmentItem } from './dataStore';

export interface CurrentReceivableFact {
  id: string;
  contractId: string;
  contractNo: string;
  contractDate: string;
  shipmentId: string;
  shipmentNo: string;
  shipmentDate: string;
  customerName: string;
  country: string;
  exportType: Contract['export_type'];
  contactSheetId: string;
  contactSheetNo: string;
  productName: string;
  materialNo: string;
  status: string;
  currency: Contract['currency'];
  outstandingAmount: number;
  outstandingAmountRmb: number | null;
  missingRate: boolean;
  allocationNote: string;
}

export interface CurrentReceivableResult {
  facts: CurrentReceivableFact[];
  prepaymentByContract: Record<string, number>;
}

export interface ShipmentSettlementSummary {
  shipmentAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: '已收全款' | '部分收款' | '未收款';
}

export interface CurrentReceivableInput {
  contracts: Contract[];
  sheets: ContactSheet[];
  shipments: Shipment[];
  shipmentItems: ShipmentItem[];
  payments: Payment[];
  asOfDate?: string;
  rateForDate: (date: string | null | undefined) => number | null;
}

export interface ReceivableDashboardFilters {
  customerId?: string;
  contractId?: string;
  exportType?: string;
  currency?: string;
  keyword?: string;
  asOfDate?: string;
}

export interface OutstandingContractSummary {
  contracts: Contract[];
  totalOutstandingRmb: number;
  missingRateContractNos: string[];
}

export interface CustomerPaymentRowLike {
  customer_name?: string;
  amount: number;
  amount_rmb?: number;
  currency: 'USD' | 'RMB';
}

export interface CustomerPaymentGroup<T extends CustomerPaymentRowLike = Payment> {
  customerName: string;
  paymentsList: T[];
  totalAmountRmb: number;
  totalAmountUsd: number;
  hasUsdPayments: boolean;
}

const EPSILON = 0.005;

export function groupPaymentsByCustomer<T extends CustomerPaymentRowLike>(payments: T[]): CustomerPaymentGroup<T>[] {
  const groups = new Map<string, T[]>();
  payments.forEach((payment) => {
    const customerName = payment.customer_name || '未知客户';
    const rows = groups.get(customerName) || [];
    rows.push(payment);
    groups.set(customerName, rows);
  });

  return [...groups.entries()].map(([customerName, paymentsList]) => ({
    customerName,
    paymentsList,
    totalAmountRmb: paymentsList.reduce((sum, payment) => {
      if (payment.amount_rmb !== undefined && payment.amount_rmb !== null) return sum + Number(payment.amount_rmb || 0);
      return payment.currency === 'RMB' ? sum + Number(payment.amount || 0) : sum;
    }, 0),
    totalAmountUsd: paymentsList
      .filter((payment) => payment.currency === 'USD')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    hasUsdPayments: paymentsList.some((payment) => payment.currency === 'USD')
  }));
}

function effectiveItemAmount(item: ShipmentItem): number {
  const stored = Number(item.amount || 0);
  return stored > 0 ? stored : Number(item.shipped_quantity || 0) * Number(item.unit_price || 0);
}

function paymentAmountInContractCurrency(payment: Payment, contract: Contract): number {
  if (payment.currency === contract.currency) return Math.max(0, Number(payment.amount || 0));
  if (contract.currency === 'RMB') return Math.max(0, Number(payment.amount_rmb || 0));
  const rate = Number(payment.exchange_rate || 0);
  return rate > 0 ? Math.max(0, Number(payment.amount || 0) / rate) : 0;
}

function matchesDashboardScope(contract: Contract, filters: ReceivableDashboardFilters): boolean {
  if (contract.archived) return false;
  if (filters.asOfDate && contract.contract_date && contract.contract_date > filters.asOfDate) return false;
  if (filters.customerId && filters.customerId !== 'all' && contract.customer_id !== filters.customerId) return false;
  if (filters.contractId && filters.contractId !== 'all' && contract.id !== filters.contractId) return false;
  if (filters.exportType && filters.exportType !== 'all' && contract.export_type !== filters.exportType) return false;
  if (filters.currency && filters.currency !== 'all' && contract.currency !== filters.currency) return false;
  const keyword = (filters.keyword || '').trim().toLocaleLowerCase();
  if (!keyword) return true;
  return [contract.contract_no, contract.customer_name, contract.internal_contract_seq, contract.notes]
    .some((value) => String(value || '').toLocaleLowerCase().includes(keyword));
}

export function selectReceivableDashboardContracts(
  contracts: Contract[],
  filters: ReceivableDashboardFilters
): Contract[] {
  return contracts.filter((contract) => matchesDashboardScope(contract, filters));
}

export function summarizeOutstandingContractsRmb(input: {
  contracts: Contract[];
  sheets: ContactSheet[];
  payments: Payment[];
  filters: ReceivableDashboardFilters;
  rateForDate: (date: string | null | undefined) => number | null;
}): OutstandingContractSummary {
  const scopedContracts = selectReceivableDashboardContracts(input.contracts, input.filters);
  const asOfDate = input.filters.asOfDate || '9999-12-31';
  const missingRateContractNos: string[] = [];
  const totalOutstandingRmb = scopedContracts.reduce((total, contract) => {
    const contractAmount = input.sheets
      .filter((sheet) => sheet.contract_id === contract.id)
      .reduce((sum, sheet) => sum + Number(sheet.quantity || 0) * Number(sheet.unit_price || 0), 0);
    const contractRate = contract.currency === 'RMB' ? 1 : input.rateForDate(contract.contract_date);
    if (contractRate === null) {
      missingRateContractNos.push(contract.contract_no);
      return total;
    }
    const contractAmountRmb = contractAmount * contractRate;
    const paidRmb = input.payments
      .filter((payment) => payment.contract_id === contract.id
        && Boolean(payment.payment_date)
        && payment.payment_date <= asOfDate)
      .reduce((sum, payment) => {
        if (payment.amount_rmb !== undefined && payment.amount_rmb !== null) return sum + Number(payment.amount_rmb || 0);
        if (payment.currency === 'RMB') return sum + Number(payment.amount || 0);
        const paymentRate = Number(payment.exchange_rate || 0);
        return paymentRate > 0 ? sum + Number(payment.amount || 0) * paymentRate : sum;
      }, 0);
    return total + Math.max(0, contractAmountRmb - paidRmb);
  }, 0);

  return { contracts: scopedContracts, totalOutstandingRmb, missingRateContractNos };
}

export function filterCurrentReceivableFacts(
  facts: CurrentReceivableFact[],
  allowedContractIds: Iterable<string>,
  keyword = ''
): CurrentReceivableFact[] {
  const allowed = new Set(allowedContractIds);
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  return facts.filter((fact) => {
    if (!allowed.has(fact.contractId)) return false;
    if (!normalizedKeyword) return true;
    return [fact.contractNo, fact.customerName, fact.shipmentNo, fact.contactSheetNo, fact.productName, fact.materialNo]
      .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedKeyword));
  });
}

export function summarizeCurrentReceivableRmb(facts: CurrentReceivableFact[]) {
  return facts.reduce((summary, fact) => {
    if (fact.outstandingAmountRmb === null) {
      summary.missingRateCount += 1;
      return summary;
    }
    summary.totalRmb += fact.outstandingAmountRmb;
    return summary;
  }, { totalRmb: 0, missingRateCount: 0 });
}

/**
 * 汇总一笔物理发货（可能包含多个合同子记录）的实际收款状态。
 * 当前应收事实已经应用“指定发货优先、其余合同内先发先抵”，因此这里不能再用
 * 合同是否全部收齐或是否手工关联发货来判断。
 */
export function summarizeShipmentSettlement(
  shipmentIds: Iterable<string>,
  shipmentAmount: number,
  facts: CurrentReceivableFact[]
): ShipmentSettlementSummary {
  const ids = new Set(shipmentIds);
  const normalizedShipmentAmount = Math.max(0, Number(shipmentAmount || 0));
  const outstandingAmount = Math.min(
    normalizedShipmentAmount,
    Math.max(0, facts
      .filter((fact) => ids.has(fact.shipmentId))
      .reduce((sum, fact) => sum + Number(fact.outstandingAmount || 0), 0))
  );
  const paidAmount = Math.max(0, normalizedShipmentAmount - outstandingAmount);
  const status = normalizedShipmentAmount > EPSILON && outstandingAmount <= EPSILON
    ? '已收全款'
    : paidAmount > EPSILON
      ? '部分收款'
      : '未收款';

  return { shipmentAmount: normalizedShipmentAmount, paidAmount, outstandingAmount, status };
}

/**
 * 计算指定截止日的当前应收：只纳入已发货记录；指定发货的收款直接抵扣，
 * 其余合同级收款按发货日期先发先抵，同一发货中的产品按金额比例分摊余额。
 */
export function calculateCurrentReceivables(input: CurrentReceivableInput): CurrentReceivableResult {
  const asOfDate = input.asOfDate || '9999-12-31';
  const sheetById = new Map(input.sheets.map((row) => [row.id, row]));
  const itemsByShipment = new Map<string, ShipmentItem[]>();
  input.shipmentItems.forEach((item) => {
    const rows = itemsByShipment.get(item.shipment_id) || [];
    rows.push(item);
    itemsByShipment.set(item.shipment_id, rows);
  });

  const facts: CurrentReceivableFact[] = [];
  const prepaymentByContract: Record<string, number> = {};

  input.contracts.forEach((contract) => {
    const contractShipments = input.shipments
      .filter((shipment) => shipment.contract_id === contract.id
        && shipment.status === '已发货'
        && Boolean(shipment.shipment_date)
        && shipment.shipment_date <= asOfDate)
      .sort((left, right) => {
        const dateDiff = left.shipment_date.localeCompare(right.shipment_date);
        return dateDiff || left.id.localeCompare(right.id, 'zh-CN', { numeric: true, sensitivity: 'base' });
      });
    if (contractShipments.length === 0) return;

    const balances = new Map(contractShipments.map((shipment) => {
      const items = itemsByShipment.get(shipment.id) || [];
      const itemTotal = items.reduce((sum, item) => sum + effectiveItemAmount(item), 0);
      return [shipment.id, Math.max(0, itemTotal > 0 ? itemTotal : Number(shipment.amount || 0))];
    }));

    let fifoPaymentPool = 0;
    input.payments
      .filter((payment) => payment.contract_id === contract.id
        && Boolean(payment.payment_date)
        && payment.payment_date <= asOfDate)
      .forEach((payment) => {
        let available = paymentAmountInContractCurrency(payment, contract);
        if (available <= EPSILON) return;
        if (payment.shipment_id && balances.has(payment.shipment_id)) {
          const balance = balances.get(payment.shipment_id) || 0;
          const applied = Math.min(balance, available);
          balances.set(payment.shipment_id, balance - applied);
          available -= applied;
        }
        fifoPaymentPool += available;
      });

    contractShipments.forEach((shipment) => {
      if (fifoPaymentPool <= EPSILON) return;
      const balance = balances.get(shipment.id) || 0;
      const applied = Math.min(balance, fifoPaymentPool);
      balances.set(shipment.id, balance - applied);
      fifoPaymentPool -= applied;
    });
    if (fifoPaymentPool > EPSILON) prepaymentByContract[contract.id] = fifoPaymentPool;

    contractShipments.forEach((shipment) => {
      const shipmentBalance = balances.get(shipment.id) || 0;
      if (shipmentBalance <= EPSILON) return;
      const items = itemsByShipment.get(shipment.id) || [];
      const itemTotal = items.reduce((sum, item) => sum + effectiveItemAmount(item), 0);
      const targets = items.length > 0 ? items : [null];
      const exchangeRate = contract.currency === 'USD' ? input.rateForDate(shipment.shipment_date) : 1;
      let allocatedOutstanding = 0;

      targets.forEach((item, index) => {
        const itemAmount = item ? effectiveItemAmount(item) : shipmentBalance;
        const weight = items.length > 0
          ? (itemTotal > 0 ? itemAmount / itemTotal : 1 / items.length)
          : 1;
        const outstandingAmount = index === targets.length - 1
          ? shipmentBalance - allocatedOutstanding
          : shipmentBalance * weight;
        if (outstandingAmount <= EPSILON) return;
        allocatedOutstanding += outstandingAmount;
        const sheet = item ? sheetById.get(item.contact_sheet_id) : undefined;
        facts.push({
          id: `${shipment.id}:${item?.id || 'shipment'}`,
          contractId: contract.id,
          contractNo: contract.contract_no,
          contractDate: contract.contract_date,
          shipmentId: shipment.id,
          shipmentNo: shipment.group_shipment_no || shipment.shipment_no,
          shipmentDate: shipment.shipment_date,
          customerName: contract.customer_name,
          country: sheet?.country || contract.country || '未知国家',
          exportType: contract.export_type,
          contactSheetId: sheet?.id || '',
          contactSheetNo: sheet?.contact_sheet_no || item?.contact_sheet_no || '',
          productName: sheet?.product_name || item?.product_name || '未指定产品',
          materialNo: sheet?.material_no || item?.material_no || '未指定物料',
          status: sheet?.status || shipment.status,
          currency: contract.currency,
          outstandingAmount,
          outstandingAmountRmb: exchangeRate === null ? null : outstandingAmount * exchangeRate,
          missingRate: exchangeRate === null,
          allocationNote: '合同级收款按先发先抵；同一发货内按产品金额比例分摊'
        });
      });
    });
  });

  return { facts, prepaymentByContract };
}
