import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPaymentReceiptLedger, filterPaymentReceiptLedger } from '../src/services/paymentReceiptLedger.ts';

const customers = [{ id: 'u1', name: '测试客户' }];
const contracts = [
  { id: 'c1', customer_id: 'u1' },
  { id: 'c2', customer_id: 'u1' },
];
const base = { customer_name: '测试客户', customer_id: 'u1', currency: 'USD', payment_type: '其他', exchange_rate: 7, amount_rmb: 700, notes: '', created_at: '2026-08-01T00:00:00Z', export_type: '自营' };

test('多合同到账合并为一条可展开主记录', () => {
  const rows = buildPaymentReceiptLedger({
    customers,
    contracts,
    contractTotals: new Map([['c1', 1000], ['c2', 1000]]),
    receipts: [{ id: 'r1', customer_id: 'u1', receipt_no: 'R001', payment_date: '2026-08-01', total_amount: 200, currency: 'USD', payment_type: '其他', exchange_rate: 7, amount_rmb: 1400, notes: '', created_at: '2026-08-01T00:00:00Z' }],
    payments: [
      { ...base, id: 'p1', receipt_id: 'r1', contract_id: 'c1', contract_no: 'C-1', payment_date: '2026-08-01', amount: 100 },
      { ...base, id: 'p2', receipt_id: 'r1', contract_id: 'c2', contract_no: 'C-2', payment_date: '2026-08-01', amount: 100 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].is_expandable, true);
  assert.deepEqual(rows[0].contract_nos, ['C-1', 'C-2']);
  assert.equal(rows[0].total_amount, 200);
});

test('单合同且无预存款保持普通单行，一个合同加预存款则可展开', () => {
  const common = {
    customers,
    contracts,
    contractTotals: new Map([['c1', 1000]]),
    payments: [{ ...base, id: 'p1', receipt_id: 'r1', contract_id: 'c1', contract_no: 'C-1', payment_date: '2026-08-01', amount: 100 }],
  };
  const single = buildPaymentReceiptLedger({ ...common, receipts: [{ id: 'r1', customer_id: 'u1', receipt_no: '', payment_date: '2026-08-01', total_amount: 100, currency: 'USD', payment_type: '其他', notes: '', created_at: '2026-08-01T00:00:00Z' }] });
  assert.equal(single[0].is_expandable, false);
  const withDeposit = buildPaymentReceiptLedger({ ...common, receipts: [{ id: 'r1', customer_id: 'u1', receipt_no: '', payment_date: '2026-08-01', total_amount: 150, currency: 'USD', payment_type: '其他', notes: '', created_at: '2026-08-01T00:00:00Z' }] });
  assert.equal(withDeposit[0].is_expandable, true);
  assert.equal(withDeposit[0].deposit_amount, 50);
});

test('尚无联系单金额的合同回款保持待形成状态', () => {
  const rows = buildPaymentReceiptLedger({
    customers,
    contracts,
    contractTotals: new Map([['c1', 0]]),
    receipts: [{ id: 'r1', customer_id: 'u1', receipt_no: '', payment_date: '2026-08-01', total_amount: 100, currency: 'USD', payment_type: '其他', notes: '', created_at: '2026-08-01T00:00:00Z' }],
    payments: [{ ...base, id: 'p1', receipt_id: 'r1', contract_id: 'c1', contract_no: 'C-1', payment_date: '2026-08-01', amount: 100 }],
  });
  assert.equal(rows[0].allocations[0].contract_total, 0);
  assert.equal(rows[0].allocations[0].progress_status, '合同金额待形成');
});

test('按合同筛选显示整笔主单，但匹配金额只计算命中分摊', () => {
  const rows = buildPaymentReceiptLedger({
    customers,
    contracts,
    contractTotals: new Map([['c1', 1000], ['c2', 1000]]),
    receipts: [{ id: 'r1', customer_id: 'u1', receipt_no: '', payment_date: '2026-08-01', total_amount: 300, currency: 'USD', payment_type: '其他', exchange_rate: 7, amount_rmb: 2100, notes: '', created_at: '2026-08-01T00:00:00Z' }],
    payments: [
      { ...base, id: 'p1', receipt_id: 'r1', contract_id: 'c1', contract_no: 'C-1', payment_date: '2026-08-01', amount: 100 },
      { ...base, id: 'p2', receipt_id: 'r1', contract_id: 'c2', contract_no: 'C-2', payment_date: '2026-08-01', amount: 200, amount_rmb: 1400 },
    ],
  });
  const filtered = filterPaymentReceiptLedger(rows, { contractId: 'c2' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].total_amount, 300);
  assert.equal(filtered[0].matched_amount, 200);
  assert.deepEqual(filtered[0].matched_allocation_ids, ['p2']);
});
