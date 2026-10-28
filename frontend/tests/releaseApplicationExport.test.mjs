import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('提前放行导出只选择已入库未放行联系单且允许缺少包装模板', async () => {
  const [page, store] = await Promise.all([
    read('../src/pages/Exports.tsx'),
    read('../src/services/dataStore.ts')
  ]);
  assert.match(page, /Boolean\(sheet\.actual_warehousing_date\) && !sheet\.actual_release_date/);
  assert.match(page, /export-release-application/);
  assert.match(page, /车间待手填/);
  assert.doesNotMatch(page, /filter\(sheet => Boolean\(sheet\.packaging_profile_version_id\)/);
  assert.match(store, /'export-release-application': true/);
});

test('包装车间随版本冻结且更换整套包装参数需要确认', async () => {
  const [contactPage, packagingPage, service, migration] = await Promise.all([
    read('../src/pages/ContactSheets.tsx'),
    read('../src/pages/PackagingMasterData.tsx'),
    read('../src/services/masterDataService.ts'),
    read('../../local_api/action_master.py')
  ]);
  assert.match(contactPage, /确认更换整套包装参数/);
  assert.match(contactPage, /生产车间、包装尺寸和装箱参数会作为一个整体切换/);
  assert.match(packagingPage, /disabled=\{Boolean\(editing\)\}/);
  assert.match(packagingPage, /不同车间请复制或新建独立包装模板/);
  assert.match(service, /workshop: string/);
  assert.match(migration, /data\['workshop'\] = profile.get\('workshop'\)/);
});
