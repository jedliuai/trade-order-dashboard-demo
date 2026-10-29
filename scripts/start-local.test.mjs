import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { findEdge } from './start-local.mjs';

test('launcher finds only Microsoft Edge in standard Windows installation locations', () => {
  const env = { ProgramFiles: 'C:/Apps With Spaces', LOCALAPPDATA: 'C:/Users/demo/AppData/Local' };
  const expected = path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  assert.equal(findEdge(env, candidate => candidate === expected), expected);
  assert.equal(findEdge(env, () => false), undefined);
});
