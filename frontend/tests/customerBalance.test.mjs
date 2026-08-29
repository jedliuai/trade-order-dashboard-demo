import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCustomerBalances } from '../src/services/customerBalance.ts';

const customers = [
  { id: 'cu-usd', name: '美元客户', default_currency: 'USD' },
  { id: 'cu-rmb', name: '人民币客户', default_currency: 'RMB' }
];
const contracts = [
  { id: 'c-usd', contract_no: 'PO-USD', customer_id: 'cu-usd', customer_name: '美元客户', currency: 'USD' },
  { id: 'c-rmb', contract_no: 'PO-RMB', customer_id: 'cu-rmb', customer_name: '人民币客户', currency: 'RMB' }
];
const rates = [
  { id: 'r1', effective_month: '2026-07', currency_pair: 'USD/CNY', rate: 6.8 }
];

function calculate(overrides = {}) {
  return calculateCustomerBalances({
    customers,
    contracts,
    shipments: [],
    shipmentItems: [],
    payments: [],
    paymentReceipts: [],
    exchangeRates: rates,
    asOfDate: '2026-07-23',
    ...overrides
  });
}

test('客户余额只使用已发货金额减整笔实际收款', () => {
  const result = calculate({
    shipments: [
      { id: 'sh1', contract_id: 'c-usd', shipment_no: 'SH-1', shipment_date: '2026-07-10', status: '已发货', amount: 100 },
      { id: 'sh2', contract_id: 'c-usd', shipment_no: 'SH-2', shipment_date: '2026-07-11', status: '准备中', amount: 999 }
    ],
    paymentReceipts: [
      { id: 'pr1', customer_id: 'cu-usd', receipt_no: 'R-1', payment_date: '2026-07-01', total_amount: 70, currency: 'USD' }
    ],
    payments: [
      { id: 'p1', receipt_id: 'pr1', contract_id: 'c-usd', payment_date: '2026-07-01', amount: 70, currency: 'USD' }
    ]
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].totalShipment, 100);
  assert.equal(result.rows[0].totalPayment, 70);
  assert.equal(result.rows[0].balance, 30);
  assert.equal(result.rows[0].balanceRmb, 204);
  assert.equal(result.rows[0].status, 'customer_owes');
});

test('组合收款缺少主记录时按 receipt_id 合计一次，不重复计算分摊', () => {
  const result = calculate({
    payments: [
      { id: 'p1', receipt_id: 'missing-receipt', contract_id: 'c-usd', payment_date: '2026-07-01', amount: 30, currency: 'USD' },
      { id: 'p2', receipt_id: 'missing-receipt', contract_id: 'c-usd', payment_date: '2026-07-01', amount: 20, currency: 'USD' }
    ]
  });

  assert.equal(result.rows[0].totalPayment, 50);
  assert.equal(result.rows[0].events.length, 1);
});

test('我方待交货与客户待付款分开汇总，净敞口仅作为参考', () => {
  const result = calculate({
    shipments: [
      { id: 'sh-usd', contract_id: 'c-usd', shipment_no: 'SH-USD', shipment_date: '2026-07-10', status: '已发货', amount: 100 },
      { id: 'sh-rmb', contract_id: 'c-rmb', shipment_no: 'SH-RMB', shipment_date: '2026-07-10', status: '已发货', amount: 100 }
    ],
    paymentReceipts: [
      { id: 'pr-usd', customer_id: 'cu-usd', payment_date: '2026-07-01', total_amount: 50, currency: 'USD' },
      { id: 'pr-rmb', customer_id: 'cu-rmb', payment_date: '2026-07-01', total_amount: 250, currency: 'RMB' }
    ]
  });

  assert.equal(result.customerOwesRmb, 340);
  assert.equal(result.weOweGoodsRmb, 150);
  assert.equal(result.netExposureRmb, 190);
  assert.equal(result.customerOwesCount, 1);
  assert.equal(result.weOweGoodsCount, 1);
});

test('截止日期排除未来发货和未来收款', () => {
  const result = calculate({
    shipments: [
      { id: 'sh1', contract_id: 'c-rmb', shipment_no: 'SH-1', shipment_date: '2026-07-24', status: '已发货', amount: 100 }
    ],
    paymentReceipts: [
      { id: 'pr1', customer_id: 'cu-rmb', payment_date: '2026-07-24', total_amount: 100, currency: 'RMB' }
    ]
  });

  assert.equal(result.rows.length, 0);
});

test('美元缺参考汇率时保留原币余额但不进入人民币汇总', () => {
  const result = calculate({
    shipments: [
      { id: 'sh1', contract_id: 'c-usd', shipment_no: 'SH-1', shipment_date: '2026-07-10', status: '已发货', amount: 100 }
    ],
    exchangeRates: []
  });

  assert.equal(result.rows[0].balance, 100);
  assert.equal(result.rows[0].balanceRmb, null);
  assert.equal(result.missingRateCount, 1);
  assert.equal(result.customerOwesRmb, 0);
});

test('同一客户出现多币种时只报一个异常客户且不污染人民币汇总', () => {
  const result = calculate({
    contracts: [
      ...contracts,
      { id: 'c-usd-rmb', contract_no: 'PO-USD-RMB', customer_id: 'cu-usd', customer_name: '美元客户', currency: 'RMB' }
    ],
    shipments: [
      { id: 'sh-usd', contract_id: 'c-usd', shipment_no: 'SH-USD', shipment_date: '2026-07-10', status: '已发货', amount: 100 },
      { id: 'sh-rmb', contract_id: 'c-usd-rmb', shipment_no: 'SH-RMB', shipment_date: '2026-07-10', status: '已发货', amount: 200 }
    ]
  });

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.every((row) => row.currencyConflict), true);
  assert.equal(result.currencyConflictCount, 1);
  assert.equal(result.customerOwesRmb, 0);
  assert.equal(result.customerOwesCount, 0);
});
