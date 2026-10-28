import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePrepaymentMilestone, deriveContractPaymentProgress } from '../src/services/paymentProgress.ts';

test('预付款可分多次累计，首次达到约定比例的分配生效日才算达标', () => {
  const payments = [
    { id: 'p1', contract_id: 'c1', amount: 100, payment_date: '2026-01-01', allocation_effective_date: '2026-01-01' },
    { id: 'p2', contract_id: 'c1', amount: 100, payment_date: '2026-01-05', allocation_effective_date: '2026-01-05' },
    { id: 'p3', contract_id: 'c1', amount: 100, payment_date: '2025-12-01', allocation_effective_date: '2026-01-10' },
  ];
  const result = calculatePrepaymentMilestone({ id: 'c1', contract_date: '2025-12-20', prepayment_ratio: 0.3 }, 1000, payments);
  assert.deepEqual(result, { requiredAmount: 300, receivedAmount: 300, reachedDate: '2026-01-10' });
});

test('0% 预付款从合同日期视为条件已满足', () => {
  const result = calculatePrepaymentMilestone({ id: 'c1', contract_date: '2026-02-03', prepayment_ratio: 0 }, 1000, []);
  assert.equal(result.reachedDate, '2026-02-03');
  assert.equal(result.requiredAmount, 0);
});

test('合同金额尚未形成时不提前判定预付款达标或已收齐', () => {
  const payment = { id: 'pending', contract_id: 'c1', amount: 300, payment_date: '2026-02-05' };
  const milestone = calculatePrepaymentMilestone(
    { id: 'c1', contract_date: '2026-02-03', prepayment_ratio: 0.3 },
    0,
    [payment]
  );
  assert.deepEqual(milestone, { requiredAmount: 0, receivedAmount: 300, reachedDate: '' });
  assert.equal(deriveContractPaymentProgress(payment, 0, [payment]), '合同金额待形成');
  assert.equal(calculatePrepaymentMilestone({ id: 'c1', contract_date: '2026-02-03', prepayment_ratio: 0 }, 0, []).reachedDate, '');
});

test('回款状态由累计金额自动区分一次付清与分次付清', () => {
  const oneShot = { id: 'a', contract_id: 'c1', amount: 1000, payment_date: '2026-01-01' };
  assert.equal(deriveContractPaymentProgress(oneShot, 1000, [oneShot]), '一次付清');
  const installments = [
    { id: 'b1', contract_id: 'c2', amount: 300, payment_date: '2026-01-01' },
    { id: 'b2', contract_id: 'c2', amount: 700, payment_date: '2026-01-10' },
  ];
  assert.equal(deriveContractPaymentProgress(installments[0], 1000, installments), '部分回款');
  assert.equal(deriveContractPaymentProgress(installments[1], 1000, installments), '分次付清');
});
