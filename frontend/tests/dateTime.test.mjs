import assert from 'node:assert/strict';
import test from 'node:test';

import { CHINA_TIME_ZONE, formatChinaDateTime } from '../src/services/dateTime.ts';

test('同步日志时间固定按中国时区显示而不依赖电脑或浏览器时区', () => {
  assert.equal(CHINA_TIME_ZONE, 'Asia/Shanghai');
  assert.match(formatChinaDateTime('2026-08-03T01:11:42.000Z'), /2026\/08\/03 09:11:42/);
});

test('无效日志时间保留可读回退文本', () => {
  assert.equal(formatChinaDateTime('not-a-date'), 'not-a-date');
});
