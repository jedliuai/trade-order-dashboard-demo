import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateCurrentReceivables,
  filterCurrentReceivableFacts,
  groupPaymentsByCustomer,
  selectReceivableDashboardContracts,
  summarizeCurrentReceivableRmb,
  summarizeShipmentSettlement,
  summarizeOutstandingContractsRmb
} from '../src/services/receivablesWorkspace.ts';

const contract = {
  id: 'c1', contract_no: 'PO-1', customer_id: 'cu1', customer_name: '客户 A', country: '中国',
  contract_date: '2026-01-01', export_type: '自营', currency: 'USD', status: '执行中'
};

const sheets = [
  { id: 's1', contract_id: 'c1', contact_sheet_no: 'B1', product_name: '产品 A', material_no: 'M1', country: '中国', status: 'shipped' },
  { id: 's2', contract_id: 'c1', contact_sheet_no: 'B2', product_name: '产品 B', material_no: 'M2', country: '中国', status: 'shipped' }
];

const shipments = [
  { id: 'sh1', contract_id: 'c1', shipment_no: 'SH-1', shipment_date: '2026-02-01', amount: 100, status: '已发货' },
  { id: 'sh2', contract_id: 'c1', shipment_no: 'SH-2', shipment_date: '2026-03-01', amount: 100, status: '已发货' },
  { id: 'sh3', contract_id: 'c1', shipment_no: 'SH-3', shipment_date: '2026-04-01', amount: 999, status: '准备中' }
];

const shipmentItems = [
  { id: 'i1', shipment_id: 'sh1', contact_sheet_id: 's1', shipped_quantity: 60, unit_price: 1, amount: 60, product_name: '产品 A', material_no: 'M1' },
  { id: 'i2', shipment_id: 'sh1', contact_sheet_id: 's2', shipped_quantity: 40, unit_price: 1, amount: 40, product_name: '产品 B', material_no: 'M2' },
  { id: 'i3', shipment_id: 'sh2', contact_sheet_id: 's2', shipped_quantity: 100, unit_price: 1, amount: 100, product_name: '产品 B', material_no: 'M2' }
];

test('当前应收排除未发货，合同级回款按先发先抵且同批产品按比例分摊', () => {
  const result = calculateCurrentReceivables({
    contracts: [contract], sheets, shipments, shipmentItems,
    payments: [{ id: 'p1', contract_id: 'c1', payment_date: '2026-01-15', amount: 50, currency: 'USD' }],
    asOfDate: '2026-03-31',
    rateForDate: () => 7
  });

  assert.deepEqual(result.facts.map((row) => [row.shipmentId, row.materialNo, row.outstandingAmount]), [
    ['sh1', 'M1', 30],
    ['sh1', 'M2', 20],
    ['sh2', 'M2', 100]
  ]);
  assert.equal(result.facts.reduce((sum, row) => sum + row.outstandingAmountRmb, 0), 1050);
  assert.equal(result.facts.some((row) => row.shipmentId === 'sh3'), false);
});

test('指定发货收款直接抵扣目标发货，其余合同级款继续按先发先抵', () => {
  const result = calculateCurrentReceivables({
    contracts: [contract], sheets, shipments, shipmentItems,
    payments: [
      { id: 'p1', contract_id: 'c1', shipment_id: 'sh2', payment_date: '2026-03-02', amount: 80, currency: 'USD' },
      { id: 'p2', contract_id: 'c1', payment_date: '2026-03-03', amount: 70, currency: 'USD' }
    ],
    asOfDate: '2026-03-31',
    rateForDate: () => 7
  });

  assert.equal(result.facts.filter((row) => row.shipmentId === 'sh1').reduce((sum, row) => sum + row.outstandingAmount, 0), 30);
  assert.equal(result.facts.filter((row) => row.shipmentId === 'sh2').reduce((sum, row) => sum + row.outstandingAmount, 0), 20);
});

test('发货级收款状态使用先发先抵后的余额而不是合同是否全部收齐', () => {
  const result = calculateCurrentReceivables({
    contracts: [contract], sheets, shipments: [shipments[0]], shipmentItems: shipmentItems.slice(0, 2),
    payments: [{ id: 'p1', contract_id: 'c1', payment_date: '2026-01-15', amount: 100, currency: 'USD' }],
    asOfDate: '2026-03-31',
    rateForDate: () => 7
  });

  assert.deepEqual(summarizeShipmentSettlement(['sh1'], 100, result.facts), {
    shipmentAmount: 100,
    paidAmount: 100,
    outstandingAmount: 0,
    status: '已收全款'
  });
  assert.equal(summarizeShipmentSettlement(['sh1'], 100, [{
    shipmentId: 'sh1', outstandingAmount: 40
  }]).status, '部分收款');
  assert.equal(summarizeShipmentSettlement(['sh1'], 100, [{
    shipmentId: 'sh1', outstandingAmount: 100
  }]).status, '未收款');
});

