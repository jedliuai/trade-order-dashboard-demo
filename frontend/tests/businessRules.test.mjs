import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateEstimatedReleaseDate,
  calculateExpiryDate,
  isQaComplete,
  parseBatchAllocations,
  parseBatchNumbers
} from '../src/services/businessRules.ts';

test('错月有效期跨年时正确回退一个月', () => {
  assert.equal(calculateExpiryDate('2026-01', 3, true), '12/2028');
  assert.equal(calculateExpiryDate('07/2026', 3, false), '07/2029');
});

test('非法生产月份和有效期年数不会生成伪日期', () => {
  assert.equal(calculateExpiryDate('2026-13', 3, false), '');
  assert.equal(calculateExpiryDate('2026-07', -1, false), '');
});

test('连续批号解析保留前导零且拒绝部分数字文本', () => {
  assert.deepEqual(parseBatchNumbers('001-003'), ['001', '002', '003']);
  assert.deepEqual(parseBatchNumbers('1-003'), ['001', '002', '003']);
  assert.deepEqual(parseBatchNumbers('2601115-2601117'), ['2601115', '2601116', '2601117']);
  assert.deepEqual(parseBatchNumbers('2601115-19'), ['2601115', '2601116', '2601117', '2601118', '2601119']);
  assert.deepEqual(parseBatchNumbers('2601199-03'), ['2601199', '2601200', '2601201', '2601202', '2601203']);
  assert.deepEqual(parseBatchNumbers('2601115-2601117A'), ['2601115-2601117A']);
  assert.deepEqual(parseBatchNumbers('2601115/2601119'), ['2601115', '2601119']);
});

test('批号分组可以一次录入多段相同的每批数量', () => {
  assert.deepEqual(
    parseBatchAllocations('263132191-95：30,960；263132196-97：22,600'),
    [
      { batch_no: '263132191', batch_quantity: 30960 },
      { batch_no: '263132192', batch_quantity: 30960 },
      { batch_no: '263132193', batch_quantity: 30960 },
      { batch_no: '263132194', batch_quantity: 30960 },
      { batch_no: '263132195', batch_quantity: 30960 },
      { batch_no: '263132196', batch_quantity: 22600 },
      { batch_no: '263132197', batch_quantity: 22600 }
    ]
  );
});

test('预计放行和 QA 前置节点推断符合业务规则', () => {
  assert.equal(calculateEstimatedReleaseDate('2026-07-01', '注射用产品'), '2026-07-18');
  assert.equal(calculateEstimatedReleaseDate('2026-07-01', '普通产品'), '2026-07-11');
  assert.equal(isQaComplete({ aps_scheduled_date: '2026-07-02' }), true);
  assert.equal(isQaComplete({}), false);
});
