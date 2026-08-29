export const DOSAGE_FORM_OPTIONS = [
  '粉针剂',
  '水针剂',
  '片剂',
  '胶囊剂',
  '气雾剂',
  '口服补液盐',
  '干混悬剂',
  '软胶囊剂'
] as const;

export const CONTACT_SHEET_UNIT_OPTIONS = ['支', '盒', '瓶', 'kg', '十亿'] as const;

export const PACKAGING_QUANTITY_UNIT_OPTIONS = [
  { value: '支/箱', label: '支' },
  { value: '盒/箱', label: '盒' },
  { value: '瓶/箱', label: '瓶' }
] as const;

export const PACKING_METHOD_OPTIONS = ['机装', '非机装'] as const;

export function isAllowedDosageForm(value: string): boolean {
  return DOSAGE_FORM_OPTIONS.includes(value as (typeof DOSAGE_FORM_OPTIONS)[number]);
}

export function normalizeContactSheetUnit(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase() === 'kg' ? 'kg' : trimmed;
}

export function isAllowedContactSheetUnit(value: string): boolean {
  return CONTACT_SHEET_UNIT_OPTIONS.includes(
    normalizeContactSheetUnit(value) as (typeof CONTACT_SHEET_UNIT_OPTIONS)[number]
  );
}

export function isAllowedPackagingQuantityUnit(value: string): boolean {
  return PACKAGING_QUANTITY_UNIT_OPTIONS.some((option) => option.value === value);
}

export function isAllowedPackingMethod(value: string): boolean {
  return PACKING_METHOD_OPTIONS.includes(value as (typeof PACKING_METHOD_OPTIONS)[number]);
}
