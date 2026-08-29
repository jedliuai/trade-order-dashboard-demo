import assert from 'node:assert/strict';
import test from 'node:test';

import { sortCustomersForDisplay } from '../src/services/customerOrderingSort.ts';

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
