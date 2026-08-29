export interface AnalyticsMetricRow {
  name: string;
  [key: string]: string | number;
}

export interface ConcentrationSummary {
  metric: string;
  total: number;
  top1: number;
  top3: number;
  top5: number;
  positiveGroupCount: number;
}

export function calculateConcentration(rows: AnalyticsMetricRow[], metric: string): ConcentrationSummary {
  const values = rows
    .map((row) => Number(row[metric] || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left);
  const total = values.reduce((sum, value) => sum + value, 0);
  const share = (limit: number) => total > 0
    ? values.slice(0, limit).reduce((sum, value) => sum + value, 0) / total * 100
    : 0;
  return {
    metric,
    total,
    top1: share(1),
    top3: share(3),
    top5: share(5),
    positiveGroupCount: values.length
  };
}

export function collapseTopGroupsWithOther(
  rows: AnalyticsMetricRow[],
  rankMetric: string,
  metrics: string[],
  limit = 5
): AnalyticsMetricRow[] {
  const sorted = [...rows].sort((left, right) => Number(right[rankMetric] || 0) - Number(left[rankMetric] || 0));
  if (sorted.length <= limit) return sorted;
  const other: AnalyticsMetricRow = { name: '其他' };
  metrics.forEach((metric) => {
    other[metric] = sorted.slice(limit).reduce((sum, row) => sum + Number(row[metric] || 0), 0);
  });
  return [...sorted.slice(0, limit), other];
}
