import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMissingMaterialNumberRows,
  findMissingMaterialNumberSheets,
  isMaterialNumberRequiredAtEntry,
  summarizeMissingMaterialNumbers
} from '../src/services/materialNumberRules.ts';

const sheets = [
  { id: 'sheet-1', material_no: '', contact_sheet_no: 'DEMO-CS-26001', product_name: '产品甲' },
  { id: 'sheet-2', material_no: '  ', contact_sheet_no: '', product_name: '产品乙' },
  { id: 'sheet-3', material_no: 'DEMO-M-10003', contact_sheet_no: 'DEMO-CS-26003', product_name: '产品丙' }
];

test('只有原料药在录入联系单时仍要求物料号', () => {
  assert.equal(isMaterialNumberRequiredAtEntry('制剂'), false);
  assert.equal(isMaterialNumberRequiredAtEntry('原料药'), true);
});

test('正式发货和导出可以按联系单范围找出所有待补物料号', () => {
  assert.deepEqual(findMissingMaterialNumberRows(sheets).map((row) => row.id), ['sheet-1', 'sheet-2']);
  assert.deepEqual(
    findMissingMaterialNumberSheets(sheets, ['sheet-2', 'sheet-3']).map((row) => row.id),
    ['sheet-2']
  );
  assert.equal(summarizeMissingMaterialNumbers(sheets.slice(0, 2)), 'DEMO-CS-26001、产品乙');
});