test('预付款超过已发货金额时应收最低为零并保留预收款余额', () => {
  const result = calculateCurrentReceivables({
    contracts: [contract], sheets, shipments: [shipments[0]], shipmentItems: shipmentItems.slice(0, 2),
    payments: [{ id: 'p1', contract_id: 'c1', payment_date: '2026-01-01', amount: 130, currency: 'USD' }],
    asOfDate: '2026-02-28',
    rateForDate: () => 7
  });

  assert.equal(result.facts.length, 0);
  assert.equal(result.prepaymentByContract.c1, 30);
});

test('美元发货月份缺汇率时保留应收原值并标记缺汇率', () => {
  const result = calculateCurrentReceivables({
    contracts: [contract], sheets, shipments: [shipments[0]], shipmentItems: shipmentItems.slice(0, 2), payments: [],
    asOfDate: '2026-02-28',
    rateForDate: () => null
  });

  assert.equal(result.facts.reduce((sum, row) => sum + row.outstandingAmount, 0), 100);
  assert.equal(result.facts.every((row) => row.outstandingAmountRmb === null && row.missingRate), true);
});

test('回款看板合同范围统一按截止日、客户和执行状态筛选', () => {
  const rows = [
    contract,
    { ...contract, id: 'c2', contract_no: 'PO-2', customer_id: 'cu2', contract_date: '2026-02-01' },
    { ...contract, id: 'c3', contract_no: 'PO-3', contract_date: '2026-08-01' },
    { ...contract, id: 'c4', contract_no: 'PO-4', archived: true }
  ];

  assert.deepEqual(
    selectReceivableDashboardContracts(rows, { customerId: 'all', asOfDate: '2026-07-31' }).map((row) => row.id),
    ['c1', 'c2']
  );
  assert.deepEqual(
    selectReceivableDashboardContracts(rows, { customerId: 'cu1', asOfDate: '2026-07-31' }).map((row) => row.id),
    ['c1']
  );
});

test('执行中合同未收余额逐合同截断为零，超收款不会抵消其他合同欠款', () => {
  const contracts = [
    { ...contract, id: 'c1', contract_no: 'PO-1', currency: 'RMB' },
    { ...contract, id: 'c2', contract_no: 'PO-2', currency: 'RMB' }
  ];
  const summary = summarizeOutstandingContractsRmb({
    contracts,
    sheets: [
      { id: 's1', contract_id: 'c1', quantity: 100, unit_price: 10 },
      { id: 's2', contract_id: 'c2', quantity: 100, unit_price: 10 }
    ],
    payments: [
      { id: 'p1', contract_id: 'c1', payment_date: '2026-03-01', amount: 1200, amount_rmb: 1200, currency: 'RMB' },
      { id: 'p2', contract_id: 'c2', payment_date: '2026-08-01', amount: 900, amount_rmb: 900, currency: 'RMB' }
    ],
    filters: { customerId: 'all', asOfDate: '2026-07-31' },
    rateForDate: () => 1
  });

  assert.equal(summary.totalOutstandingRmb, 1000);
});

test('已发货未收事实支持共同合同范围和关键字筛选并汇总缺汇率', () => {
  const facts = [
    { contractId: 'c1', contractNo: 'PO-1', customerName: '客户 A', shipmentNo: 'SH-1', contactSheetNo: 'B1', productName: '产品 A', materialNo: 'M1', outstandingAmountRmb: 700 },
    { contractId: 'c2', contractNo: 'PO-2', customerName: '客户 B', shipmentNo: 'SH-2', contactSheetNo: 'B2', productName: '产品 B', materialNo: 'M2', outstandingAmountRmb: null }
  ];
  const filtered = filterCurrentReceivableFacts(facts, ['c1', 'c2'], 'm2');
  assert.deepEqual(filtered.map((row) => row.contractId), ['c2']);
  assert.deepEqual(summarizeCurrentReceivableRmb(filtered), { totalRmb: 0, missingRateCount: 1 });
});

test('客户分组对美元客户同时汇总美元原币和人民币折合金额', () => {
  const groups = groupPaymentsByCustomer([
    { id: 'p1', customer_name: '美元客户', currency: 'USD', amount: 100, amount_rmb: 680 },
    { id: 'p2', customer_name: '美元客户', currency: 'USD', amount: 50, amount_rmb: 345 },
    { id: 'p3', customer_name: '人民币客户', currency: 'RMB', amount: 200, amount_rmb: 200 }
  ]);

  assert.deepEqual(groups.map((group) => ({
    customerName: group.customerName,
    totalAmountUsd: group.totalAmountUsd,
    totalAmountRmb: group.totalAmountRmb,
    hasUsdPayments: group.hasUsdPayments
  })), [
    { customerName: '美元客户', totalAmountUsd: 150, totalAmountRmb: 1025, hasUsdPayments: true },
    { customerName: '人民币客户', totalAmountUsd: 0, totalAmountRmb: 200, hasUsdPayments: false }
  ]);
});
