export interface DashboardPeriodRange {
  startDate: string;
  endDate: string;
}

export interface DashboardKpiMetric {
  amountRmb: number;
  count: number;
  originalRmb: number;
  originalUsd: number;
}

export interface DashboardPeriodMetrics {
  orders: DashboardKpiMetric;
  payments: DashboardKpiMetric;
  shipments: DashboardKpiMetric;
  confirmedProfitRmb: number;
  customerBalance: DashboardCustomerBalance;
  missingRateMonths: string[];
}

export interface DashboardCustomerBalance {
  customerOwesRmb: number;
  weOweCustomerRmb: number;
  customerOwesCount: number;
  weOweCustomerCount: number;
  balancedCount: number;
  missingRateCount: number;
  currencyConflictCount: number;
}

interface OperatingMetricsRpcResponse {
  orders?: Record<string, unknown>;
  payments?: Record<string, unknown>;
  shipments?: Record<string, unknown>;
  confirmed_profit_rmb?: unknown;
  customer_balance?: Record<string, unknown>;
  missing_rate_months?: unknown;
}

const emptyMetric = (): DashboardKpiMetric => ({
  amountRmb: 0,
  count: 0,
  originalRmb: 0,
  originalUsd: 0
});

function numberValue(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function metricValue(value: Record<string, unknown> | undefined): DashboardKpiMetric {
  return {
    count: numberValue(value?.count),
    originalUsd: numberValue(value?.original_usd),
    originalRmb: numberValue(value?.original_rmb),
    amountRmb: numberValue(value?.amount_rmb)
  };
}

export function emptyDashboardPeriodMetrics(): DashboardPeriodMetrics {
  return {
    orders: emptyMetric(),
    payments: emptyMetric(),
    shipments: emptyMetric(),
    confirmedProfitRmb: 0,
    customerBalance: {
      customerOwesRmb: 0,
      weOweCustomerRmb: 0,
      customerOwesCount: 0,
      weOweCustomerCount: 0,
      balancedCount: 0,
      missingRateCount: 0,
      currencyConflictCount: 0
    },
    missingRateMonths: []
  };
}

export async function fetchDashboardPeriodMetrics(
  range: DashboardPeriodRange,
  ownerId?: string
): Promise<DashboardPeriodMetrics> {
  const { localRest } = await import('./localClient.ts');
  const search = new URLSearchParams({
    p_start_date: range.startDate,
    p_end_date: range.endDate
  });
  if (ownerId) search.set('p_owner_id', ownerId);
  const payload = await localRest<OperatingMetricsRpcResponse>(
    `rpc/get_operating_metrics?${search.toString()}`,
    { method: 'GET' }
  );
  const balance = payload.customer_balance || {};
  return {
    orders: metricValue(payload.orders),
    payments: metricValue(payload.payments),
    shipments: metricValue(payload.shipments),
    confirmedProfitRmb: numberValue(payload.confirmed_profit_rmb),
    customerBalance: {
      customerOwesRmb: numberValue(balance.customer_owes_rmb),
      weOweCustomerRmb: numberValue(balance.we_owe_customer_rmb),
      customerOwesCount: numberValue(balance.customer_owes_count),
      weOweCustomerCount: numberValue(balance.we_owe_customer_count),
      balancedCount: numberValue(balance.balanced_count),
      missingRateCount: numberValue(balance.missing_rate_count),
      currencyConflictCount: numberValue(balance.currency_conflict_count)
    },
    missingRateMonths: Array.isArray(payload.missing_rate_months)
      ? payload.missing_rate_months.map(String).sort()
      : []
  };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateText(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getDashboardMonthComparisonRanges(asOfDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfDate);
  if (!match) throw new Error('首页月份比较需要 YYYY-MM-DD 格式的截止日期。');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousMonthYear = month === 1 ? year - 1 : year;
  const previousEndDay = Math.min(day, daysInMonth(previousMonthYear, previousMonth));
  const yearAgoEndDay = Math.min(day, daysInMonth(year - 1, month));

  return {
    current: { startDate: dateText(year, month, 1), endDate: asOfDate },
    previous: {
      startDate: dateText(previousMonthYear, previousMonth, 1),
      endDate: dateText(previousMonthYear, previousMonth, previousEndDay)
    },
    yearAgo: {
      startDate: dateText(year - 1, month, 1),
      endDate: dateText(year - 1, month, yearAgoEndDay)
    }
  };
}

export function calculateGrowthPercent(current: number, comparison: number) {
  if (!Number.isFinite(current) || !Number.isFinite(comparison) || comparison <= 0) return null;
  return ((current - comparison) / comparison) * 100;
}

export function getFullMonthRange(month: string, endDate?: string): DashboardPeriodRange {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('月份必须使用 YYYY-MM 格式。');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const monthEnd = dateText(year, monthNumber, daysInMonth(year, monthNumber));
  return {
    startDate: `${month}-01`,
    endDate: endDate && endDate.startsWith(month) ? endDate : monthEnd
  };
}
