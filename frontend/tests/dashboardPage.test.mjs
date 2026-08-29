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
});
