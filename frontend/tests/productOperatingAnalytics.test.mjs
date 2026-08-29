import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductOperatingAnalysis,
  buildProductOperatingTrend
} from '../src/services/productOperatingAnalytics.ts';

const catalog = {
  products: [{
    id: 'p1',
    productCode: 'P00001',
    productName: '归一产品',
    englishName: '',
    aliases: [],
    variants: [{ id: 'v1', productId: 'p1', specification: '1g' }]
  }]
};

const snapshot = {
  customers: [],
  contracts: [
    { id: 'c1', contract_no: 'PO-1', customer_id: 'customer-1', currency: 'RMB' },
    { id: 'c2', contract_no: 'PO-2', customer_id: 'customer-2', currency: 'RMB' },
    { id: 'c3', contract_no: 'PO-3', customer_id: 'customer-1', currency: 'RMB' }
  ],
  sheets: [
    { id: 's1', contract_id: 'c1', contract_no: 'PO-1', contact_sheet_no: 'CS-1', product_variant_id: 'v1', material_no: 'ERP-01', product_name: '旧名一', specification: '1g', unit: '支' },
    { id: 's2', contract_id: 'c2', contract_no: 'PO-2', contact_sheet_no: 'CS-2', product_variant_id: 'v1', material_no: 'ERP-02', product_name: '旧名二', specification: '1g', unit: '支' },
    { id: 's3', contract_id: 'c3', contract_no: 'PO-3', contact_sheet_no: 'CS-3', material_no: 'ERP-03', product_name: '未归一产品', specification: '2g', unit: '盒' }
  ],
  payments: [],
  paymentReceipts: [],
  shipments: [
    { id: 'sh1', shipment_group_id: 'group-1', contract_id: 'c1', customer_id: 'customer-1', currency: 'RMB', shipment_date: '2026-02-01', status: '已发货' },
    { id: 'sh2', shipment_group_id: 'group-1', contract_id: 'c2', customer_id: 'customer-2', currency: 'RMB', shipment_date: '2026-02-01', status: '已发货' },
    { id: 'sh3', contract_id: 'c3', customer_id: 'customer-1', currency: 'RMB', shipment_date: '2026-03-01', status: '已发货' },
    { id: 'sh4', contract_id: 'c3', customer_id: 'customer-1', currency: 'RMB', shipment_date: '2026-03-01', status: '准备中' }
  ],
  shipmentItems: [
    { id: 'i1', shipment_id: 'sh1', contact_sheet_id: 's1', batch_id: 'b1', material_no: 'ERP-01', product_name: '旧名一', specification: '1g', unit: '支', amount: 100, shipped_quantity: 10, unit_price: 10 },
    { id: 'i2', shipment_id: 'sh2', contact_sheet_id: 's2', batch_id: 'b2', material_no: 'ERP-02', product_name: '旧名二', specification: '1g', unit: '支', amount: 300, shipped_quantity: 30, unit_price: 10 },
    { id: 'i3', shipment_id: 'sh3', contact_sheet_id: 's3', batch_id: '', material_no: 'ERP-03', product_name: '未归一产品', specification: '2g', unit: '盒', amount: 100, shipped_quantity: 1, unit_price: 100 },
    { id: 'i4', shipment_id: 'sh4', contact_sheet_id: 's3', batch_id: '', material_no: 'ERP-03', product_name: '未归一产品', specification: '2g', unit: '盒', amount: 999, shipped_quantity: 1, unit_price: 999 }
  ],
  invoices: [],
  alerts: [],
  batches: [],
  shipmentProfits: [
    { shipment_id: 'sh1', contract_no: 'PO-1', contact_sheet_no: 'CS-1', material_no: 'ERP-01', product_name: '旧名一', specification: '1g', unit: '支', invoice_month: '2026-02', sales_amount_rmb: 100, profit_basis_amount_rmb: 90, profit: 20, is_estimated_profit: false },
    { shipment_id: 'sh2', contract_no: 'PO-2', contact_sheet_no: 'CS-2', material_no: 'ERP-02', product_name: '旧名二', specification: '1g', unit: '支', invoice_month: '2026-02', sales_amount_rmb: 300, profit_basis_amount_rmb: 210, profit: 30, is_estimated_profit: false },
    { shipment_id: 'sh3', contract_no: 'PO-3', contact_sheet_no: 'CS-3', material_no: 'ERP-03', product_name: '未归一产品', specification: '2g', unit: '盒', invoice_month: '2026-03', sales_amount_rmb: 100, profit_basis_amount_rmb: 100, profit: -10, is_estimated_profit: false },
    { shipment_id: 'sh3', contract_no: 'PO-3', contact_sheet_no: 'CS-3', material_no: 'ERP-03', product_name: '未归一产品', specification: '2g', unit: '盒', invoice_month: '2026-03', sales_amount_rmb: 10, profit_basis_amount_rmb: 10, profit: 9, is_estimated_profit: true }
  ],
  exchangeRates: []
};

