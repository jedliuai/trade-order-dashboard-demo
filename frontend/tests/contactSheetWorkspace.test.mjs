import assert from 'node:assert/strict';
import test from 'node:test';
import { isContactSheetHistory, resolveContactSheetCurrentProgress, sortContactSheetsByCreatedAt } from '../src/services/contactSheetWorkspace.ts';

test('fully shipped contact sheets enter history independently from contract archive', () => {
  assert.equal(isContactSheetHistory({ quantity: 100, shipped_quantity: 100 }), true);
  assert.equal(isContactSheetHistory({ quantity: 100, shipped_quantity: 60 }), false);
  assert.equal(isContactSheetHistory({ quantity: 100, shipped_quantity: 0 }, true), true);
});

test('contact sheets are sorted by newest creation time first', () => {
  const rows = sortContactSheetsByCreatedAt([
    { id: 'old', created_at: '2026-07-01T08:00:00Z' },
    { id: 'new', created_at: '2026-07-20T08:00:00Z' }
  ]);
  assert.deepEqual(rows.map(row => row.id), ['new', 'old']);
});

test('历史导入联系单按业务日期排序，不把近期导入时间当作新业务置顶', () => {
  const rows = sortContactSheetsByCreatedAt([
    { id: 'historical', is_historical: true, created_at: '2026-07-22T08:00:00Z', contract_id: 'c-old' },
    { id: 'current', is_historical: false, created_at: '2026-07-10T08:00:00Z', contract_id: 'c-new' }
  ], row => row.contract_id === 'c-old' ? '2025-11-25' : '2026-07-10');

  assert.deepEqual(rows.map(row => row.id), ['current', 'historical']);
});

test('current progress shows only the latest completed business stage and date', () => {
  const result = resolveContactSheetCurrentProgress({
    quantity: 100,
    shipped_quantity: 0,
    qa_approval_date: '2026-07-02',
    aps_scheduled_date: '2026-07-10',
    actual_warehousing_date: '2026-07-18'
  });
  assert.equal(result.label, '生产已入库');
  assert.equal(result.date, '2026-07-18');
  assert.equal(result.next, '下一步：检验放行');
});
