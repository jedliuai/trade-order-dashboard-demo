export type ContactSheetWorkspaceInput = {
  id?: string;
  business_type?: '制剂' | '原料药';
  is_historical?: boolean;
  contact_sheet_no?: string | null;
  quantity: number;
  shipped_quantity?: number | null;
  qa_approval_date?: string | null;
  aps_scheduled_date?: string | null;
  actual_warehousing_date?: string | null;
  actual_release_date?: string | null;
  created_at?: string | null;
};

export type ContactSheetCurrentProgress = {
  label: string;
  date: string;
  next: string;
  tone: 'success' | 'progress' | 'warning' | 'danger' | 'neutral';
};

export function isContactSheetHistory(
  sheet: Pick<ContactSheetWorkspaceInput, 'quantity' | 'shipped_quantity'>,
  contractArchived = false
): boolean {
  return contractArchived || (sheet.quantity > 0 && (sheet.shipped_quantity || 0) >= sheet.quantity - 0.0001);
}

export function sortContactSheetsByCreatedAt<T extends { created_at?: string | null; is_historical?: boolean; id?: string }>(
  rows: T[],
  historicalBusinessDate?: (row: T) => string | null | undefined
): T[] {
  return [...rows].sort((left, right) => {
    // 历史数据的一次性导入时间不代表业务录入先后，否则旧业务会长期占据列表顶部。
    const leftSortDate = left.is_historical
      ? historicalBusinessDate?.(left) || left.created_at
      : left.created_at;
    const rightSortDate = right.is_historical
      ? historicalBusinessDate?.(right) || right.created_at
      : right.created_at;
    const byCreatedAt = String(rightSortDate || '').localeCompare(String(leftSortDate || ''));
    if (byCreatedAt !== 0) return byCreatedAt;
    return String(right.id || '').localeCompare(String(left.id || ''));
  });
}

export function resolveContactSheetCurrentProgress(
  sheet: ContactSheetWorkspaceInput,
  latestShipmentDate = ''
): ContactSheetCurrentProgress {
  const shippedQuantity = sheet.shipped_quantity || 0;
  if (sheet.quantity > 0 && shippedQuantity >= sheet.quantity - 0.0001) {
    return { label: '已全部发货', date: latestShipmentDate, next: '后续在发货与开票、收款流水中跟进', tone: 'success' };
  }
  if (shippedQuantity > 0) {
    return { label: '部分发货', date: latestShipmentDate, next: `剩余 ${(sheet.quantity - shippedQuantity).toLocaleString()}`, tone: 'warning' };
  }
  if (sheet.business_type === '原料药' || sheet.is_historical) {
    return { label: '可安排发货', date: '', next: '等待创建发货记录', tone: 'progress' };
  }
  if (sheet.actual_release_date) {
    return { label: '检验已放行', date: sheet.actual_release_date, next: '下一步：安排发货', tone: 'success' };
  }
  if (sheet.actual_warehousing_date) {
    return { label: '生产已入库', date: sheet.actual_warehousing_date, next: '下一步：检验放行', tone: 'warning' };
  }
  if (sheet.aps_scheduled_date) {
    return { label: '已排产', date: sheet.aps_scheduled_date, next: '下一步：生产入库', tone: 'progress' };
  }
  const qaDate = sheet.qa_approval_date || '';
  if (qaDate) {
    return { label: 'QA 已审批', date: qaDate.slice(0, 10), next: '下一步：排产', tone: 'progress' };
  }
  if (sheet.contact_sheet_no) {
    return { label: '等待 QA 审批', date: '', next: '已提起联系单', tone: 'warning' };
  }
  return { label: '待填写联系单号', date: '', next: '先补充联系单号', tone: 'danger' };
}
