import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('超过100%后生成连续向外扩展的多圈螺旋路径', () => {
  const progress = calculateFiscalProgress(215, 100);
  const geometry = buildFiscalSpiralGeometry(progress);
  assert.equal(geometry.capacityTurns, 3);
  assert.equal(geometry.lapSegments.length, 3);
  assert.match(geometry.lapSegments[0].path, /^M /);
  assert.ok(geometry.lapSegments.reduce((count, segment) => count + segment.path.split(' C ').length, 0) > 30);
  assert.deepEqual(geometry.lapSegments.map((segment) => [segment.startTurn, segment.endTurn]), [[0, 1], [1, 2], [2, 2.15]]);
  assert.equal(geometry.boundaryPoints.length, 2);
  assert.ok(geometry.endpoint);
});

test('不足100%时也保留双圈引导轨迹以明确后续延伸方向', () => {
  const geometry = buildFiscalSpiralGeometry(calculateFiscalProgress(72, 100));
  assert.equal(geometry.capacityTurns, 2);
  assert.ok(geometry.trackPath.split(' C ').length > geometry.lapSegments[0].path.split(' C ').length);
});

test('螺旋只使用无填充描边，不生成扇形三角', () => {
  const source = readFileSync(new URL('../src/components/FiscalProgressRing.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('<polygon'), false);
  assert.ok((source.match(/fill="none"/g) || []).length >= 3);
  assert.match(source, /linearGradient/);
  assert.match(source, /geometry\.lapSegments/);
  assert.match(source, /geometry\.boundaryPoints/);
  assert.match(source, /geometry\.endpoint/);
  assert.match(source, /已完成.*圈.*第/s);
});
