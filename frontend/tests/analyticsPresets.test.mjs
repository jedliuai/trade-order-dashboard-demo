import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILT_IN_ANALYSIS_PRESETS, mergeAnalysisTemplates } from '../src/services/analyticsPresets.ts';

test('数据分析中心固定提供四个常用分析入口', () => {
  assert.equal(BUILT_IN_ANALYSIS_PRESETS.length, 4);
  assert.deepEqual(BUILT_IN_ANALYSIS_PRESETS.map((item) => item.name), [
    '月度收款与利润趋势',
    '客户回款与应收排行',
    '产品销售与利润占比',
    '交付与风险状态分布'
  ]);
  assert.deepEqual(BUILT_IN_ANALYSIS_PRESETS.map((item) => item.entryTitle), [
    '回款与应收',
    '客户与市场',
    '利润与产品',
    '交付与风险'
  ]);
  assert.deepEqual(BUILT_IN_ANALYSIS_PRESETS[0].metrics, ['payment_amount', 'unpaid_amount']);
  assert.deepEqual(BUILT_IN_ANALYSIS_PRESETS[1].metrics, ['contract_amount', 'payment_amount', 'profit']);
  assert.deepEqual(BUILT_IN_ANALYSIS_PRESETS[2].metrics, ['shipment_amount', 'profit', 'gross_margin']);
});

test('用户模板与常用模板按名称去重并保留自定义项', () => {
  const merged = mergeAnalysisTemplates([
    { ...BUILT_IN_ANALYSIS_PRESETS[0], chartType: 'line' },
    { ...BUILT_IN_ANALYSIS_PRESETS[0], name: '我的南美分析' }
  ]);
  assert.equal(merged.length, 5);
  assert.equal(merged.find((item) => item.name === '月度收款与利润趋势')?.chartType, 'line');
  assert.ok(merged.some((item) => item.name === '我的南美分析'));
});
