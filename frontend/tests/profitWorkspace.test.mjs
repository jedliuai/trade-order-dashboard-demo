import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterProfitWorkspace,
  listProfitFilterOptions,
  resolveProfitStatus,
  summarizeProfitByContactSheet,
  summarizeProfitByCustomer,
  summarizeShipmentProfitByCustomer,
  summarizeProfitWorkspace
} from '../src/services/profitWorkspace.ts';

const rows = [
  { shipment_no: 'SH-001', contract_no: 'DEMO-PO70041', contact_sheet_no: 'DEMO-CS-101', customer_name: 'DEMO_PACKAGING', product_name: '产品 A', material_no: 'DEMO-MAT-A', invoice_month: '2026-07', export_type: '自营', currency: 'USD', exchangeRate: 6.8, costNoTax: 1, salesRmb: 100, profit: 20, isEstimate: false, quantity: 10, unit: '支' },
  { shipment_no: 'SH-002', contract_no: 'DEMO-002', contact_sheet_no: 'DEMO-CS-102', customer_name: '演示星辰', product_name: '产品 B', material_no: 'DEMO-MAT-B', invoice_month: '2026-06', export_type: '转口', currency: 'RMB', exchangeRate: 1, costNoTax: 2, salesRmb: 200, profit: 30, isEstimate: true, quantity: 20, unit: '支' },
  { shipment_no: 'SH-003', contract_no: 'DEMO-PO70042', contact_sheet_no: 'DEMO-CS-103', customer_name: 'DEMO_PACKAGING', product_name: '产品 C', material_no: 'DEMO-MAT-C', invoice_month: '2026-07', export_type: '自营', currency: 'USD', exchangeRate: null, costNoTax: null, salesRmb: null, profit: null, isEstimate: false, quantity: 30, unit: '支' }
];

test('利润状态只区分已确认和待计算，预估成本不计入利润', () => {
  assert.equal(resolveProfitStatus(rows[0]), 'confirmed');
  assert.equal(resolveProfitStatus(rows[1]), 'pending');
  assert.equal(resolveProfitStatus(rows[2]), 'pending');
});

test('利润筛选支持时间段、客户、合同、联系单、状态和包含搜索', () => {
  const filtered = filterProfitWorkspace(rows, { dateFrom: '2026-07-01', dateTo: '2026-07-31', customer: 'DEMO_PACKAGING', contract: 'DEMO-PO70041', contactSheet: 'DEMO-CS-101', status: 'confirmed', query: 'demo-cs-10' });
  assert.deepEqual(filtered.map((row) => row.shipment_no), ['SH-001']);
});

test('利润汇总只纳入已确认毛利，预估成本归入待计算', () => {
  const summary = summarizeProfitWorkspace(rows);
  assert.equal(summary.totalSalesRmb, 300);
  assert.equal(summary.confirmedProfitRmb, 20);
  assert.equal(summary.pendingCount, 2);
  assert.equal(summary.estimatedCostCount, 1);
  assert.equal(summary.missingRateCount, 1);
  assert.equal(summary.missingCostCount, 1);
});

test('负利润仍属于已确认利润，并按负数计入汇总', () => {
  const negative = { ...rows[0], shipment_no: 'SH-LOSS', profit: -12, salesRmb: 80 };
  assert.equal(resolveProfitStatus(negative), 'confirmed');
  const summary = summarizeProfitWorkspace([negative]);
  assert.equal(summary.confirmedProfitRmb, -12);
  assert.equal(summary.confirmedCount, 1);
});

test('利润筛选候选项按月份倒序并对客户去重', () => {
  assert.deepEqual(listProfitFilterOptions(rows), {
    months: ['2026-07', '2026-06'],
    customers: ['DEMO_PACKAGING', '演示星辰'],
    contracts: ['DEMO-002', 'DEMO-PO70041', 'DEMO-PO70042'],
    contactSheets: ['DEMO-CS-101', 'DEMO-CS-102', 'DEMO-CS-103']
  });
});

