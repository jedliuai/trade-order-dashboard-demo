import type {
  Contract,
  Customer,
  ExchangeRate,
  Payment,
  PaymentReceipt,
  Shipment,
  ShipmentItem
} from './dataStore';

export type CustomerBalanceStatus = 'customer_owes' | 'we_owe_goods' | 'balanced';

export interface CustomerBalanceEvent {
  id: string;
  customerId: string;
  date: string;
  createdAt: string;
  kind: 'shipment' | 'payment';
  reference: string;
  amount: number;
  currency: 'USD' | 'RMB';
  runningBalance: number;
}

export interface CustomerBalanceRow {
  id: string;
  customerId: string;
  customerName: string;
  currency: 'USD' | 'RMB';
  totalShipment: number;
  totalPayment: number;
  balance: number;
  balanceRmb: number | null;
  referenceRate: number | null;
  status: CustomerBalanceStatus;
  recentBusinessDate: string;
  events: CustomerBalanceEvent[];
  currencyConflict: boolean;
}

export interface CustomerBalanceSummary {
  asOfDate: string;
  rows: CustomerBalanceRow[];
  customerOwesRmb: number;
  weOweGoodsRmb: number;
  netExposureRmb: number;
  customerOwesCount: number;
  weOweGoodsCount: number;
  balancedCount: number;
  missingRateCount: number;
  currencyConflictCount: number;
}

interface CustomerBalanceInput {
  customers: Customer[];
  contracts: Contract[];
  shipments: Shipment[];
  shipmentItems: ShipmentItem[];
  payments: Payment[];
  paymentReceipts: PaymentReceipt[];
  exchangeRates: ExchangeRate[];
  asOfDate: string;
}

interface RawBalanceEvent {
  id: string;
  customerId: string;
  customerName: string;
  date: string;
  createdAt: string;
  kind: CustomerBalanceEvent['kind'];
  reference: string;
  amount: number;
  currency: CustomerBalanceEvent['currency'];
}

const BALANCE_EPSILON = 0.01;

function normalizeCustomerIdentity(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s,，.。]+/g, '');
}

function effectiveShipmentAmount(shipment: Shipment, itemsByShipment: Map<string, ShipmentItem[]>) {
  const items = itemsByShipment.get(shipment.id) || [];
  if (items.length > 0) {
    return items.reduce((sum, item) => {
      const storedAmount = Number(item.amount || 0);
      return sum + (storedAmount > 0
        ? storedAmount
        : Number(item.shipped_quantity || 0) * Number(item.unit_price || 0));
    }, 0);
  }
  return Number(shipment.amount || 0);
}

function referenceRateForDate(exchangeRates: ExchangeRate[], asOfDate: string) {
  const month = asOfDate.slice(0, 7);
  return [...exchangeRates]
    .filter((rate) => rate.currency_pair === 'USD/CNY' && rate.effective_month <= month && Number(rate.rate) > 0)
    .sort((left, right) => right.effective_month.localeCompare(left.effective_month))[0]?.rate ?? null;
}

function balanceStatus(balance: number): CustomerBalanceStatus {
  if (balance > BALANCE_EPSILON) return 'customer_owes';
  if (balance < -BALANCE_EPSILON) return 'we_owe_goods';
  return 'balanced';
}

function normalizedAmount(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
}

