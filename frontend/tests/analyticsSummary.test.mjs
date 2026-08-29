import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeAnalyticsBusiness } from '../src/services/analyticsSummary.ts';

test('经营摘要排除缺汇率金额和未确认利润，并计算已确认毛利率', () => {
  const summary = summarizeAnalyticsBusiness({
    contractAmountsRmb: [100, null, 200],
    paymentAmountsRmb: [80, 20],
    receivableAmountsRmb: [50, null],
    profitRows: [
      { profit: 30, salesAmountRmb: 150, confirmed: true },
      { profit: 99, salesAmountRmb: 200, confirmed: false },
      { profit: null, salesAmountRmb: null, confirmed: true }
    ]
  });

  assert.equal(summary.contractAmount, 300);
  assert.equal(summary.paymentAmount, 100);
  assert.equal(summary.currentReceivable, 50);
  assert.equal(summary.confirmedProfit, 30);
  assert.equal(summary.confirmedGrossMargin, 20);
  assert.equal(summary.confirmedProfitCount, 1);
  assert.equal(summary.missingContractRateCount, 1);
  assert.equal(summary.missingReceivableRateCount, 1);
});
