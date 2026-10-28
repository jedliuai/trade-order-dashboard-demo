import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contactSheetsSource = readFileSync(
  new URL('../src/pages/ContactSheets.tsx', import.meta.url),
  'utf8'
);
const shipmentsSource = readFileSync(
  new URL('../src/pages/Shipments.tsx', import.meta.url),
  'utf8'
);
const batchesSource = readFileSync(
  new URL('../src/pages/Batches.tsx', import.meta.url),
  'utf8'
);
const dataStoreSource = readFileSync(
  new URL('../src/services/dataStore.ts', import.meta.url),
  'utf8'
);
function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('生产日期和失效日期只由联系单保存并供关联批次读取', () => {
  const saveBatchesBlock = sourceBlock(contactSheetsSource, 'const handleSaveBatches', 'const handleOpenMaterialsInfo');
  const dataStoreBatchWriteBlock = sourceBlock(dataStoreSource, 'saveBatches:', 'updateBatch:');

  assert.doesNotMatch(saveBatchesBlock, /production_date|expiry_date/);
  assert.doesNotMatch(dataStoreBatchWriteBlock, /production_date|expiry_date/);
  assert.match(batchesSource, /productionDate: sheet\?\.production_date/);
  assert.match(batchesSource, /expiryDate: sheet\?\.expiry_date/);
});

test('发货明细导出不读取批次中的历史效期副本', () => {
  assert.match(shipmentsSource, /sheet\?\.production_date \|\| ''/);
  assert.match(shipmentsSource, /sheet\?\.expiry_date \|\| ''/);
  assert.doesNotMatch(shipmentsSource, /batch\?\.production_date|batch\?\.expiry_date/);
});
