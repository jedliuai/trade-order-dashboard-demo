import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contactSheetsSource = readFileSync(
  new URL('../src/pages/ContactSheets.tsx', import.meta.url),
  'utf8'
);
const cardListSource = contactSheetsSource.slice(
  contactSheetsSource.indexOf('Card List of Contact Sheets'),
  contactSheetsSource.indexOf('Edit/Add Contact Sheet Modal')
);
const detailSource = contactSheetsSource.slice(
  contactSheetsSource.indexOf('Contact Sheet Detail View Modal'),
  contactSheetsSource.indexOf('{historySheet &&')
);

test('联系单管理只保留一个统一卡片模式', () => {
  assert.doesNotMatch(contactSheetsSource, /viewMode|switchViewMode|联系单视图/);
  assert.doesNotMatch(cardListSource, />紧凑<|>完整</);
});

test('统一联系单卡片保留两种旧模式的全部业务信息', () => {
  assert.match(cardListSource, /contact_sheet_no/);
  assert.match(cardListSource, /handleOpenMaterialsInfo\(s\.material_no\)/);
  assert.match(cardListSource, /合同 \{s\.contract_no\}/);
  assert.match(cardListSource, /质量标准/);
  assert.doesNotMatch(cardListSource, /特殊重复|duplicate_reason|is_special_duplicate/);
  assert.match(cardListSource, /formattedUnitPrice/);
  assert.match(cardListSource, /formattedOrderAmount/);
  assert.match(cardListSource, /生产日期/);
  assert.match(cardListSource, /失效日期/);
  assert.match(cardListSource, /预计放行/);
  assert.match(cardListSource, /紧急排产/);
  assert.match(cardListSource, /<ProgressBar steps=\{steps\} compact \/>/);
  assert.match(cardListSource, /handleOpenHistory\(s, event\)/);
  assert.match(cardListSource, /handleOpenCopy\(s\)/);
  assert.match(cardListSource, /handleDelete\(s\.id\)/);
  assert.match(cardListSource, /立即确认盒子版式/);
  assert.match(cardListSource, /盒子版式已确认/);
  assert.match(cardListSource, /handleToggleBoxArtworkConfirmation\(s\)/);
});

test('联系单卡片只前置批次管理入口，不展示半截批次信息', () => {
  assert.doesNotMatch(cardListSource, /sheetBatches|分摊批次|拆分批次/);
  assert.match(cardListSource, /管理批次/);
  assert.match(cardListSource, /handleOpenBatchEditor\(s\.id\)/);
  assert.ok(cardListSource.indexOf('管理批次') < cardListSource.indexOf('查看完整详情'));
});

test('完整批次信息和管理入口统一保留在联系单详情', () => {
  assert.match(detailSource, /批次分摊与追踪看板/);
  assert.match(detailSource, /sheetBatches\.map/);
  assert.match(detailSource, /管理批次/);
  assert.match(detailSource, /handleOpenBatchEditor\(s\.id\)/);
});

test('效期编辑分区使用确认后的业务标题', () => {
  assert.match(contactSheetsSource, /title="包材实际印刷上的效期"/);
  assert.match(contactSheetsSource, /label="客户确认包装稿日期"/);
});

test('新联系单单价和数量输入框不再显示前置零', () => {
  assert.match(contactSheetsSource, /value=\{unitPrice \|\| ''\}/);
  assert.match(contactSheetsSource, /value=\{quantity \|\| ''\}/);
});

test('新建、复制和编辑联系单共用规格标准化保存入口', () => {
  assert.match(contactSheetsSource, /specification: normalizeContactSheetSpecification\(specification\)/);
  assert.match(contactSheetsSource, /保存时自动移除多余空格/);
});

test('联系单详情不重复显示进度条', () => {
  assert.doesNotMatch(detailSource, /ProgressBar|当前流转节点/);
});
