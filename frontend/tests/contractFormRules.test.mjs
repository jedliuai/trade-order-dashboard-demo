import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copiedContractNotes,
  currencyForExportType,
  exportTypeForCustomerCurrency,
  hasDuplicateContractNumber,
} from '../src/services/contractFormRules.ts';

test('合同出口类型与结算币种强绑定', () => {
  assert.equal(currencyForExportType('自营'), 'USD');
  assert.equal(currencyForExportType('转口'), 'RMB');
});

test('客户固定币种决定合同出口类型', () => {
  assert.equal(exportTypeForCustomerCurrency('USD'), '自营');
  assert.equal(exportTypeForCustomerCurrency('RMB'), '转口');
});

test('复制合同时备注保持为空', () => {
  assert.equal(copiedContractNotes(), '');
});

test('合同号防重忽略大小写和首尾空格，并允许编辑当前合同', () => {
  const rows = [
    { id: 'contract-1', contract_no: 'DEMO-PO70003' },
    { id: 'contract-2', contract_no: 'DEMONL08' },
  ];
  assert.equal(hasDuplicateContractNumber(rows, ' demo-po70003 '), true);
  assert.equal(hasDuplicateContractNumber(rows, 'DEMO-PO70003', 'contract-1'), false);
  assert.equal(hasDuplicateContractNumber(rows, 'DEMO-PO70004'), false);
});
