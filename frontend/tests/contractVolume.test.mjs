import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { summarizeContractVolume } from '../src/services/contractVolume.ts';

const contractsPageSource = readFileSync(
  new URL('../src/pages/Contracts.tsx', import.meta.url),
  'utf8'
);

const versions = [{
  id: 'version-1',
  quantity_per_carton: 100,
  quantity_unit: '支/箱',
  carton_volume_m3: 0.05
}];

test('全部联系单资料齐全时按合同总体积和发货比例生成三项概览', () => {
  const summary = summarizeContractVolume([
    {
      id: 'sheet-1',
      quantity: 250,
      shipped_quantity: 100,
      unit: '支',
      pcs_per_carton: 100,
      packaging_profile_version_id: 'version-1'
    },
    {
      id: 'sheet-2',
      quantity: 100,
      shipped_quantity: 100,
      unit: '支',
      pcs_per_carton: 100,
      packaging_profile_version_id: 'version-1'
    }
  ], versions);

  assert.deepEqual(summary, {
    isComplete: true,
    missingSheetCount: 0,
    totalVolumeM3: 0.2,
    shippedVolumeM3: 0.11,
    remainingVolumeM3: 0.09
  });
  assert.equal(summary.shippedVolumeM3 + summary.remainingVolumeM3, summary.totalVolumeM3);
});

test('任一联系单缺少包装体积资料时整份合同只返回待录入状态', () => {
  const summary = summarizeContractVolume([
    {
      id: 'sheet-ready',
      quantity: 100,
      shipped_quantity: 0,
      unit: '支',
      pcs_per_carton: 100,
      packaging_profile_version_id: 'version-1'
    },
    {
      id: 'sheet-missing',
      quantity: 100,
      shipped_quantity: 0,
      unit: '支',
      pcs_per_carton: 100,
      packaging_profile_version_id: null
    }
  ], versions);

  assert.deepEqual(summary, {
    isComplete: false,
    missingSheetCount: 1,
    totalVolumeM3: 0,
    shippedVolumeM3: 0,
    remainingVolumeM3: 0
  });
});

test('包装单位不一致或合同没有联系单时不显示估算体积', () => {
  assert.equal(summarizeContractVolume([{
    id: 'sheet-1',
    quantity: 100,
    shipped_quantity: 0,
    unit: '瓶',
    pcs_per_carton: 100,
    packaging_profile_version_id: 'version-1'
  }], versions).isComplete, false);
  assert.equal(summarizeContractVolume([], versions).isComplete, false);
});

test('超发数量只按百分之百计入，不产生负的剩余体积', () => {
  const summary = summarizeContractVolume([{
    id: 'sheet-1',
    quantity: 100,
    shipped_quantity: 120,
    unit: '支',
    pcs_per_carton: 100,
    packaging_profile_version_id: 'version-1'
  }], versions);

  assert.equal(summary.totalVolumeM3, 0.05);
  assert.equal(summary.shippedVolumeM3, 0.05);
  assert.equal(summary.remainingVolumeM3, 0);
});

test('合同卡片展示剩余尾款且详情保留三项体积和待录入状态', () => {
  assert.match(contractsPageSource, /剩余尾款/);
  assert.match(contractsPageSource, /合同体积概览/);
  assert.match(contractsPageSource, /总体积/);
  assert.match(contractsPageSource, /已发货体积/);
  assert.match(contractsPageSource, /剩余货物体积/);
  assert.match(contractsPageSource, /待录入全部联系单的包装体积资料后显示/);
});
