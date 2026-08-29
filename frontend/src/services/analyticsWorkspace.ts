export type AnalyticsTimeDimension = 'month' | 'quarter' | 'year';

export interface AnalyticsChartRowLike {
  name: string;
  [metric: string]: string | number;
}

export interface AnalyticsDimensionContext {
  eventDate?: string | null;
  customerName?: string | null;
  country?: string | null;
  productName?: string | null;
  materialNo?: string | null;
  exportType?: string | null;
  status?: string | null;
}

export type AnalyticsMetricUnit = 'amount' | 'rate' | 'count';

const amountMetrics = new Set([
  'contract_amount',
  'shipment_amount',
  'payment_amount',
  'unpaid_amount',
  'invoice_amount',
  'profit'
]);

const metricLabels: Record<string, string> = {
  contract_amount: '合同金额',
  shipment_amount: '发货金额',
  payment_amount: '回款金额',
  unpaid_amount: '当前应收',
  invoice_amount: '开票金额',
  profit: '利润',
  gross_margin: '毛利率',
  contract_count: '合同数量',
  sheet_count: '联系单数量',
  shipment_count: '发货数量',
  alert_count: '风险订单数'
};

const countSuffixes: Record<string, string> = {
  contract_count: '份',
  sheet_count: '张',
  shipment_count: '批',
  alert_count: '条'
};

export function getAnalyticsMetricUnit(metric: string): AnalyticsMetricUnit {
  if (amountMetrics.has(metric)) return 'amount';
  if (metric === 'gross_margin') return 'rate';
  return 'count';
}

export function getAnalyticsMetricLabel(metric: string, includeUnit = false): string {
  const label = metricLabels[metric] || metric;
  if (!includeUnit) return label;
  const unit = getAnalyticsMetricUnit(metric);
  if (unit === 'amount') return `${label}（人民币元）`;
  if (unit === 'rate') return `${label}（%）`;
  return `${label}（${countSuffixes[metric] || '项'}）`;
}

export function getAnalyticsMetricUnits(metrics: readonly string[]): AnalyticsMetricUnit[] {
  return Array.from(new Set(metrics.map(getAnalyticsMetricUnit)));
}

export function limitAnalyticsMetricsToTwoUnits(metrics: readonly string[]): string[] {
  const acceptedUnits = new Set<AnalyticsMetricUnit>();
  return metrics.filter((metric) => {
    const unit = getAnalyticsMetricUnit(metric);
    if (acceptedUnits.has(unit)) return true;
    if (acceptedUnits.size >= 2) return false;
    acceptedUnits.add(unit);
    return true;
  });
}

