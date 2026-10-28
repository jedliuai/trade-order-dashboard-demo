import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (file) => readFileSync(new URL(`../src/pages/${file}`, import.meta.url), 'utf8');

test('发货使用窄屏摘要，回款表格在 1024px 以下保留核心列并固定操作入口', () => {
  const shipments = source('Shipments.tsx');
  const payments = source('Payments.tsx');

  assert.match(shipments, /aria-label="发货与开票记录窄屏摘要"/);
  assert.match(shipments, /renderShipmentActions\(shipment, true\)/);
  assert.match(shipments, /<div className="hidden lg:block">\s*<DataTable ariaLabel="发货与开票记录"/);

  assert.match(payments, /grid grid-cols-2 border-b/);
  assert.match(payments, /aria-label="回款明细"/);
  assert.doesNotMatch(payments, /payments-tab-all|全部流水视图|客户回款明细视图/);
  assert.match(payments, /aria-label="回款日期快捷范围"/);
  assert.match(payments, /历史收款（\{paymentPeriodCounts\.history\}）/);
  assert.match(payments, /汇率 \$\{row\.exchange_rate\.toFixed\(4\)\}/);
  assert.match(payments, /hidden p-4 lg:table-cell">分摊情况/);
  assert.match(payments, /xl:hidden[\s\S]*其余 \{row\.contract_nos\.length - 2\} 个/);
  assert.match(payments, /sticky right-0 z-10 bg-surface-muted p-4 text-right">操作/);
});

test('发货桌面操作区和收款分摊行保留各自边界，不挤压金额或越出容器', () => {
  const shipments = source('Shipments.tsx');
  const payments = source('Payments.tsx');

  assert.match(shipments, /tableClassName="min-w-\[1200px\]"/);
  assert.match(shipments, /min-w-\[385px\] whitespace-nowrap px-3 py-4 text-right">操作/);
  assert.match(shipments, /flex min-w-max justify-end gap-1\.5 whitespace-nowrap/);

  assert.match(payments, /md:grid-cols-\[minmax\(0,1\.6fr\)_minmax\(110px,0\.8fr\)_40px\]/);
  assert.match(payments, /className="min-w-0"/);
  assert.match(payments, /className="flex w-10 items-center justify-end gap-1"/);
});

test('提醒中心逐条突出合同、客户和产品身份', () => {
  const alerts = source('Alerts.tsx');

  assert.match(alerts, /<dt className="text-\[10px\] text-muted">合同<\/dt>/);
  assert.match(alerts, /<dt className="text-\[10px\] text-muted">客户<\/dt>/);
  assert.match(alerts, /<dt className="text-\[10px\] text-muted">产品<\/dt>/);
  assert.match(alerts, /font-bold text-ink/);
});

test('产品与包装主数据只在窄屏切换为摘要网格', () => {
  const products = source('ProductMasterData.tsx');
  const packaging = source('PackagingMasterData.tsx');

  assert.match(products, /grid grid-cols-2 gap-3[\s\S]*lg:grid-cols-\[minmax\(250px/);
  assert.match(products, /lg:hidden">联系单引用/);
  assert.match(packaging, /grid grid-cols-2 gap-3[\s\S]*lg:grid-cols-\[minmax\(220px/);
  assert.match(packaging, /lg:hidden">外箱外径 \(MM\)/);
  assert.match(packaging, /col-span-2 flex flex-wrap justify-start gap-2[\s\S]*lg:justify-end/);
});
