export interface MaterialNumberRow {
  id?: string;
  material_no?: string | null;
  contact_sheet_no?: string | null;
  product_name?: string | null;
}

export function isMaterialNumberRequiredAtEntry(businessType: string): boolean {
  return businessType === '原料药';
}

export function findMissingMaterialNumberRows<T extends MaterialNumberRow>(rows: readonly T[]): T[] {
  return rows.filter((row) => !String(row.material_no || '').trim());
}

export function findMissingMaterialNumberSheets<T extends MaterialNumberRow>(
  sheets: readonly T[],
  contactSheetIds: Iterable<string>
): T[] {
  const requestedIds = new Set(contactSheetIds);
  return findMissingMaterialNumberRows(sheets.filter((sheet) => sheet.id && requestedIds.has(sheet.id)));
}

export function summarizeMissingMaterialNumbers(rows: readonly MaterialNumberRow[], limit = 3): string {
  const labels = Array.from(new Set(rows.map((row) => (
    String(row.contact_sheet_no || '').trim()
    || String(row.product_name || '').trim()
    || '未填写联系单号'
  ))));
  const visible = labels.slice(0, limit).join('、');
  return labels.length > limit ? `${visible} 等 ${labels.length} 条` : visible;
}
