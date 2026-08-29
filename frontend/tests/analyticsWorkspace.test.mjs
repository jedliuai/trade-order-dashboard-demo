import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAnalyticsAxisValue,
  formatAnalyticsTooltipValue,
  formatAnalyticsValue,
  getAnalyticsTimeGroupKey,
  getAnalyticsMetricLabel,
  getAnalyticsMetricUnits,
  isAnalyticsEventInRange,
  limitAnalyticsMetricsToTwoUnits,
  normalizeAnalyticsChartRows
} from '../src/services/analyticsWorkspace.ts';

test('月度图只保留筛选范围并补齐范围内空月份', () => {
  const rows = [
    { name: '2025-10', contract_amount: 99 },
    { name: '2025-12', contract_amount: 10 },
    { name: '2026-02', contract_amount: 20 },
    { name: '2026-08', contract_amount: 88 }
  ];

  const normalized = normalizeAnalyticsChartRows(rows, {
    dimension: 'month',
    startDate: '2025-12-01',
    endDate: '2026-02-28',
    selectedMetrics: ['contract_amount']
  });

  assert.deepEqual(normalized, [
    { name: '2025-12', contract_amount: 10 },
    { name: '2026-01', contract_amount: 0 },
    { name: '2026-02', contract_amount: 20 }
  ]);
});

test('季度和年度分组使用业务日期', () => {
  assert.equal(getAnalyticsTimeGroupKey('2026-01-31', 'quarter'), '2026 Q1');
  assert.equal(getAnalyticsTimeGroupKey('2026-12-01', 'quarter'), '2026 Q4');
  assert.equal(getAnalyticsTimeGroupKey('2026-07-20', 'year'), '2026');
});

test('提醒等业务事件必须落在筛选日期内', () => {
  assert.equal(isAnalyticsEventInRange('2025-10-20T08:00:00Z', '2025-12-01', '2026-07-20'), false);
  assert.equal(isAnalyticsEventInRange('2026-07-20T08:00:00Z', '2025-12-01', '2026-07-20'), true);
});

test('非时间维度隐藏所选指标全部为零的分组', () => {
  const normalized = normalizeAnalyticsChartRows([
    { name: '客户 A', payment_amount: 0, profit: 0 },
    { name: '客户 B', payment_amount: 10, profit: 0 }
  ], {
    dimension: 'customer',
    startDate: '2025-12-01',
    endDate: '2026-07-20',
    selectedMetrics: ['payment_amount', 'profit']
  });

  assert.deepEqual(normalized.map((row) => row.name), ['客户 B']);
});

test('金额明细显示整数元、Tooltip 显示两位小数万元、坐标轴缩写为万元', () => {
  assert.equal(formatAnalyticsValue(1234567.49, 'payment_amount'), '￥1,234,567');
  assert.equal(formatAnalyticsTooltipValue(11111, 'payment_amount'), '1.11 万元');
  assert.equal(formatAnalyticsTooltipValue(12.345, 'gross_margin'), '12.35%');
  assert.equal(formatAnalyticsAxisValue(1234567.49, 'amount'), '123');
  assert.equal(getAnalyticsMetricLabel('payment_amount', true), '回款金额（人民币元）');
});

test('图表最多识别金额、比率和数量三类单位', () => {
  assert.deepEqual(getAnalyticsMetricUnits(['contract_amount', 'payment_amount', 'gross_margin']), ['amount', 'rate']);
  assert.deepEqual(getAnalyticsMetricUnits(['contract_amount', 'gross_margin', 'sheet_count']), ['amount', 'rate', 'count']);
  assert.deepEqual(limitAnalyticsMetricsToTwoUnits(['contract_amount', 'gross_margin', 'sheet_count', 'payment_amount']), ['contract_amount', 'gross_margin', 'payment_amount']);
  assert.equal(formatAnalyticsValue(12, 'sheet_count'), '12 张');
});
