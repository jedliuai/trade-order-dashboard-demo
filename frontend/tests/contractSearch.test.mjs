import assert from 'node:assert/strict';
import test from 'node:test';

import { filterContractsByNumber, findExistingContractById } from '../src/services/contractSearch.ts';

const contracts = [
  { id: '1', contract_no: 'DEMO-CL-OP15095', customer_name: '演示星辰商贸' },
  { id: '2', contract_no: 'DEMONL05', customer_name: 'DEMO HORIZON' },
  { id: '3', contract_no: 'PO11041', customer_name: 'DEMO_PACKAGING' }
];

test('合同搜索按合同号做不区分大小写的包含匹配', () => {
  assert.deepEqual(filterContractsByNumber(contracts, 'op15').map(item => item.id), ['1']);
  assert.deepEqual(filterContractsByNumber(contracts, 'demonl').map(item => item.id), ['2']);
  assert.deepEqual(filterContractsByNumber(contracts, 'po110').map(item => item.id), ['3']);
});

test('空搜索返回全部合同，客户名不参与匹配', () => {
  assert.equal(filterContractsByNumber(contracts, '  ').length, 3);
  assert.equal(filterContractsByNumber(contracts, 'horizon').length, 0);
});

test('合同选择只能解析为已有合同 ID', () => {
  assert.equal(findExistingContractById(contracts, '3')?.contract_no, 'PO11041');
  assert.equal(findExistingContractById(contracts, '用户随意输入的合同号'), null);
  assert.equal(findExistingContractById(contracts, ''), null);
});
