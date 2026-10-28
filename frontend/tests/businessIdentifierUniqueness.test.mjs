import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dataStoreSource = readFileSync(new URL('../src/services/dataStore.ts', import.meta.url), 'utf8');
const contactsSource = readFileSync(new URL('../src/pages/ContactSheets.tsx', import.meta.url), 'utf8');
const contractsSource = readFileSync(new URL('../src/pages/Contracts.tsx', import.meta.url), 'utf8');
test('跨账号的合同和批号冲突检查保留本地入口', () => {
  assert.match(contractsSource, /getGlobalContractNumberConflict/);
  assert.match(contactsSource, /getGlobalBatchNumberConflicts/);
  assert.doesNotMatch(contactsSource, /is_special_duplicate|duplicate_reason/);
  assert.match(dataStoreSource, /localRest<BusinessIdentifierConflict/);
});
