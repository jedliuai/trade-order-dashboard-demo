import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterComboboxOptions } from '../src/services/comboboxSearch.ts';

const options = [
  { value: '1', label: 'DEMO-CL-OP15097 (演示星辰商贸有限公司)', searchText: 'DEMO-CL-OP15097' },
  { value: '2', label: 'DEMO-PY-EQ263252 (演示星辰商贸有限公司)', searchText: 'DEMO-PY-EQ263252' },
  { value: '3', label: 'DEMOGE01 (DEMO ATLAS LTD.)' }
];

test('可搜索选择框采用不区分大小写的包含匹配', () => {
  assert.deepEqual(
    filterComboboxOptions(options, 'op150').map(option => option.value),
    ['1']
  );
  assert.deepEqual(
    filterComboboxOptions(options, 'demo-py').map(option => option.value),
    ['2']
  );
});
test('显式 searchText 可限制为只按合同号搜索', () => {
  assert.deepEqual(
    filterComboboxOptions(options, '演示星辰').map(option => option.value),
    []
  );
  assert.deepEqual(
    filterComboboxOptions(options, 'demo atlas').map(option => option.value),
    ['3']
  );
});

test('可搜索下拉层通过 Portal 避免被玻璃卡片或后续内容遮挡', () => {
  const source = readFileSync(new URL('../src/components/SearchableCombobox.tsx', import.meta.url), 'utf8');
  assert.match(source, /createPortal\(/);
  assert.match(source, /className="fixed z-\[60\]/);
  assert.match(source, /addEventListener\('scroll', updatePosition, true\)/);
});
