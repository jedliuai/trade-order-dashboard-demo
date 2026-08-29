import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCustomerProductAnalysis,
  buildCustomerValueMatrix,
  getFiscalYearPeriod
} from '../src/services/customerValueAnalytics.ts';

const base = () => ({
  customers: [
    { id: 'c1', name: '客户甲', country: '', default_currency: 'USD' },
    { id: 'c2', name: '客户乙', country: '', default_currency: 'RMB' }
  ],
  contracts: [
    { id: 'k1', contract_no: 'PO-1', customer_id: 'c1', customer_name: '客户甲', contract_date: '2025-12-10', currency: 'USD' },
    { id: 'k2', contract_no: 'PO-2', customer_id: 'c2', customer_name: '客户乙', contract_date: '2026-01-10', currency: 'RMB' }
  ],
  sheets: [
    { id: 's1', contract_id: 'k1', material_no: 'M1', product_name: '产品一', specification: '1g', unit: '支', quantity: 100, unit_price: 10 },
    { id: 's2', contract_id: 'k2', material_no: 'M2', product_name: '产品二', specification: '2g', unit: '盒', quantity: 50, unit_price: 100 }
  ],
  payments: [],
  paymentReceipts: [],
  shipments: [],
  shipmentItems: [],
  shipmentProfits: [],
  exchangeRates: [
    { effective_month: '2025-12', rate: 7.1 },
    { effective_month: '2026-02', rate: 7.2 }
  ]
});

test('财年从上一自然年12月1日开始，当前财年按截止日截断', () => {
  assert.deepEqual(getFiscalYearPeriod(2026, '2026-07-23'), {
    fiscalYear: 2026,
    startDate: '2025-12-01',
    endDate: '2026-07-23',
    isCurrent: true
  });
  assert.equal(getFiscalYearPeriod(2025, '2026-07-23').endDate, '2025-11-30');
});

test('客户价值矩阵按收款单头汇总，避免合同分摊重复计入', () => {
  const input = base();
  input.paymentReceipts = [{
    id: 'r1',
    customer_id: 'c1',
    payment_date: '2026-02-10',
    total_amount: 100,
    currency: 'USD'
  }];
  input.payments = [
    { id: 'p1', receipt_id: 'r1', contract_id: 'k1', contract_no: 'PO-1', customer_name: '客户甲', payment_date: '2026-02-10', amount: 40, currency: 'USD' },
    { id: 'p2', receipt_id: 'r1', contract_id: 'k1', contract_no: 'PO-1', customer_name: '客户甲', payment_date: '2026-02-10', amount: 60, currency: 'USD' }
  ];
  const result = buildCustomerValueMatrix(input, { startDate: '2025-12-01', endDate: '2026-07-23' });
  assert.equal(result.rows.find((row) => row.customerId === 'c1').paymentRmb, 720);
  assert.equal(result.totalPaymentRmb, 720);
});

test('客户价值矩阵只统计已确认利润，预估利润不进入合计', () => {
  const input = base();
  input.shipmentProfits = [
    { contract_no: 'PO-1', customer_name: '客户甲', material_no: 'M1', product_name: '产品一', specification: '1g', unit: '支', invoice_month: '2026-03', profit: 300, sales_amount_rmb: 1000, is_estimated_profit: false },
    { contract_no: 'PO-1', customer_name: '客户甲', material_no: 'M1', product_name: '产品一', specification: '1g', unit: '支', invoice_month: '2026-04', profit: 999, sales_amount_rmb: 1000, is_estimated_profit: true }
  ];
  const result = buildCustomerValueMatrix(input, { startDate: '2025-12-01', endDate: '2026-07-23' });
  const customer = result.rows.find((row) => row.customerId === 'c1');
  assert.equal(customer.profitRmb, 300);
  assert.equal(customer.grossMargin, 0.3);
});

