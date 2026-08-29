import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCustomerConcentration
} from '../src/services/customerConcentrationAnalytics.ts';

const range = { startDate: '2025-12-01', endDate: '2026-07-31' };

function baseInput(customerNames = ['甲客户', '乙客户', '丙客户']) {
  return {
    customers: customerNames.map((name, index) => ({
      id: `c${index + 1}`,
      name,
      country: '',
      default_currency: 'RMB'
    })),
    contracts: customerNames.map((name, index) => ({
      id: `k${index + 1}`,
      contract_no: `PO-${index + 1}`,
      customer_id: `c${index + 1}`,
      customer_name: name,
      contract_date: '2026-01-10',
      currency: 'RMB'
    })),
    sheets: [],
    payments: [],
    paymentReceipts: [],
    shipments: [],
    shipmentItems: [],
    shipmentProfits: [],
    exchangeRates: []
  };
}

test('N80 取累计贡献达到 80% 的最少客户数，金额相同按中文名稳定排序', () => {
  const input = baseInput();
  input.paymentReceipts = [60, 20, 20].map((amount, index) => ({
    id: `r${index + 1}`,
    customer_id: `c${index + 1}`,
    payment_date: '2026-02-10',
    total_amount: amount,
    currency: 'RMB'
  }));

  const result = buildCustomerConcentration(input, range, 'payment');
  const expectedTiedNames = ['乙客户', '丙客户'].sort((left, right) => left.localeCompare(right, 'zh-CN'));

  assert.equal(result.n80, 2);
  assert.equal(result.top1Share, 0.6);
  assert.equal(result.top3Share, 1);
  assert.equal(result.top5Share, 1);
  assert.deepEqual(result.rows.slice(1).map((row) => row.customerName), expectedTiedNames);
  assert.deepEqual(result.rows.map((row) => row.rank), [1, 2, 3]);
  assert.equal(result.rows[1].cumulativeShare, 0.8);
});

test('利润集中度只以正利润为分母，亏损客户单列且零利润不进入列表', () => {
  const input = baseInput(['盈利客户', '亏损客户', '零利润客户', '预估利润客户']);
  input.shipmentProfits = [
    { contract_no: 'PO-1', customer_name: '盈利客户', invoice_month: '2026-03', profit: 100, sales_amount_rmb: 500, is_estimated_profit: false },
    { contract_no: 'PO-2', customer_name: '亏损客户', invoice_month: '2026-03', profit: -30, sales_amount_rmb: 200, is_estimated_profit: false },
    { contract_no: 'PO-3', customer_name: '零利润客户', invoice_month: '2026-03', profit: 0, sales_amount_rmb: 100, is_estimated_profit: false },
    { contract_no: 'PO-4', customer_name: '预估利润客户', invoice_month: '2026-03', profit: 999, sales_amount_rmb: 100, is_estimated_profit: true }
  ];

  const result = buildCustomerConcentration(input, range, 'profit');

  assert.equal(result.totalAmount, 100);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].customerName, '盈利客户');
  assert.equal(result.rows[0].share, 1);
  assert.equal(result.lossRows.length, 1);
  assert.equal(result.lossRows[0].customerName, '亏损客户');
  assert.equal(result.lossRows[0].amount, -30);
  assert.equal(result.totalLossRmb, -30);
});

test('合同签约和发货不在本期时，本期开票月份的已确认利润仍进入集中度', () => {
  const input = baseInput(['跨期利润客户']);
  input.contracts[0].contract_date = '2025-01-10';
  input.shipmentProfits = [{
    contract_no: 'PO-1',
    customer_name: '跨期利润客户',
    invoice_month: '2026-03',
    profit: 125,
    sales_amount_rmb: 500,
    is_estimated_profit: false
  }];

  const result = buildCustomerConcentration(input, range, 'profit');

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].customerName, '跨期利润客户');
  assert.equal(result.rows[0].profitRmb, 125);
  assert.equal(result.totalAmount, 125);
});

