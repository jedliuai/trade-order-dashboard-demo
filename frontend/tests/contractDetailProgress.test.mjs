import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contractsSource = readFileSync(
  new URL('../src/pages/Contracts.tsx', import.meta.url),
  'utf8'
);
const progressSection = contractsSource.slice(
  contractsSource.indexOf('子联系单进度列表'),
  contractsSource.indexOf('Bottom Row flow statistics')
);

test('合同详情恢复联系单进度条并保留五个关键节点', () => {
  assert.match(progressSection, /steps\.map/);
  assert.match(progressSection, /QA审批/);
  assert.match(progressSection, /排产/);
  assert.match(progressSection, /入库/);
  assert.match(progressSection, /放行/);
  assert.match(progressSection, /已发货/);
});

test('只有最新已完成节点在进度条上突出显示日期', () => {
  assert.match(progressSection, /activeStepIdx/);
  assert.match(progressSection, /isCurrent && step\.date/);
  assert.match(progressSection, /\{step\.date\}/);
});

test('合同详情缩略卡片显示到期的 DEMO_PACKAGING 盒子版式提醒', () => {
  assert.match(progressSection, /请确认盒子版式/);
  assert.match(progressSection, /boxArtworkStatus\.reminderDate/);
});
