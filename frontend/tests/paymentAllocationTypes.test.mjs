import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveReceiptPaymentType } from '../src/services/paymentAllocationTypes.ts';

test('同一收款的合同明细可分别保存不同收款类型', () => {
  assert.equal(deriveReceiptPaymentType([
    { payment_type: '预付款' },
    { payment_type: '尾款' }
  ]), '其他');
  assert.equal(deriveReceiptPaymentType([
    { payment_type: '分批付款' },
    { payment_type: '分批付款' }
  ]), '分批付款');
  assert.equal(deriveReceiptPaymentType([]), '其他');
});