test('回款沿用收款主单汇总，已分摊的付款明细不重复计入', () => {
  const input = baseInput(['主单客户']);
  input.exchangeRates = [{ effective_month: '2026-02', rate: 7.2 }];
  input.paymentReceipts = [{
    id: 'r1',
    customer_id: 'c1',
    payment_date: '2026-02-10',
    total_amount: 100,
    currency: 'USD'
  }];
  input.payments = [
    { id: 'p1', receipt_id: 'r1', contract_id: 'k1', contract_no: 'PO-1', customer_name: '主单客户', payment_date: '2026-02-10', amount: 40, currency: 'USD' },
    { id: 'p2', receipt_id: 'r1', contract_id: 'k1', contract_no: 'PO-1', customer_name: '主单客户', payment_date: '2026-02-10', amount: 60, currency: 'USD' }
  ];

  const result = buildCustomerConcentration(input, range, 'payment');

  assert.equal(result.totalAmount, 720);
  assert.equal(result.rows[0].paymentRmb, 720);
  assert.equal(result.rows[0].amount, 720);
  assert.equal(result.missingPaymentRateCount, 0);
});

test('销售额只取范围内已发货明细金额，使用合同币种并分别返回销售和回款缺汇率数', () => {
  const input = baseInput();
  input.contracts[0].currency = 'USD';
  input.contracts[1].currency = 'USD';
  input.exchangeRates = [{ effective_month: '2026-02', rate: 7.2 }];
  input.shipments = [
    { id: 'sh1', customer_id: 'c1', contract_id: 'k1', contract_no: 'PO-1', customer_name: '甲客户', currency: 'RMB', shipment_date: '2026-02-15', status: '已发货' },
    { id: 'sh2', customer_id: 'c2', contract_id: 'k2', contract_no: 'PO-2', customer_name: '乙客户', currency: 'RMB', shipment_date: '2026-03-15', status: '已发货' },
    { id: 'sh3', customer_id: 'c3', contract_id: 'k3', contract_no: 'PO-3', customer_name: '丙客户', currency: 'RMB', shipment_date: '2026-02-15', status: '准备中' },
    { id: 'sh4', customer_id: 'c3', contract_id: 'k3', contract_no: 'PO-3', customer_name: '丙客户', currency: 'RMB', shipment_date: '2025-11-30', status: '已发货' }
  ];
  input.shipmentItems = [
    { id: 'si1', shipment_id: 'sh1', amount: 100, shipped_quantity: 99, unit_price: 999 },
    { id: 'si2', shipment_id: 'sh2', amount: 50, shipped_quantity: 1, unit_price: 50 },
    { id: 'si3', shipment_id: 'sh3', amount: 999, shipped_quantity: 1, unit_price: 999 },
    { id: 'si4', shipment_id: 'sh4', amount: 888, shipped_quantity: 1, unit_price: 888 }
  ];
  input.paymentReceipts = [{
    id: 'r-missing',
    customer_id: 'c3',
    payment_date: '2026-04-01',
    total_amount: 10,
    currency: 'USD'
  }];

  const result = buildCustomerConcentration(input, range, 'sales');

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].customerName, '甲客户');
  assert.equal(result.rows[0].salesRmb, 720);
  assert.equal(result.totalAmount, 720);
  assert.equal(result.missingSalesRateCount, 1);
  assert.equal(result.missingPaymentRateCount, 1);
});

test('无正贡献客户时占比和 N80 均为零', () => {
  const result = buildCustomerConcentration(baseInput(), range, 'sales');

  assert.deepEqual(result.rows, []);
  assert.equal(result.totalAmount, 0);
  assert.equal(result.top1Share, 0);
  assert.equal(result.top3Share, 0);
  assert.equal(result.top5Share, 0);
  assert.equal(result.n80, 0);
});
