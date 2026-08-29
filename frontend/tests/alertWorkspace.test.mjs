import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterAlertWorkspace,
  getAlertNavigationTab,
  groupAlertWorkspace
} from '../src/services/alertWorkspace.ts';

const alerts = [
  { id: '1', alert_type: '请开票', related_type: 'shipment', related_id: 'shipment-a', priority: 'medium', message: '发货 A 待开票', status: '未处理', created_at: '2026-07-17T09:00:00Z' },
  { id: '2', alert_type: '请开票', related_type: 'shipment', related_id: 'shipment-b', priority: 'high', message: '发货 B 待开票', status: '未处理', created_at: '2026-07-17T10:00:00Z' },
  { id: '3', alert_type: '请收款', related_type: 'contract', related_id: 'contract-a', priority: 'low', message: '合同待收款', status: '已处理', created_at: '2026-07-16T10:00:00Z' },
  { id: '4', alert_type: '请收款', related_type: 'contract', related_id: 'contract-b', priority: 'medium', message: '合同稍后收款', status: '稍后提醒', snoozed_until: '2026-07-20T01:00:00Z', created_at: '2026-07-17T11:00:00Z' }
];

test('提醒筛选支持状态、风险、对象类型和业务身份搜索', () => {
  const filtered = filterAlertWorkspace(alerts, {
    status: '未处理',
    priority: 'high',
    relatedType: 'shipment',
    query: 'SH-002'
  }, (alert) => alert.id === '2' ? 'SH-002 DEMO_PACKAGING' : 'SH-001');
  assert.deepEqual(filtered.map((alert) => alert.id), ['2']);
});

test('同类型同对象提醒折叠成一组并按最高风险排序', () => {
  const groups = groupAlertWorkspace(alerts.filter((alert) => alert.status === '未处理'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].priority, 'high');
  assert.deepEqual(groups[0].alerts.map((alert) => alert.id), ['2', '1']);
});

test('DEMO_PACKAGING 盒子制版稿提醒始终排在提醒中心最上方', () => {
  const groups = groupAlertWorkspace([
    ...alerts.filter((alert) => alert.status === '未处理'),
    { id: '5', alert_type: '请确认 DEMO_PACKAGING 盒子制版稿', related_type: 'contact_sheet', related_id: 'sheet-a', priority: 'high', message: '请确认盒子版式', status: '未处理', created_at: '2026-07-01T08:00:00Z' }
  ]);
  assert.equal(groups[0].alertType, '请确认 DEMO_PACKAGING 盒子制版稿');
});

test('稍后提醒使用独立状态筛选，不会混入未处理提醒', () => {
  const snoozed = filterAlertWorkspace(alerts, {
    status: '稍后提醒',
    priority: '',
    relatedType: '',
    query: ''
  }, () => '');
  assert.deepEqual(snoozed.map((alert) => alert.id), ['4']);
});

test('提醒对象跳转到对应业务工作区', () => {
  assert.equal(getAlertNavigationTab('contract'), 'contracts');
  assert.equal(getAlertNavigationTab('contact_sheet'), 'contact_sheets');
  assert.equal(getAlertNavigationTab('batch'), 'batches');
  assert.equal(getAlertNavigationTab('shipment'), 'shipments');
  assert.equal(getAlertNavigationTab('invoice'), 'shipments');
  assert.equal(getAlertNavigationTab('payment'), 'payments');
});
