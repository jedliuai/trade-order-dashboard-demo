import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentsDirectory = new URL('../src/components/', import.meta.url);

test('公共组件只使用语义颜色，不继续依赖反转 Slate 色阶', () => {
  const offenders = readdirSync(componentsDirectory)
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => /(?:bg|text|border|from|via|to|ring|shadow)-slate-/.test(
      readFileSync(new URL(name, componentsDirectory), 'utf8')
    ));

  assert.deepEqual(offenders, []);
});
