import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPhysicalShipmentRows,
  resolvePhysicalShipmentInvoice
} from '../src/services/shipmentInvoicing.ts';

const groupedRows = [
  { id: 's1', shipment_group_id: 'g1', status: '已发货', amount: 100 },
  { id: 's2', shipment_group_id: 'g1', status: '已发货', amount: 200 },
  { id: 's3', shipment_group_id: 'g2', status: '已发货', amount: 300 }
];

test('按物理发货组取回全部子发货记录', () => {
  assert.deepEqual(getPhysicalShipmentRows(groupedRows[0], groupedRows).map((row) => row.id), ['s1', 's2']);
  assert.deepEqual(getPhysicalShipmentRows(groupedRows[2], groupedRows).map((row) => row.id), ['s3']);
});

test('全部子发货由同一张有日期发票完整覆盖时判定为已开票', () => {
  const result = resolvePhysicalShipmentInvoice(groupedRows.slice(0, 2), [{
    id: 'i1',
    invoice_date: '2026-07-17',
    shipment_allocations: [
      { shipment_id: 's1', allocated_amount: 100 },
      { shipment_id: 's2', allocated_amount: 200 }
    ]
  }]);
  assert.equal(result.state, 'invoiced');
  assert.equal(result.invoice?.id, 'i1');
});

test('美元和人民币都只按实际开完票日期及完整覆盖判断完成', () => {
  const usdResult = resolvePhysicalShipmentInvoice([groupedRows[0]], [{
    id: 'usd-invoice',
    currency: 'USD',
    status: '已申请',
    invoice_date: '2026-07-17',
    shipment_allocations: [{ shipment_id: 's1', allocated_amount: 100 }]
  }]);
  const rmbResult = resolvePhysicalShipmentInvoice([groupedRows[2]], [{
    id: 'rmb-invoice',
    currency: 'RMB',
    status: '已收到电子发票',
    invoice_date: '2026-07-17',
    shipment_allocations: [{ shipment_id: 's3', allocated_amount: 300 }]
  }]);

  assert.equal(usdResult.state, 'invoiced');
  assert.equal(rmbResult.state, 'invoiced');
});

test('部分开票、跨物理发货或重复发票均标记为异常', () => {
  const partial = resolvePhysicalShipmentInvoice(groupedRows.slice(0, 2), [{
    id: 'i1', invoice_date: '2026-07-17', shipment_allocations: [{ shipment_id: 's1', allocated_amount: 50 }]
  }]);
  assert.equal(partial.state, 'inconsistent');

  const crossShipment = resolvePhysicalShipmentInvoice(groupedRows.slice(0, 2), [{
    id: 'i1', invoice_date: '2026-07-17', shipment_allocations: [
      { shipment_id: 's1', allocated_amount: 100 },
      { shipment_id: 's2', allocated_amount: 200 },
      { shipment_id: 's3', allocated_amount: 300 }
    ]
  }]);
  assert.equal(crossShipment.state, 'inconsistent');

  const duplicate = resolvePhysicalShipmentInvoice(groupedRows.slice(0, 2), [
    { id: 'i1', invoice_date: '2026-07-17', shipment_allocations: [{ shipment_id: 's1', allocated_amount: 100 }] },
    { id: 'i2', invoice_date: '2026-07-17', shipment_allocations: [{ shipment_id: 's2', allocated_amount: 200 }] }
  ]);
  assert.equal(duplicate.state, 'inconsistent');
});

test('未发货记录不能进入开票流程', () => {
  const result = resolvePhysicalShipmentInvoice([
    { id: 's1', status: '准备中', amount: 100 }
  ], []);
  assert.equal(result.state, 'not-shipped');
});
