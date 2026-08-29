import assert from 'node:assert/strict';
import test from 'node:test';
import {
  packagingConstraintField,
  validatePackagingOuterDimensions
} from '../src/services/packagingValidation.ts';

test('外箱外径长宽高均不小于内径时允许保存', () => {
  assert.deepEqual(validatePackagingOuterDimensions({
    carton_inner_length_mm: 624,
    carton_inner_width_mm: 333,
    carton_inner_height_mm: 334,
    carton_outer_length_mm: 640,
    carton_outer_width_mm: 340,
    carton_outer_height_mm: 350
  }), {});
});

test('外箱外径高度小于内径时返回包含实际数值的中文错误', () => {
  const errors = validatePackagingOuterDimensions({
    carton_inner_height_mm: 350,
    carton_outer_height_mm: 330
  });
  assert.equal(
    errors.carton_outer_height_mm,
    '外箱外径高（330 mm）不能小于外箱内径高（350 mm），请核对这两个数值。'
  );
});

test('尺寸未完整时不误报外径关系错误', () => {
  assert.deepEqual(validatePackagingOuterDimensions({
    carton_inner_height_mm: 350,
    carton_outer_height_mm: null
  }), {});
});

test('数据库约束名可以映射回具体外径输入框', () => {
  assert.equal(
    packagingConstraintField('packaging_profile_versions_outer_height_mm_gte_inner_check'),
    'carton_outer_height_mm'
  );
  assert.equal(packagingConstraintField('some_other_error'), null);
});