function eventSort(left: RawBalanceEvent, right: RawBalanceEvent) {
  const dateDiff = left.date.localeCompare(right.date);
  if (dateDiff) return dateDiff;
  const createdDiff = String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
  if (createdDiff) return createdDiff;
  if (left.kind !== right.kind) return left.kind === 'payment' ? -1 : 1;
  return left.id.localeCompare(right.id, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function groupFallbackReceiptPayments(
  payments: Payment[],
  knownReceiptIds: Set<string>,
  resolveCustomer: (row: Pick<Payment, 'customer_id' | 'contract_id' | 'customer_name'>) => Customer | null,
  asOfDate: string
) {
  const groups = new Map<string, RawBalanceEvent>();
  payments.forEach((payment) => {
    if (!payment.receipt_id || knownReceiptIds.has(payment.receipt_id) || !payment.payment_date || payment.payment_date > asOfDate) return;
    const customer = resolveCustomer(payment);
    if (!customer) return;
    const current = groups.get(payment.receipt_id);
    if (current) {
      current.amount = normalizedAmount(current.amount + Number(payment.amount || 0));
      return;
    }
    groups.set(payment.receipt_id, {
      id: `payment-receipt-fallback:${payment.receipt_id}`,
      customerId: customer.id,
      customerName: customer.name,
      date: payment.payment_date,
      createdAt: payment.created_at || '',
      kind: 'payment',
      reference: payment.receipt_no || payment.contract_no || '组合收款',
      amount: normalizedAmount(payment.amount),
      currency: payment.currency
    });
  });
  return [...groups.values()];
}

export function calculateCustomerBalances(input: CustomerBalanceInput): CustomerBalanceSummary {
  const customerById = new Map(input.customers.map((customer) => [customer.id, customer]));
  const customerByName = new Map(input.customers.map((customer) => [normalizeCustomerIdentity(customer.name), customer]));
  const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const itemsByShipment = new Map<string, ShipmentItem[]>();
  input.shipmentItems.forEach((item) => {
    const rows = itemsByShipment.get(item.shipment_id) || [];
    rows.push(item);
    itemsByShipment.set(item.shipment_id, rows);
  });

  const resolveCustomer = (row: { customer_id?: string | null; contract_id?: string | null; customer_name?: string | null }) => {
    if (row.customer_id && customerById.has(row.customer_id)) return customerById.get(row.customer_id) || null;
    const contract = row.contract_id ? contractById.get(row.contract_id) : null;
    if (contract?.customer_id && customerById.has(contract.customer_id)) return customerById.get(contract.customer_id) || null;
    const normalizedName = normalizeCustomerIdentity(row.customer_name || contract?.customer_name || '');
    return normalizedName ? customerByName.get(normalizedName) || null : null;
  };

  const rawEvents: RawBalanceEvent[] = [];
  input.shipments.forEach((shipment) => {
    if (shipment.status !== '已发货' || !shipment.shipment_date || shipment.shipment_date > input.asOfDate) return;
    const customer = resolveCustomer(shipment);
    const contract = contractById.get(shipment.contract_id);
    if (!customer || !contract) return;
    const amount = effectiveShipmentAmount(shipment, itemsByShipment);
    if (amount <= 0) return;
    rawEvents.push({
      id: `shipment:${shipment.id}`,
      customerId: customer.id,
      customerName: customer.name,
      date: shipment.shipment_date,
      createdAt: shipment.created_at || '',
      kind: 'shipment',
      reference: shipment.group_shipment_no || shipment.shipment_no,
      amount: normalizedAmount(amount),
      currency: contract.currency
    });
  });

  const knownReceiptIds = new Set(input.paymentReceipts.map((receipt) => receipt.id));
  input.paymentReceipts.forEach((receipt) => {
    if (!receipt.payment_date || receipt.payment_date > input.asOfDate || Number(receipt.total_amount || 0) <= 0) return;
    const customer = customerById.get(receipt.customer_id);
    if (!customer) return;
    rawEvents.push({
      id: `payment-receipt:${receipt.id}`,
      customerId: customer.id,
      customerName: customer.name,
      date: receipt.payment_date,
      createdAt: receipt.created_at || '',
      kind: 'payment',
      reference: receipt.receipt_no || '整笔收款',
      amount: normalizedAmount(receipt.total_amount),
      currency: receipt.currency
    });
  });

  input.payments.forEach((payment) => {
    if (payment.receipt_id || !payment.payment_date || payment.payment_date > input.asOfDate || Number(payment.amount || 0) <= 0) return;
    const customer = resolveCustomer(payment);
    if (!customer) return;
    rawEvents.push({
      id: `payment:${payment.id}`,
      customerId: customer.id,
      customerName: customer.name,
      date: payment.payment_date,
      createdAt: payment.created_at || '',
      kind: 'payment',
      reference: payment.receipt_no || payment.contract_no || '历史收款',
      amount: normalizedAmount(payment.amount),
      currency: payment.currency
    });
  });
  rawEvents.push(...groupFallbackReceiptPayments(input.payments, knownReceiptIds, resolveCustomer, input.asOfDate));

  const eventCurrenciesByCustomer = new Map<string, Set<CustomerBalanceEvent['currency']>>();
  rawEvents.forEach((event) => {
    const currencies = eventCurrenciesByCustomer.get(event.customerId) || new Set<CustomerBalanceEvent['currency']>();
    currencies.add(event.currency);
    eventCurrenciesByCustomer.set(event.customerId, currencies);
  });

  const referenceRate = referenceRateForDate(input.exchangeRates, input.asOfDate);
  const groups = new Map<string, RawBalanceEvent[]>();
  rawEvents.forEach((event) => {
    const key = `${event.customerId}:${event.currency}`;
    const rows = groups.get(key) || [];
    rows.push(event);
    groups.set(key, rows);
  });

  const rows = [...groups.entries()].map(([id, groupedEvents]): CustomerBalanceRow => {
    const sortedEvents = [...groupedEvents].sort(eventSort);
    let runningBalance = 0;
    let totalShipment = 0;
    let totalPayment = 0;
    const events = sortedEvents.map((event): CustomerBalanceEvent => {
      if (event.kind === 'shipment') {
        totalShipment += event.amount;
        runningBalance += event.amount;
      } else {
        totalPayment += event.amount;
        runningBalance -= event.amount;
      }
      return { ...event, runningBalance: normalizedAmount(runningBalance) };
    });
    const currency = groupedEvents[0].currency;
    const balance = Math.abs(runningBalance) <= BALANCE_EPSILON ? 0 : normalizedAmount(runningBalance);
    return {
      id,
      customerId: groupedEvents[0].customerId,
      customerName: groupedEvents[0].customerName,
      currency,
      totalShipment: normalizedAmount(totalShipment),
      totalPayment: normalizedAmount(totalPayment),
      balance,
      balanceRmb: currency === 'RMB' ? balance : referenceRate === null ? null : normalizedAmount(balance * referenceRate),
      referenceRate: currency === 'RMB' ? 1 : referenceRate,
      status: balanceStatus(balance),
      recentBusinessDate: sortedEvents.at(-1)?.date || '',
      events,
      currencyConflict: (eventCurrenciesByCustomer.get(groupedEvents[0].customerId)?.size || 0) > 1
    };
  }).sort((left, right) => {
    const statusOrder: Record<CustomerBalanceStatus, number> = { customer_owes: 0, we_owe_goods: 1, balanced: 2 };
    const statusDiff = statusOrder[left.status] - statusOrder[right.status];
    if (statusDiff) return statusDiff;
    const amountDiff = Math.abs(right.balanceRmb ?? right.balance) - Math.abs(left.balanceRmb ?? left.balance);
    return amountDiff || left.customerName.localeCompare(right.customerName, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });

  const currencyConflictCount = new Set(
    rows.filter((row) => row.currencyConflict).map((row) => row.customerId)
  ).size;

  return rows.reduce<CustomerBalanceSummary>((summary, row) => {
    // 同一客户出现多币种与既定业务规则冲突。明细仍展示用于核对，
    // 但在纠正客户归属前不能把两种货币互相抵消后计入人民币总览。
    if (row.currencyConflict) return summary;
    if (row.balanceRmb === null) {
      summary.missingRateCount += 1;
    } else if (row.status === 'customer_owes') {
      summary.customerOwesRmb += row.balanceRmb;
      summary.customerOwesCount += 1;
    } else if (row.status === 'we_owe_goods') {
      summary.weOweGoodsRmb += Math.abs(row.balanceRmb);
      summary.weOweGoodsCount += 1;
    } else {
      summary.balancedCount += 1;
    }
    summary.netExposureRmb = summary.customerOwesRmb - summary.weOweGoodsRmb;
    return summary;
  }, {
    asOfDate: input.asOfDate,
    rows,
    customerOwesRmb: 0,
    weOweGoodsRmb: 0,
    netExposureRmb: 0,
    customerOwesCount: 0,
    weOweGoodsCount: 0,
    balancedCount: 0,
    missingRateCount: 0,
    currencyConflictCount
  });
}

export function formatBalanceAmount(value: number, currency: 'USD' | 'RMB', maximumFractionDigits = 2) {
  return `${currency === 'USD' ? '$' : '￥'}${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits
  })}`;
}

export function balanceStatusLabel(status: CustomerBalanceStatus) {
  if (status === 'customer_owes') return '客户待付款';
  if (status === 'we_owe_goods') return '我方待交货';
  return '基本平衡';
}
