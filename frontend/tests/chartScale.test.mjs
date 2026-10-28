import assert from 'node:assert/strict';
import test from 'node:test';

import { createNiceChartScale } from '../src/services/chartScale.ts';

test('趋势图为大额数据生成易读的整百整千刻度', () => {
  assert.deepEqual(createNiceChartScale([80, 430, 1500]), {
    domainMax: 1560,
    step: 500,
    ticks: [0, 500, 1000, 1500]
  });
});

test('趋势图随数据量级调整刻度并给最高柱保留空间', () => {
  assert.deepEqual(createNiceChartScale([35, 180, 480]), {
    domainMax: 512,
    step: 100,
    ticks: [0, 100, 200, 300, 400, 500]
  });
});

test('趋势图无数据时仍保留可理解的整数参照线', () => {
  assert.deepEqual(createNiceChartScale([0, Number.NaN]), {
    domainMax: 104,
    step: 20,
    ticks: [0, 20, 40, 60, 80, 100]
  });
});