test('联系单利润汇总会合并同一联系单的多次发货并重新计算整体毛利率', () => {
  const summary = summarizeProfitByContactSheet([
    rows[0],
    { ...rows[0], shipment_no: 'SH-004', salesRmb: 300, profit: 60, quantity: 30 }
  ]);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].shipmentCount, 2);
  assert.equal(summary[0].quantity, 40);
  assert.equal(summary[0].salesRmb, 400);
  assert.equal(summary[0].profit, 80);
  assert.equal(summary[0].margin, 20);
});

test('CIF 利润汇总保留销售毛额，但毛利率按扣除运保费后的 FOB 基数计算', () => {
  const cifRow = {
    ...rows[0],
    salesRmb: 700,
    profitBasisRmb: 665,
    profit: 133
  };
  const workspace = summarizeProfitWorkspace([cifRow]);
  assert.equal(workspace.totalSalesRmb, 700);
  assert.equal(workspace.confirmedProfitBasisRmb, 665);

  const summary = summarizeProfitByContactSheet([cifRow]);
  assert.equal(summary[0].salesRmb, 700);
  assert.equal(summary[0].profitBasisRmb, 665);
  assert.equal(summary[0].margin, 20);
});

test('联系单任一利润明细待计算时，汇总结果不会伪装成已确认', () => {
  const summary = summarizeProfitByContactSheet([
    rows[0],
    { ...rows[0], shipment_no: 'SH-004', profit: null, isEstimate: true }
  ]);
  assert.equal(summary[0].profit, null);
  assert.equal(summary[0].margin, null);
  assert.equal(summary[0].pendingCount, 1);
});

test('利润页默认财年范围按开票月份筛选且包含边界月份', () => {
  const fiscalRows = filterProfitWorkspace(rows, {
    month: 'fiscal',
    startMonth: '2026-07',
    endMonth: '2026-07'
  });
  assert.deepEqual(fiscalRows.map((row) => row.shipment_no), ['SH-003', 'SH-001']);
});

test('利润明细按开票月份由晚到早排列', () => {
  const sorted = filterProfitWorkspace(rows, { month: 'all' });
  assert.deepEqual(sorted.map((row) => row.invoice_month), ['2026-07', '2026-07', '2026-06']);
});

test('customer profit groups aggregate confirmed RMB profit and preserve pending contact sheets', () => {
  const contactSheets = summarizeProfitByContactSheet(rows);
  const groups = summarizeProfitByCustomer(contactSheets);
  const demo_packaging = groups.find((group) => group.customer_name === 'DEMO_PACKAGING');
  assert.ok(demo_packaging);
  assert.equal(demo_packaging.contactSheetCount, 2);
  assert.equal(demo_packaging.confirmedContactSheetCount, 1);
  assert.equal(demo_packaging.pendingContactSheetCount, 1);
  assert.equal(demo_packaging.profitRmb, 20);
  assert.equal(demo_packaging.confirmedSalesRmb, 100);
  assert.equal(demo_packaging.margin, 20);
});

test('发货利润按客户分组并汇总发货笔数、确认利润和待计算明细', () => {
  const groups = summarizeShipmentProfitByCustomer([
    rows[0],
    { ...rows[0], shipment_no: 'SH-004', salesRmb: 300, profitBasisRmb: 300, profit: 60 },
    rows[2]
  ]);
  const demo_packaging = groups.find((group) => group.customer_name === 'DEMO_PACKAGING');
  assert.ok(demo_packaging);
  assert.equal(demo_packaging.shipmentCount, 3);
  assert.equal(demo_packaging.detailCount, 3);
  assert.equal(demo_packaging.confirmedDetailCount, 2);
  assert.equal(demo_packaging.pendingDetailCount, 1);
  assert.equal(demo_packaging.salesRmb, 400);
  assert.equal(demo_packaging.profitRmb, 80);
  assert.equal(demo_packaging.margin, 20);
  assert.deepEqual(demo_packaging.shipments.map((row) => row.shipment_no), ['SH-001', 'SH-004', 'SH-003']);
});
