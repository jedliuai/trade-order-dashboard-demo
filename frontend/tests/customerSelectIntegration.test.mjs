import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const customerPages = [
  'Analytics.tsx',
  'Contracts.tsx',
  'CustomerProductAnalysis.tsx',
  'Customers.tsx',
  'Payments.tsx',
  'Profit.tsx',
  'Shipments.tsx'
];

test('customer dropdowns share the public CustomerSelect component', () => {
  for (const file of customerPages) {
    const source = readFileSync(new URL(`../src/pages/${file}`, import.meta.url), 'utf8');
    assert.match(source, /<CustomerSelect/, `${file} should use CustomerSelect`);
  }
});

// Persistence and role boundaries are exercised against SQLite in local_api/tests.

test('contact sheet compact mode is removed and dosage units use the fixed order', () => {
  const source = readFileSync(new URL('../src/pages/ContactSheets.tsx', import.meta.url), 'utf8');
  const options = readFileSync(new URL('../src/services/formOptions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /compactCards/);
  assert.match(options, /\['支', '盒', '瓶', 'kg', '十亿'\]/);
  assert.doesNotMatch(options, /'袋'|'片\/箱'|'粒\/箱'/);
  assert.match(source, /useState\('支'\)/);
  assert.match(source, /setUnit\('支'\)/);
});

test('contract compact mode is removed', () => {
  const source = readFileSync(new URL('../src/pages/Contracts.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /compactCards/);
});
