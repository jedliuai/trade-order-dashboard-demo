import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateConcentration,
  collapseTopGroupsWithOther
} from '../src/services/analyticsInsights.ts';

test('集中度按正向贡献计算 Top 1/3/5', () => {
  const result = calculateConcentration([
    { name: 'A', contract_amount: 50 },
    { name: 'B', contract_amount: 30 },
    { name: 'C', contract_amount: 20 },
    { name: '亏损项', contract_amount: -10 }
  ], 'contract_amount');
  assert.equal(result.top1, 50);
  assert.equal(result.top3, 100);
  assert.equal(result.top5, 100);
  assert.equal(result.positiveGroupCount, 3);
});

test('饼图只保留 Top 5 并把其余指标合并为其他', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    name: `客户${index + 1}`,
    contract_amount: 70 - index * 10,
    profit: 7 - index
  }));
  const result = collapseTopGroupsWithOther(rows, 'contract_amount', ['contract_amount', 'profit']);
  assert.equal(result.length, 6);
  assert.equal(result[5].name, '其他');
  assert.equal(result[5].contract_amount, 30);
  assert.equal(result[5].profit, 3);
});
