import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const paymentsPageSource = readFileSync(
  new URL('../src/pages/Payments.tsx', import.meta.url),
  'utf8'
);
const dataStoreSource = readFileSync(
  new URL('../src/services/dataStore.ts', import.meta.url),
  'utf8'
);

test('新收款只分摊到合同，不再提供具体发货选择', () => {
  assert.doesNotMatch(paymentsPageSource, /不指定发货记录|指定发货|分摊发货记录/);
  assert.doesNotMatch(paymentsPageSource, /allocation\.shipment_id/);
  assert.match(dataStoreSource, /shipment_id: null/);
  assert.match(dataStoreSource, /rpc\/create_payment_receipt_with_allocations/);
  assert.match(dataStoreSource, /rpc\/update_payment_receipt_with_allocations/);
});
