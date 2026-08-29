import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTACT_SHEET_UNIT_OPTIONS,
  DOSAGE_FORM_OPTIONS,
  PACKAGING_QUANTITY_UNIT_OPTIONS,
  PACKING_METHOD_OPTIONS,
  isAllowedContactSheetUnit,
  normalizeContactSheetUnit
} from '../src/services/formOptions.ts';

test('产品剂型严格使用已确认的八个标准选项', () => {
  assert.deepEqual([...DOSAGE_FORM_OPTIONS], [
    '粉针剂', '水针剂', '片剂', '胶囊剂', '气雾剂', '口服补液盐', '干混悬剂', '软胶囊剂'
  ]);
});

test('联系单单位和包装参数选项不包含历史自由输入项', () => {
  assert.deepEqual([...CONTACT_SHEET_UNIT_OPTIONS], ['支', '盒', '瓶', 'kg', '十亿']);
  assert.deepEqual(PACKAGING_QUANTITY_UNIT_OPTIONS.map((option) => option.label), ['支', '盒', '瓶']);
  assert.deepEqual([...PACKING_METHOD_OPTIONS], ['机装', '非机装']);
  assert.equal(isAllowedContactSheetUnit('袋'), false);
  assert.equal(normalizeContactSheetUnit('KG'), 'kg');
});
