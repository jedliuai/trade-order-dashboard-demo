import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('产品与包装主数据均已纳入驾驶舱导航', async () => {
  const [app, sidebar] = await Promise.all([
    read('../src/App.tsx'),
    read('../src/components/Sidebar.tsx')
  ]);
  assert.match(app, /product_master_data/);
  assert.match(app, /packaging_master_data/);
  assert.match(sidebar, /产品主数据/);
  assert.match(sidebar, /包装主数据/);
});

test('客户档案位于基础主数据首位并承载账号级展示顺序', async () => {
  const [sidebar, customers, settings, contracts] = await Promise.all([
    read('../src/components/Sidebar.tsx'),
    read('../src/pages/Customers.tsx'),
    read('../src/pages/Settings.tsx'),
    read('../src/pages/Contracts.tsx')
  ]);
  const customerPosition = sidebar.indexOf("{ id: 'customers', name: '客户档案'");
  const productPosition = sidebar.indexOf("{ id: 'product_master_data', name: '产品主数据'");
  const packagingPosition = sidebar.indexOf("{ id: 'packaging_master_data', name: '包装主数据'");
  assert.ok(customerPosition > sidebar.indexOf("label: '基础主数据'"));
  assert.ok(customerPosition < productPosition && productPosition < packagingPosition);
  assert.match(customers, /客户展示顺序/);
  assert.match(customers, /<CustomerOrderManager customers=\{customers\}/);
  assert.doesNotMatch(settings, /CustomerOrderManager/);
  assert.match(contracts, /useState\(true\)/);
});

test('产品维护将中文界面值转换为数据库枚举', async () => {
  const [service, page] = await Promise.all([
    read('../src/services/masterDataService.ts'),
    read('../src/pages/ProductMasterData.tsx')
  ]);
  assert.match(service, /finished_product/);
  assert.match(service, /raw_material/);
  assert.match(service, /mdc_product_variants/);
  assert.match(service, /alias_kind: 'trade'/);
  assert.match(service, /language: 'zh'/);
  assert.match(service, /status: 'active'/);
  assert.match(page, /规格（独立记录）/);
  assert.match(page, /调整展示顺序/);
});

test('新联系单允许暂空包装，选择后仍固定引用已确认的具体版本', async () => {
  const [page, store] = await Promise.all([
    read('../src/pages/ContactSheets.tsx'),
    read('../src/services/dataStore.ts')
  ]);
  assert.match(page, /review_status === 'verified'/);
  assert.match(page, /packaging_profile_version_id: packagingVersionId \|\| null/);
  assert.match(page, /包装模板可以暂空/);
  assert.doesNotMatch(page, /新联系单必须选择一套已确认的包装模板/);
  assert.doesNotMatch(page, /id="contact-pcs-per-carton"/);
  assert.match(page, /生产车间/);
  assert.match(store, /packaging_profile_version_id\?: string \| null/);
});

test('包装版本管理直接打开时加载全部版本记录', async () => {
  const page = await read('../src/pages/PackagingMasterData.tsx');
  assert.match(page, /const openVersionsTab = async/);
  assert.match(page, /setVersions\(await loadPackagingVersions\(\)\)/);
  assert.match(page, /全部版本记录/);
});

test('包装参数可以复制为数据库自动编号的独立新模板', async () => {
  const page = await read('../src/pages/PackagingMasterData.tsx');
  assert.match(page, /const openCopy = \(profile: PackagingProfile\)/);
  assert.match(page, /setEditing\(null\)/);
  assert.match(page, /draftFromProfile\(profile, 'copy'\)/);
  assert.match(page, /onClick=\{\(\) => openCopy\(profile\)\}>复制/);
  assert.match(page, /if \(editing\) await createPackagingVersion/);
  assert.match(page, /else await createPackagingProfile\(draft\)/);
  assert.match(page, /系统已自动分配新的包装编号/);
  assert.match(page, /material_no: mode === 'version' \? profile\.material_no \|\| '' : ''/);
  assert.match(page, /carton_gross_weight_kg: mode === 'version'/);
});

test('包装外箱尺寸录入错误会在弹窗内定位且保留草稿', async () => {
  const [page, validation] = await Promise.all([
    read('../src/pages/PackagingMasterData.tsx'),
    read('../src/services/packagingValidation.ts')
  ]);
  assert.match(page, /validatePackagingOuterDimensions\(draft\)/);
  assert.match(page, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(page, /focusDimensionField\(firstInvalidDimension\)/);
  assert.match(page, /其他已填内容已经保留/);
  assert.match(page, /error=\{dimensionErrors\.carton_outer_height_mm\}/);
  assert.match(validation, /outer_height_mm_gte_inner_check/);
});

test('产品展示顺序通过单一数据库函数保存且不修改业务关联', async () => {
  const [service, manager] = await Promise.all([
    read('../src/services/masterDataService.ts'),
    read('../src/components/ProductOrderManager.tsx')
  ]);
  assert.match(service, /rpc\/set_mdc_product_display_order/);
  assert.match(manager, /直接置顶/);
  assert.match(manager, /直接移到底部/);
  assert.match(manager, /不会改变产品主键、规格或历史业务关联/);
});

// Product variant revisions and historical references are verified by local_api/tests.
