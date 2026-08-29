import assert from 'node:assert/strict';
import test from 'node:test';

import {
  balanceLastPaymentAllocation,
  createCustomerDepositLedgerRow,
  getContractOutstandingAmount,
  getDatedInvoiceCoverage,
  getReceivableContracts,
  isShipmentFullyInvoiced,
  normalizeMoneyAmount,
  resolveShipmentPaymentDisplayStatus,
  sortPaymentLedger,
  summarizePaymentAllocations,
  updatePaymentAllocationWithAutoRemainder
} from '../src/services/financialRules.ts';

const invoices = [
  {
    invoice_date: '2026-04-15',
    shipment_allocations: [
      { shipment_id: 'shipment-a', allocated_amount: 700 },
      { shipment_id: 'shipment-b', allocated_amount: 300 }
    ]
  },
  {
    invoice_date: '',
    shipment_allocations: [{ shipment_id: 'shipment-a', allocated_amount: 500 }]
  }
];

test('只有填写开票日期的发票分摊才形成开票金额', () => {
  assert.equal(getDatedInvoiceCoverage('shipment-a', invoices), 700);
  assert.equal(isShipmentFullyInvoiced('shipment-a', 700, invoices), true);
  assert.equal(isShipmentFullyInvoiced('shipment-a', 701, invoices), false);
});

test('发货后补齐关联收款时最终状态覆盖发货前风控结果', () => {
  assert.equal(resolveShipmentPaymentDisplayStatus(121200, 121200, '不建议发货'), '已收全款');
  assert.equal(resolveShipmentPaymentDisplayStatus(121200, 60000, '不建议发货'), '部分收款');
  assert.equal(resolveShipmentPaymentDisplayStatus(121200, 0, '不建议发货'), '不建议发货');
});

const contracts = [
  { id: 'unpaid', customer_id: 'customer-a', archived: false },
  { id: 'paid', customer_id: 'customer-a', archived: false },
  { id: 'archived', customer_id: 'customer-a', archived: true },
  { id: 'other-customer', customer_id: 'customer-b', archived: false }
];
const contactSheets = contracts.map((contract) => ({
  contract_id: contract.id,
  quantity: 100,
  unit_price: 2
}));
const payments = [
  { contract_id: 'unpaid', amount: 80 },
  { contract_id: 'paid', amount: 200 },
  { contract_id: 'archived', amount: 0 }
];

test('新建收款只显示未归档且仍有未收余额的合同', () => {
  assert.equal(getContractOutstandingAmount('unpaid', contactSheets, payments), 120);
  assert.deepEqual(
    getReceivableContracts('customer-a', contracts, contactSheets, payments).map((contract) => contract.id),
    ['unpaid']
  );
});

test('编辑历史收款时保留原有关联合同以便修改', () => {
  assert.deepEqual(
    getReceivableContracts('customer-a', contracts, contactSheets, payments, ['paid', 'archived']).map((contract) => contract.id),
    ['unpaid', 'paid', 'archived']
  );
});

test('收款分摊固定显示到账、已分摊和待分摊金额', () => {
  assert.deepEqual(summarizePaymentAllocations(1000, [{ amount: 300 }, { amount: 500 }]), {
    allocated: 800,
    unallocated: 200,
    isBalanced: false
  });
  assert.equal(summarizePaymentAllocations(1000, [{ amount: 600 }, { amount: 400 }]).isBalanced, true);
  assert.equal(summarizePaymentAllocations(1000, [{ amount: 1100 }]).unallocated, -100);
});

test('收款金额按数据库四位精度消除浮点残差', () => {
  assert.equal(normalizeMoneyAmount(126111.272 - 1e-10), 126111.272);
  assert.deepEqual(summarizePaymentAllocations(126111.272, [{ amount: 126111.272 }]), {
    allocated: 126111.272,
    unallocated: 0,
    isBalanced: true
  });
});

test('新增收款只有一个合同时自动填满实际到账总额', () => {
  assert.deepEqual(
    balanceLastPaymentAllocation(126111.272, [{ contract_id: 'a', amount: 0 }]),
    [{ contract_id: 'a', amount: 126111.272 }]
  );
});

test('多个合同时修改前一笔会自动把剩余金额补到最后一笔', () => {
  const allocations = [
    { contract_id: 'a', amount: 1000 },
    { contract_id: 'b', amount: 0 }
  ];
  assert.deepEqual(
    updatePaymentAllocationWithAutoRemainder(1000, allocations, 0, 320),
    [
      { contract_id: 'a', amount: 320 },
      { contract_id: 'b', amount: 680 }
    ]
  );
});

test('三个合同时保留前两笔手工分摊并只自动补最后一笔', () => {
  const allocations = [
    { contract_id: 'a', amount: 300 },
    { contract_id: 'b', amount: 200 },
    { contract_id: 'c', amount: 0 }
  ];
  assert.deepEqual(balanceLastPaymentAllocation(1000, allocations).map((row) => row.amount), [300, 200, 500]);
  assert.deepEqual(updatePaymentAllocationWithAutoRemainder(1000, allocations, 1, 450).map((row) => row.amount), [300, 450, 250]);
});

test('收款流水按到账日期由晚到早且不修改原数组', () => {
  const rows = [
    { id: '1', payment_date: '2026-06-01' },
    { id: '2', payment_date: '2026-07-20' },
    { id: '3', payment_date: '2026-07-20' }
  ];
  assert.deepEqual(sortPaymentLedger(rows).map((row) => row.id), ['3', '2', '1']);
  assert.deepEqual(rows.map((row) => row.id), ['1', '2', '3']);
});

test('客户预存款转换为没有合同号的普通流水并保留原币与人民币金额', () => {
  const row = createCustomerDepositLedgerRow({
    id: 'receipt-1',
    customer_id: 'customer-1',
    customer_name: '测试客户',
    receipt_no: 'BANK-001',
    payment_date: '2026-07-27',
    deposit_amount: 1000,
    currency: 'USD',
    exchange_rate: 6.8,
    notes: '',
    created_at: '2026-07-27T10:00:00Z'
  });
  assert.equal(row.payment_type, '客户预存款');
  assert.equal(row.contract_no, '');
  assert.equal(row.amount, 1000);
  assert.equal(row.amount_rmb, 6800);
  assert.equal(row.is_customer_deposit, true);
});
