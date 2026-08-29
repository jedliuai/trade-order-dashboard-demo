import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCustomerIdentity,
  summarizeCustomerReferences
} from '../src/services/customerMerge.ts';

test('客户名称建议匹配忽略空格和常见中英文标点', () => {
  assert.equal(
    normalizeCustomerIdentity('EVEREST BIOTECH CO., LTD'),
    normalizeCustomerIdentity('EVEREST BIOTECH CO.,LTD')
  );
  assert.equal(
    normalizeCustomerIdentity(' 演示，星辰。商贸 '),
    normalizeCustomerIdentity('演示星辰商贸')
  );
});

test('客户合并预览覆盖全部直接外键引用', () => {
  assert.deepEqual(
    summarizeCustomerReferences(
      'source',
      [{ customer_id: 'source' }, { customer_id: 'target' }],
      [{ customer_id: 'source' }, { customer_id: 'source' }],
      [{ customer_id: 'source' }]
    ),
    { contracts: 1, paymentReceipts: 2, shipmentGroups: 1, total: 4 }
  );
});
