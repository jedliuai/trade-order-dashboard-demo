import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  resolveContactSheetNavigationTarget,
  sortContactSheetsByNumber
} from '../src/services/contactSheetNavigation.ts';

const contractsSource = readFileSync(new URL('../src/pages/Contracts.tsx', import.meta.url), 'utf8');
const contactSheetsSource = readFileSync(new URL('../src/pages/ContactSheets.tsx', import.meta.url), 'utf8');

const duplicateMaterialSheets = [
  { id: 'sheet-old-contract', contract_id: 'contract-old', material_no: 'FF01288' },
  { id: 'sheet-po11041', contract_id: 'contract-po11041', material_no: 'FF01288' }
];

test('合同详情跳转按联系单 ID 和合同 ID 精确定位，不受相同物料号影响', () => {
  const resolved = resolveContactSheetNavigationTarget(duplicateMaterialSheets, {
    contactSheetId: 'sheet-po11041',
    contractId: 'contract-po11041',
    contractNo: 'PO11041'
  });

  assert.equal(resolved?.id, 'sheet-po11041');
});

test('联系单 ID 与合同 ID 不一致时拒绝定位', () => {
  const resolved = resolveContactSheetNavigationTarget(duplicateMaterialSheets, {
    contactSheetId: 'sheet-old-contract',
    contractId: 'contract-po11041',
    contractNo: 'PO11041'
  });

  assert.equal(resolved, null);
});

test('合同详情子联系单按联系单号自然升序排列且空单号置底', () => {
  const sorted = sortContactSheetsByNumber([
    { id: '3', contact_sheet_no: 'B260382' },
    { id: 'empty', contact_sheet_no: '' },
    { id: '1', contact_sheet_no: 'B260343' },
    { id: '4', contact_sheet_no: 'B2601000' },
    { id: '2', contact_sheet_no: 'B260344' }
  ]);

  assert.deepEqual(sorted.map((sheet) => sheet.id), ['1', '2', '3', '4', 'empty']);
  assert.match(contractsSource, /sortContactSheetsByNumber\([\s\S]*sheetsList\.filter/);
});

test('合同详情跳转只定位并高亮联系单卡片，不自动打开详情', () => {
  const focusEffect = contactSheetsSource.slice(
    contactSheetsSource.indexOf('if (!navigationTarget) return;'),
    contactSheetsSource.indexOf('const selectedContract =')
  );

  assert.match(focusEffect, /setSelectedSheetDetail\(null\)/);
  assert.match(focusEffect, /scrollIntoView/);
  assert.doesNotMatch(focusEffect, /setSelectedSheetDetail\(focusedSheet\)/);
  assert.match(contactSheetsSource, /contact-sheet-card-\$\{s\.id\}/);
});
