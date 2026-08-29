export type ContactSheetStage = {
  label: string;
  tone: 'success' | 'progress' | 'warning' | 'danger' | 'neutral';
};

type ContactSheetStageInput = {
  business_type?: '制剂' | '原料药';
  is_historical?: boolean;
  contact_sheet_no?: string | null;
  quantity: number;
  shipped_quantity?: number | null;
  qa_approval_date?: string | null;
  aps_scheduled_date?: string | null;
  actual_warehousing_date?: string | null;
  actual_release_date?: string | null;
};

export function resolveContactSheetStage(sheet: ContactSheetStageInput): ContactSheetStage {
  const shippedQuantity = sheet.shipped_quantity || 0;
  if (sheet.quantity > 0 && shippedQuantity >= sheet.quantity) return { label: '已全部发货', tone: 'success' };
  if (shippedQuantity > 0) return { label: '部分发货', tone: 'warning' };
  if (sheet.business_type === '原料药' || sheet.is_historical) return { label: '可安排发货', tone: 'progress' };
  if (sheet.actual_release_date) return { label: '已放行，可发货', tone: 'success' };
  if (sheet.actual_warehousing_date) return { label: '已入库，待放行', tone: 'warning' };
  if (sheet.aps_scheduled_date) return { label: '已排产，待入库', tone: 'progress' };
  if (sheet.qa_approval_date) return { label: '待 排产', tone: 'warning' };
  if (sheet.contact_sheet_no) return { label: '待 QA 审核', tone: 'warning' };
  return { label: '待填写联系单号', tone: 'danger' };
}
