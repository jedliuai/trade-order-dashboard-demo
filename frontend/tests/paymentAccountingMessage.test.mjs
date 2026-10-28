import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPaymentAccountingMessage } from '../src/services/paymentAccountingMessage.ts';

test('整笔收款按合同拆分，并计算截至入账日的累计回款率', () => {
  const payments = [
    { id: 'old', contract_id: 'c1', contract_no: '26RYNL06', customer_name: 'NL PHARMA S.A.', payment_date: '2026-07-01', amount: 5250, currency: 'USD', payment_type: '预付款' },
    { id: 'p1', receipt_id: 'r1', contract_id: 'c1', contract_no: '26RYNL06', customer_name: 'NL PHARMA S.A.', payment_date: '2026-08-18', amount: 2250, currency: 'USD', payment_type: '其他' },
    { id: 'p2', receipt_id: 'r1', contract_id: 'c2', contract_no: '26RYNL08', customer_name: 'NL PHARMA S.A.', payment_date: '2026-08-18', amount: 3000, currency: 'USD', payment_type: '其他' },
  ];
  const message = buildPaymentAccountingMessage({
    receipt: { id: 'r1', customer_name: 'NL PHARMA S.A.', payment_date: '2026-08-18', total_amount: 5250, currency: 'USD', payment_type: '其他' },
    allocations: payments.slice(1),
    allPayments: payments,
    contractTotals: [
      { contract_id: 'c1', total_amount: 25000 },
      { contract_id: 'c2', total_amount: 3000 },
    ],
  });

  assert.equal(message, [
    '张姐，收到，多谢。明细如下：',
    'NL PHARMA S.A.，合同号：26RYNL06，本次入账金额：2,250美金，合同总金额：25,000美元，入账时间：2026年8月18日，截止此日期此合同回款率：30%',
    'NL PHARMA S.A.，合同号：26RYNL08，本次入账金额：3,000美金，合同总金额：3,000美元，入账时间：2026年8月18日，截止此日期此合同回款率：100%',
  ].join('\n'));
});

test('合同金额尚未由联系单形成时复制文字不把未知金额写成零', () => {
  const payment = { id: 'p3', receipt_id: 'r3', contract_id: 'c3', contract_no: 'RYVI26-03', customer_name: 'VIVAS INTERNACIONAL, C.A.', payment_date: '2026-09-10', amount: 1000, currency: 'USD' };
  const message = buildPaymentAccountingMessage({
    receipt: { id: 'r3', customer_name: payment.customer_name, payment_date: payment.payment_date, total_amount: payment.amount, currency: 'USD' },
    allocations: [payment],
    allPayments: [payment],
    contractTotals: [{ contract_id: 'c3', total_amount: 0 }],
  });
  assert.match(message, /合同总金额：待录入/);
  assert.match(message, /合同回款率：暂无法计算/);
  assert.doesNotMatch(message, /合同总金额：0美元/);
});

test('未分配部分会作为客户预存款写入同一段文字', () => {
  const message = buildPaymentAccountingMessage({
    receipt: { id: 'r2', customer_name: '测试客户', payment_date: '2026-08-19', total_amount: 10000, currency: 'RMB', payment_type: '其他' },
    allocations: [],
    allPayments: [],
    contractTotals: [],
  });
  assert.match(message, /客户预存款/);
  assert.match(message, /10,000人民币/);
  assert.match(message, /暂未关联合同/);
});
