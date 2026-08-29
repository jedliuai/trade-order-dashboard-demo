import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('contact sheets persist a formal product variant independently from material and packaging', async () => {
  const [page, store, validation] = await Promise.all([
    read('../src/pages/ContactSheets.tsx'),
    read('../src/services/dataStore.ts'),
    read('../src/services/contactSheetFormValidation.ts')
  ]);

  assert.match(store, /product_variant_id\?: string \| null/);
  assert.match(store, /product_variant_id: row\.product_variant_id \|\| null/);
  assert.match(page, /product_variant_id: productVariantId \|\| null/);
  assert.match(page, /handleProductVariantChange/);
  assert.match(page, /SearchableCombobox/);
  assert.match(validation, /requiresProductVariant/);
  assert.match(validation, /productVariantId/);
  assert.match(page, /material_no: materialNo/);
  assert.match(page, /packaging_profile_version_id: packagingVersionId \|\| null/);
  assert.match(page, /Boolean\(packagingVersionId\)/);
  assert.match(page, /activeSnapshotCandidates\.length === 1/);
  assert.doesNotMatch(page, /新联系单必须选择一套已确认的包装模板/);
});

// Formal references are verified by the SQLite transaction tests.

test('product analytics prefers the formal variant and only retains snapshot matching as a legacy fallback', async () => {
  const analytics = await read('../src/services/productOperatingAnalytics.ts');
  assert.match(analytics, /productVariantId/);
  assert.match(analytics, /variantById\.get\(details\.productVariantId\)/);
  assert.match(analytics, /variantsBySnapshot/);
  assert.doesNotMatch(analytics, /materialMappingByNo/);
  assert.doesNotMatch(analytics, /packagingMappingById/);
});
