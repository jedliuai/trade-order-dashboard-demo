import type {
  Alert,
  ContactSheet,
  Contract,
  Invoice,
  Payment,
  Shipment,
  ShipmentItem,
  ShipmentProfit
} from './dataStore';
import { getAnalyticsDimensionKey, getAnalyticsMetricLabel, isAnalyticsEventInRange } from './analyticsWorkspace.ts';
import type { CurrentReceivableFact } from './receivablesWorkspace';

export interface AnalyticsDrillRow {
  id: string;
  sourceType: '合同' | '联系单' | '发货' | '收款' | '发票' | '利润' | '提醒';
  documentNo: string;
  businessDate: string;
  customerName: string;
  contractNo: string;
  productMaterial: string;
  amountRmb: number | null;
  status: string;
  note: string;
}

export interface AnalyticsDrilldownInput {
  metric: string;
  group: string;
  dimension: string;
  startDate: string;
  endDate: string;
  contracts: Contract[];
  sheets: ContactSheet[];
  filteredContracts?: Contract[];
  filteredSheets?: ContactSheet[];
  payments: Payment[];
  shipments: Shipment[];
  filteredShipments?: Shipment[];
  shipmentItems: ShipmentItem[];
  invoices: Invoice[];
  profits: ShipmentProfit[];
  receivables?: CurrentReceivableFact[];
  alerts: Alert[];
  rateForDate: (date: string | null | undefined) => number | null;
  timePerspective?: 'event' | 'contract';
}

function sheetLabel(sheet?: ContactSheet | null) {
  if (!sheet) return '未指定产品';
  return [sheet.product_name, sheet.material_no].filter(Boolean).join(' · ') || '未指定产品';
}

function matchesGroup(
  input: AnalyticsDrilldownInput,
  contract: Contract | null | undefined,
  sheet: ContactSheet | null | undefined,
  eventDate: string
) {
  return getAnalyticsDimensionKey(input.dimension, {
    eventDate,
    customerName: contract?.customer_name,
    country: sheet?.country || contract?.country,
    productName: sheet?.product_name,
    materialNo: sheet?.material_no,
    exportType: contract?.export_type,
    status: sheet?.status || contract?.status
  }) === input.group;
}

function amountInRmb(amount: number, currency: string, date: string, rateForDate: AnalyticsDrilldownInput['rateForDate']) {
  if (currency === 'RMB') return amount;
  const rate = rateForDate(date);
  return rate === null ? null : amount * rate;
}

function perspectiveDate(input: AnalyticsDrilldownInput, contract: Contract, eventDate: string) {
  return input.timePerspective === 'contract' ? contract.contract_date : eventDate;
}

function resolveAlertContract(input: AnalyticsDrilldownInput, alert: Alert) {
  if (alert.related_type === 'contract') return input.contracts.find((row) => row.id === alert.related_id);
  if (alert.related_type === 'contact_sheet') {
    const sheet = input.sheets.find((row) => row.id === alert.related_id);
    return input.contracts.find((row) => row.id === sheet?.contract_id);
  }
  if (alert.related_type === 'shipment') {
    const shipment = input.shipments.find((row) => row.id === alert.related_id);
    return input.contracts.find((row) => row.id === shipment?.contract_id);
  }
  if (alert.related_type === 'payment') {
    const payment = input.payments.find((row) => row.id === alert.related_id);
    return input.contracts.find((row) => row.id === payment?.contract_id);
  }
  if (alert.related_type === 'invoice') {
    const invoice = input.invoices.find((row) => row.id === alert.related_id);
    const shipment = input.shipments.find((row) => invoice?.shipment_ids.includes(row.id));
    return input.contracts.find((row) => row.id === shipment?.contract_id);
  }
  return undefined;
}

