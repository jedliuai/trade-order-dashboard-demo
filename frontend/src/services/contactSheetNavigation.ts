export type ContactSheetNavigationTarget = {
  contactSheetId: string;
  contractId: string;
  contractNo: string;
};

const contactSheetNumberCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
});

export function sortContactSheetsByNumber<T extends { contact_sheet_no?: string | null }>(sheets: T[]): T[] {
  return [...sheets].sort((left, right) => {
    const leftNo = left.contact_sheet_no?.trim() || '';
    const rightNo = right.contact_sheet_no?.trim() || '';

    if (!leftNo && rightNo) return 1;
    if (leftNo && !rightNo) return -1;
    return contactSheetNumberCollator.compare(leftNo, rightNo);
  });
}

export function resolveContactSheetNavigationTarget<T extends { id: string; contract_id: string }>(
  sheets: T[],
  target: ContactSheetNavigationTarget | null
): T | null {
  if (!target?.contactSheetId || !target.contractId) return null;
  return sheets.find(
    (sheet) => sheet.id === target.contactSheetId && sheet.contract_id === target.contractId
  ) || null;
}
