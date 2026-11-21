import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFiscalSpiralGeometry, calculateFiscalProgress } from '../src/services/fiscalProgress.ts';

test('不足一圈时只绘制第一圈的实际比例', () => {
  assert.deepEqual(calculateFiscalProgress(84.5, 100), {
    percent: 84.5,
    completedLaps: 0,
    remainderPercent: 84.5,
    activeLap: 1
  });
});

test('超过上财年后沿同一路径进入第二圈', () => {
  assert.deepEqual(calculateFiscalProgress(111.4, 100), {
    percent: 111.4,
    completedLaps: 1,
    remainderPercent: 11.4,
    activeLap: 2
  });
});

test('超过两倍时保留完整圈数并继续第三圈', () => {
  const progress = calculateFiscalProgress(215, 100);
  assert.equal(progress.completedLaps, 2);
  assert.equal(progress.remainderPercent, 15);
  assert.equal(progress.activeLap, 3);
});

test('上一财年为零时不伪造百分比', () => {
  assert.deepEqual(calculateFiscalProgress(100, 0), {
    percent: null,
    completedLaps: 0,
    remainderPercent: 0,
    activeLap: 0
  });
});

const geometryAt = (value) => buildFiscalSpiralGeometry(calculateFiscalProgress(value, 100));

test('高倍数使用原版圈距，仅绘制当前一圈', () => {
  for (const [value, remainder] of [[1870.4, 70.4], [1342.9, 42.9], [1443.5, 43.5], [1716.9, 16.9]]) {
    assert.deepEqual(geometryAt(value), geometryAt(remainder));
    assert.ok(geometryAt(value).progressPath.length > 0);
  }
});

test('整数倍显示刚完成的整圈，零进度和无基数只显示底轨', () => {
  assert.deepEqual(geometryAt(1800), geometryAt(100));
  assert.ok(geometryAt(100).endpoint);
  assert.equal(geometryAt(0).progressPath, '');
  assert.equal(geometryAt(0).endpoint, null);
  assert.deepEqual(buildFiscalSpiralGeometry(calculateFiscalProgress(100, 0)), geometryAt(0));
});
