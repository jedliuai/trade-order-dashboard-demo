import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');

test('首页整页采用经营驾驶舱信息架构并移除旧图表杂项', () => {
  for (const heading of ['经营业绩', '当前经营敞口', '今日优先事项', '经营节奏趋势']) {
    assert.match(dashboard, new RegExp(heading));
  }
  assert.doesNotMatch(dashboard, /图表数据筛选器/);
  assert.doesNotMatch(dashboard, /出口国家合同金额占比/);
  assert.doesNotMatch(dashboard, /今天建议优先处理/);
});

test('首页使用已确认的经营敞口文案并展示具体待办字段', () => {
  assert.match(dashboard, /客户欠我方金额/);
  assert.match(dashboard, /我方欠客户金额/);
  assert.doesNotMatch(dashboard, /我方待交货/);
  assert.match(dashboard, /record\.customer/);
  assert.match(dashboard, /record\.contract/);
  assert.match(dashboard, /record\.product/);
});

test('首页财年进度明确使用连续螺旋表达多圈进度', () => {
  assert.match(dashboard, /每 100% 为一圈/);
  assert.match(dashboard, /沿同一条螺旋连续向外延伸/);
  assert.match(dashboard, /<FiscalProgressRing/);
  assert.match(dashboard, /const FISCAL_RING_COLOR = '#ad8557'/);
  assert.match(dashboard, /const fiscalRingCapacity = Math\.max/);
  assert.match(dashboard, /<FiscalProgressRing current=\{card\.current\} previous=\{card\.previous\} color=\{FISCAL_RING_COLOR\} sharedCapacityTurns=\{fiscalRingCapacity\}/);
  assert.doesNotMatch(dashboard, /<FiscalProgressRing[^>]+color=\{card\.color\}/);
});

test('经营节奏趋势使用整数参照线且图例与柱子共用同一顺序', () => {
  assert.match(dashboard, /const TREND_SERIES = \[/);
  assert.match(dashboard, /ticks=\{trendAxis\.ticks\}/);
  assert.match(dashboard, /domain=\{\[0, trendAxis\.domainMax\]\}/);
  assert.match(dashboard, /stroke="#e4ddd4" strokeDasharray="4 4"/);
  assert.match(dashboard, /TREND_SERIES\.map\(\(series\) => \(/);
  assert.match(dashboard, /aria-label="图表图例"/);
});

test('经营节奏趋势悬浮信息与图例共用新增订单、到账回款、实际发货顺序', () => {
  assert.match(dashboard, /function TrendTooltip/);
  assert.match(dashboard, /content=\{<TrendTooltip \/>\}/);
  assert.match(dashboard, /TrendTooltip[\s\S]*TREND_SERIES\.map\(\(series\) => \(/);
  assert.doesNotMatch(dashboard, /formatter=\{\(value, name\)/);
});
