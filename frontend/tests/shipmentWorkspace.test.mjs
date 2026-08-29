import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canExportReceiptConfirmation, matchesShipmentFilters, setAllShipmentAllocationQuantities, sortShipmentWorklist, summarizeShipmentDraft, summarizeShipmentSources } from '../src/services/shipmentWorkspace.ts';

const shipmentsPageSource = readFileSync(
  new URL('../src/pages/Shipments.tsx', import.meta.url),
  'utf8'
);

test('合并发货来源汇总去重合同、联系单和批号', () => {
  const summary = summarizeShipmentSources(
    ['shipment-1', 'shipment-2'],
    ['PO-001', 'PO-002', 'PO-001'],
    [
      { shipment_id: 'shipment-1', contact_sheet_id: 'sheet-1', batch_id: 'batch-1', contact_sheet_no: 'B001', batch_no: '26001', shipped_quantity: 100 },
      { shipment_id: 'shipment-2', contact_sheet_id: 'sheet-2', batch_id: 'batch-2', contact_sheet_no: 'B002', batch_no: '26002', shipped_quantity: 200 },
      { shipment_id: 'other', contact_sheet_id: 'sheet-3', batch_id: 'batch-3', contact_sheet_no: 'B003', batch_no: '26003', shipped_quantity: 500 }
    ]
  );
  assert.deepEqual(summary.contractNos, ['PO-001', 'PO-002']);
  assert.deepEqual(summary.contactSheetNos, ['B001', 'B002']);
  assert.equal(summary.batchNos.length, 2);
  assert.equal(summary.totalQuantity, 300);
});

test('发货筛选同时支持来源搜索、客户、合同、日期和状态', () => {
  const candidate = {
    shipmentNo: 'SH-20260717-001',
    customerId: 'customer-1',
    customerName: '演示星辰商贸',
    contractNos: ['PO-001', 'PO-002'],
    contactSheetNos: ['B001'],
    batchNos: ['26001'],
    shipmentDate: '2026-07-17',
    status: '已发货'
  };
  assert.equal(matchesShipmentFilters(candidate, { query: 'b001', customerId: 'customer-1', contractNo: 'PO-002', dateFrom: '2026-07-01', dateTo: '2026-07-31', status: '已发货' }), true);
  assert.equal(matchesShipmentFilters(candidate, { query: '', customerId: '', contractNo: 'PO-003', dateFrom: '', dateTo: '', status: '' }), false);
});

test('发货草稿固定汇总本次数量与发货后剩余量', () => {
  assert.deepEqual(summarizeShipmentDraft([
    { contract_no: 'PO-001', contact_sheet_id: 'sheet-1', batch_id: 'batch-1', availableQty: 100, shippedQty: 80 },
    { contract_no: 'PO-002', contact_sheet_id: 'sheet-2', batch_id: 'batch-2', availableQty: 50, shippedQty: 0 }
  ]), {
    contractCount: 1,
    contactSheetCount: 1,
    batchCount: 1,
    totalShippedQuantity: 80,
    remainingAvailableQuantity: 70
  });
});

test('创建发货时可以一键满发并一键清空当前全部可发明细', () => {
  const allocations = [
    { contract_no: 'PO-001', contact_sheet_id: 'sheet-1', batch_id: 'batch-1', availableQty: 100, shippedQty: 20 },
    { contract_no: 'PO-002', contact_sheet_id: 'sheet-2', batch_id: 'batch-2', availableQty: 50, shippedQty: 0 }
  ];

  assert.deepEqual(
    setAllShipmentAllocationQuantities(allocations, 'full').map(row => row.shippedQty),
    [100, 50]
  );
  assert.deepEqual(
    setAllShipmentAllocationQuantities(allocations, 'clear').map(row => row.shippedQty),
    [0, 0]
  );
  assert.deepEqual(allocations.map(row => row.shippedQty), [20, 0]);
});

test('创建安排可主动展开未入库批次且实际发货前再次校验入库', () => {
  assert.match(shipmentsPageSource, /显示未入库产品/);
  assert.match(shipmentsPageSource, /未入库 · 仅可提前安排/);
  assert.match(shipmentsPageSource, /尚未记录实际入库，不能确认实际发货/);
});

test('一键满发不会把浮点残差写入数量输入框', () => {
  const [row] = setAllShipmentAllocationQuantities([
    { contract_no: 'API-001', contact_sheet_id: 'sheet-api', batch_id: '', availableQty: 159.09999999999997, shippedQty: 0 }
  ], 'full');
  assert.equal(row.shippedQty, 159.1);
  assert.match(shipmentsPageSource, /step="0\.001"/);
  assert.match(shipmentsPageSource, /parseFloat\(event\.target\.value\)/);
});

test('编辑历史发货时保留没有批次 ID 的原有发货明细', () => {
  assert.match(shipmentsPageSource, /sheet\.business_type === '原料药' \|\| sheet\.is_historical/);
  assert.match(shipmentsPageSource, /历史数据未记录批次/);
});

test('发货工作台先显示待开票并在同状态内按日期倒序', () => {
  const rows = [
    { shipment_no: 'SH-004', shipment_date: '2026-07-18', status: '已发货', invoice_state: 'invoiced' },
    { shipment_no: 'SH-002', shipment_date: '2026-07-15', status: '已发货', invoice_state: 'pending' },
    { shipment_no: 'SH-003', shipment_date: '2026-07-20', status: '已发货', invoice_state: 'pending' },
    { shipment_no: 'SH-001', shipment_date: '2026-07-21', status: '已发货', invoice_state: 'inconsistent' }
  ];

  assert.deepEqual(sortShipmentWorklist(rows).map((row) => row.shipment_no), [
    'SH-003',
    'SH-002',
    'SH-001',
    'SH-004'
  ]);
});

test('新创建的准备中发货安排置顶并按安排日期倒序', () => {
  const rows = [
    { shipment_no: 'SH-SHIPPED', shipment_date: '2026-07-28', status: '已发货', invoice_state: 'pending' },
    { shipment_no: 'SH-PREP-OLD', shipment_date: '2026-07-26', status: '准备中', invoice_state: 'not-shipped' },
    { shipment_no: 'SH-PREP-NEW', shipment_date: '2026-07-27', status: '准备中', invoice_state: 'not-shipped' }
  ];

  assert.deepEqual(sortShipmentWorklist(rows).map((row) => row.shipment_no), [
    'SH-PREP-NEW',
    'SH-PREP-OLD',
    'SH-SHIPPED'
  ]);
});

test('取消发货记录始终沉底且不会修改原数组', () => {
  const rows = [
    { shipment_no: 'SH-002', shipment_date: '2026-07-20', status: '取消', invoice_state: 'pending' },
    { shipment_no: 'SH-001', shipment_date: '2026-07-19', status: '已发货', invoice_state: 'invoiced' }
  ];

  const sorted = sortShipmentWorklist(rows);
  assert.deepEqual(sorted.map((row) => row.shipment_no), ['SH-001', 'SH-002']);
  assert.deepEqual(rows.map((row) => row.shipment_no), ['SH-002', 'SH-001']);
});

test('收货确认函只对已实际发货的人民币记录开放', () => {
  assert.equal(canExportReceiptConfirmation({ status: '已发货', currency: 'RMB' }), true);
  assert.equal(canExportReceiptConfirmation({ status: '准备中', currency: 'RMB' }), false);
  assert.equal(canExportReceiptConfirmation({ status: '已发货', currency: 'USD' }), false);
  assert.match(shipmentsPageSource, /export-receipt-confirmation/);
});
