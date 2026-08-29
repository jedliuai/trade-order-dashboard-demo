import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const progressSource = readFileSync(
  new URL('../src/components/ProgressBar.tsx', import.meta.url),
  'utf8'
);

test('联系单进度日期位于节点上方并使用更醒目的字号', () => {
  assert.match(progressSource, /bottom-9 text-\[11px\]/);
  assert.match(progressSource, /bottom-10 text-xs/);
  assert.match(progressSource, /font-semibold text-body shadow-sm/);
  assert.doesNotMatch(progressSource, /text-\[9px\].*step\.date/);
});
