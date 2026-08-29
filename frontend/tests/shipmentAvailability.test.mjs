import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAvailableShipmentQuantity,
  getRemainingShipmentQuantity,
  isShipmentBatchWarehoused,
  normalizeShipmentQuantity
} from '../src/services/shipmentAvailability.ts';

test('创建发货记录只计算已入库批次的剩余库存', () => {
  assert.equal(getAvailableShipmentQuantity({ batch_quantity: 100, warehouse_date: '2026-07-15' }, 35), 65);
  assert.equal(getAvailableShipmentQuantity({ batch_quantity: 100, contact_warehouse_date: '2026-07-15' }, 35), 65);
});

test('未入库批次不进入发货候选列表', () => {
  assert.equal(getAvailableShipmentQuantity({ batch_quantity: 100, warehouse_date: '' }, 0), 0);
  assert.equal(getAvailableShipmentQuantity({ batch_quantity: 100, warehouse_date: null, contact_warehouse_date: null }, 0), 0);
});

test('提前创建发货安排时可以计算未入库批次的剩余未发数量', () => {
  assert.equal(getRemainingShipmentQuantity(100, 35), 65);
  assert.equal(getRemainingShipmentQuantity(100, 100), 0);
  assert.equal(isShipmentBatchWarehoused({ batch_quantity: 100, warehouse_date: '' }), false);
  assert.equal(isShipmentBatchWarehoused({ batch_quantity: 100, contact_warehouse_date: '2026-08-07' }), true);
});

test('库存已全部占用或超额占用时不进入发货候选列表', () => {
  assert.equal(getAvailableShipmentQuantity({ batch_quantity: 100, warehouse_date: '2026-07-15' }, 100), 0);
  assert.equal(getAvailableShipmentQuantity({ batch_quantity: 100, warehouse_date: '2026-07-15' }, 120), 0);
});

test('小数可发量按数据库三位精度消除浮点残差', () => {
  assert.equal(normalizeShipmentQuantity(159.09999999999997), 159.1);
  assert.equal(getAvailableShipmentQuantity({ batch_quantity: 159.2, warehouse_date: '2026-07-15' }, 0.1), 159.1);
});
