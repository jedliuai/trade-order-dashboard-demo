import {
  buildCustomerValueMatrix,
  toRmb
} from './customerValueAnalytics.ts';
import type {
  CustomerValueAnalyticsInput,
  DateRange
} from './customerValueAnalytics.ts';

export type CustomerConcentrationMetric = 'sales' | 'payment' | 'profit';

interface CustomerMetricAmounts {
  customerId: string;
  customerName: string;
  salesRmb: number;
  paymentRmb: number;
  profitRmb: number;
}

export interface CustomerConcentrationRow extends CustomerMetricAmounts {
  rank: number;
  amount: number;
  share: number;
  cumulativeShare: number;
}

export interface CustomerConcentrationLossRow extends CustomerMetricAmounts {
  amount: number;
}

export interface CustomerConcentrationResult {
  metric: CustomerConcentrationMetric;
  rows: CustomerConcentrationRow[];
  lossRows: CustomerConcentrationLossRow[];
  totalAmount: number;
  totalLossRmb: number;
  top1Share: number;
  top3Share: number;
  top5Share: number;
  n80: number;
  missingSalesRateCount: number;
  missingPaymentRateCount: number;
}

const clean = (value: unknown) => String(value ?? '').trim();

function withinRange(value: string, range: DateRange) {
  const date = clean(value).slice(0, 10);
  return Boolean(date && date >= range.startDate && date <= range.endDate);
}

function normalizeCustomerName(value: string) {
  return clean(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s,.，。()（）]+/g, '');
}

function compareCustomerNames(
  left: Pick<CustomerMetricAmounts, 'customerId' | 'customerName'>,
  right: Pick<CustomerMetricAmounts, 'customerId' | 'customerName'>
) {
  return left.customerName.localeCompare(right.customerName, 'zh-CN')
    || left.customerId.localeCompare(right.customerId);
}

function metricAmount(row: CustomerMetricAmounts, metric: CustomerConcentrationMetric) {
  if (metric === 'sales') return row.salesRmb;
  if (metric === 'payment') return row.paymentRmb;
  return row.profitRmb;
}

/**
 * 汇总客户集中度。回款沿用客户价值矩阵口径；利润按相同的已确认条件
 * 直接汇总 v_shipment_profit 快照；销售额只取日期范围内已发货记录的
 * 发货明细金额，并按合同币种及统一汇率逻辑折算人民币。
 * 所有占比均为 0–1 的小数。
 */
export function buildCustomerConcentration(
  input: CustomerValueAnalyticsInput,
  range: DateRange,
  metric: CustomerConcentrationMetric
): CustomerConcentrationResult {
  const valueMatrix = buildCustomerValueMatrix(input, range);
  const customerById = new Map(input.customers.map((item) => [item.id, item]));
  const customerByName = new Map(
    input.customers.map((item) => [normalizeCustomerName(item.name), item])
  );
  const contractById = new Map(input.contracts.map((item) => [item.id, item]));
  const contractByNo = new Map(input.contracts.map((item) => [item.contract_no, item]));
  const amountsByCustomer = new Map<string, CustomerMetricAmounts>();

  const ensureCustomer = (customerId: string, customerName = '') => {
    if (!customerId) return null;
    const existing = amountsByCustomer.get(customerId);
    if (existing) return existing;
    const row: CustomerMetricAmounts = {
      customerId,
      customerName: customerById.get(customerId)?.name || customerName || '未命名客户',
      salesRmb: 0,
      paymentRmb: 0,
      profitRmb: 0
    };
    amountsByCustomer.set(customerId, row);
    return row;
  };

  for (const valueRow of valueMatrix.rows) {
    const row = ensureCustomer(valueRow.customerId, valueRow.customerName);
    if (!row) continue;
    row.paymentRmb = valueRow.paymentRmb;
  }

  // 价值矩阵只返回其活跃客户集合。利润集中度需覆盖“本期仅有已确认利润事实”的客户，
  // 因此在此按价值矩阵既有的利润条件直接聚合，避免被合同或发货活动日期过滤。
  for (const profit of input.shipmentProfits) {
    const invoiceDate = profit.invoice_month ? `${profit.invoice_month}-01` : '';
    if (
      !withinRange(invoiceDate, range)
      || profit.profit === null
      || !Number.isFinite(profit.profit)
      || profit.is_estimated_profit
    ) continue;
    const contract = contractByNo.get(profit.contract_no);
    const matchedCustomer = customerByName.get(normalizeCustomerName(
      contract?.customer_name || profit.customer_name
    ));
    const customerId = contract?.customer_id || matchedCustomer?.id || '';
    const row = ensureCustomer(
      customerId,
      matchedCustomer?.name || contract?.customer_name || profit.customer_name
    );
    if (!row) continue;
    row.profitRmb += profit.profit;
  }

  const eligibleShipmentById = new Map(
    input.shipments
      .filter((item) => item.status === '已发货' && withinRange(item.shipment_date, range))
      .map((item) => [item.id, item])
  );
  let missingSalesRateCount = 0;
  for (const item of input.shipmentItems) {
    const shipment = eligibleShipmentById.get(item.shipment_id);
    if (!shipment) continue;
    const contract = contractById.get(shipment.contract_id) || contractByNo.get(shipment.contract_no);
    const matchedCustomer = customerByName.get(normalizeCustomerName(
      shipment.customer_name || contract?.customer_name || ''
    ));
    const customerId = shipment.customer_id || contract?.customer_id || matchedCustomer?.id || '';
    const row = ensureCustomer(
      customerId,
      matchedCustomer?.name || contract?.customer_name || shipment.customer_name
    );
    if (!row) continue;
    const itemAmount = Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0;
    const converted = toRmb(
      itemAmount,
      contract?.currency || shipment.currency,
      shipment.shipment_date,
      input.exchangeRates
    );
    row.salesRmb += converted.value;
    if (converted.missingRate) missingSalesRateCount += 1;
  }

  const positiveRows = [...amountsByCustomer.values()]
    .map((row) => ({ ...row, amount: metricAmount(row, metric) }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .sort((left, right) => right.amount - left.amount || compareCustomerNames(left, right));
  const totalAmount = positiveRows.reduce((sum, row) => sum + row.amount, 0);
  let cumulativeAmount = 0;
  const rows = positiveRows.map((row, index): CustomerConcentrationRow => {
    cumulativeAmount += row.amount;
    return {
      ...row,
      rank: index + 1,
      share: totalAmount > 0 ? row.amount / totalAmount : 0,
      cumulativeShare: totalAmount > 0 ? cumulativeAmount / totalAmount : 0
    };
  });
  const shareFor = (limit: number) => totalAmount > 0
    ? rows.slice(0, limit).reduce((sum, row) => sum + row.amount, 0) / totalAmount
    : 0;
  const n80Index = rows.findIndex((row) => row.cumulativeShare >= 0.8);
  const lossRows = metric === 'profit'
    ? [...amountsByCustomer.values()]
        .map((row) => ({ ...row, amount: row.profitRmb }))
        .filter((row) => Number.isFinite(row.amount) && row.amount < 0)
        .sort((left, right) => left.amount - right.amount || compareCustomerNames(left, right))
    : [];

  return {
    metric,
    rows,
    lossRows,
    totalAmount,
    totalLossRmb: lossRows.reduce((sum, row) => sum + row.amount, 0),
    top1Share: shareFor(1),
    top3Share: shareFor(3),
    top5Share: shareFor(5),
    n80: n80Index >= 0 ? n80Index + 1 : 0,
    missingSalesRateCount,
    missingPaymentRateCount: valueMatrix.missingRateCount
  };
}
