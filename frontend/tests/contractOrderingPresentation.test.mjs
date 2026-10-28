import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contractsPageSource = readFileSync(
  new URL('../src/pages/Contracts.tsx', import.meta.url),
  'utf8'
);

test('contract management uses customer-number grouping and names the ungrouped view by entry time', () => {
  assert.match(contractsPageSource, /sortContractsByCustomerAndContractNumber/);
  assert.match(contractsPageSource, /按录入时间查看/);
  assert.doesNotMatch(contractsPageSource, /返回日期排序/);
});
