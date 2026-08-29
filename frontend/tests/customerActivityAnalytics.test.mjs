import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCustomerActivity } from '../src/services/customerActivityAnalytics.ts';
import { CUSTOMER_DORMANCY_DAYS } from '../src/services/customerOperatingConfig.ts';

const emptyInput = () => ({
  customers: [],
  contracts: [],
  sheets: [],
  payments: [],
  paymentReceipts: [],
  shipments: [],
  shipmentItems: [],
  shipmentProfits: [],
  exchangeRates: []
});

const customer = (id, name = `客户${id}`) => ({ id, name });
const contract = (id, customerId) => ({
  id,
  contract_no: `PO-${id}`,
  customer_id: customerId,
  customer_name: `客户${customerId}`
});
const shipment = (id, contractId, shipmentDate, overrides = {}) => ({
  id,
  contract_id: contractId,
  customer_name: '',
  shipment_date: shipmentDate,
  status: '已发货',
  ...overrides
});

test('合并发货按 shipment_group_id 计为一次物理发货，并排除准备中与截止日后记录', () => {
  const input = emptyInput();
  input.customers = [customer('c1'), customer('c2'), customer('c3')];
  input.contracts = [contract('k1', 'c1'), contract('k2', 'c2')];
  input.shipments = [
    shipment('sh1', 'k1', '2026-01-10', { shipment_group_id: 'group-1', customer_id: 'c1' }),
    shipment('sh2', 'k1', '2026-01-10', { shipment_group_id: 'group-1' }),
    shipment('sh3', 'k1', '2026-02-10', { status: '准备中' }),
    shipment('sh4', 'k2', '2026-03-10'),
    shipment('sh5', 'k2', '2026-08-01')
  ];

  const result = buildCustomerActivity(input, {
    startDate: '2026-01-01',
    endDate: '2026-07-31'
  });

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find((row) => row.customerId === 'c1').physicalShipmentCount, 1);
  assert.equal(result.rows.find((row) => row.customerId === 'c2').physicalShipmentCount, 1);
  assert.equal(result.rows.some((row) => row.customerId === 'c3'), false);
  assert.deepEqual(result.rows.map((row) => row.customerId), ['c2', 'c1']);
});

test('平均复购间隔基于不同发货日期的相邻间隔', () => {
  const input = emptyInput();
  input.customers = [customer('c1')];
  input.contracts = [contract('k1', 'c1')];
  input.shipments = [
    shipment('sh1', 'k1', '2025-01-01'),
    shipment('sh2', 'k1', '2025-01-01'),
    shipment('sh3', 'k1', '2025-01-11'),
    shipment('sh4', 'k1', '2025-01-31')
  ];

  const row = buildCustomerActivity(input, {
    startDate: '2025-01-01',
    endDate: '2025-02-28'
  }).rows[0];

  assert.equal(row.physicalShipmentCount, 4);
  assert.equal(row.firstShipmentDate, '2025-01-01');
  assert.equal(row.latestShipmentDate, '2025-01-31');
  assert.equal(row.averageRepurchaseIntervalDays, 15);
});

test('客户活跃状态按新客户、重新激活、沉睡、活跃的互斥优先级判定', () => {
  const input = emptyInput();
  input.customers = [
    customer('new'),
    customer('active'),
    customer('dormant'),
    customer('reactivated')
  ];
  input.contracts = input.customers.map((item) => contract(`k-${item.id}`, item.id));
  input.shipments = [
    shipment('new-1', 'k-new', '2026-03-01'),
    shipment('new-2', 'k-new', '2026-06-20'),
    shipment('active-1', 'k-active', '2025-12-20'),
    shipment('active-2', 'k-active', '2026-01-05'),
    shipment('active-3', 'k-active', '2026-06-30'),
    shipment('dormant-1', 'k-dormant', '2025-12-20'),
    shipment('dormant-2', 'k-dormant', '2026-01-02'),
    shipment('reactivated-1', 'k-reactivated', '2025-07-05'),
    shipment('reactivated-2', 'k-reactivated', '2026-01-01'),
    shipment('reactivated-3', 'k-reactivated', '2026-06-30')
  ];

  const result = buildCustomerActivity(input, {
    startDate: '2026-01-01',
    endDate: '2026-07-01'
  });
  const statusOf = (customerId) => result.rows.find((row) => row.customerId === customerId).status;

  assert.equal(statusOf('new'), 'new');
  assert.equal(statusOf('active'), 'active');
  assert.equal(statusOf('dormant'), 'dormant');
  assert.equal(statusOf('reactivated'), 'reactivated');
  assert.deepEqual(result.counts, { new: 1, active: 1, dormant: 1, reactivated: 1 });
});

test('180 天边界同时触发重新激活和沉睡判定', () => {
  assert.equal(CUSTOMER_DORMANCY_DAYS, 180);

  const input = emptyInput();
  input.customers = [customer('dormant'), customer('reactivated')];
  input.contracts = [contract('kd', 'dormant'), contract('kr', 'reactivated')];
  input.shipments = [
    shipment('d1', 'kd', '2025-12-20'),
    shipment('d2', 'kd', '2026-01-02'),
    shipment('r1', 'kr', '2025-07-05'),
    shipment('r2', 'kr', '2026-01-01')
  ];

  const result = buildCustomerActivity(input, {
    startDate: '2026-01-01',
    endDate: '2026-07-01'
  });

  assert.equal(result.rows.find((row) => row.customerId === 'dormant').status, 'dormant');
  assert.equal(result.rows.find((row) => row.customerId === 'reactivated').status, 'reactivated');
  assert.equal(result.dormancyDays, 180);
  assert.equal(result.asOfDate, '2026-07-01');
});
