import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagedPages = ['Contracts', 'ContactSheets', 'Batches', 'Shipments', 'Payments', 'Profit', 'Analytics'];

test('七个历史或下钻明细工作区统一通过公共查询 hook 和分页组件渲染', async () => {
  for (const pageName of pagedPages) {
    const source = await readFile(new URL(`../src/pages/${pageName}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /usePagedRows\(/, `${pageName} 未接入统一分页查询 hook`);
    assert.match(source, /<PaginationControls\b/, `${pageName} 未接入统一分页组件`);
  }
});

test('数据分析页面通过独立 service 读取业务数据，不直接依赖 dataStore', async () => {
  const source = await readFile(new URL('../src/pages/Analytics.tsx', import.meta.url), 'utf8');
  assert.match(source, /loadAnalyticsDataSnapshot\(/);
  assert.doesNotMatch(source, /from ['"]\.\.\/services\/dataStore['"]/);
  assert.doesNotMatch(source, /\bdb\./);
});
