const DOSAGE_UNITS = 'miu|mcg|iu|kg|mg|ug|ml|g|l|u';
const DOSAGE_UNIT_PATTERN = new RegExp(`(^|[^A-Za-z])(${DOSAGE_UNITS})(?=$|[^A-Za-z])`, 'gi');
const NUMBER_UNIT_GAP_PATTERN = new RegExp(`(\\d)\\s+(?=(?:${DOSAGE_UNITS})(?:$|[^A-Za-z]))`, 'gi');
const DECIMAL_BEFORE_UNIT_PATTERN = new RegExp(`(\\d+\\.\\d+)(?=(?:${DOSAGE_UNITS})(?:$|[^A-Za-z]))`, 'gi');

export function normalizeMasterSpecification(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(DOSAGE_UNIT_PATTERN, (_match, prefix: string, unit: string) => `${prefix}${unit.toLowerCase()}`)
    .replace(NUMBER_UNIT_GAP_PATTERN, '$1')
    .replace(DECIMAL_BEFORE_UNIT_PATTERN, (numberText: string) => String(Number(numberText)));
}

export function masterSpecificationKey(value: string): string {
  return normalizeMasterSpecification(value).replace(/\s+/g, '').toLowerCase();
}
