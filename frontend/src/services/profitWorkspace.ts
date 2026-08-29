export type ProfitStatusFilter = 'all' | 'confirmed' | 'pending';

export interface ProfitWorkspaceRow {
  shipment_no: string;
  contract_no: string;
  contact_sheet_no?: string;
  customer_name: string;
  product_name: string;
  material_no: string;
  invoice_month: string;
  export_type: string;
  currency: string;
  exchangeRate: number | null;
  costNoTax: number | null;
  salesRmb: number | null;
  profitBasisRmb?: number | null;
  profit: number | null;
  isEstimate: boolean;
}

export interface ProfitWorkspaceFilters {
  query?: string;
  month?: string;
  startMonth?: string;
  endMonth?: string;
  dateFrom?: string;
  dateTo?: string;
  customer?: string;
  contract?: string;
  contactSheet?: string;
  exportType?: string;
  status?: ProfitStatusFilter;
}

export interface ContactSheetProfitSummary {
  id: string;
  contract_no: string;
  contact_sheet_no: string;
  customer_name: string;
  material_no: string;
  product_name: string;
  quantity: number;
  unit: string;
  shipmentCount: number;
  invoiceMonthStart: string;
  invoiceMonthEnd: string;
  salesRmb: number | null;
  profitBasisRmb?: number | null;
  profit: number | null;
  margin: number | null;
  pendingCount: number;
}

export interface CustomerProfitSummary {
  customer_name: string;
  contactSheetCount: number;
  confirmedContactSheetCount: number;
  pendingContactSheetCount: number;
  salesRmb: number;
  confirmedSalesRmb: number;
  confirmedProfitBasisRmb?: number;
  profitRmb: number;
  margin: number | null;
  contactSheets: ContactSheetProfitSummary[];
}

export interface CustomerShipmentProfitSummary<T extends ProfitWorkspaceRow = ProfitWorkspaceRow> {
  customer_name: string;
  shipmentCount: number;
  detailCount: number;
  confirmedDetailCount: number;
  pendingDetailCount: number;
  salesRmb: number;
  confirmedProfitBasisRmb: number;
  profitRmb: number;
  margin: number | null;
  shipments: T[];
}

export function resolveProfitStatus(row: ProfitWorkspaceRow): Exclude<ProfitStatusFilter, 'all'> {
  if (row.profit === null || row.isEstimate) return 'pending';
  return 'confirmed';
}

