import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  calculateGrowthPercent,
  getDashboardMonthComparisonRanges
} from '../src/services/dashboardOperatingMetrics.ts';

test('首页经营指标只调用数据库权威 RPC，不保留第二套本地计算', async () => {
  const source = await readFile(new URL('../src/services/dashboardOperatingMetrics.ts', import.meta.url), 'utf8');
  assert.match(source, /rpc\/get_operating_metrics/);
  assert.doesNotMatch(source, /function paymentEvents|function appendAmount|calculateDashboardPeriodMetrics/);
});

test('月度同比环比使用相同已过天数并正确处理跨年', () => {
  assert.deepEqual(getDashboardMonthComparisonRanges('2026-01-31'), {
    current: { startDate: '2026-01-01', endDate: '2026-01-31' },
    previous: { startDate: '2025-12-01', endDate: '2025-12-31' },
    yearAgo: { startDate: '2025-01-01', endDate: '2025-01-31' }
  });
  assert.deepEqual(getDashboardMonthComparisonRanges('2026-03-31').previous, {
    startDate: '2026-02-01',
    endDate: '2026-02-28'
  });
});

test('对比基数为零时不伪造增长率', () => {
  assert.equal(calculateGrowthPercent(100, 0), null);
  assert.equal(calculateGrowthPercent(120, 100), 20);
});