test('客户价值矩阵使用活跃客户回款与利润中位数划分四象限', () => {
  const input = {
    ...base(),
    customers: [1, 2, 3, 4].map((index) => ({
      id: `c${index}`,
      name: `客户${index}`,
      country: '',
      default_currency: 'RMB'
    })),
    contracts: [1, 2, 3, 4].map((index) => ({
      id: `k${index}`,
      contract_no: `PO-${index}`,
      customer_id: `c${index}`,
      customer_name: `客户${index}`,
      contract_date: '2026-01-10',
      currency: 'RMB'
    })),
    sheets: [],
    paymentReceipts: [10, 20, 30, 100].map((amount, index) => ({
      id: `r${index + 1}`,
      customer_id: `c${index + 1}`,
      payment_date: '2026-02-10',
      total_amount: amount,
      currency: 'RMB'
    })),
    shipmentProfits: [10, 100, 20, 30].map((profit, index) => ({
      contract_no: `PO-${index + 1}`,
      customer_name: `客户${index + 1}`,
      material_no: `M${index + 1}`,
      product_name: `产品${index + 1}`,
      specification: '1g',
      unit: '支',
      invoice_month: '2026-03',
      profit,
      sales_amount_rmb: 200,
      is_estimated_profit: false
    }))
  };

  const result = buildCustomerValueMatrix(input, { startDate: '2025-12-01', endDate: '2026-07-23' });
  assert.equal(result.paymentMedian, 25);
  assert.equal(result.profitMedian, 25);
  assert.equal(result.rows.find((row) => row.customerId === 'c1').quadrant, 'low');
  assert.equal(result.rows.find((row) => row.customerId === 'c2').quadrant, 'potential');
  assert.equal(result.rows.find((row) => row.customerId === 'c3').quadrant, 'scale');
  assert.equal(result.rows.find((row) => row.customerId === 'c4').quadrant, 'core');
});

test('客户产品分析按实际发货聚合数量与销售额，并保留确认利润', () => {
  const input = base();
  input.shipments = [{
    id: 'sh1',
    contract_id: 'k1',
    contract_no: 'PO-1',
    customer_name: '客户甲',
    amount: 1000,
    currency: 'USD',
    shipment_date: '2026-02-15',
    status: '已发货'
  }];
  input.shipmentItems = [{
    id: 'si1',
    shipment_id: 'sh1',
    contact_sheet_id: 's1',
    material_no: 'M1',
    product_name: '产品一',
    specification: '1g',
    unit: '支',
    shipped_quantity: 100,
    unit_price: 10,
    amount: 1000
  }];
  input.shipmentProfits = [{
    contract_no: 'PO-1',
    customer_name: '客户甲',
    material_no: 'M1',
    product_name: '产品一',
    specification: '1g',
    unit: '支',
    invoice_month: '2026-03',
    profit: 1400,
    sales_amount_rmb: 7200,
    is_estimated_profit: false
  }];
  const result = buildCustomerProductAnalysis(input, 'c1', 2026, 'shipment', '2026-07-23');
  assert.equal(result.rows[0].quantity, 100);
  assert.equal(result.rows[0].salesRmb, 7200);
  assert.equal(result.rows[0].profitRmb, 1400);
  assert.equal(result.rows[0].grossMargin, 1400 / 7200);
});

test('客户产品分析忽略规格和单位的大小写及空格差异，但不合并不同物料号', () => {
  const input = base();
  input.shipments = [{
    id: 'sh1',
    contract_id: 'k1',
    contract_no: 'PO-1',
    customer_name: '客户甲',
    amount: 300,
    currency: 'USD',
    shipment_date: '2026-02-15',
    status: '已发货'
  }];
  input.shipmentItems = [
    {
      id: 'si1',
      shipment_id: 'sh1',
      contact_sheet_id: 's1',
      material_no: 'M1',
      product_name: '产品一',
      specification: '4.5g',
      unit: '支',
      shipped_quantity: 100,
      unit_price: 1,
      amount: 100
    },
    {
      id: 'si2',
      shipment_id: 'sh1',
      contact_sheet_id: 's1',
      material_no: ' m1 ',
      product_name: '产品一',
      specification: ' 4.5G ',
      unit: ' 支 ',
      shipped_quantity: 100,
      unit_price: 1,
      amount: 100
    },
    {
      id: 'si3',
      shipment_id: 'sh1',
      contact_sheet_id: 's2',
      material_no: 'M2',
      product_name: '产品一',
      specification: '4.5G',
      unit: '支',
      shipped_quantity: 100,
      unit_price: 1,
      amount: 100
    }
  ];

  const result = buildCustomerProductAnalysis(input, 'c1', 2026, 'shipment', '2026-07-23');

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find((row) => row.materialNo === 'M1').quantity, 200);
  assert.equal(result.rows.find((row) => row.materialNo === 'M1').salesRmb, 1440);
  assert.equal(result.rows.find((row) => row.materialNo === 'M2').quantity, 100);
});
