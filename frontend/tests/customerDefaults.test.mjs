import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_PAYMENT_TERMS,
  getNewContractDefaults,
  normalizeCustomerCurrency
} from '../src/services/customerDefaults.ts';

test('客户档案为新合同提供付款条款和默认国家，但不覆盖出口类型币种规则', () => {
  assert.deepEqual(getNewContractDefaults({
    default_currency: 'RMB',
    default_payment_terms: '发货后 60 天付全款',
    country: '巴西'
  }), {
    paymentTerms: '发货后 60 天付全款',
    destinationCountry: '巴西'
  });
});

test('客户默认币种字段仍可安全标准化供档案展示', () => {
  assert.equal(normalizeCustomerCurrency(undefined), 'USD');
  assert.equal(normalizeCustomerCurrency('CNY'), 'USD');
  assert.deepEqual(getNewContractDefaults(null), {
    paymentTerms: FALLBACK_PAYMENT_TERMS,
    destinationCountry: ''
  });
});
