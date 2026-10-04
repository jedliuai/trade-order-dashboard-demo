import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnalyticsDrillRows } from '../src/services/analyticsDrilldown.ts';

const contract = {
  id: 'c1', contract_no: 'PO-001', customer_id: 'customer-1', customer_name: '客户 A', country: '哥伦比亚',
  contract_date: '2025-12-10', export_type: '自营', currency: 'USD', status: '执行中'
};
const sheet = {
  id: 's1', contract_id: 'c1', contact_sheet_no: 'B001', product_name: '产品 A', material_no: 'DEMO-MAT-A',
  country: '哥伦比亚', quantity: 100, unit_price: 2, status: '发货完成'
};
const shipment = {
  id: 'sh1', shipment_no: 'SH-001', contract_id: 'c1', shipment_date: '2026-01-20', amount: 200,
  currency: 'USD', status: '已发货'
};
const baseInput = {
  group: '2026-01', dimension: 'month', startDate: '2025-12-01', endDate: '2026-07-20',
  contracts: [contract], sheets: [sheet], shipments: [shipment],
  shipmentItems: [{ id: 'item-1', shipment_id: 'sh1', contact_sheet_id: 's1', shipped_quantity: 100, unit_price: 2, batch_no: '26001' }],
  payments: [{ id: 'p1', contract_id: 'c1', payment_date: '2026-02-01', amount: 200, amount_rmb: 1400, currency: 'USD', payment_type: '尾款' }],
  invoices: [{ id: 'i1', invoice_no: 'INV-1', invoice_date: '2026-03-01', currency: 'USD', status: '已收到电子发票', shipment_ids: ['sh1'], shipment_allocations: [{ shipment_id: 'sh1', allocated_amount: 200 }] }],
  profits: [{ shipment_id: 'sh1', shipment_no: 'SH-001', contract_no: 'PO-001', customer_name: '客户 A', contact_sheet_no: 'B001', batch_no: '26001', material_no: 'DEMO-MAT-A', product_name: '产品 A', invoice_month: '2026-03', profit: 300, gross_margin: 0.2 }],
  receivables: [{
    id: 'sh1:item-1', contractId: 'c1', contractNo: 'PO-001', contractDate: '2025-12-10',
    shipmentId: 'sh1', shipmentNo: 'SH-001', shipmentDate: '2026-01-20', customerName: '客户 A',
    country: '哥伦比亚', exportType: '自营', contactSheetId: 's1', contactSheetNo: 'B001',
    productName: '产品 A', materialNo: 'FF01', status: '发货完成', currency: 'USD',
    outstandingAmount: 50, outstandingAmountRmb: 350, missingRate: false, allocationNote: '系统按先发先抵分摊'
  }],
  alerts: [], rateForDate: () => 7
};

test('点击发货金额只下钻发货日期所在分组', () => {
  const rows = buildAnalyticsDrillRows({ ...baseInput, metric: 'shipment_amount' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, '发货');
  assert.equal(rows[0].businessDate, '2026-01-20');
  assert.equal(rows[0].amountRmb, 1400);
});

test('合同金额按合同签订日期下钻合同', () => {
  const rows = buildAnalyticsDrillRows({ ...baseInput, metric: 'contract_amount', group: '2025-12' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, '合同');
  assert.equal(rows[0].documentNo, 'PO-001');
  assert.equal(rows[0].businessDate, '2025-12-10');
});

test('不同指标按各自业务日期下钻', () => {
  const paymentRows = buildAnalyticsDrillRows({ ...baseInput, metric: 'payment_amount', group: '2026-02' });
  const invoiceRows = buildAnalyticsDrillRows({ ...baseInput, metric: 'invoice_amount', group: '2026-03' });
  const profitRows = buildAnalyticsDrillRows({ ...baseInput, metric: 'profit', group: '2026-03' });
  assert.deepEqual(paymentRows.map((row) => row.sourceType), ['收款']);
  assert.deepEqual(invoiceRows.map((row) => row.sourceType), ['发票']);
  assert.deepEqual(profitRows.map((row) => row.sourceType), ['利润']);
});

test('当前应收下钻展示真实发货余额而不是合同金额来源', () => {
  const rows = buildAnalyticsDrillRows({ ...baseInput, metric: 'unpaid_amount', group: '2026-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].documentNo, 'SH-001');
  assert.equal(rows[0].amountRmb, 350);
  assert.match(rows[0].note, /先发先抵/);
});

test('按合同签约批次观察时，各业务指标统一归入合同月份', () => {
  const paymentRows = buildAnalyticsDrillRows({ ...baseInput, metric: 'payment_amount', group: '2025-12', timePerspective: 'contract' });
  const receivableRows = buildAnalyticsDrillRows({ ...baseInput, metric: 'unpaid_amount', group: '2025-12', timePerspective: 'contract' });
  assert.deepEqual(paymentRows.map((row) => row.sourceType), ['收款']);
  assert.deepEqual(receivableRows.map((row) => row.sourceType), ['发货']);
});