test('经营分析按联系单正式 Product Variant 归并多个 ERP 物料号，并按物理发货去重', () => {
  const result = buildProductOperatingAnalysis(snapshot, catalog, { startDate: '2025-12-01', endDate: '2026-08-13' }, 'sales');
  assert.equal(result.allRows.length, 2);
  const normalized = result.allRows.find((row) => row.key === 'variant:v1');
  assert.ok(normalized);
  assert.deepEqual(normalized.materialNumbers, ['ERP-01', 'ERP-02']);
  assert.equal(normalized.salesRmb, 400);
  assert.equal(normalized.profitRmb, 50);
  assert.equal(normalized.profitBasisRmb, 300);
  assert.equal(normalized.grossMargin, 50 / 300);
  assert.equal(normalized.activeCustomerCount, 2);
  assert.equal(normalized.contactSheetCount, 2);
  assert.equal(normalized.linkedBatchCount, 2);
  assert.equal(normalized.physicalShipmentCount, 1);
  assert.equal(result.pendingProfitLineCount, 1);
  assert.equal(result.unlinkedBatchLineCount, 1);
});

test('销售集中度计算 Top 与 N80，并保留未归一和亏损提示', () => {
  const result = buildProductOperatingAnalysis(snapshot, catalog, { startDate: '2025-12-01', endDate: '2026-08-13' }, 'sales');
  assert.equal(result.totalAmount, 500);
  assert.equal(result.top1Share, 0.8);
  assert.equal(result.top3Share, 1);
  assert.equal(result.n80, 1);
  assert.equal(result.core.productCount, 1);
  assert.equal(result.core.share, 0.8);
  assert.equal(result.tail.productCount, 1);
  assert.equal(result.lossRows.length, 1);
  assert.equal(result.unmappedProductCount, 1);
});

test('利润集中度只使用正利润产品，亏损产品不冲减贡献分母', () => {
  const result = buildProductOperatingAnalysis(snapshot, catalog, { startDate: '2025-12-01', endDate: '2026-08-13' }, 'profit');
  assert.equal(result.rows.length, 1);
  assert.equal(result.totalAmount, 50);
  assert.equal(result.top1Share, 1);
  assert.equal(result.n80, 1);
  assert.equal(result.lossRows[0].profitRmb, -10);
  assert.equal(result.totalLossRmb, -10);
});

test('三财年趋势沿用归一产品键和利润基数', () => {
  const rows = buildProductOperatingTrend(snapshot, catalog, 2026, 'variant:v1', '2026-08-13');
  assert.deepEqual(rows.map((row) => row.fiscalYear), [2024, 2025, 2026]);
  assert.equal(rows[2].salesRmb, 400);
  assert.equal(rows[2].profitRmb, 50);
  assert.equal(rows[2].profitBasisRmb, 300);
  assert.equal(rows[2].grossMargin, 50 / 300);
});

test('没有正式外键且文字快照有多个候选时不自动归并', () => {
  const conflictedCatalog = {
    ...catalog,
    products: [{ ...catalog.products[0], aliases: ['旧名一'] }, {
      id: 'p2', productCode: 'P00002', productName: '旧名一', englishName: '', aliases: [],
      variants: [{ id: 'v2', productId: 'p2', specification: '1g' }]
    }]
  };
  const conflictedSnapshot = { ...snapshot, sheets: snapshot.sheets.map((sheet) => sheet.id === 's1' ? { ...sheet, product_variant_id: null } : sheet) };
  const result = buildProductOperatingAnalysis(conflictedSnapshot, conflictedCatalog, { startDate: '2025-12-01', endDate: '2026-08-13' }, 'sales');
  assert.ok(result.allRows.some((row) => row.identityState === 'conflict'));
  assert.equal(result.conflictingProductCount, 1);
});
