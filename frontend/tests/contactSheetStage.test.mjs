import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveContactSheetStage } from '../src/services/contactSheetStage.ts';

test('联系单当前节点按最终业务结果优先展示', () => {
  assert.equal(resolveContactSheetStage({ quantity: 100, shipped_quantity: 100 }).label, '已全部发货');
  assert.equal(resolveContactSheetStage({ quantity: 100, shipped_quantity: 20 }).label, '部分发货');
  assert.equal(resolveContactSheetStage({ quantity: 100, actual_release_date: '2026-07-16' }).label, '已放行，可发货');
  assert.equal(resolveContactSheetStage({ quantity: 100, actual_warehousing_date: '2026-07-16' }).label, '已入库，待放行');
});

test('联系单未完成时展示最近一个待办节点', () => {
  assert.equal(resolveContactSheetStage({ quantity: 100, aps_scheduled_date: '2026-07-20' }).label, '已排产，待入库');
  assert.equal(resolveContactSheetStage({ quantity: 100, qa_approval_date: '2026-07-16' }).label, '待 排产');
  assert.equal(resolveContactSheetStage({ quantity: 100, contact_sheet_no: 'DEMO-CS-001' }).label, '待 QA 审核');
  assert.equal(resolveContactSheetStage({ quantity: 100 }).label, '待填写联系单号');
});

test('原料药与历史数据不会进入 QA/排产 节点', () => {
  assert.equal(resolveContactSheetStage({ quantity: 100, business_type: '原料药' }).label, '可安排发货');
  assert.equal(resolveContactSheetStage({ quantity: 100, is_historical: true }).label, '可安排发货');
});
