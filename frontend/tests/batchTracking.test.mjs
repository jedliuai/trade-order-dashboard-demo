import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBatchTracking, validateBatchProgressDates, validateBatchQuantityTotal } from '../src/services/batchTracking.ts';

const baseBatch = {
  batchNo: '260401',
  productName: '注射用头孢唑林钠',
  productionDate: '04/2026',
  expiryDate: '03/2029'
};

test('批次状态按待入库、待放行和已放行区分', () => {
  assert.equal(resolveBatchTracking({ ...baseBatch, apsScheduledDate: '2026-07-20' }, '2026-07-17').label, '已排产，待入库');
  assert.equal(resolveBatchTracking({ ...baseBatch, warehouseDate: '2026-07-10' }, '2026-07-17').label, '已入库，待放行');
  assert.equal(resolveBatchTracking({ ...baseBatch, warehouseDate: '2026-07-10', releaseDate: '2026-07-17' }, '2026-07-17').label, '已放行');
});

test('过期排产和预计放行会成为高优先级异常', () => {
  const warehouseRisk = resolveBatchTracking({ ...baseBatch, apsScheduledDate: '2026-07-10' }, '2026-07-17');
  assert.equal(warehouseRisk.severity, 3);
  assert.equal(warehouseRisk.risks.at(-1)?.label, '排产日已过 7 天，仍未入库');

  const releaseRisk = resolveBatchTracking({ ...baseBatch, warehouseDate: '2026-06-20' }, '2026-07-17');
  assert.equal(releaseRisk.severity, 3);
  assert.match(releaseRisk.risks.at(-1)?.label || '', /预计放行已逾期/);
});

test('批次进度日期拒绝缺入库或倒序放行', () => {
  assert.equal(validateBatchProgressDates('', '2026-07-17'), '填写实际放行日期前，请先填写入库日期。');
  assert.equal(validateBatchProgressDates('2026-07-18', '2026-07-17'), '实际放行日期不能早于入库日期。');
  assert.equal(validateBatchProgressDates('2026-07-17', '2026-07-18'), '');
});

test('批次合计少于、等于、大于联系单数量时只有精确相等能够保存', () => {
  assert.match(validateBatchQuantityTotal([40, 50], 100), /必须等于/);
  assert.equal(validateBatchQuantityTotal([40, 60], 100), '');
  assert.match(validateBatchQuantityTotal([40, 70], 100), /必须等于/);
  assert.equal(validateBatchQuantityTotal([], 100), '');
});
