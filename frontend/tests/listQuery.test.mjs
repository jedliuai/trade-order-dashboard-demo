import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_LIST_PAGE_SIZE, queryLocalPage } from '../src/services/listQuery.ts';

const rows = Array.from({ length: 123 }, (_, index) => ({ id: index + 1 }));

test('列表默认每页 50 条并返回稳定的分页元数据', () => {
  const result = queryLocalPage(rows, { page: 2 });

  assert.equal(DEFAULT_LIST_PAGE_SIZE, 50);
  assert.equal(result.rows.length, 50);
  assert.equal(result.rows[0].id, 51);
  assert.equal(result.rows.at(-1).id, 100);
  assert.deepEqual({ page: result.page, totalPages: result.totalPages, from: result.from, to: result.to }, {
    page: 2,
    totalPages: 3,
    from: 51,
    to: 100
  });
});

test('筛选后页码超出范围时自动收敛到最后一页', () => {
  const result = queryLocalPage(rows.slice(0, 62), { page: 9, pageSize: 50 });

  assert.equal(result.page, 2);
  assert.equal(result.rows.length, 12);
  assert.equal(result.from, 51);
  assert.equal(result.to, 62);
});

test('空列表返回可安全渲染的第一页元数据', () => {
  assert.deepEqual(queryLocalPage([], { page: 3 }), {
    rows: [],
    page: 1,
    pageSize: 50,
    totalRows: 0,
    totalPages: 1,
    from: 0,
    to: 0
  });
});
