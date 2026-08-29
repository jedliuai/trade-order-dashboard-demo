import assert from 'node:assert/strict';
import test from 'node:test';

import { getBusinessStatusTone } from '../src/services/statusPresentation.ts';

test('相同业务状态在全系统使用固定展示色', () => {
  assert.equal(getBusinessStatusTone('已发货'), 'success');
  assert.equal(getBusinessStatusTone('发货完成'), 'success');
  assert.equal(getBusinessStatusTone('部分发货'), 'progress');
  assert.equal(getBusinessStatusTone('待收款'), 'warning');
  assert.equal(getBusinessStatusTone('未收款'), 'warning');
  assert.equal(getBusinessStatusTone('待开票 2 批'), 'warning');
  assert.equal(getBusinessStatusTone('交货期已逾期'), 'danger');
  assert.equal(getBusinessStatusTone('已归档'), 'neutral');
});

test('未知状态保持调用方指定的安全回退色', () => {
  assert.equal(getBusinessStatusTone('自定义展示状态'), 'neutral');
  assert.equal(getBusinessStatusTone('自定义展示状态', 'accent'), 'accent');
});
