import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('品牌图标只替换合适入口且保留现有产品名称', async () => {
  const [sidebar, app, html] = await Promise.all([
    readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);

  assert.match(sidebar, /trade-tracker-app-icon\.svg/);
  assert.doesNotMatch(sidebar, />\s*DEMO\s*</);
  assert.match(sidebar, /个人订单驾驶舱/);
  assert.match(sidebar, /订单工作台/);
  assert.doesNotMatch(sidebar, /accountName|accountRole/);
  assert.match(app, /trade-tracker-mark\.svg/);
  assert.match(html, /trade-tracker-app-icon\.svg/);
});

test('品牌 SVG 保留用户提供的原始青绿与沙金色系', async () => {
  const assets = await Promise.all([
    readFile(new URL('../public/brand/trade-tracker-mark.svg', import.meta.url), 'utf8'),
    readFile(new URL('../public/brand/trade-tracker-app-icon.svg', import.meta.url), 'utf8')
  ]);

  for (const svg of assets) {
    assert.match(svg, /#21C7C2/i);
    assert.match(svg, /#0FA9A5/i);
    assert.match(svg, /#F5C97A|#FFD98D/i);
  }
});
