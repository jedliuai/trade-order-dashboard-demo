import type {
  ContactSheet,
  Contract,
  Customer,
  ExchangeRate,
  Payment,
  PaymentReceipt,
  Shipment,
  ShipmentItem,
  ShipmentProfit
} from './dataStore';

export interface CustomerValueAnalyticsInput {
  customers: Customer[];
  contracts: Contract[];
  sheets: ContactSheet[];
  payments: Payment[];
  paymentReceipts: PaymentReceipt[];
  shipments: Shipment[];
  shipmentItems: ShipmentItem[];
  shipmentProfits: ShipmentProfit[];
  exchangeRates: ExchangeRate[];
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface CustomerValueRow {
  customerId: string;
  customerName: string;
  paymentRmb: number;
  profitRmb: number;
  confirmedSalesRmb: number;
  profitBasisRmb: number;
  grossMargin: number | null;
  activeMonths: number;
  contractCount: number;
  productCount: number;
  score: number;
  quadrant: 'core' | 'scale' | 'potential' | 'low';
  missingRateCount: number;
}

export interface CustomerValueMatrixResult {
  rows: CustomerValueRow[];
  paymentMedian: number;
  profitMedian: number;
  activeCustomerCount: number;
  totalPaymentRmb: number;
  totalProfitRmb: number;
  overallGrossMargin: number | null;
  averagePaymentCycleDays: number | null;
  missingRateCount: number;
}

export type ProductAnalysisBasis = 'shipment' | 'contract';
export type ProductMetric = 'sales' | 'profit' | 'margin' | 'quantity';

export interface ProductAnalysisRow {
  key: string;
  materialNo: string;
  productName: string;
  specification: string;
  unit: string;
  quantity: number;
  salesRmb: number;
  confirmedSalesRmb: number;
  profitBasisRmb: number;
  profitRmb: number;
  grossMargin: number | null;
  amountShare: number;
  yearOverYear: number | null;
  missingRateCount: number;
}

export interface CustomerProductAnalysisResult {
  rows: ProductAnalysisRow[];
  period: DateRange & { fiscalYear: number; isCurrent: boolean };
  totalSalesRmb: number;
  totalProfitRmb: number;
  overallGrossMargin: number | null;
  totalQuantity: number | null;
  quantityUnit: string;
  mixedQuantityUnits: boolean;
  missingRateCount: number;
}

export interface ProductTrendYear {
  fiscalYear: number;
  label: string;
  startDate: string;
  endDate: string;
  cutoffLabel: string;
  salesRmb: number;
  confirmedSalesRmb: number;
  profitBasisRmb: number;
  profitRmb: number;
  grossMargin: number | null;
  quantity: number;
  unit: string;
}

const clean = (value: unknown) => String(value ?? '').trim();
const normalizeProductIdentityText = (value: unknown) => clean(value)
  .normalize('NFKC')
  .toLocaleLowerCase('zh-CN')
  .replace(/\s+/g, '');
const formatLocalDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const monthOf = (value: string) => clean(value).slice(0, 7);
const within = (value: string, range: DateRange) => {
  const date = clean(value).slice(0, 10);
  return Boolean(date && date >= range.startDate && date <= range.endDate);
};

function normalizeName(value: string) {
  return clean(value).toLocaleLowerCase().replace(/[\s,.，。()（）]+/g, '');
}

function rateForDate(date: string, rates: ExchangeRate[]) {
  const month = monthOf(date);
  const rate = rates.find((item) => item.effective_month === month)?.rate;
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function toRmb(
  amount: number,
  currency: 'USD' | 'RMB',
  date: string,
  rates: ExchangeRate[],
  explicitRate?: number | null,
  explicitRmb?: number | null
) {
  if (currency === 'RMB') return { value: amount, missingRate: false };
  if (typeof explicitRmb === 'number' && Number.isFinite(explicitRmb)) {
    return { value: explicitRmb, missingRate: false };
  }
  const rate = explicitRate && explicitRate > 0 ? explicitRate : rateForDate(date, rates);
  return rate ? { value: amount * rate, missingRate: false } : { value: 0, missingRate: true };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeScore(value: number, values: number[]) {
  if (!values.length) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return max === 0 ? 0 : 100;
  return ((value - min) / (max - min)) * 100;
}

function dayDiff(start: string, end: string) {
  const startMs = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const endMs = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.floor((endMs - startMs) / 86_400_000);
}

function customerIdForContract(contract: Contract | undefined, name: string, customers: Customer[]) {
  if (contract?.customer_id) return contract.customer_id;
  const normalized = normalizeName(name || contract?.customer_name || '');
  return customers.find((item) => normalizeName(item.name) === normalized)?.id || '';
}

export function buildCustomerValueMatrix(
  input: CustomerValueAnalyticsInput,
  range: DateRange
): CustomerValueMatrixResult {
  const contractById = new Map(input.contracts.map((item) => [item.id, item]));
  const contractByNo = new Map(input.contracts.map((item) => [item.contract_no, item]));
  const customerById = new Map(input.customers.map((item) => [item.id, item]));
  const activeIds = new Set<string>();
  const rows = new Map<string, Omit<CustomerValueRow, 'score' | 'quadrant'>>();
  const ensure = (customerId: string, customerName = '') => {
    if (!customerId) return null;
    const existing = rows.get(customerId);
    if (existing) return existing;
    const customer = customerById.get(customerId);
    const next: Omit<CustomerValueRow, 'score' | 'quadrant'> = {
      customerId,
      customerName: customer?.name || customerName || '未命名客户',
      paymentRmb: 0,
      profitRmb: 0,
      confirmedSalesRmb: 0,
      profitBasisRmb: 0,
      grossMargin: null,
      activeMonths: 0,
      contractCount: 0,
      productCount: 0,
      missingRateCount: 0
    };
    rows.set(customerId, next);
    return next;
  };

  const contractsInRange = input.contracts.filter((item) => within(item.contract_date, range));
  const activityMonths = new Map<string, Set<string>>();
  const productKeys = new Map<string, Set<string>>();
  for (const contract of contractsInRange) {
    activeIds.add(contract.customer_id);
    const row = ensure(contract.customer_id, contract.customer_name);
    if (!row) continue;
    row.contractCount += 1;
    const months = activityMonths.get(contract.customer_id) || new Set<string>();
    months.add(monthOf(contract.contract_date));
    activityMonths.set(contract.customer_id, months);
    const products = productKeys.get(contract.customer_id) || new Set<string>();
    input.sheets
      .filter((sheet) => sheet.contract_id === contract.id)
      .forEach((sheet) => products.add(`${clean(sheet.material_no)}|${clean(sheet.product_name)}`));
    productKeys.set(contract.customer_id, products);
  }

  for (const shipment of input.shipments) {
    if (shipment.status !== '已发货' || !within(shipment.shipment_date, range)) continue;
    const contract = contractById.get(shipment.contract_id) || contractByNo.get(shipment.contract_no);
    const customerId = shipment.customer_id || customerIdForContract(contract, shipment.customer_name, input.customers);
    if (!customerId) continue;
    activeIds.add(customerId);
    ensure(customerId, shipment.customer_name);
  }

  const knownReceiptIds = new Set(input.paymentReceipts.map((item) => item.id));
  for (const receipt of input.paymentReceipts) {
    if (!within(receipt.payment_date, range)) continue;
    activeIds.add(receipt.customer_id);
    const row = ensure(receipt.customer_id);
    if (!row) continue;
    const converted = toRmb(
      receipt.total_amount,
      receipt.currency,
      receipt.payment_date,
      input.exchangeRates,
      receipt.exchange_rate,
      receipt.amount_rmb
    );
    row.paymentRmb += converted.value;
    if (converted.missingRate) row.missingRateCount += 1;
  }
  for (const payment of input.payments) {
    if (payment.receipt_id && knownReceiptIds.has(payment.receipt_id)) continue;
    if (!within(payment.payment_date, range)) continue;
    const contract = contractById.get(payment.contract_id) || contractByNo.get(payment.contract_no);
    const customerId = payment.customer_id || customerIdForContract(contract, payment.customer_name, input.customers);
    if (!customerId) continue;
    activeIds.add(customerId);
    const row = ensure(customerId, payment.customer_name);
    if (!row) continue;
    const converted = toRmb(
      payment.amount,
      payment.currency,
      payment.payment_date,
      input.exchangeRates,
      payment.exchange_rate,
      payment.amount_rmb
    );
    row.paymentRmb += converted.value;
    if (converted.missingRate) row.missingRateCount += 1;
  }

  for (const profit of input.shipmentProfits) {
    const invoiceDate = profit.invoice_month ? `${profit.invoice_month}-01` : '';
    if (!within(invoiceDate, range) || profit.profit === null || profit.is_estimated_profit) continue;
    const contract = contractByNo.get(profit.contract_no);
    const customerId = customerIdForContract(contract, profit.customer_name, input.customers);
    if (!customerId) continue;
    const row = ensure(customerId, profit.customer_name);
    if (!row) continue;
    row.profitRmb += profit.profit;
    row.confirmedSalesRmb += profit.sales_amount_rmb || 0;
    row.profitBasisRmb += profit.profit_basis_amount_rmb ?? profit.sales_amount_rmb ?? 0;
  }

  for (const customerId of activeIds) {
    const row = ensure(customerId);
    if (!row) continue;
    row.activeMonths = activityMonths.get(customerId)?.size || 0;
    row.productCount = productKeys.get(customerId)?.size || 0;
    row.grossMargin = row.profitBasisRmb > 0 ? row.profitRmb / row.profitBasisRmb : null;
  }

  const baseRows = [...rows.values()].filter((item) => activeIds.has(item.customerId));
  const paymentMedian = median(baseRows.map((item) => item.paymentRmb));
  const profitMedian = median(baseRows.map((item) => item.profitRmb));
  const paymentValues = baseRows.map((item) => item.paymentRmb);
  const profitValues = baseRows.map((item) => item.profitRmb);
  const activityValues = baseRows.map((item) => item.activeMonths);
  const scoredRows: CustomerValueRow[] = baseRows.map((item) => {
    const highPayment = item.paymentRmb >= paymentMedian;
    const highProfit = item.profitRmb >= profitMedian;
    return {
      ...item,
      score:
        normalizeScore(item.paymentRmb, paymentValues) * 0.45 +
        normalizeScore(item.profitRmb, profitValues) * 0.45 +
        normalizeScore(item.activeMonths, activityValues) * 0.1,
      quadrant: highPayment
        ? highProfit ? 'core' : 'scale'
        : highProfit ? 'potential' : 'low'
    };
  });

  let weightedDays = 0;
  let weightedAmount = 0;
  for (const payment of input.payments) {
    if (!within(payment.payment_date, range)) continue;
    const contract = contractById.get(payment.contract_id) || contractByNo.get(payment.contract_no);
    if (!contract?.contract_date) continue;
    const days = dayDiff(contract.contract_date, payment.payment_date);
    if (days === null || days < 0) continue;
    const amount = toRmb(
      payment.amount,
      payment.currency,
      payment.payment_date,
      input.exchangeRates,
      payment.exchange_rate,
      payment.amount_rmb
    ).value;
    weightedDays += days * amount;
    weightedAmount += amount;
  }
  const totalProfitRmb = scoredRows.reduce((sum, item) => sum + item.profitRmb, 0);
  const confirmedProfitBasisRmb = scoredRows.reduce((sum, item) => sum + item.profitBasisRmb, 0);
  return {
    rows: scoredRows.sort((a, b) => b.score - a.score),
    paymentMedian,
    profitMedian,
    activeCustomerCount: scoredRows.length,
    totalPaymentRmb: scoredRows.reduce((sum, item) => sum + item.paymentRmb, 0),
    totalProfitRmb,
    overallGrossMargin: confirmedProfitBasisRmb > 0 ? totalProfitRmb / confirmedProfitBasisRmb : null,
    averagePaymentCycleDays: weightedAmount > 0 ? weightedDays / weightedAmount : null,
    missingRateCount: scoredRows.reduce((sum, item) => sum + item.missingRateCount, 0)
  };
}

export function fiscalYearForDate(date: string) {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  return parsed.getMonth() === 11 ? parsed.getFullYear() + 1 : parsed.getFullYear();
}

export function getFiscalYearPeriod(
  fiscalYear: number,
  asOfDate = formatLocalDate()
): DateRange & { fiscalYear: number; isCurrent: boolean } {
  const startDate = `${fiscalYear - 1}-12-01`;
  const fullEndDate = `${fiscalYear}-11-30`;
  const currentFiscalYear = fiscalYearForDate(asOfDate);
  return {
    fiscalYear,
    startDate,
    endDate: fiscalYear === currentFiscalYear && asOfDate < fullEndDate ? asOfDate : fullEndDate,
    isCurrent: fiscalYear === currentFiscalYear
  };
}

export function getProductSkuKey(materialNo: string, productName: string, specification: string, unit: string) {
  const material = normalizeProductIdentityText(materialNo);
  return material
    ? [material, normalizeProductIdentityText(specification), normalizeProductIdentityText(unit)].join('|')
    : [
        '无物料号',
        normalizeProductIdentityText(productName),
        normalizeProductIdentityText(specification),
        normalizeProductIdentityText(unit)
      ].join('|');
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function comparablePreviousRange(period: DateRange & { isCurrent: boolean }, fiscalYear: number) {
  const previous = getFiscalYearPeriod(fiscalYear - 1, `${fiscalYear - 1}-11-30`);
  if (!period.isCurrent) return previous;
  const elapsed = dayDiff(period.startDate, period.endDate) || 0;
  return { ...previous, endDate: addDays(previous.startDate, elapsed) };
}

function aggregateProducts(
  input: CustomerValueAnalyticsInput,
  customerId: string,
  period: DateRange,
  basis: ProductAnalysisBasis
) {
  const contracts = input.contracts.filter((item) => item.customer_id === customerId);
  const contractIds = new Set(contracts.map((item) => item.id));
  const contractByNo = new Map(contracts.map((item) => [item.contract_no, item]));
  const sheetsById = new Map(input.sheets.map((item) => [item.id, item]));
  const rows = new Map<string, ProductAnalysisRow>();
  const ensure = (details: {
    materialNo: string;
    productName: string;
    specification: string;
    unit: string;
  }) => {
    const key = getProductSkuKey(details.materialNo, details.productName, details.specification, details.unit);
    const existing = rows.get(key);
    if (existing) return existing;
    const row: ProductAnalysisRow = {
      key,
      materialNo: clean(details.materialNo) || '—',
      productName: clean(details.productName) || '未命名产品',
      specification: clean(details.specification) || '—',
      unit: clean(details.unit) || '单位',
      quantity: 0,
      salesRmb: 0,
      confirmedSalesRmb: 0,
      profitBasisRmb: 0,
      profitRmb: 0,
      grossMargin: null,
      amountShare: 0,
      yearOverYear: null,
      missingRateCount: 0
    };
    rows.set(key, row);
    return row;
  };

  if (basis === 'shipment') {
    const shipments = input.shipments.filter(
      (item) => item.status === '已发货' && contractIds.has(item.contract_id) && within(item.shipment_date, period)
    );
    const shipmentById = new Map(shipments.map((item) => [item.id, item]));
    for (const item of input.shipmentItems) {
      const shipment = shipmentById.get(item.shipment_id);
      if (!shipment) continue;
      const sheet = sheetsById.get(item.contact_sheet_id);
      const row = ensure({
        materialNo: item.material_no || sheet?.material_no || '',
        productName: item.product_name || sheet?.product_name || '',
        specification: item.specification || sheet?.specification || '',
        unit: item.unit || sheet?.unit || ''
      });
      row.quantity += item.shipped_quantity || 0;
      const amount = item.amount || (item.shipped_quantity || 0) * (item.unit_price || 0);
      const converted = toRmb(amount, shipment.currency, shipment.shipment_date, input.exchangeRates);
      row.salesRmb += converted.value;
      if (converted.missingRate) row.missingRateCount += 1;
    }
  } else {
    const contractsInRange = contracts.filter((item) => within(item.contract_date, period));
    const contractByRangeId = new Map(contractsInRange.map((item) => [item.id, item]));
    for (const sheet of input.sheets) {
      const contract = contractByRangeId.get(sheet.contract_id);
      if (!contract) continue;
      const row = ensure({
        materialNo: sheet.material_no,
        productName: sheet.product_name,
        specification: sheet.specification,
        unit: sheet.unit
      });
      row.quantity += sheet.quantity || 0;
      const converted = toRmb(
        (sheet.quantity || 0) * (sheet.unit_price || 0),
        contract.currency,
        contract.contract_date,
        input.exchangeRates
      );
      row.salesRmb += converted.value;
      if (converted.missingRate) row.missingRateCount += 1;
    }
  }

  for (const item of input.shipmentProfits) {
    const invoiceDate = item.invoice_month ? `${item.invoice_month}-01` : '';
    const contract = contractByNo.get(item.contract_no);
    if (!contract || !within(invoiceDate, period) || item.profit === null || item.is_estimated_profit) continue;
    if (basis === 'contract' && !within(contract.contract_date, period)) continue;
    const row = ensure({
      materialNo: item.material_no,
      productName: item.product_name,
      specification: item.specification,
      unit: item.unit
    });
    row.profitRmb += item.profit;
    row.confirmedSalesRmb += item.sales_amount_rmb || 0;
    row.profitBasisRmb += item.profit_basis_amount_rmb ?? item.sales_amount_rmb ?? 0;
  }

  const totalSalesRmb = [...rows.values()].reduce((sum, item) => sum + item.salesRmb, 0);
  for (const row of rows.values()) {
    row.grossMargin = row.profitBasisRmb > 0 ? row.profitRmb / row.profitBasisRmb : null;
    row.amountShare = totalSalesRmb > 0 ? row.salesRmb / totalSalesRmb : 0;
  }
  return [...rows.values()];
}

export function buildCustomerProductAnalysis(
  input: CustomerValueAnalyticsInput,
  customerId: string,
  fiscalYear: number,
  basis: ProductAnalysisBasis,
  asOfDate = formatLocalDate()
): CustomerProductAnalysisResult {
  const period = getFiscalYearPeriod(fiscalYear, asOfDate);
  const currentRows = aggregateProducts(input, customerId, period, basis);
  const previousRange = comparablePreviousRange(period, fiscalYear);
  const previousRows = new Map(
    aggregateProducts(input, customerId, previousRange, basis).map((item) => [item.key, item])
  );
  const rows = currentRows.map((item) => {
    const previous = previousRows.get(item.key)?.salesRmb || 0;
    return {
      ...item,
      yearOverYear: previous > 0 ? (item.salesRmb - previous) / previous : null
    };
  }).sort((a, b) => b.salesRmb - a.salesRmb);
  const totalSalesRmb = rows.reduce((sum, item) => sum + item.salesRmb, 0);
  const totalProfitRmb = rows.reduce((sum, item) => sum + item.profitRmb, 0);
  const confirmedProfitBasisRmb = rows.reduce((sum, item) => sum + item.profitBasisRmb, 0);
  const units = new Set(rows.filter((item) => item.quantity > 0).map((item) => item.unit));
  return {
    rows,
    period,
    totalSalesRmb,
    totalProfitRmb,
    overallGrossMargin: confirmedProfitBasisRmb > 0 ? totalProfitRmb / confirmedProfitBasisRmb : null,
    totalQuantity: units.size <= 1 ? rows.reduce((sum, item) => sum + item.quantity, 0) : null,
    quantityUnit: units.size === 1 ? [...units][0] : '',
    mixedQuantityUnits: units.size > 1,
    missingRateCount: rows.reduce((sum, item) => sum + item.missingRateCount, 0)
  };
}

export function buildProductTrend(
  input: CustomerValueAnalyticsInput,
  customerId: string,
  selectedFiscalYear: number,
  basis: ProductAnalysisBasis,
  selectedProductKey: string,
  asOfDate = formatLocalDate()
): ProductTrendYear[] {
  return [selectedFiscalYear - 2, selectedFiscalYear - 1, selectedFiscalYear].map((fiscalYear) => {
    const period = getFiscalYearPeriod(fiscalYear, asOfDate);
    const row = aggregateProducts(input, customerId, period, basis)
      .find((item) => item.key === selectedProductKey);
    return {
      fiscalYear,
      label: `FY${fiscalYear}`,
      startDate: period.startDate,
      endDate: period.endDate,
      cutoffLabel: period.isCurrent ? `截至 ${period.endDate}` : `${period.startDate}—${period.endDate}`,
      salesRmb: row?.salesRmb || 0,
      confirmedSalesRmb: row?.confirmedSalesRmb || 0,
      profitBasisRmb: row?.profitBasisRmb || 0,
      profitRmb: row?.profitRmb || 0,
      grossMargin: row?.grossMargin ?? null,
      quantity: row?.quantity || 0,
      unit: row?.unit || ''
    };
  });
}
