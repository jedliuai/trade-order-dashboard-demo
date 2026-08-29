import assert from 'node:assert/strict';
import test from 'node:test';

import { addDaysToLocalDate, formatChinaDate, formatLocalDate, formatLocalMonth } from '../src/services/dateUtils.ts';

test('本地日期格式不经过 UTC 转换', () => {
  const local = new Date(2026, 6, 1, 0, 30);
  assert.equal(formatLocalDate(local), '2026-07-01');
  assert.equal(formatLocalMonth(local), '2026-07');
});

test('本地日期加天数正确处理跨月并拒绝伪日期', () => {
  assert.equal(addDaysToLocalDate('2026-07-25', 10), '2026-08-04');
  assert.equal(addDaysToLocalDate('2026-02-30', 10), '');
});

test('首页经营截止日期固定按中国时区解释', () => {
  assert.equal(formatChinaDate(new Date('2026-08-24T16:30:00.000Z')), '2026-08-25');
});
