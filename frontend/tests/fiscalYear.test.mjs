import assert from 'node:assert/strict';
import test from 'node:test';

import { getFiscalYearRange, getPreviousFiscalYearRange, isDateInRange, isMonthInRange, listMonthsInRange } from '../src/services/fiscalYear.ts';

test('一月至十一月默认财年从上一年十二月一日开始', () => {
  assert.deepEqual(getFiscalYearRange(new Date(2026, 6, 17)), {
    startDate: '2025-12-01',
    endDate: '2026-07-17',
    startMonth: '2025-12',
    endMonth: '2026-07',
    label: '2025-12-01 至 2026-07-17'
  });
});

test('进入十二月后自动切换到新财年', () => {
  assert.equal(getFiscalYearRange(new Date(2026, 11, 5)).startDate, '2026-12-01');
});

test('上一完整财年始终取十二月一日至次年十一月三十日', () => {
  assert.deepEqual(getPreviousFiscalYearRange(getFiscalYearRange(new Date(2026, 7, 25))), {
    startDate: '2024-12-01',
    endDate: '2025-11-30',
    startMonth: '2024-12',
    endMonth: '2025-11',
    label: '2024-12-01 至 2025-11-30'
  });
});

test('财年日期和月份范围包含边界并能跨年列出月份', () => {
  assert.equal(isDateInRange('2025-12-01', '2025-12-01', '2026-07-17'), true);
  assert.equal(isDateInRange('2025-11-30', '2025-12-01', '2026-07-17'), false);
  assert.equal(isMonthInRange('2026-07', '2025-12', '2026-07'), true);
  assert.deepEqual(listMonthsInRange('2025-12', '2026-02'), ['2025-12', '2026-01', '2026-02']);
});
