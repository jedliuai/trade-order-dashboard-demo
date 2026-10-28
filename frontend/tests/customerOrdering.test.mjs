import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sortContractsByCustomerAndContractNumber,
  sortContractsByCustomerOrder,
  sortCustomersForDisplay
} from '../src/services/customerOrderingSort.ts';

const customers = [
  { id: 'c2', name: 'Bravo' },
  { id: 'c1', name: 'Alpha' },
  { id: 'c3', name: 'Charlie' }
];

test('manual customer order only changes display order and keeps original objects intact', () => {
  const sorted = sortCustomersForDisplay(customers, ['c3', 'c1']);
  assert.deepEqual(sorted.map((customer) => customer.id), ['c3', 'c1', 'c2']);
  assert.deepEqual(customers.map((customer) => customer.id), ['c2', 'c1', 'c3']);
});

test('customers outside the manual order fall back to name order', () => {
  const sorted = sortCustomersForDisplay(customers, []);
  assert.deepEqual(sorted.map((customer) => customer.id), ['c1', 'c2', 'c3']);
});

test('contracts follow customer display order and newest contract date within each customer', () => {
  const contracts = [
    { id: 'c1-old', customer_id: 'c1', contract_date: '2026-01-10', created_at: '2026-02-01T08:00:00Z', contract_no: 'PO-10' },
    { id: 'c2-new', customer_id: 'c2', contract_date: '2026-08-01', created_at: '2026-08-01T08:00:00Z', contract_no: 'PO-20' },
    { id: 'c1-new', customer_id: 'c1', contract_date: '2026-09-01', created_at: '2026-01-01T08:00:00Z', contract_no: 'PO-11' },
    { id: 'c3-new', customer_id: 'c3', contract_date: '2026-07-01', created_at: '2026-07-01T08:00:00Z', contract_no: 'PO-30' }
  ];

  const sorted = sortContractsByCustomerOrder(contracts, ['c3', 'c1', 'c2']);

  assert.deepEqual(sorted.map((contract) => contract.id), ['c3-new', 'c1-new', 'c1-old', 'c2-new']);
  assert.deepEqual(contracts.map((contract) => contract.id), ['c1-old', 'c2-new', 'c1-new', 'c3-new']);
});

test('contracts with the same contract date use newest creation time and then contract number', () => {
  const contracts = [
    { id: 'later-no', customer_id: 'c1', contract_date: '2026-09-01', created_at: '2026-09-01T08:00:00Z', contract_no: 'PO-11' },
    { id: 'newest', customer_id: 'c1', contract_date: '2026-09-01', created_at: '2026-09-02T08:00:00Z', contract_no: 'PO-20' },
    { id: 'earlier-no', customer_id: 'c1', contract_date: '2026-09-01', created_at: '2026-09-01T08:00:00Z', contract_no: 'PO-2' }
  ];

  const sorted = sortContractsByCustomerOrder(contracts, ['c1']);

  assert.deepEqual(sorted.map((contract) => contract.id), ['newest', 'earlier-no', 'later-no']);
});

test('contract management keeps the manual customer order and sorts each group by natural contract number descending', () => {
  const contracts = [
    { id: 'c1-9', customer_id: 'c1', contract_no: 'RY-CL-OP9' },
    { id: 'c2-20', customer_id: 'c2', contract_no: 'PO20' },
    { id: 'c1-10', customer_id: 'c1', contract_no: 'RY-CL-OP10' },
    { id: 'c2-3', customer_id: 'c2', contract_no: 'PO3' }
  ];

  const sorted = sortContractsByCustomerAndContractNumber(contracts, ['c2', 'c1']);

  assert.deepEqual(sorted.map((contract) => contract.id), ['c2-20', 'c2-3', 'c1-10', 'c1-9']);
  assert.deepEqual(contracts.map((contract) => contract.id), ['c1-9', 'c2-20', 'c1-10', 'c2-3']);
});

test('contract management compares the complete contract number rather than only its trailing digits', () => {
  const contracts = [
    { id: 'numeric-prefix', customer_id: 'c1', contract_no: '2026062601' },
    { id: 'letter-prefix', customer_id: 'c1', contract_no: 'RYHS260801' }
  ];

  const sorted = sortContractsByCustomerAndContractNumber(contracts, ['c1']);

  assert.deepEqual(sorted.map((contract) => contract.id), ['letter-prefix', 'numeric-prefix']);
});
