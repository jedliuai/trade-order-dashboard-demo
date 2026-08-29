export type PackagingOuterDimensionField =
  | 'carton_outer_length_mm'
  | 'carton_outer_width_mm'
  | 'carton_outer_height_mm';

export type PackagingDimensionErrors = Partial<Record<PackagingOuterDimensionField, string>>;

interface PackagingDimensions {
  carton_inner_length_mm?: number | null;
  carton_inner_width_mm?: number | null;
  carton_inner_height_mm?: number | null;
  carton_outer_length_mm?: number | null;
  carton_outer_width_mm?: number | null;
  carton_outer_height_mm?: number | null;
}

const axes = [
  ['长', 'carton_inner_length_mm', 'carton_outer_length_mm'],
  ['宽', 'carton_inner_width_mm', 'carton_outer_width_mm'],
  ['高', 'carton_inner_height_mm', 'carton_outer_height_mm']
] as const;

export function validatePackagingOuterDimensions(draft: PackagingDimensions): PackagingDimensionErrors {
  const errors: PackagingDimensionErrors = {};
  axes.forEach(([label, innerField, outerField]) => {
    const inner = draft[innerField];
    const outer = draft[outerField];
    if (inner == null || outer == null || !Number.isFinite(inner) || !Number.isFinite(outer)) return;
    if (outer < inner) {
      errors[outerField] = `外箱外径${label}（${outer} mm）不能小于外箱内径${label}（${inner} mm），请核对这两个数值。`;
    }
  });
  return errors;
}

export function packagingConstraintField(message: string): PackagingOuterDimensionField | null {
  if (message.includes('outer_length_mm_gte_inner_check')) return 'carton_outer_length_mm';
  if (message.includes('outer_width_mm_gte_inner_check')) return 'carton_outer_width_mm';
  if (message.includes('outer_height_mm_gte_inner_check')) return 'carton_outer_height_mm';
  return null;
}
