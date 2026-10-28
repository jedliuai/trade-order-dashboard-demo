import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePackagingCopyVersion } from '../src/services/contactSheetPackaging.ts';

const profile = (overrides = {}) => ({
  profile_id: 'profile-a',
  version_id: 'version-a-2',
  version_no: 2,
  is_active: true,
  review_status: 'verified',
  packaging_code: 'PKG001',
  packaging_description: '新版包装',
  quantity_per_carton: 100,
  quantity_unit: '支/箱',
  ...overrides
});

const version = (overrides = {}) => ({
  id: 'version-a-1',
  profile_id: 'profile-a',
  version_no: 1,
  is_current: false,
  packaging_description: '旧版包装',
  quantity_per_carton: 80,
  quantity_unit: '支/箱',
  ...overrides
});

test('复制联系单时将同一包装模板的历史版本升级到当前有效版本', () => {
  const result = resolvePackagingCopyVersion('version-a-1', [version()], [profile()]);

  assert.equal(result.status, 'resolved');
  assert.equal(result.profile.version_id, 'version-a-2');
  assert.equal(result.upgraded, true);
});

test('来源已经绑定当前有效版本时原样继承', () => {
  const result = resolvePackagingCopyVersion(
    'version-a-2',
    [version({ id: 'version-a-2', version_no: 2, is_current: true })],
    [profile()]
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.profile.version_id, 'version-a-2');
  assert.equal(result.upgraded, false);
});

test('同模板没有当前有效版本时保持为空且不猜其他产品包装', () => {
  const result = resolvePackagingCopyVersion(
    'version-a-1',
    [version()],
    [profile({ profile_id: 'profile-b', version_id: 'version-b-1' })]
  );

  assert.deepEqual(result, { status: 'unavailable', reason: 'current_version_unavailable' });
});

test('来源没有包装绑定时继续保持可暂空状态', () => {
  assert.deepEqual(resolvePackagingCopyVersion(null, [version()], [profile()]), { status: 'none' });
});
