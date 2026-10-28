import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentsDirectory = new URL('../src/components/', import.meta.url);
const sourceDirectory = new URL('../src/', import.meta.url);

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test('公共组件只使用语义颜色，不继续依赖反转 Slate 色阶', () => {
  const offenders = readdirSync(componentsDirectory)
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => /(?:bg|text|border|from|via|to|ring|shadow)-slate-/.test(
      readFileSync(new URL(name, componentsDirectory), 'utf8')
    ));

  assert.deepEqual(offenders, []);
});

test('品牌颜色工具类必须引用已定义的 Design Token', () => {
  const themeSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const definedTokens = new Set(
    [...themeSource.matchAll(/--color-brand-([a-z]+)\s*:/g)].map((match) => match[1])
  );
  const offenders = [];

  for (const file of collectSourceFiles(sourceDirectory)) {
    const source = readFileSync(file, 'utf8');
    const referencedTokens = [...source.matchAll(/(?:bg|text|border|from|via|to|ring|divide|outline)-brand-([a-z]+)/g)]
      .map((match) => match[1]);
    for (const token of referencedTokens) {
      if (!definedTokens.has(token)) offenders.push(`${file.pathname}:${token}`);
    }
  }

  assert.deepEqual([...new Set(offenders)], []);
});
