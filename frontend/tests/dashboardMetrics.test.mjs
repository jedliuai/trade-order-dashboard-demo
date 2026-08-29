import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDashboardFinancialMetrics, formatDashboardWan } from '../src/services/dashboardMetrics.ts';

test('首页合同与回款全部折算为人民币后统一汇总', () => {
  const result = calculateDashboardFinancialMetrics({
    contracts: [
      { id: 'usd-contract', currency: 'USD', contract_date: '2026-07-01' },
      { id: 'rmb-contract', currency: 'RMB', contract_date: '2026-07-01' }
    ],
    sheets: [
      { contract_id: 'usd-contract', quantity: 100, unit_price: 2 },
      { contract_id: 'rmb-contract', quantity: 100, unit_price: 10 }
    ],
    payments: [
      { currency: 'USD', amount: 50, amount_rmb: 350, payment_date: '2026-07-10' },
      { currency: 'RMB', amount: 800 }
    ],
    shipmentProfits: [],
    exchangeRates: [{ effective_month: '2026-07', rate: 7 }]
  });

  assert.equal(result.totalContractRMB, 2400);
  assert.equal(result.totalPaymentsRMB, 1150);
  assert.equal(result.collectionRateRMB, 1150 / 2400);
  assert.deepEqual(result.missingRateMonths, []);
});

test('缺少美元月份汇率时不伪造人民币金额并明确返回缺失月份', () => {
  const result = calculateDashboardFinancialMetrics({
    contracts: [{ id: 'usd-contract', currency: 'USD', contract_date: '2026-06-01' }],
    sheets: [{ contract_id: 'usd-contract', quantity: 100, unit_price: 2 }],
    payments: [{ currency: 'USD', amount: 50, payment_date: '2026-05-10' }],
    shipmentProfits: [],
    exchangeRates: []
  });

  assert.equal(result.totalContractRMB, 0);
  assert.equal(result.totalPaymentsRMB, 0);
  assert.deepEqual(result.missingRateMonths, ['2026-05', '2026-06']);
});

test('首页万元格式明确使用中文单位', () => {
  assert.equal(formatDashboardWan(126000), '12.6 万');
});

test('首页财年汇总按各自业务发生日期排除财年前数据', () => {
  const result = calculateDashboardFinancialMetrics({
    contracts: [
      { id: 'old', currency: 'RMB', contract_date: '2025-11-30' },
      { id: 'current', currency: 'RMB', contract_date: '2025-12-01' }
    ],
    sheets: [
      { contract_id: 'old', quantity: 1, unit_price: 900 },
      { contract_id: 'current', quantity: 1, unit_price: 100 }
    ],
    payments: [
      { currency: 'RMB', amount: 800, payment_date: '2025-11-30' },
      { currency: 'RMB', amount: 80, payment_date: '2026-01-02' }
    ],
    shipmentProfits: [
      { invoice_month: '2025-11', profit: 700, sales_amount_rmb: 1000 },
      { invoice_month: '2025-12', profit: 20, sales_amount_rmb: 100 }
    ],
    exchangeRates: [],
    startDate: '2025-12-01',
    endDate: '2026-07-17'
  });

  assert.equal(result.totalContractRMB, 100);
  assert.equal(result.totalPaymentsRMB, 80);
  assert.equal(result.totalProfitRMB, 20);
});

test('首页综合毛利率使用 CIF 扣除运保费后的 FOB 利润基数', () => {
  const result = calculateDashboardFinancialMetrics({
    contracts: [],
    sheets: [],
    payments: [],
    shipmentProfits: [
      {
        invoice_month: '2026-07',
        profit: 133,
        sales_amount_rmb: 700,
        profit_basis_amount_rmb: 665
      }
    ],
    exchangeRates: [],
    startDate: '2025-12-01',
    endDate: '2026-07-31'
  });

  assert.equal(result.totalProfitRMB, 133);
  assert.equal(result.grossMargin, 0.2);
});

test('财年进度按实际发货日期折算发货金额并排除未发货记录', () => {
  const result = calculateDashboardFinancialMetrics({
    contracts: [],
    sheets: [],
    payments: [],
    shipments: [
      { status: '已发货', currency: 'USD', amount: 100, shipment_date: '2026-07-20' },
      { status: '已发货', currency: 'RMB', amount: 300, shipment_date: '2026-07-21' },
      { status: '准备中', currency: 'RMB', amount: 900, shipment_date: '2026-07-22' },
      { status: '已发货', currency: 'RMB', amount: 500, shipment_date: '2025-11-30' }
    ],
    shipmentProfits: [],
    exchangeRates: [{ effective_month: '2026-07', rate: 7 }],
    startDate: '2025-12-01',
    endDate: '2026-08-25'
  });

  assert.equal(result.totalShipmentRMB, 1000);
});

test('已确认毛利不包含预估利润', () => {
  const result = calculateDashboardFinancialMetrics({
    contracts: [],
    sheets: [],
    payments: [],
    shipmentProfits: [
      { invoice_month: '2026-07', profit: 80, sales_amount_rmb: 400, is_estimated_profit: false },
      { invoice_month: '2026-08', profit: 50, sales_amount_rmb: 250, is_estimated_profit: true }
    ],
    exchangeRates: [],
    startDate: '2025-12-01',
    endDate: '2026-08-25'
  });

  assert.equal(result.totalProfitRMB, 130);
  assert.equal(result.confirmedProfitRMB, 80);
});
