import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishBuild } from './build.mjs';

test('successful build replaces whole output without leaving old chunks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trade-demo-build-test-'));
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'old.js'), 'old');
  const backup = await publishBuild(root, async target => {
    await writeFile(path.join(target, 'index.html'), 'fresh');
  });
  assert.equal(await readFile(path.join(root, 'dist/index.html'), 'utf8'), 'fresh');
  await assert.rejects(readFile(path.join(root, 'dist/old.js')));
  assert.equal(await readFile(path.join(backup, 'dist/old.js'), 'utf8'), 'old');
});

test('a failed build leaves the last working build intact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trade-demo-build-test-'));
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/index.html'), 'working');
  await assert.rejects(publishBuild(root, async () => { throw Error('compiler failed'); }));
  assert.equal(await readFile(path.join(root, 'dist/index.html'), 'utf8'), 'working');
});
