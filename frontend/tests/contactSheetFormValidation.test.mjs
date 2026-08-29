import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeContactSheetSpecification,
  validateContactSheetForm
} from '../src/services/contactSheetFormValidation.ts';

test('联系单表单把必填错误返回到对应字段', () => {
  assert.deepEqual(validateContactSheetForm({
    businessType: '制剂',
    contractId: '',
    materialNo: ' ',
    productName: '',
    unitPrice: 0,
    quantity: -1,
    unit: ' '
  }), {
    contractId: '请选择下拉列表中已有的销售合同。',
    materialNo: '请填写物料号。',
    productName: '请填写产品名称。',
    unitPrice: '单价必须大于 0。',
    quantity: '数量必须大于 0。',
    unit: '请填写计量单位。'
  });
});

test('正常新建联系单必须选择正式产品规格，历史兼容可显式放行', () => {
  const base = {
    businessType: '制剂', contractId: 'contract-1', materialNo: 'FF01230', productName: '注射用头孢唑林钠',
    unitPrice: 0.225, quantity: 78000, unit: '支'
  };
  assert.equal(validateContactSheetForm({ ...base, requiresProductVariant: true }).productVariantId, '请从产品主数据中选择已有的产品规格。');
  assert.deepEqual(validateContactSheetForm({ ...base, requiresProductVariant: false }), {});
});

test('联系单表单接受去除首尾空格后有效的数据', () => {
  assert.deepEqual(validateContactSheetForm({
    businessType: '制剂',
    contractId: 'contract-1',
    materialNo: ' FF01230 ',
    productName: ' 注射用头孢唑林钠 ',
    unitPrice: 0.225,
    quantity: 78000,
    unit: ' 支 '
  }), {});
});

test('人民币制剂联系单必须维护每箱装量以支持收货确认函', () => {
  const base = {
    businessType: '制剂',
    contractId: 'contract-rmb',
    materialNo: 'FF01230',
    productName: '注射用头孢唑林钠',
    unitPrice: 2.12,
    quantity: 100000,
    unit: '支',
    requiresPcsPerCarton: true
  };

  assert.equal(
    validateContactSheetForm({ ...base, pcsPerCarton: null }).pcsPerCarton,
    '所选包装模板必须包含大于 0 的每箱装量，请先到包装主数据补全。'
  );
  assert.deepEqual(validateContactSheetForm({ ...base, pcsPerCarton: 1000 }), {});
});

test('联系单计量单位只接受支、盒、瓶、kg和十亿', () => {
  const base = {
    businessType: '原料药',
    contractId: 'contract-1',
    materialNo: 'S20032',
    productName: '头孢曲松钠',
    unitPrice: 730,
    quantity: 500,
  };

  assert.deepEqual(validateContactSheetForm({ ...base, unit: '支' }), {});
  assert.deepEqual(validateContactSheetForm({ ...base, unit: 'KG' }), {});
  assert.deepEqual(validateContactSheetForm({ ...base, unit: '十亿' }), {});
  assert.equal(validateContactSheetForm({ ...base, unit: '袋' }).unit, '计量单位只能选择支、盒、瓶、kg或十亿。');
  assert.equal(validateContactSheetForm({ ...base, unit: '片' }).unit, '计量单位只能选择支、盒、瓶、kg或十亿。');
});

test('联系单规格保存时移除多余空格并把英文计量单位统一为小写', () => {
  assert.equal(normalizeContactSheetSpecification('  4.5 G  '), '4.5g');
  assert.equal(normalizeContactSheetSpecification('40MG / 10 ML'), '40mg / 10ml');
  assert.equal(normalizeContactSheetSpecification('1 Ｇ + 500 MG'), '1g + 500mg');
  assert.equal(normalizeContactSheetSpecification('USP 4.5G'), 'USP 4.5g');
  assert.equal(normalizeContactSheetSpecification('BP'), 'BP');
});