export function filterProfitWorkspace<T extends ProfitWorkspaceRow>(rows: T[], filters: ProfitWorkspaceFilters): T[] {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filters.month && filters.month !== 'all' && filters.month !== 'fiscal' && row.invoice_month !== filters.month) return false;
    if (filters.month === 'fiscal' && filters.startMonth && row.invoice_month < filters.startMonth) return false;
    if (filters.month === 'fiscal' && filters.endMonth && row.invoice_month > filters.endMonth) return false;
    if (filters.dateFrom && row.invoice_month < filters.dateFrom.slice(0, 7)) return false;
    if (filters.dateTo && row.invoice_month > filters.dateTo.slice(0, 7)) return false;
    if (filters.customer && filters.customer !== 'all' && row.customer_name !== filters.customer) return false;
    if (filters.contract && filters.contract !== 'all' && row.contract_no !== filters.contract) return false;
    if (filters.contactSheet && filters.contactSheet !== 'all' && row.contact_sheet_no !== filters.contactSheet) return false;
    if (filters.exportType && filters.exportType !== 'all' && row.export_type !== filters.exportType) return false;
    if (filters.status && filters.status !== 'all' && resolveProfitStatus(row) !== filters.status) return false;
    if (!query) return true;
    return [row.shipment_no, row.contract_no, row.contact_sheet_no, row.product_name, row.customer_name, row.material_no]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  }).sort((left, right) => {
    const monthDiff = right.invoice_month.localeCompare(left.invoice_month);
    return monthDiff || right.shipment_no.localeCompare(left.shipment_no, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

export function summarizeProfitWorkspace(rows: ProfitWorkspaceRow[]) {
  return rows.reduce((summary, row) => {
    if (row.salesRmb !== null) summary.totalSalesRmb += row.salesRmb;
    if (row.profit === null || row.isEstimate) {
      summary.pendingCount += 1;
      if (row.currency === 'USD' && row.exchangeRate === null) summary.missingRateCount += 1;
      if (row.costNoTax === null) summary.missingCostCount += 1;
      if (row.isEstimate) summary.estimatedCostCount += 1;
      return summary;
    }
    summary.confirmedProfitRmb += row.profit;
    if (row.salesRmb !== null) summary.confirmedSalesRmb += row.salesRmb;
    const profitBasisRmb = row.profitBasisRmb ?? row.salesRmb;
    if (profitBasisRmb !== null) summary.confirmedProfitBasisRmb += profitBasisRmb;
    summary.confirmedCount += 1;
    return summary;
  }, {
    totalSalesRmb: 0,
    confirmedProfitRmb: 0,
    confirmedSalesRmb: 0,
    confirmedProfitBasisRmb: 0,
    confirmedCount: 0,
    pendingCount: 0,
    missingRateCount: 0,
    missingCostCount: 0,
    estimatedCostCount: 0
  });
}

export function listProfitFilterOptions(rows: ProfitWorkspaceRow[]) {
  return {
    months: Array.from(new Set(rows.map((row) => row.invoice_month).filter(Boolean))).sort().reverse(),
    customers: Array.from(new Set(rows.map((row) => row.customer_name).filter(Boolean))).sort(),
    contracts: Array.from(new Set(rows.map((row) => row.contract_no).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })),
    contactSheets: Array.from(new Set(rows.map((row) => row.contact_sheet_no).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
  };
}

export function summarizeProfitByContactSheet<T extends ProfitWorkspaceRow & { quantity?: number; unit?: string }>(rows: T[]): ContactSheetProfitSummary[] {
  const groups = new Map<string, {
    contract_no: string;
    contact_sheet_no: string;
    customer_name: string;
    material_no: string;
    product_name: string;
    quantity: number;
    unit: string;
    shipmentNos: Set<string>;
    invoiceMonths: string[];
    salesRmb: number;
    salesCount: number;
    profitBasisRmb: number;
    profitBasisCount: number;
    profit: number;
    pendingCount: number;
  }>();

  rows.forEach((row) => {
    const contactSheetNo = row.contact_sheet_no || '未填写联系单号';
    const key = `${row.contract_no}\u0000${contactSheetNo}\u0000${row.material_no}`;
    const group = groups.get(key) || {
      contract_no: row.contract_no,
      contact_sheet_no: contactSheetNo,
      customer_name: row.customer_name,
      material_no: row.material_no,
      product_name: row.product_name,
      quantity: 0,
      unit: row.unit || '',
      shipmentNos: new Set<string>(),
      invoiceMonths: [],
      salesRmb: 0,
      salesCount: 0,
      profitBasisRmb: 0,
      profitBasisCount: 0,
      profit: 0,
      pendingCount: 0
    };
    group.quantity += Number(row.quantity || 0);
    group.shipmentNos.add(row.shipment_no);
    if (row.invoice_month) group.invoiceMonths.push(row.invoice_month);
    if (row.salesRmb !== null) {
      group.salesRmb += row.salesRmb;
      group.salesCount += 1;
    }
    const profitBasisRmb = row.profitBasisRmb ?? row.salesRmb;
    if (profitBasisRmb !== null) {
      group.profitBasisRmb += profitBasisRmb;
      group.profitBasisCount += 1;
    }
    if (resolveProfitStatus(row) === 'pending') group.pendingCount += 1;
    else group.profit += Number(row.profit || 0);
    groups.set(key, group);
  });

  return Array.from(groups.entries()).map(([id, group]) => {
    const months = group.invoiceMonths.sort();
    const salesRmb = group.salesCount > 0 ? group.salesRmb : null;
    const profitBasisRmb = group.profitBasisCount > 0 ? group.profitBasisRmb : null;
    const profit = group.pendingCount > 0 ? null : group.profit;
    return {
      id,
      contract_no: group.contract_no,
      contact_sheet_no: group.contact_sheet_no,
      customer_name: group.customer_name,
      material_no: group.material_no,
      product_name: group.product_name,
      quantity: group.quantity,
      unit: group.unit,
      shipmentCount: group.shipmentNos.size,
      invoiceMonthStart: months.at(0) || '',
      invoiceMonthEnd: months.at(-1) || '',
      salesRmb,
      profitBasisRmb,
      profit,
      margin: profit !== null && profitBasisRmb !== null && profitBasisRmb > 0 ? profit / profitBasisRmb * 100 : null,
      pendingCount: group.pendingCount
    };
  }).sort((left, right) => {
    const monthDiff = right.invoiceMonthEnd.localeCompare(left.invoiceMonthEnd);
    return monthDiff || left.contact_sheet_no.localeCompare(right.contact_sheet_no, 'zh-CN', { numeric: true });
  });
}

export function summarizeProfitByCustomer(contactSheets: ContactSheetProfitSummary[]): CustomerProfitSummary[] {
  const groups = new Map<string, ContactSheetProfitSummary[]>();
  contactSheets.forEach((row) => {
    const rows = groups.get(row.customer_name) || [];
    rows.push(row);
    groups.set(row.customer_name, rows);
  });

  return Array.from(groups.entries()).map(([customerName, rows]) => {
    const confirmedRows = rows.filter((row) => row.profit !== null);
    const salesRmb = rows.reduce((sum, row) => sum + Number(row.salesRmb || 0), 0);
    const confirmedSalesRmb = confirmedRows.reduce((sum, row) => sum + Number(row.salesRmb || 0), 0);
    const confirmedProfitBasisRmb = confirmedRows.reduce((sum, row) => sum + Number(row.profitBasisRmb ?? row.salesRmb ?? 0), 0);
    const profitRmb = confirmedRows.reduce((sum, row) => sum + Number(row.profit || 0), 0);
    return {
      customer_name: customerName,
      contactSheetCount: rows.length,
      confirmedContactSheetCount: confirmedRows.length,
      pendingContactSheetCount: rows.length - confirmedRows.length,
      salesRmb,
      confirmedSalesRmb,
      confirmedProfitBasisRmb,
      profitRmb,
      margin: confirmedProfitBasisRmb > 0 ? profitRmb / confirmedProfitBasisRmb * 100 : null,
      contactSheets: [...rows].sort((left, right) => {
        const monthDiff = right.invoiceMonthEnd.localeCompare(left.invoiceMonthEnd);
        return monthDiff || left.contact_sheet_no.localeCompare(right.contact_sheet_no, 'zh-CN', { numeric: true });
      })
    };
  }).sort((left, right) => right.profitRmb - left.profitRmb || left.customer_name.localeCompare(right.customer_name, 'zh-CN'));
}

export function summarizeShipmentProfitByCustomer<T extends ProfitWorkspaceRow>(rows: T[]): CustomerShipmentProfitSummary<T>[] {
  const groups = new Map<string, T[]>();
  rows.forEach((row) => {
    const customerRows = groups.get(row.customer_name) || [];
    customerRows.push(row);
    groups.set(row.customer_name, customerRows);
  });

  return Array.from(groups.entries()).map(([customerName, customerRows]) => {
    const confirmedRows = customerRows.filter((row) => resolveProfitStatus(row) === 'confirmed');
    const salesRmb = customerRows.reduce((sum, row) => sum + Number(row.salesRmb || 0), 0);
    const confirmedProfitBasisRmb = confirmedRows.reduce((sum, row) => sum + Number(row.profitBasisRmb ?? row.salesRmb ?? 0), 0);
    const profitRmb = confirmedRows.reduce((sum, row) => sum + Number(row.profit || 0), 0);
    return {
      customer_name: customerName,
      shipmentCount: new Set(customerRows.map((row) => row.shipment_no)).size,
      detailCount: customerRows.length,
      confirmedDetailCount: confirmedRows.length,
      pendingDetailCount: customerRows.length - confirmedRows.length,
      salesRmb,
      confirmedProfitBasisRmb,
      profitRmb,
      margin: confirmedProfitBasisRmb > 0 ? profitRmb / confirmedProfitBasisRmb * 100 : null,
      shipments: [...customerRows]
    };
  }).sort((left, right) => right.profitRmb - left.profitRmb || left.customer_name.localeCompare(right.customer_name, 'zh-CN'));
}
