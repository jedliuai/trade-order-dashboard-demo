import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeBatchWorkspace } from '../src/services/batchWorkspace.ts';

const row = (overrides = {}) => ({
  id: 'batch-1',
  contactSheetId: 'sheet-1',
  phase: 'pending_warehouse',
  severity: 0,
  batchQuantity: 100,
  warehouseDate: '',
  releaseDate: '',
  sheetWarehouseDate: '',
  sheetReleaseDate: '',
  ...overrides
});

test('同一联系单下同步的正常批次合并为一个无需关注的分组', () => {
  const [summary] = summarizeBatchWorkspace([row(), row({ id: 'batch-2', batchQuantity: 200 })]);
  assert.equal(summary.batchCount, 2);
  assert.equal(summary.totalQuantity, 300);
  assert.equal(summary.needsAttention, false);
  assert.equal(summary.hasPhaseDivergence, false);
});

test('同一联系单下批次阶段不一致时进入关注列表', () => {
  const [summary] = summarizeBatchWorkspace([row(), row({ id: 'batch-2', phase: 'pending_release', warehouseDate: '2026-07-17' })]);
  assert.equal(summary.hasPhaseDivergence, true);
  assert.equal(summary.needsAttention, true);
});

test('批次日期与联系单主日期不一致时进入关注列表', () => {
  const [summary] = summarizeBatchWorkspace([row({ warehouseDate: '', sheetWarehouseDate: '2026-07-17' })]);
  assert.equal(summary.hasSheetDateMismatch, true);
  assert.equal(summary.needsAttention, true);
});

test('全部批次放行后分组进入历史', () => {
  const [summary] = summarizeBatchWorkspace([
    row({ phase: 'released', warehouseDate: '2026-07-10', releaseDate: '2026-07-12', sheetWarehouseDate: '2026-07-10', sheetReleaseDate: '2026-07-12' }),
    row({ id: 'batch-2', phase: 'released', warehouseDate: '2026-07-10', releaseDate: '2026-07-12', sheetWarehouseDate: '2026-07-10', sheetReleaseDate: '2026-07-12' })
  ]);
  assert.equal(summary.allReleased, true);
  assert.equal(summary.needsAttention, false);
});
