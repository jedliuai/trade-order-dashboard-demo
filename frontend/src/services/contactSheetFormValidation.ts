import { isAllowedContactSheetUnit } from './formOptions.ts';

export interface ContactSheetFormDraft {
  businessType: '制剂' | '原料药';
  contractId: string;
  materialNo: string;
  productVariantId?: string;
  requiresProductVariant?: boolean;
  productName: string;
  unitPrice: number;
  quantity: number;
  unit: string;
  pcsPerCarton?: number | null;
  requiresPcsPerCarton?: boolean;
}

export type ContactSheetFormField = Exclude<keyof ContactSheetFormDraft, 'requiresPcsPerCarton' | 'requiresProductVariant'>;
export type ContactSheetFormErrors = Partial<Record<ContactSheetFormField, string>>;

const DOSAGE_UNIT_PATTERN = /(^|[^A-Za-z])((?:miu|mcg|iu|kg|mg|ug|ml|g|l|u))(?=$|[^A-Za-z])/gi;
const NUMBER_UNIT_GAP_PATTERN = /(\d)\s+(?=(?:miu|mcg|iu|kg|mg|ug|ml|g|l|u)(?:$|[^A-Za-z]))/gi;

export function normalizeContactSheetSpecification(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(DOSAGE_UNIT_PATTERN, (_match, prefix: string, unit: string) => `${prefix}${unit.toLowerCase()}`)
    .replace(NUMBER_UNIT_GAP_PATTERN, '$1');
}

export function validateContactSheetForm(draft: ContactSheetFormDraft): ContactSheetFormErrors {
  const errors: ContactSheetFormErrors = {};

  if (!draft.contractId) {
    errors.contractId = '请选择下拉列表中已有的销售合同。';
  }
  if (!draft.materialNo.trim()) {
    errors.materialNo = '请填写物料号。';
  }
  if (draft.requiresProductVariant === true && !draft.productVariantId) {
    errors.productVariantId = '请从产品主数据中选择已有的产品规格。';
  }
  if (!draft.productName.trim()) {
    errors.productName = '请填写产品名称。';
  }
  if (!Number.isFinite(draft.unitPrice) || draft.unitPrice <= 0) {
    errors.unitPrice = '单价必须大于 0。';
  }
  if (!Number.isFinite(draft.quantity) || draft.quantity <= 0) {
    errors.quantity = '数量必须大于 0。';
  }
  if (!draft.unit.trim()) {
    errors.unit = '请填写计量单位。';
  } else if (!isAllowedContactSheetUnit(draft.unit)) {
    errors.unit = '计量单位只能选择支、盒、瓶、kg或十亿。';
  }
  if (
    draft.requiresPcsPerCarton
    && (!Number.isFinite(draft.pcsPerCarton) || Number(draft.pcsPerCarton) <= 0)
  ) {
    errors.pcsPerCarton = '所选包装模板必须包含大于 0 的每箱装量，请先到包装主数据补全。';
  }

  return errors;
}