export function buildAnalyticsDrillRows(input: AnalyticsDrilldownInput): AnalyticsDrillRow[] {
  const contractById = new Map(input.contracts.map((row) => [row.id, row]));
  const sheetById = new Map(input.sheets.map((row) => [row.id, row]));
  const shipmentById = new Map(input.shipments.map((row) => [row.id, row]));
  const sourceContracts = input.filteredContracts || input.contracts;
  const sourceSheets = input.filteredSheets || input.sheets;
  const sourceShipments = input.filteredShipments || input.shipments;
  const rows: AnalyticsDrillRow[] = [];

  if (input.metric === 'unpaid_amount') {
    (input.receivables || []).forEach((fact) => {
      const contract = contractById.get(fact.contractId);
      const sheet = sheetById.get(fact.contactSheetId);
      const analysisDate = contract ? perspectiveDate(input, contract, fact.shipmentDate) : fact.shipmentDate;
      if (!contract || !matchesGroup(input, contract, sheet, analysisDate)) return;
      rows.push({
        id: `receivable-${fact.id}`,
        sourceType: '发货',
        documentNo: fact.shipmentNo,
        businessDate: fact.shipmentDate,
        customerName: fact.customerName,
        contractNo: fact.contractNo,
        productMaterial: [fact.productName, fact.materialNo].filter(Boolean).join(' · '),
        amountRmb: fact.outstandingAmountRmb,
        status: '当前应收',
        note: fact.missingRate ? '缺少发货月份汇率，暂不计入人民币合计' : fact.allocationNote
      });
    });
  } else if (['contract_amount', 'sheet_count'].includes(input.metric)) {
    sourceSheets.forEach((sheet) => {
      const contract = contractById.get(sheet.contract_id);
      if (!contract || !matchesGroup(input, contract, sheet, contract.contract_date)) return;
      rows.push({
        id: `${input.metric}-${sheet.id}`,
        sourceType: input.metric === 'sheet_count' ? '联系单' : '合同',
        documentNo: input.metric === 'sheet_count' ? (sheet.contact_sheet_no || '待填写联系单号') : contract.contract_no,
        businessDate: contract.contract_date,
        customerName: contract.customer_name,
        contractNo: contract.contract_no,
        productMaterial: sheetLabel(sheet),
        amountRmb: input.metric === 'sheet_count' ? null : amountInRmb(sheet.quantity * sheet.unit_price, contract.currency, contract.contract_date, input.rateForDate),
        status: sheet.status || contract.status,
        note: ''
      });
    });
  } else if (input.metric === 'contract_count') {
    sourceContracts.forEach((contract) => {
      const sheet = sourceSheets.find((row) => row.contract_id === contract.id);
      if (!matchesGroup(input, contract, sheet, contract.contract_date)) return;
      rows.push({
        id: `contract-${contract.id}`,
        sourceType: '合同',
        documentNo: contract.contract_no,
        businessDate: contract.contract_date,
        customerName: contract.customer_name,
        contractNo: contract.contract_no,
        productMaterial: sheetLabel(sheet),
        amountRmb: null,
        status: contract.status,
        note: ''
      });
    });
  } else if (['shipment_amount', 'shipment_count'].includes(input.metric)) {
    sourceShipments.forEach((shipment) => {
      const contract = contractById.get(shipment.contract_id);
      const items = input.shipmentItems.filter((row) => row.shipment_id === shipment.id);
      const firstSheet = sheetById.get(items[0]?.contact_sheet_id);
      if (!contract || !matchesGroup(input, contract, firstSheet, perspectiveDate(input, contract, shipment.shipment_date))) return;
      if (input.metric === 'shipment_count' || items.length === 0) {
        rows.push({
          id: `${input.metric}-${shipment.id}`,
          sourceType: '发货',
          documentNo: shipment.group_shipment_no || shipment.shipment_no,
          businessDate: shipment.shipment_date,
          customerName: contract.customer_name,
          contractNo: contract.contract_no,
          productMaterial: items.length === 1 ? sheetLabel(firstSheet) : `${items.length} 条发货明细`,
          amountRmb: input.metric === 'shipment_count' ? null : amountInRmb(shipment.amount, contract.currency, shipment.shipment_date, input.rateForDate),
          status: shipment.status,
          note: ''
        });
        return;
      }
      items.forEach((item) => {
        const sheet = sheetById.get(item.contact_sheet_id);
        rows.push({
          id: `shipment-${shipment.id}-${item.id}`,
          sourceType: '发货',
          documentNo: shipment.group_shipment_no || shipment.shipment_no,
          businessDate: shipment.shipment_date,
          customerName: contract.customer_name,
          contractNo: contract.contract_no,
          productMaterial: sheetLabel(sheet),
          amountRmb: amountInRmb(item.shipped_quantity * item.unit_price, contract.currency, shipment.shipment_date, input.rateForDate),
          status: shipment.status,
          note: item.batch_no ? `批号 ${item.batch_no}` : ''
        });
      });
    });
  } else if (input.metric === 'payment_amount') {
    input.payments.forEach((payment) => {
      const contract = contractById.get(payment.contract_id);
      const contractSheets = sourceSheets.filter((row) => row.contract_id === payment.contract_id);
      const splitBySheet = ['country', 'product', 'material', 'status'].includes(input.dimension) && contractSheets.length > 0;
      const targets = splitBySheet ? contractSheets : [contractSheets[0]];
      const totalWeight = contractSheets.reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0);
      targets.forEach((sheet) => {
        if (!contract || !matchesGroup(input, contract, sheet, perspectiveDate(input, contract, payment.payment_date))) return;
        const weight = splitBySheet
          ? (totalWeight > 0 ? sheet!.quantity * sheet!.unit_price / totalWeight : 1 / contractSheets.length)
          : 1;
        const amountRmb = payment.currency === 'RMB' ? payment.amount : payment.amount_rmb ?? null;
        rows.push({
          id: `payment-${payment.id}-${sheet?.id || 'contract'}`,
          sourceType: '收款',
          documentNo: payment.receipt_no || payment.id,
          businessDate: payment.payment_date,
          customerName: contract.customer_name,
          contractNo: contract.contract_no,
          productMaterial: splitBySheet ? sheetLabel(sheet) : '合同级收款',
          amountRmb: amountRmb === null ? null : amountRmb * weight,
          status: payment.payment_type,
          note: splitBySheet ? '合同级收款按联系单金额比例展示' : payment.notes
        });
      });
    });
  } else if (input.metric === 'invoice_amount') {
    input.invoices.forEach((invoice) => {
      invoice.shipment_allocations.forEach((allocation) => {
        const shipment = shipmentById.get(allocation.shipment_id);
        const contract = shipment ? contractById.get(shipment.contract_id) : undefined;
        const item = input.shipmentItems.find((row) => row.shipment_id === shipment?.id);
        const sheet = sheetById.get(item?.contact_sheet_id || '');
        if (!contract || !matchesGroup(input, contract, sheet, perspectiveDate(input, contract, invoice.invoice_date))) return;
        rows.push({
          id: `invoice-${invoice.id}-${allocation.shipment_id}`,
          sourceType: '发票',
          documentNo: invoice.invoice_no || `发票 ${invoice.id}`,
          businessDate: invoice.invoice_date,
          customerName: contract.customer_name,
          contractNo: contract.contract_no,
          productMaterial: sheetLabel(sheet),
          amountRmb: amountInRmb(allocation.allocated_amount, invoice.currency, invoice.invoice_date, input.rateForDate),
          status: invoice.status,
          note: shipment?.group_shipment_no || shipment?.shipment_no || ''
        });
      });
    });
  } else if (['profit', 'gross_margin'].includes(input.metric)) {
    input.profits.forEach((profit) => {
      if (profit.profit === null || profit.is_estimated_profit) return;
      const shipment = shipmentById.get(profit.shipment_id);
      const contract = shipment ? contractById.get(shipment.contract_id) : undefined;
      const sheet = input.sheets.find((row) => row.contract_id === contract?.id && (
        (profit.contact_sheet_no && row.contact_sheet_no === profit.contact_sheet_no)
        || row.material_no === profit.material_no
      ));
      const eventDate = profit.invoice_month ? `${profit.invoice_month}-01` : '';
      if (!contract || !matchesGroup(input, contract, sheet, perspectiveDate(input, contract, eventDate))) return;
      rows.push({
        id: `${input.metric}-${profit.shipment_id}-${profit.contact_sheet_no}-${profit.batch_no || profit.material_no}`,
        sourceType: '利润',
        documentNo: profit.shipment_no,
        businessDate: profit.invoice_month,
        customerName: profit.customer_name,
        contractNo: profit.contract_no,
        productMaterial: [profit.product_name, profit.material_no].filter(Boolean).join(' · '),
        amountRmb: input.metric === 'profit' ? profit.profit : profit.gross_margin === null ? null : profit.gross_margin * 100,
        status: profit.profit === null ? '暂不可计算' : '已开票',
        note: input.metric === 'gross_margin' ? '本行金额列显示毛利率百分比' : ''
      });
    });
  } else if (input.metric === 'alert_count') {
    input.alerts.forEach((alert) => {
      if (alert.status !== '未处理' || !isAnalyticsEventInRange(alert.created_at, input.startDate, input.endDate)) return;
      const contract = resolveAlertContract(input, alert);
      const sheet = alert.related_type === 'contact_sheet' ? sheetById.get(alert.related_id) : sourceSheets.find((row) => row.contract_id === contract?.id);
      const eventDate = alert.created_at.substring(0, 10);
      if (!contract || !matchesGroup(input, contract, sheet, perspectiveDate(input, contract, eventDate))) return;
      rows.push({
        id: `alert-${alert.id}`,
        sourceType: '提醒',
        documentNo: getAnalyticsMetricLabel(input.metric),
        businessDate: eventDate,
        customerName: contract.customer_name,
        contractNo: contract.contract_no,
        productMaterial: sheetLabel(sheet),
        amountRmb: null,
        status: alert.priority === 'high' ? '高风险' : alert.priority === 'medium' ? '中风险' : '低风险',
        note: alert.message
      });
    });
  }

  return rows.sort((left, right) => {
    const dateDiff = right.businessDate.localeCompare(left.businessDate);
    return dateDiff || left.documentNo.localeCompare(right.documentNo, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}