export function formatAnalyticsValue(value: number | string | null | undefined, metric: string): string {
  const numericValue = Number(value || 0);
  const unit = getAnalyticsMetricUnit(metric);
  if (unit === 'amount') return `￥${Math.round(numericValue).toLocaleString('zh-CN')}`;
  if (unit === 'rate') return `${numericValue.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
  return `${Math.round(numericValue).toLocaleString('zh-CN')} ${countSuffixes[metric] || '项'}`;
}

export function formatAnalyticsTooltipValue(value: number | string | null | undefined, metric: string): string {
  const numericValue = Number(value || 0);
  const unit = getAnalyticsMetricUnit(metric);
  if (unit === 'amount') {
    return `${(numericValue / 10000).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} 万元`;
  }
  if (unit === 'rate') {
    return `${numericValue.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}%`;
  }
  return `${Math.round(numericValue).toLocaleString('zh-CN')} ${countSuffixes[metric] || '项'}`;
}

export function formatAnalyticsAxisValue(value: number | string, unit: AnalyticsMetricUnit): string {
  const numericValue = Number(value || 0);
  if (unit === 'amount') {
    const wan = numericValue / 10000;
    return wan.toLocaleString('zh-CN', { maximumFractionDigits: Math.abs(wan) < 10 ? 1 : 0 });
  }
  if (unit === 'rate') return `${numericValue.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
  return Math.round(numericValue).toLocaleString('zh-CN');
}

export function isAnalyticsTimeDimension(dimension: string): dimension is AnalyticsTimeDimension {
  return dimension === 'month' || dimension === 'quarter' || dimension === 'year';
}

export function getAnalyticsTimeGroupKey(date: string | null | undefined, dimension: AnalyticsTimeDimension): string {
  if (!date || !/^\d{4}-\d{2}/.test(date)) return '未指定日期';
  const year = date.substring(0, 4);
  if (dimension === 'year') return year;
  if (dimension === 'month') return date.substring(0, 7);
  const month = Number(date.substring(5, 7));
  return month >= 1 && month <= 12 ? `${year} Q${Math.ceil(month / 3)}` : '未指定日期';
}

export function getAnalyticsDimensionKey(dimension: string, context: AnalyticsDimensionContext): string {
  if (isAnalyticsTimeDimension(dimension)) return getAnalyticsTimeGroupKey(context.eventDate, dimension);
  if (dimension === 'customer') return context.customerName || '未知客户';
  if (dimension === 'country') return context.country || '未知国家';
  if (dimension === 'product') return context.productName || '未知产品';
  if (dimension === 'material') return context.materialNo || '未知物料';
  if (dimension === 'export_type') return context.exportType || '未知类型';
  if (dimension === 'status') return context.status || '未知状态';
  return '其他';
}

export function isAnalyticsEventInRange(date: string | null | undefined, startDate: string, endDate: string): boolean {
  if (!date) return false;
  const day = date.substring(0, 10);
  return (!startDate || day >= startDate) && (!endDate || day <= endDate);
}

function enumerateMonths(startDate: string, endDate: string): string[] {
  const startMatch = /^(\d{4})-(\d{2})/.exec(startDate);
  const endMatch = /^(\d{4})-(\d{2})/.exec(endDate);
  if (!startMatch || !endMatch) return [];

  let year = Number(startMatch[1]);
  let month = Number(startMatch[2]);
  const endYear = Number(endMatch[1]);
  const endMonth = Number(endMatch[2]);
  if (month < 1 || month > 12 || endMonth < 1 || endMonth > 12) return [];
  if (year * 12 + month > endYear * 12 + endMonth) return [];

  const months: string[] = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return months;
}

export function getAnalyticsTimeGroups(startDate: string, endDate: string, dimension: AnalyticsTimeDimension): string[] {
  const monthGroups = enumerateMonths(startDate, endDate);
  if (dimension === 'month') return monthGroups;
  return Array.from(new Set(monthGroups.map((month) => getAnalyticsTimeGroupKey(`${month}-01`, dimension))));
}

/**
 * 时间图严格服从筛选范围并补齐空档；非时间图只保留当前所选指标至少有一个非零值的分组。
 */
export function normalizeAnalyticsChartRows<T extends AnalyticsChartRowLike>(
  rows: readonly T[],
  options: {
    dimension: string;
    startDate: string;
    endDate: string;
    selectedMetrics: string[];
  }
): AnalyticsChartRowLike[] {
  if (!isAnalyticsTimeDimension(options.dimension)) {
    return rows
      .filter((row) => options.selectedMetrics.some((metric) => Math.abs(Number(row[metric] || 0)) > 0))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));
  }

  const expectedGroups = getAnalyticsTimeGroups(options.startDate, options.endDate, options.dimension);
  if (expectedGroups.length === 0) return [];
  const rowsByName = new Map(rows.map((row) => [row.name, row]));

  return expectedGroups.map((name) => {
    const existing = rowsByName.get(name);
    if (existing) return existing;
    return options.selectedMetrics.reduce<AnalyticsChartRowLike>((emptyRow, metric) => {
      emptyRow[metric] = 0;
      return emptyRow;
    }, { name });
  });
}
