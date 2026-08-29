import assert from 'node:assert/strict';
import test from 'node:test';
import {
  masterSpecificationKey,
  normalizeMasterSpecification
} from '../src/services/masterSpecification.ts';

test('主数据规格会清理空格、统一单位小写并移除无意义小数零', () => {
  assert.equal(normalizeMasterSpecification(' 1.0 G '), '1g');
  assert.equal(normalizeMasterSpecification('0.50 G'), '0.5g');
  assert.equal(normalizeMasterSpecification('40 MG / 10 ML'), '40mg / 10ml');
  assert.equal(normalizeMasterSpecification('USP 4.5G'), 'USP 4.5g');
});

test('等价规格生成相同去重键', () => {
  assert.equal(masterSpecificationKey('1G'), masterSpecificationKey('1.0g'));
  assert.equal(masterSpecificationKey(' 40 MG / 10 ML '), masterSpecificationKey('40mg/10ml'));
});
