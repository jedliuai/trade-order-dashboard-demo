import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('App Shell 在 1024px 处切换 Overlay Drawer 与桌面 Sidebar', () => {
  const app = source('../src/App.tsx');
  const sidebar = source('../src/components/Sidebar.tsx');
  const header = source('../src/components/Header.tsx');

  assert.match(app, /lg:pl-20/);
  assert.match(app, /lg:pl-64/);
  assert.match(sidebar, /matchMedia\('\(min-width: 1024px\)'\)/);
  assert.match(sidebar, /-translate-x-full/);
  assert.match(sidebar, /lg:translate-x-0/);
  assert.match(sidebar, /inert=/);
  assert.match(header, /aria-label="打开主导航"/);
  assert.match(header, /lg:hidden/);
});

test('FormField 自动关联原生控件、必填状态与辅助消息', () => {
  const formField = source('../src/components/FormField.tsx');

  assert.match(formField, /useId/);
  assert.match(formField, /htmlFor=\{controlId\}/);
  assert.match(formField, /required:/);
  assert.match(formField, /'aria-invalid':/);
  assert.match(formField, /'aria-describedby':/);
  assert.match(formField, /role="alert"/);
});

test('高频 Tabs 使用统一键盘导航与 tab/tabpanel 关联', () => {
  const pages = [
    '../src/pages/Customers.tsx',
    '../src/pages/Settings.tsx',
    '../src/pages/Payments.tsx',
    '../src/pages/PackagingMasterData.tsx'
  ];

  for (const path of pages) {
    const page = source(path);
    assert.match(page, /handleTabListKeyDown/, path);
    assert.match(page, /role="tablist"/, path);
    assert.match(page, /role="tab"/, path);
    assert.match(page, /aria-controls=/, path);
    assert.match(page, /role="tabpanel"/, path);
  }
});

test('本地页头不提供远程同步入口，主数据长表单可以从顶部关闭', () => {
  const header = source('../src/components/Header.tsx');
  assert.doesNotMatch(header, /workerClient|apsSync|supabaseClient/);
  assert.match(header, /切换演示身份/);
  assert.match(source('../src/pages/ProductMasterData.tsx'), /label="关闭产品主数据表单"/);
  assert.match(source('../src/pages/PackagingMasterData.tsx'), /label="关闭包装参数表单"/);
});
