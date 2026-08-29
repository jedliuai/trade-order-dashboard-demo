import { calculateEstimatedReleaseDate, checkPaymentTermsBeforeShipment } from './businessRules';
import {
  downloadLocalFile,
  localRequest, getLocalSession,
  localRest
} from './localClient';
import { isQaComplete } from './businessRules';
import { formatLocalDate } from './dateUtils';
import { resolveShipmentPaymentDisplayStatus } from './financialRules';
import { normalizeCustomerCurrency } from './customerDefaults';
import { normalizeCustomerIdentity } from './customerMerge';
import { isAllowedContactSheetUnit, normalizeContactSheetUnit } from './formOptions';
import { isPaymentType, type PaymentType } from './paymentAllocationTypes';

export interface Customer {
  id: string;
  owner_id: string;
  owner_display_name: string;
  name: string;
  country: string;
  is_staggered_month: boolean;
  expiry_years: number;
  default_currency: 'USD' | 'RMB';
  default_payment_terms: string;
  notes: string;
  created_at: string;
}

export interface Contract {
  id: string;
  contract_no: string;
  customer_id: string;
  customer_name: string;
  country: string;
  contract_date: string;
  destination_country: string;
  export_type: '自营' | '转口';
  currency: 'USD' | 'RMB';
  incoterm?: 'FOB' | 'CIF' | null;
  delivery_days: number;
  agreed_delivery_date: string;
  packaging_confirmed_date: string;
  payment_terms: string;
  prepayment_ratio: number;
  internal_contract_seq: string;
  status: string;
  archived: boolean;
  is_historical: boolean;
  notes: string;
  created_at: string;
}

export interface ContactSheet {
  id: string;
  contract_id: string;
  contract_no: string;
  customer_name: string;
  country: string;
  export_type?: '自营' | '转口';
  business_type: '制剂' | '原料药';
  is_historical: boolean;
  contact_sheet_no: string;
  material_no: string;
  product_name: string;
  specification: string;
  product_variant_id?: string | null;
  packaging: string;
  packaging_profile_version_id?: string | null;
  packaging_confirmed_date: string;
  quality_standard: string;
  unit_price: number;
  quantity: number;
  unit: string;
  pcs_per_carton?: number | null;
  gross_weight_kg?: number | null;
  production_date: string;
  expiry_date: string;
  is_staggered_month: boolean;
  qa_approval_date: string;
  aps_scheduled_date: string;
  box_artwork_confirmed_date: string;
  actual_warehousing_date: string;
  estimated_release_date: string;
  actual_release_date: string;
  aps_auto_query_enabled: boolean;
  reference_contact_sheet: string;
  notes: string;
  status?: string;
  shipped_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface ContactSheetChangeHistory {
  id: string;
  contact_sheet_id: string;
  changed_at: string;
  old_data: Record<string, unknown>;
  new_data: Record<string, unknown>;
}

export interface Batch {
  id: string;
  contact_sheet_id: string;
  contact_sheet_no: string;
  contract_no: string;
  product_name: string;
  material_no: string;
  batch_no: string;
  batch_quantity: number;
  production_date: string;
  expiry_date: string;
  warehouse_date: string;
  release_date: string;
  notes: string;
  created_at: string;
}

export interface Shipment {
  id: string;
  shipment_no: string;
  shipment_group_id?: string | null;
  group_shipment_no?: string;
  customer_id?: string;
  contract_id: string;
  contract_no: string;
  customer_name: string;
  amount: number;
  currency: 'USD' | 'RMB';
  incoterm_snapshot?: 'FOB' | 'CIF' | null;
  freight_insurance_amount?: number | null;
  shipment_date: string;
  payment_check_status: string;
  linked_paid_amount: number;
  payment_settlement_status: string;
  status: '准备中' | '已发货' | '取消';
  notes: string;
  created_at: string;
}

export interface ShipmentItem {
  id: string;
  shipment_id: string;
  contact_sheet_id: string;
  batch_id: string;
  contact_sheet_no: string;
  batch_no?: string;
  product_name: string;
  specification?: string;
  unit?: string;
  pcs_per_carton?: number | null;
  material_no: string;
  shipped_quantity: number;
  unit_price: number;
  amount: number;
  notes: string;
  created_at: string;
}

export interface Payment {
  id: string;
  receipt_id?: string | null;
  receipt_no?: string;
  contract_id: string;
  shipment_id?: string | null;
  contract_no: string;
  customer_id?: string;
  customer_name: string;
  export_type: '自营' | '转口';
  payment_date: string;
  amount: number;
  currency: 'USD' | 'RMB';
  payment_type: PaymentType;
  exchange_rate?: number;
  amount_rmb?: number;
  notes: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  shipment_id: string;
  shipment_ids: string[];
  shipment_allocations: { shipment_id: string; allocated_amount: number }[];
  shipment_no: string;
  contract_no: string;
  customer_id?: string;
  customer_name?: string;
  export_type: '自营' | '转口';
  invoice_no: string;
  invoice_date: string;
  amount: number;
  currency: 'USD' | 'RMB';
  invoice_type: '国内增值税发票' | '外贸内部发票';
  status: '未申请' | '已申请' | '已收到电子发票';
  notes: string;
  created_at: string;
}

export interface CustomerMergeResult {
  source_name: string;
  target_name: string;
  moved_contracts: number;
  moved_payment_receipts: number;
  moved_shipment_groups: number;
  deleted_customers: number;
}

export interface BusinessIdentifierConflict {
  owner_display_name: string;
  contract_no: string;
  contact_sheet_no?: string;
}

export interface BatchIdentifierConflict extends BusinessIdentifierConflict {
  batch_no: string;
}

export interface PaymentReceipt {
  id: string;
  customer_id: string;
  receipt_no: string;
  payment_date: string;
  total_amount: number;
  currency: 'USD' | 'RMB';
  payment_type: Payment['payment_type'];
  exchange_rate?: number;
  amount_rmb?: number;
  notes: string;
  created_at: string;
}

export interface ShipmentGroup {
  id: string;
  customer_id: string;
  shipment_no: string;
  shipment_date: string;
  currency: 'USD' | 'RMB';
  incoterm?: 'FOB' | 'CIF' | null;
  freight_insurance_amount?: number | null;
  status: Shipment['status'];
  notes: string;
  created_at: string;
}

export interface InvoiceShipment {
  invoice_id: string;
  shipment_id: string;
  allocated_amount: number;
}

export interface ExchangeRate {
  id: string;
  effective_month: string;
  currency_pair: string;
  rate: number;
  source_date: string;
  source: 'ChinaMoney' | 'Manual';
  notes: string;
  created_at: string;
}

export interface Alert {
  id: string;
  alert_type: string;
  related_type: 'contract' | 'contact_sheet' | 'shipment' | 'invoice' | 'payment' | 'batch';
  related_id: string;
  priority: 'high' | 'medium' | 'low';
  message: string;
  status: '未处理' | '已处理' | '忽略' | '稍后提醒';
  created_at: string;
  handled_at?: string | null;
  snoozed_until?: string | null;
}

export interface SyncLog {
  id: string;
  sync_type: 'qa_email' | 'aps' | 'exchange_rate' | 'import' | 'export';
  status: 'success' | 'failed' | 'partial';
  started_at: string;
  finished_at: string;
  message: string;
  details?: any;
}

export interface ShipmentProfit {
  shipment_id: string;
  owner_id: string;
  shipment_no: string;
  shipment_date: string;
  contract_no: string;
  customer_name: string;
  export_type: '自营' | '转口';
  currency: 'USD' | 'RMB';
  contact_sheet_no: string;
  batch_no: string;
  material_no: string;
  product_name: string;
  specification: string;
  unit: string;
  shipped_quantity: number;
  unit_price: number;
  sales_amount: number;
  invoice_month: string;
  cost_month: string;
  unit_cost: number | null;
  exchange_rate: number | null;
  sales_amount_rmb: number | null;
  profit: number | null;
  gross_margin: number | null;
  is_estimated_profit: boolean;
  incoterm?: 'FOB' | 'CIF' | null;
  cif_amount?: number | null;
  freight_insurance_amount?: number | null;
  fob_amount?: number | null;
  freight_insurance_rmb?: number | null;
  profit_basis_amount_rmb?: number | null;
  product_cost_total_rmb?: number | null;
}

export interface AnalysisTemplate {
  id?: string;
  name: string;
  filters: any;
  metrics: string[];
  dimension: string;
  chartType: string;
  currencyMode: 'RMB' | 'original';
}

type Cache = {
  customers: Customer[];
  contracts: Contract[];
  contactSheets: ContactSheet[];
  batches: Batch[];
  shipments: Shipment[];
  shipmentGroups: ShipmentGroup[];
  shipmentItems: ShipmentItem[];
  payments: Payment[];
  paymentReceipts: PaymentReceipt[];
  invoices: Invoice[];
  invoiceShipments: InvoiceShipment[];
  exchangeRates: ExchangeRate[];
  alerts: Alert[];
  syncLogs: SyncLog[];
  shipmentProfits: ShipmentProfit[];
  analysisTemplates: AnalysisTemplate[];
};

const emptyCache = (): Cache => ({
  customers: [],
  contracts: [],
  contactSheets: [],
  batches: [],
  shipments: [],
  shipmentGroups: [],
  shipmentItems: [],
  payments: [],
  paymentReceipts: [],
  invoices: [],
  invoiceShipments: [],
  exchangeRates: [],
  alerts: [],
  syncLogs: [],
  shipmentProfits: [],
  analysisTemplates: []
});

let cache: Cache = emptyCache();
let cacheOwnerId: string | null = null;
let lastLoadError = '';
let supportsPcsPerCarton = false;

export interface DataLoadPerformance {
  durationMs: number;
  totalRows: number;
  tableRows: Record<string, number>;
  measuredAt: string;
}

let lastLoadPerformance: DataLoadPerformance | null = null;

function ownerId() {
  const id = getLocalSession()?.user?.id;
  if (!id) throw new Error('请先在系统设置中登录 本地演示账户。');
  return id;
}

function num(value: unknown) {
  return Number(value || 0);
}

function str(value: unknown) {
  return value ? String(value) : '';
}

function inferContactStatus(sheet: ContactSheet) {
  const shipped = sheet.shipped_quantity || 0;
  if (sheet.business_type === '原料药' || sheet.is_historical) {
    if (shipped <= 0) return '可安排发货';
    if (shipped < sheet.quantity) return '部分发货';
    return '发货完成';
  }
  if (!sheet.contact_sheet_no) return '待填写联系单号';
  if (!isQaComplete(sheet)) return '待 QA 审批';
  if (!sheet.aps_scheduled_date) return '待排产';
  if (!sheet.actual_warehousing_date) return '已排产待入库';
  if (!sheet.actual_release_date) return '已入库待放行';
  if (shipped <= 0) return '生产完成 / 可发货';
  if (shipped < sheet.quantity) return '部分发货';
  return '发货完成';
}

function inferContractStatus(contract: Contract, sheets: ContactSheet[]) {
  if (contract.archived) return '已归档';
  const totalQuantity = sheets.reduce((sum, sheet) => sum + sheet.quantity, 0);
  const shippedQuantity = sheets.reduce((sum, sheet) => sum + sheet.shipped_quantity, 0);
  if (totalQuantity > 0 && shippedQuantity >= totalQuantity) return '发货完成';
  if (shippedQuantity > 0) return '部分发货';
  if (sheets.length > 0 && sheets.every((sheet) => Boolean(sheet.actual_release_date))) return '生产完成';
  return '进行中';
}

function assertPositiveNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}必须大于 0。`);
  }
  return parsed;
}

function assertUniqueText<T extends { id: string }, K extends keyof T>(
  rows: T[],
  field: K,
  value: unknown,
  label: string,
  excludeId?: string
) {
  const normalized = String(value || '').trim().toLocaleLowerCase();
  if (!normalized) throw new Error(`${label}不能为空。`);
  if (rows.some((row) => row.id !== excludeId && String(row[field] || '').trim().toLocaleLowerCase() === normalized)) {
    throw new Error(`${label}“${String(value).trim()}”已经存在。`);
  }
}

function validateShipmentItems(
  contractId: string,
  items: { contact_sheet_id: string; batch_id: string; shipped_quantity: number; unit_price: number }[],
  currentShipmentId?: string,
  targetStatus: Shipment['status'] = '已发货'
) {
  if (items.length === 0) throw new Error('请至少保留一条发货明细。');

  const requestedByBatch = new Map<string, number>();
  const requestedBySheet = new Map<string, number>();
  items.forEach((item) => {
    const sheet = cache.contactSheets.find((row) => row.id === item.contact_sheet_id);
    if (!sheet) throw new Error('发货明细关联的联系单不存在，请刷新后重试。');
    if (sheet.contract_id !== contractId) throw new Error(`${sheet.contact_sheet_no || sheet.product_name} 不属于当前合同，不能混合发货。`);

    const quantity = assertPositiveNumber(item.shipped_quantity, '发货数量');
    assertPositiveNumber(item.unit_price, '发货单价');
    requestedBySheet.set(item.contact_sheet_id, (requestedBySheet.get(item.contact_sheet_id) || 0) + quantity);

    if (!item.batch_id && sheet.business_type !== '原料药' && !sheet.is_historical) {
      throw new Error(`${sheet.contact_sheet_no || sheet.product_name} 是制剂，发货时必须选择已入库批次。`);
    }

    if (item.batch_id) {
      const batch = cache.batches.find((row) => row.id === item.batch_id);
      if (!batch) throw new Error('发货明细关联的批次不存在，请刷新后重试。');
      if (batch.contact_sheet_id !== item.contact_sheet_id) throw new Error(`${batch.batch_no} 不属于所选联系单，不能混合发货。`);
      requestedByBatch.set(item.batch_id, (requestedByBatch.get(item.batch_id) || 0) + quantity);
    }
  });

  const reservingShipmentIds = new Set(
    cache.shipments.filter((row) => row.status !== '取消').map((row) => row.id)
  );
  if (targetStatus === '取消') return;
  requestedBySheet.forEach((requested, sheetId) => {
    const sheet = cache.contactSheets.find((row) => row.id === sheetId);
    if (!sheet) return;
    const shippedByOthers = cache.shipmentItems
      .filter((row) => row.contact_sheet_id === sheetId && row.shipment_id !== currentShipmentId && reservingShipmentIds.has(row.shipment_id))
      .reduce((sum, row) => sum + row.shipped_quantity, 0);
    const available = sheet.quantity - shippedByOthers;
    if (requested > available + 0.0001) {
      throw new Error(`${sheet.contact_sheet_no || sheet.product_name} 可发数量不足：可发 ${available}，本次填写 ${requested}。`);
    }
  });
  requestedByBatch.forEach((requested, batchId) => {
    const batch = cache.batches.find((row) => row.id === batchId);
    if (!batch) return;
    const shippedByOthers = cache.shipmentItems
      .filter((row) => row.batch_id === batchId && row.shipment_id !== currentShipmentId && reservingShipmentIds.has(row.shipment_id))
      .reduce((sum, row) => sum + row.shipped_quantity, 0);
    const available = batch.batch_quantity - shippedByOthers;
    if (requested > available + 0.0001) {
      throw new Error(`${batch.batch_no} 可发数量不足：可发 ${available}，本次填写 ${requested}。`);
    }
  });
}

function refreshDerived() {
  const shippedBySheet = new Map<string, number>();
  const shippedShipmentIds = new Set(cache.shipments.filter((row) => row.status === '已发货').map((row) => row.id));
  cache.shipmentItems.forEach((item) => {
    if (!shippedShipmentIds.has(item.shipment_id)) return;
    shippedBySheet.set(item.contact_sheet_id, (shippedBySheet.get(item.contact_sheet_id) || 0) + item.shipped_quantity);
  });

  cache.contracts = cache.contracts.map((contract) => {
    const customer = cache.customers.find((row) => row.id === contract.customer_id);
    const destinationCountry = contract.destination_country || customer?.country || '';
    return {
      ...contract,
      destination_country: destinationCountry,
      customer_name: customer?.name || '',
      country: destinationCountry
    };
  });

  cache.contactSheets = cache.contactSheets.map((sheet) => {
    const contract = cache.contracts.find((row) => row.id === sheet.contract_id);
    const customer = cache.customers.find((row) => row.id === contract?.customer_id);
    const next = {
      ...sheet,
      contract_no: contract?.contract_no || '',
      customer_name: customer?.name || '',
      country: contract?.destination_country || customer?.country || '',
      shipped_quantity: shippedBySheet.get(sheet.id) || 0
    };
    return { ...next, status: inferContactStatus(next) };
  });

  cache.contracts = cache.contracts.map((contract) => ({
    ...contract,
    status: inferContractStatus(
      contract,
      cache.contactSheets.filter((sheet) => sheet.contract_id === contract.id)
    )
  }));

  cache.batches = cache.batches.map((batch) => {
    const sheet = cache.contactSheets.find((row) => row.id === batch.contact_sheet_id);
    return {
      ...batch,
      contact_sheet_no: sheet?.contact_sheet_no || '',
      contract_no: sheet?.contract_no || '',
      product_name: sheet?.product_name || '',
      material_no: sheet?.material_no || ''
    };
  });

  cache.shipments = cache.shipments.map((shipment) => {
    const contract = cache.contracts.find((row) => row.id === shipment.contract_id);
    const customer = cache.customers.find((row) => row.id === contract?.customer_id);
    const group = cache.shipmentGroups.find((row) => row.id === shipment.shipment_group_id);
    const amount = cache.shipmentItems.filter((row) => row.shipment_id === shipment.id).reduce((sum, row) => sum + row.amount, 0);
    const linkedPaidAmount = cache.payments
      .filter((row) => row.shipment_id === shipment.id)
      .reduce((sum, row) => sum + row.amount, 0);
    return {
      ...shipment,
      contract_no: contract?.contract_no || '',
      customer_id: customer?.id || '',
      customer_name: customer?.name || '',
      group_shipment_no: group?.shipment_no || shipment.shipment_no,
      amount,
      linked_paid_amount: linkedPaidAmount,
      payment_settlement_status: resolveShipmentPaymentDisplayStatus(
        amount,
        linkedPaidAmount,
        shipment.payment_check_status
      ),
      currency: contract?.currency || 'USD'
    };
  });

  cache.payments = cache.payments.map((payment) => {
    const contract = cache.contracts.find((row) => row.id === payment.contract_id);
    const customer = cache.customers.find((row) => row.id === contract?.customer_id);
    const receipt = cache.paymentReceipts.find((row) => row.id === payment.receipt_id);
    return {
      ...payment,
      contract_no: contract?.contract_no || '',
      receipt_no: receipt?.receipt_no || '',
      customer_id: customer?.id || '',
      customer_name: customer?.name || '',
      export_type: contract?.export_type || '自营'
    };
  });

  cache.invoices = cache.invoices.map((invoice) => {
    const storedAllocations = cache.invoiceShipments.filter((row) => row.invoice_id === invoice.id);
    const allocations = storedAllocations.length > 0
      ? storedAllocations.map((row) => ({ shipment_id: row.shipment_id, allocated_amount: row.allocated_amount }))
      : [{ shipment_id: invoice.shipment_id, allocated_amount: invoice.amount }];
    const linkedShipments = allocations
      .map((row) => cache.shipments.find((shipment) => shipment.id === row.shipment_id))
      .filter((shipment): shipment is Shipment => Boolean(shipment));
    const shipment = linkedShipments[0] || cache.shipments.find((row) => row.id === invoice.shipment_id);
    const contracts = linkedShipments
      .map((row) => cache.contracts.find((contract) => contract.id === row.contract_id))
      .filter((contract): contract is Contract => Boolean(contract));
    const contract = contracts[0];
    const customer = cache.customers.find((row) => row.id === contract?.customer_id);
    return {
      ...invoice,
      shipment_ids: allocations.map((row) => row.shipment_id),
      shipment_allocations: allocations,
      shipment_no: Array.from(new Set(linkedShipments.map((row) => row.group_shipment_no || row.shipment_no))).join('、') || shipment?.shipment_no || '',
      contract_no: Array.from(new Set(contracts.map((row) => row.contract_no))).join('、'),
      customer_id: customer?.id || '',
      customer_name: customer?.name || '',
      export_type: contract?.export_type || '自营'
    };
  });

  cache.shipmentItems = cache.shipmentItems.map((item) => {
    const sheet = cache.contactSheets.find((row) => row.id === item.contact_sheet_id);
    const batch = cache.batches.find((row) => row.id === item.batch_id);
    return {
      ...item,
      contact_sheet_no: sheet?.contact_sheet_no || '',
      batch_no: batch?.batch_no || '',
      product_name: sheet?.product_name || '',
      specification: sheet?.specification || '',
      unit: sheet?.unit || '盒'
    };
  });

}

const PUBLIC_EXCHANGE_RATE_OWNER_ID = 'demo-shared';

export async function initDataStore(_force = false) {
  lastLoadError = '';
  const loadStartedAt = Date.now();
  const session = getLocalSession();
  const currentOwnerId = session?.user?.id || null;
  if (!currentOwnerId) {
    cache = emptyCache();
    cacheOwnerId = null;
    lastLoadError = '未登录 本地演示账户，当前不会加载本地业务数据。';
    return;
  }

  const isSameOwner = cacheOwnerId === currentOwnerId;
  if (!isSameOwner) {
    cache = emptyCache();
    cacheOwnerId = null;
  }

  try {
    const snapshot = await localRequest<Record<string, any[]>>('bootstrap');
    const {
      customers, contracts, contact_sheets: contactSheets, batches, shipments,
      shipment_groups: shipmentGroups, shipment_items: shipmentItems, payments,
      payment_receipts: paymentReceipts, invoices, invoice_shipments: invoiceShipments,
      exchange_rates: exchangeRates, alerts, sync_logs: syncLogs,
      v_shipment_profit: shipmentProfits, analysis_templates: analysisTemplates,
      app_user_profiles: appUserProfiles,
    } = snapshot;
    supportsPcsPerCarton = contactSheets.some((row) => Object.prototype.hasOwnProperty.call(row, 'pcs_per_carton'));
    const ownerDisplayNames = new Map(
      appUserProfiles.map((profile) => [profile.user_id, str(profile.display_name) || str(profile.login_name) || '同事'])
    );

    cache = {
      customers: customers.map((row) => ({
        id: row.id,
        owner_id: row.owner_id,
        owner_display_name: ownerDisplayNames.get(row.owner_id) || '同事',
        name: str(row.name),
        country: str(row.country),
        is_staggered_month: Boolean(row.is_staggered_month),
        expiry_years: Number(row.expiry_years || 3),
        default_currency: normalizeCustomerCurrency(row.default_currency),
        default_payment_terms: str(row.default_payment_terms),
        notes: str(row.notes),
        created_at: str(row.created_at)
      })),
      contracts: contracts.map((row) => ({
        id: row.id,
        contract_no: str(row.contract_no),
        customer_id: row.customer_id,
        contract_date: str(row.contract_date),
        destination_country: str(row.destination_country),
        export_type: row.export_type || '自营',
        currency: row.currency || 'USD',
        incoterm: row.currency === 'USD' ? (row.incoterm === 'CIF' ? 'CIF' : 'FOB') : null,
        delivery_days: Number(row.delivery_days || 0),
        agreed_delivery_date: str(row.agreed_delivery_date),
        packaging_confirmed_date: str(row.packaging_confirmed_date),
        payment_terms: str(row.payment_terms),
        prepayment_ratio: Number(row.prepayment_ratio || 0.3),
        internal_contract_seq: str(row.internal_contract_seq),
        status: str(row.status || '进行中'),
        customer_name: '',
        country: '',
        archived: Boolean(row.archived),
        is_historical: Boolean(row.is_historical),
        notes: str(row.notes),
        created_at: str(row.created_at)
      })),
      contactSheets: contactSheets.map((row) => ({
        id: row.id,
        contract_id: row.contract_id,
        business_type: row.business_type === '原料药' ? '原料药' : '制剂',
        is_historical: Boolean(row.is_historical),
        contact_sheet_no: str(row.contact_sheet_no),
        material_no: str(row.material_no),
        product_variant_id: row.product_variant_id || null,
        product_name: str(row.product_name),
        specification: str(row.specification),
        packaging: str(row.packaging),
        packaging_profile_version_id: row.packaging_profile_version_id || null,
        packaging_confirmed_date: str(row.packaging_confirmed_date),
        quality_standard: str(row.quality_standard),
        unit_price: num(row.unit_price),
        quantity: num(row.quantity),
        unit: str(row.unit || '盒'),
        pcs_per_carton: row.pcs_per_carton === null || row.pcs_per_carton === undefined ? undefined : num(row.pcs_per_carton),
        gross_weight_kg: row.gross_weight_kg === null || row.gross_weight_kg === undefined ? undefined : num(row.gross_weight_kg),
        production_date: str(row.production_date),
        expiry_date: str(row.expiry_date),
        is_staggered_month: Boolean(row.is_staggered_month),
        qa_approval_date: str(row.qa_approval_date),
        aps_scheduled_date: str(row.aps_scheduled_date),
        box_artwork_confirmed_date: str(row.box_artwork_confirmed_date),
        actual_warehousing_date: str(row.actual_warehousing_date),
        estimated_release_date: str(row.estimated_release_date),
        actual_release_date: str(row.actual_release_date),
        aps_auto_query_enabled: Boolean(row.aps_auto_query_enabled ?? true),
        reference_contact_sheet: str(row.reference_contact_sheet),
        notes: str(row.notes),
        created_at: str(row.created_at),
        updated_at: str(row.updated_at),
        contract_no: '',
        customer_name: '',
        country: '',
        shipped_quantity: 0
      })),
      batches: batches.map((row) => ({
        id: row.id,
        contact_sheet_id: row.contact_sheet_id,
        batch_no: str(row.batch_no),
        batch_quantity: num(row.batch_quantity),
        production_date: str(row.production_date),
        expiry_date: str(row.expiry_date),
        warehouse_date: str(row.warehouse_date),
        release_date: str(row.release_date),
        notes: str(row.notes),
        created_at: str(row.created_at),
        contact_sheet_no: '',
        contract_no: '',
        product_name: '',
        material_no: ''
      })),
      shipments: shipments.map((row) => ({
        id: row.id,
        shipment_no: str(row.shipment_no),
        contract_id: row.contract_id,
        shipment_group_id: row.shipment_group_id || undefined,
        shipment_date: str(row.shipment_date),
        incoterm_snapshot: row.incoterm_snapshot === 'CIF' ? 'CIF' : row.incoterm_snapshot === 'FOB' ? 'FOB' : null,
        freight_insurance_amount: row.freight_insurance_amount === null || row.freight_insurance_amount === undefined
          ? null
          : num(row.freight_insurance_amount),
        payment_check_status: str(row.payment_check_status || '需人工确认'),
        linked_paid_amount: 0,
        payment_settlement_status: str(row.payment_check_status || '需人工确认'),
        status: row.status || '准备中',
        notes: str(row.notes),
        created_at: str(row.created_at),
        contract_no: '',
        customer_name: '',
        amount: 0,
        currency: 'USD'
      })),
      shipmentGroups: shipmentGroups.map((row) => ({
        id: row.id,
        customer_id: row.customer_id,
        shipment_no: str(row.shipment_no),
        shipment_date: str(row.shipment_date),
        currency: row.currency || 'USD',
        incoterm: row.incoterm === 'CIF' ? 'CIF' : row.incoterm === 'FOB' ? 'FOB' : null,
        freight_insurance_amount: row.freight_insurance_amount === null || row.freight_insurance_amount === undefined
          ? null
          : num(row.freight_insurance_amount),
        status: row.status || '已发货',
        notes: str(row.notes),
        created_at: str(row.created_at)
      })),
      shipmentItems: shipmentItems.map((row) => ({
        id: row.id,
        shipment_id: row.shipment_id,
        contact_sheet_id: row.contact_sheet_id,
        batch_id: row.batch_id,
        material_no: str(row.material_no),
        shipped_quantity: num(row.shipped_quantity),
        unit_price: num(row.unit_price),
        amount: num(row.amount),
        notes: str(row.notes),
        created_at: str(row.created_at),
        contact_sheet_no: '',
        product_name: ''
      })),
      payments: payments.map((row) => ({
        id: row.id,
        receipt_id: row.receipt_id || undefined,
        contract_id: row.contract_id,
        shipment_id: row.shipment_id || undefined,
        payment_date: str(row.payment_date),
        amount: num(row.amount),
        currency: row.currency || 'USD',
        payment_type: row.payment_type || '其他',
        exchange_rate: row.exchange_rate === null || row.exchange_rate === undefined ? undefined : num(row.exchange_rate),
        amount_rmb: row.amount_rmb === null || row.amount_rmb === undefined ? undefined : num(row.amount_rmb),
        notes: str(row.notes),
        created_at: str(row.created_at),
        contract_no: '',
        customer_name: '',
        export_type: '自营'
      })),
      paymentReceipts: paymentReceipts.map((row) => ({
        id: row.id,
        customer_id: row.customer_id,
        receipt_no: str(row.receipt_no),
        payment_date: str(row.payment_date),
        total_amount: num(row.total_amount),
        currency: row.currency || 'USD',
        payment_type: row.payment_type || '其他',
        exchange_rate: row.exchange_rate === null || row.exchange_rate === undefined ? undefined : num(row.exchange_rate),
        amount_rmb: row.amount_rmb === null || row.amount_rmb === undefined ? undefined : num(row.amount_rmb),
        notes: str(row.notes),
        created_at: str(row.created_at)
      })),
      invoices: invoices.map((row) => ({
        id: row.id,
        shipment_id: row.shipment_id,
        shipment_ids: [],
        shipment_allocations: [],
        invoice_no: str(row.invoice_no),
        invoice_date: str(row.invoice_date),
        amount: num(row.amount),
        currency: row.currency || 'USD',
        invoice_type: row.invoice_type || '外贸内部发票',
        status: row.status || '未申请',
        notes: str(row.notes),
        created_at: str(row.created_at),
        shipment_no: '',
        contract_no: '',
        customer_name: '',
        export_type: '自营'
      })),
      invoiceShipments: invoiceShipments.map((row) => ({
        invoice_id: row.invoice_id,
        shipment_id: row.shipment_id,
        allocated_amount: num(row.allocated_amount)
      })),
      exchangeRates: exchangeRates.map((row) => ({
        id: row.id,
        effective_month: str(row.effective_month),
        currency_pair: str(row.currency_pair || 'USD/CNY'),
        rate: num(row.rate),
        source_date: str(row.source_date),
        source: row.source || 'Manual',
        notes: str(row.notes),
        created_at: str(row.created_at)
      })),
      alerts: alerts.map((row) => ({
        id: row.id,
        alert_type: str(row.alert_type),
        related_type: row.related_type || 'contact_sheet',
        related_id: str(row.related_id),
        priority: row.priority || 'medium',
        message: str(row.message),
        status: row.status || '未处理',
        created_at: str(row.created_at),
        handled_at: row.handled_at || undefined,
        snoozed_until: row.snoozed_until || undefined
      })),
      syncLogs: syncLogs.map((row) => ({
        id: row.id,
        sync_type: row.sync_type || 'import',
        status: row.status || 'success',
        started_at: str(row.started_at),
        finished_at: str(row.finished_at),
        message: str(row.message),
        details: row.details
      })),
      shipmentProfits: shipmentProfits.map((row) => ({
        shipment_id: row.shipment_id,
        owner_id: row.owner_id,
        shipment_no: str(row.shipment_no),
        shipment_date: str(row.shipment_date),
        contract_no: str(row.contract_no),
        customer_name: str(row.customer_name),
        export_type: row.export_type || '自营',
        currency: row.currency || 'USD',
        contact_sheet_no: str(row.contact_sheet_no),
        batch_no: str(row.batch_no),
        material_no: str(row.material_no),
        product_name: str(row.product_name),
        specification: str(row.specification),
        unit: str(row.unit),
        shipped_quantity: num(row.shipped_quantity),
        unit_price: num(row.unit_price),
        sales_amount: num(row.sales_amount),
        invoice_month: str(row.invoice_month),
        cost_month: str(row.cost_month),
        unit_cost: row.unit_cost === null || row.unit_cost === undefined ? null : num(row.unit_cost),
        exchange_rate: row.exchange_rate === null || row.exchange_rate === undefined ? null : num(row.exchange_rate),
        sales_amount_rmb: row.sales_amount_rmb === null || row.sales_amount_rmb === undefined ? null : num(row.sales_amount_rmb),
        profit: row.profit === null || row.profit === undefined ? null : num(row.profit),
        gross_margin: row.gross_margin === null || row.gross_margin === undefined ? null : num(row.gross_margin),
        is_estimated_profit: Boolean(row.is_estimated_profit),
        incoterm: row.incoterm === 'CIF' ? 'CIF' : row.incoterm === 'FOB' ? 'FOB' : null,
        cif_amount: row.cif_amount === null || row.cif_amount === undefined ? null : num(row.cif_amount),
        freight_insurance_amount: row.freight_insurance_amount === null || row.freight_insurance_amount === undefined
          ? null
          : num(row.freight_insurance_amount),
        fob_amount: row.fob_amount === null || row.fob_amount === undefined ? null : num(row.fob_amount),
        freight_insurance_rmb: row.freight_insurance_rmb === null || row.freight_insurance_rmb === undefined
          ? null
          : num(row.freight_insurance_rmb),
        profit_basis_amount_rmb: row.profit_basis_amount_rmb === null || row.profit_basis_amount_rmb === undefined
          ? null
          : num(row.profit_basis_amount_rmb),
        product_cost_total_rmb: row.product_cost_total_rmb === null || row.product_cost_total_rmb === undefined
          ? null
          : num(row.product_cost_total_rmb)
      })),
      analysisTemplates: analysisTemplates.map((row) => ({
        id: row.id,
        name: str(row.name),
        filters: row.filters || {},
        metrics: Array.isArray(row.metrics) ? row.metrics : [],
        dimension: str(row.dimension || 'month'),
        chartType: str(row.chart_type || 'composed'),
        currencyMode: row.currency_mode === 'original' ? 'original' : 'RMB'
      }))
    };
    cacheOwnerId = currentOwnerId;
    refreshDerived();
    const tableRows = {
      customers: customers.length,
      contracts: contracts.length,
      contact_sheets: contactSheets.length,
      batches: batches.length,
      shipments: shipments.length,
      shipment_groups: shipmentGroups.length,
      shipment_items: shipmentItems.length,
      payments: payments.length,
      payment_receipts: paymentReceipts.length,
      invoices: invoices.length,
      invoice_shipments: invoiceShipments.length,
      exchange_rates: exchangeRates.length,
      alerts: alerts.length,
      sync_logs: syncLogs.length,
      v_shipment_profit: shipmentProfits.length,
      analysis_templates: analysisTemplates.length,
      app_user_profiles: appUserProfiles.length
    };
    lastLoadPerformance = {
      durationMs: Date.now() - loadStartedAt,
      totalRows: Object.values(tableRows).reduce((sum, count) => sum + count, 0),
      tableRows,
      measuredAt: new Date().toISOString()
    };
  } catch (error) {
    if (!isSameOwner) cache = emptyCache();
    const detail = error instanceof Error ? error.message : String(error);
    lastLoadError = isSameOwner
      ? `本地数据刷新失败，页面暂时保留上次成功加载的数据：${detail}`
      : detail;
    throw error;
  }
}

async function post<T>(path: string, body: unknown, headers?: HeadersInit): Promise<T> {
  const rows = await localRest<T[]>(path, { method: 'POST', body: JSON.stringify(body), headers });
  if (!rows[0]) throw new Error('本地没有返回新增记录，请刷新页面后核对数据。');
  return rows[0];
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const rows = await localRest<T[]>(path, { method: 'PATCH', body: JSON.stringify(body) });
  if (!rows[0]) throw new Error('本地没有找到可更新的记录，请刷新页面后重试。');
  return rows[0];
}

async function remove<T = unknown>(path: string): Promise<T[]> {
  return localRest<T[]>(path, { method: 'DELETE' });
}

async function removeOne<T>(table: string, id: string, label: string): Promise<T> {
  const rows = await remove<T>(`${table}?id=eq.${id}`);
  if (!rows[0]) throw new Error(`本地没有找到可删除的${label}，请刷新页面后重试。`);
  return rows[0];
}

async function waitForAll<T>(promises: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const values: T[] = [];
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
    values.push(result.value);
  }
  return values;
}

export async function refreshLocalAlerts() {
  await localRest<number>('rpc/refresh_alerts', { method: 'POST', body: '{}' });
}

async function refreshAfterConfirmedWrite(refreshAlerts = false) {
  const errors: string[] = [];
  if (refreshAlerts) {
    try {
      await refreshLocalAlerts();
    } catch (error) {
      errors.push(`提醒重算失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    await initDataStore(true);
  } catch (error) {
    errors.push(`页面刷新失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (errors.length > 0) {
    lastLoadError = `业务数据已写入本地，但后续刷新未完整完成。${errors.join('；')}`;
  }
}

const LOCAL_EXPORT_TYPES = {
  'export-production': true,
  'export-monthly': true,
  'export-original-contracts': true,
  'export-helper': true,
  'export-payments': true,
  'export-customer-monthly-sales': true,
  'export-rmb-invoice': true,
  'export-shipment-plan': true,
  'export-receipt-confirmation': true,
  'export-shipment-details': true,
} as const;

async function runLocalExport(command: keyof typeof LOCAL_EXPORT_TYPES, filters: Record<string, string | string[]> = {}) {
  return downloadLocalFile(
    `export/${command}`, { method: 'POST', body: JSON.stringify(filters) },
    command === 'export-receipt-confirmation' ? '收货确认函.docx' : '演示报表.xlsx',
  );
}

async function getGlobalContactSheetNumberConflict(contactSheetNo: string, excludeContactSheetId?: string | null) {
  if (!contactSheetNo.trim()) return null;
  return localRest<BusinessIdentifierConflict | null>('rpc/get_global_contact_sheet_number_conflict', {
    method: 'POST',
    body: JSON.stringify({
      p_contact_sheet_no: contactSheetNo.trim(),
      p_exclude_contact_sheet_id: excludeContactSheetId || null
    })
  });
}

async function getGlobalContractNumberConflict(contractNo: string, excludeContractId?: string | null) {
  if (!contractNo.trim()) return null;
  return localRest<BusinessIdentifierConflict | null>('rpc/get_global_contract_number_conflict', {
    method: 'POST',
    body: JSON.stringify({
      p_contract_no: contractNo.trim(),
      p_exclude_contract_id: excludeContractId || null
    })
  });
}

async function getGlobalBatchNumberConflicts(batchNumbers: string[], excludeContactSheetId?: string | null) {
  const normalizedNumbers = Array.from(new Set(batchNumbers.map((value) => value.trim()).filter(Boolean)));
  if (normalizedNumbers.length === 0) return [];
  return localRest<BatchIdentifierConflict[]>('rpc/get_global_batch_number_conflicts', {
    method: 'POST',
    body: JSON.stringify({
      p_batch_numbers: normalizedNumbers,
      p_exclude_contact_sheet_id: excludeContactSheetId || null
    })
  });
}

export const db = {
  getLastLoadError: () => lastLoadError,
  getLastLoadPerformance: () => lastLoadPerformance,
  getCustomers: () => cache.customers,
  getContracts: () => cache.contracts,
  getContactSheets: () => cache.contactSheets,
  getBatches: () => cache.batches,
  getShipments: () => cache.shipments,
  getShipmentGroups: () => cache.shipmentGroups,
  getPayments: () => cache.payments,
  getPaymentReceipts: () => cache.paymentReceipts,
  getInvoices: () => cache.invoices,
  getInvoiceShipments: () => cache.invoiceShipments,
  getExchangeRates: () => cache.exchangeRates,
  getAlerts: () => cache.alerts,
  getSyncLogs: () => cache.syncLogs,
  getShipmentProfits: () => cache.shipmentProfits,
  getAnalysisTemplates: () => cache.analysisTemplates,
  exportBackup: () => ({
    customers: cache.customers,
    contracts: cache.contracts,
    contact_sheets: cache.contactSheets,
    batches: cache.batches,
    shipments: cache.shipments,
    shipment_groups: cache.shipmentGroups,
    shipment_items: cache.shipmentItems,
    payments: cache.payments,
    payment_receipts: cache.paymentReceipts,
    invoices: cache.invoices,
    invoice_shipments: cache.invoiceShipments,
    exchange_rates: cache.exchangeRates,
    alerts: cache.alerts,
    sync_logs: cache.syncLogs,
    shipment_profit_view: cache.shipmentProfits,
    exported_at: new Date().toISOString(),
    source: 'local-cache'
  }),
  getTable: <T,>(key: string): T[] => {
    if (key.includes('shipment_items')) return cache.shipmentItems as T[];
    if (key.includes('batches')) return cache.batches as T[];
    if (key.includes('v_shipment_profit')) return cache.shipmentProfits as T[];
    return [] as T[];
  },
  getShipmentDetails: (shipmentId: string) => cache.shipmentItems.filter((item) => item.shipment_id === shipmentId),
  getGlobalContactSheetNumberConflict,
  getGlobalContractNumberConflict,
  getGlobalBatchNumberConflicts,
  runLocalExport: async (
    command: keyof typeof LOCAL_EXPORT_TYPES,
    filters?: Record<string, string | string[]>,
  ) => {
    return runLocalExport(command, filters || {});
  },
  saveAnalysisTemplates: async (templates: AnalysisTemplate[]) => {
    const currentOwnerId = ownerId();
    const uniqueTemplates = Array.from(new Map(
      templates
        .filter((template) => template.name.trim())
        .map((template) => [template.name.trim(), { ...template, name: template.name.trim() }])
    ).values());
    try {
      await waitForAll(uniqueTemplates.map((template) => post<AnalysisTemplate>('analysis_templates?on_conflict=owner_id,name', {
        owner_id: currentOwnerId,
        name: template.name,
        filters: template.filters || {},
        metrics: template.metrics || [],
        dimension: template.dimension || 'month',
        chart_type: template.chartType || 'composed',
        currency_mode: template.currencyMode || 'RMB'
      }, { Prefer: 'resolution=merge-duplicates,return=representation' })));
    } catch (error) {
      await initDataStore().catch(() => undefined);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`分析模板未能全部同步，请核对当前模板列表后重试：${detail}`);
    }
    await refreshAfterConfirmedWrite();
  },

  addCustomer: async (data: Omit<Customer, 'id' | 'created_at' | 'owner_id' | 'owner_display_name'>) => {
    const normalizedName = normalizeCustomerIdentity(data.name);
    const currentOwnerId = ownerId();
    const existing = cache.customers.find((customer) => (
      customer.owner_id === currentOwnerId
      && normalizeCustomerIdentity(customer.name) === normalizedName
    ));
    if (existing) {
      throw new Error(`客户“${existing.name}”已经存在；系统已忽略名称中的空格和常见标点差异。若两者确为不同客户，请先使用更完整的名称区分。`);
    }
    const saved = await post<Customer>('customers', {
      owner_id: currentOwnerId,
      name: data.name,
      country: data.country,
      is_staggered_month: data.is_staggered_month,
      expiry_years: data.expiry_years,
      default_currency: data.default_currency,
      default_payment_terms: data.default_payment_terms,
      notes: data.notes
    });
    await refreshAfterConfirmedWrite();
    return saved;
  },
  updateCustomer: async (id: string, data: Partial<Customer>) => {
    if (data.name !== undefined) {
      const normalizedName = normalizeCustomerIdentity(data.name);
      const currentOwnerId = ownerId();
      const existing = cache.customers.find((customer) => (
        customer.id !== id
        && customer.owner_id === currentOwnerId
        && normalizeCustomerIdentity(customer.name) === normalizedName
      ));
      if (existing) {
        throw new Error(`客户“${existing.name}”已经存在；系统已忽略名称中的空格和常见标点差异。若两者确为不同客户，请先使用更完整的名称区分。`);
      }
    }
    await patch<Customer>(`customers?id=eq.${id}`, {
      name: data.name,
      country: data.country,
      is_staggered_month: data.is_staggered_month,
      expiry_years: data.expiry_years,
      default_currency: data.default_currency,
      default_payment_terms: data.default_payment_terms,
      notes: data.notes
    });
    await refreshAfterConfirmedWrite();
  },
  deleteCustomer: async (id: string) => {
    await removeOne<Customer>('customers', id, '客户');
    await refreshAfterConfirmedWrite(true);
  },
  mergeCustomers: async (sourceCustomerId: string, targetCustomerId: string) => {
    if (!sourceCustomerId || !targetCustomerId) throw new Error('请选择要合并的客户和保留的客户。');
    if (sourceCustomerId === targetCustomerId) throw new Error('不能把客户合并到自身。');
    const result = await localRest<CustomerMergeResult>('rpc/merge_customer_records', {
      method: 'POST',
      body: JSON.stringify({
        source_customer_id: sourceCustomerId,
        target_customer_id: targetCustomerId
      })
    });
    await refreshAfterConfirmedWrite(true);
    return result;
  },

  addContract: async (data: any) => {
    assertUniqueText(cache.contracts, 'contract_no', data.contract_no, '合同号');
    const contractCurrency = data.currency === 'RMB' ? 'RMB' : 'USD';
    const incoterm = contractCurrency === 'USD' ? (data.incoterm === 'CIF' ? 'CIF' : 'FOB') : null;
    const saved = await post<Contract>('contracts', {
      owner_id: ownerId(),
      ...data,
      incoterm,
      contract_no: String(data.contract_no).trim(),
      contract_date: data.contract_date || null,
      destination_country: String(data.destination_country || '').trim(),
      packaging_confirmed_date: data.packaging_confirmed_date || null,
      agreed_delivery_date: data.agreed_delivery_date || null
    });
    await refreshAfterConfirmedWrite(true);
    return saved;
  },
  updateContract: async (id: string, data: Partial<Contract>) => {
    if (data.contract_no !== undefined) {
      assertUniqueText(cache.contracts, 'contract_no', data.contract_no, '合同号', id);
    }
    const current = cache.contracts.find((row) => row.id === id);
    const nextCurrency = data.currency || current?.currency || 'USD';
    await patch<Contract>(`contracts?id=eq.${id}`, {
      ...data,
      ...(data.currency !== undefined || data.incoterm !== undefined
        ? { incoterm: nextCurrency === 'USD' ? (data.incoterm === 'CIF' ? 'CIF' : data.incoterm === 'FOB' ? 'FOB' : current?.incoterm || 'FOB') : null }
        : {}),
      ...(data.contract_no !== undefined ? { contract_no: data.contract_no.trim() } : {}),
      ...(data.contract_date !== undefined ? { contract_date: data.contract_date || null } : {}),
      ...(data.destination_country !== undefined ? { destination_country: data.destination_country.trim() } : {}),
      ...(data.packaging_confirmed_date !== undefined ? { packaging_confirmed_date: data.packaging_confirmed_date || null } : {}),
      ...(data.agreed_delivery_date !== undefined ? { agreed_delivery_date: data.agreed_delivery_date || null } : {})
    });
    await refreshAfterConfirmedWrite(true);
  },
  deleteContract: async (id: string) => {
    await removeOne<Contract>('contracts', id, '合同');
    await refreshAfterConfirmedWrite(true);
  },

  addContactSheet: async (data: any) => {
    assertPositiveNumber(data.unit_price, '联系单单价');
    assertPositiveNumber(data.quantity, '联系单数量');
    if (data.pcs_per_carton !== undefined && data.pcs_per_carton !== null && data.pcs_per_carton !== '') {
      assertPositiveNumber(data.pcs_per_carton, '每箱装量');
    }
    if (data.gross_weight_kg !== undefined && data.gross_weight_kg !== null && data.gross_weight_kg !== '') {
      assertPositiveNumber(data.gross_weight_kg, '毛重');
    }
    if (!isAllowedContactSheetUnit(String(data.unit || ''))) {
      throw new Error('计量单位只能选择支、盒、瓶、kg或十亿。');
    }
    const contactSheetNo = String(data.contact_sheet_no || '').trim();
    const conflict = await getGlobalContactSheetNumberConflict(contactSheetNo);
    if (conflict) {
      throw new Error(`联系单号“${contactSheetNo}”已由${conflict.owner_display_name}用于合同 ${conflict.contract_no}，不能重复保存。`);
    }
    const saved = await post<ContactSheet>('contact_sheets', {
      owner_id: ownerId(),
      contract_id: data.contract_id,
      business_type: data.business_type === '原料药' ? '原料药' : '制剂',
      is_historical: false,
      contact_sheet_no: contactSheetNo || null,
      material_no: String(data.material_no || '').trim(),
      product_variant_id: data.product_variant_id || null,
      product_name: data.product_name,
      specification: data.specification,
      packaging: data.packaging,
      packaging_profile_version_id: data.packaging_profile_version_id || null,
      packaging_confirmed_date: data.packaging_confirmed_date || null,
      quality_standard: data.quality_standard,
      unit_price: data.unit_price,
      quantity: data.quantity,
      unit: normalizeContactSheetUnit(data.unit),
      ...(supportsPcsPerCarton ? { pcs_per_carton: data.pcs_per_carton || null } : {}),
      gross_weight_kg: data.gross_weight_kg || null,
      production_date: data.production_date || null,
      expiry_date: data.expiry_date || null,
      is_staggered_month: data.is_staggered_month,
      qa_approval_date: data.qa_approval_date || null,
      aps_scheduled_date: data.aps_scheduled_date || null,
      actual_warehousing_date: data.actual_warehousing_date || null,
      estimated_release_date: data.estimated_release_date || null,
      actual_release_date: data.actual_release_date || null,
      aps_auto_query_enabled: data.business_type === '原料药' ? false : data.aps_auto_query_enabled,
      reference_contact_sheet: data.reference_contact_sheet,
      notes: data.notes
    });
    await refreshAfterConfirmedWrite(true);
    return saved;
  },
  updateContactSheet: async (id: string, data: Partial<ContactSheet>) => {
    if (data.unit_price !== undefined) assertPositiveNumber(data.unit_price, '联系单单价');
    if (data.quantity !== undefined) assertPositiveNumber(data.quantity, '联系单数量');
    if (data.pcs_per_carton !== undefined && data.pcs_per_carton !== null) {
      assertPositiveNumber(data.pcs_per_carton, '每箱装量');
    }
    if (data.gross_weight_kg !== undefined && data.gross_weight_kg !== null) {
      assertPositiveNumber(data.gross_weight_kg, '毛重');
    }
    const oldSheet = cache.contactSheets.find((row) => row.id === id);
    if (!oldSheet) throw new Error('当前页面没有找到要编辑的联系单，请刷新后重试。');
    if (data.contract_id && data.contract_id !== oldSheet.contract_id) {
      throw new Error('普通编辑不能更换联系单所属合同。如确需调整归属，请使用专门的合同迁移功能。');
    }
    if (data.contact_sheet_no !== undefined) {
      const nextContactSheetNo = data.contact_sheet_no.trim();
      const conflict = await getGlobalContactSheetNumberConflict(nextContactSheetNo, id);
      if (conflict) {
        throw new Error(`联系单号“${nextContactSheetNo}”已由${conflict.owner_display_name}用于合同 ${conflict.contract_no}，不能重复保存。`);
      }
    }
    const nextBusinessType = data.business_type || oldSheet.business_type;
    const nextUnit = normalizeContactSheetUnit(data.unit || oldSheet.unit);
    if (!isAllowedContactSheetUnit(nextUnit)) {
      throw new Error('计量单位只能选择支、盒、瓶、kg或十亿。');
    }
    const { pcs_per_carton: pcsPerCarton, ...writableData } = data;
    delete writableData.contract_id;
    const warehouseDateChanged = data.actual_warehousing_date !== undefined
      && data.actual_warehousing_date !== oldSheet?.actual_warehousing_date;
    const estimated = data.actual_warehousing_date && warehouseDateChanged
      ? calculateEstimatedReleaseDate(data.actual_warehousing_date, data.product_name || oldSheet?.product_name || '')
      : data.estimated_release_date;
    const patchData = {
      ...writableData,
      ...(data.unit !== undefined ? { unit: nextUnit } : {}),
      ...(data.material_no !== undefined ? { material_no: data.material_no.trim() } : {}),
      ...(data.product_variant_id !== undefined ? { product_variant_id: data.product_variant_id || null } : {}),
      ...(nextBusinessType === '原料药' ? { aps_auto_query_enabled: false } : {}),
      ...(supportsPcsPerCarton && pcsPerCarton !== undefined ? { pcs_per_carton: pcsPerCarton } : {}),
      ...(data.packaging_profile_version_id !== undefined
        ? { packaging_profile_version_id: data.packaging_profile_version_id || null }
        : {}),
      ...(data.packaging_confirmed_date !== undefined ? { packaging_confirmed_date: data.packaging_confirmed_date || null } : {}),
      ...(data.qa_approval_date !== undefined ? { qa_approval_date: data.qa_approval_date || null } : {}),
      ...(data.aps_scheduled_date !== undefined ? { aps_scheduled_date: data.aps_scheduled_date || null } : {}),
      ...(data.box_artwork_confirmed_date !== undefined ? { box_artwork_confirmed_date: data.box_artwork_confirmed_date || null } : {}),
      ...(data.actual_warehousing_date !== undefined ? { actual_warehousing_date: data.actual_warehousing_date || null } : {}),
      ...((warehouseDateChanged || data.estimated_release_date !== undefined)
        ? { estimated_release_date: estimated || null }
        : {}),
      ...(data.actual_release_date !== undefined ? { actual_release_date: data.actual_release_date || null } : {})
    };
    const versionFilter = oldSheet.updated_at
      ? `&updated_at=eq.${encodeURIComponent(oldSheet.updated_at)}`
      : '';
    await patch<ContactSheet>(
      `contact_sheets?id=eq.${id}&contract_id=eq.${oldSheet.contract_id}${versionFilter}`,
      patchData
    );
    await refreshAfterConfirmedWrite(true);
  },
  getContactSheetHistory: async (sheetId: string) => {
    return localRest<ContactSheetChangeHistory[]>(
      `contact_sheet_change_history?select=id,contact_sheet_id,changed_at,old_data,new_data&contact_sheet_id=eq.${encodeURIComponent(sheetId)}&order=changed_at.desc&limit=20`
    );
  },
  restoreContactSheetHistory: async (sheetId: string, historyId: string) => {
    const currentSheet = cache.contactSheets.find((row) => row.id === sheetId);
    if (!currentSheet) throw new Error('当前页面没有找到要回退的联系单，请刷新后重试。');
    const historyRows = await localRest<ContactSheetChangeHistory[]>(
      `contact_sheet_change_history?select=id,contact_sheet_id,changed_at,old_data,new_data&id=eq.${encodeURIComponent(historyId)}&contact_sheet_id=eq.${encodeURIComponent(sheetId)}&limit=1`
    );
    const history = historyRows[0];
    if (!history) throw new Error('没有找到这条修改历史，可能已被清理，请刷新后重试。');
    const before = history.old_data;
    const previousContractId = String(before.contract_id || '');
    if (!cache.contracts.some((contract) => contract.id === previousContractId)) {
      throw new Error('历史版本所属合同已经不存在，无法自动回退。');
    }
    const restorableFields = [
      'contract_id',
      'business_type',
      'contact_sheet_no',
      'material_no',
      'product_name',
      'specification',
      'packaging',
      'quality_standard',
      'unit_price',
      'quantity',
      'unit',
      'pcs_per_carton',
      'gross_weight_kg',
      'production_date',
      'expiry_date',
      'is_staggered_month',
      'qa_approval_date',
      'aps_scheduled_date',
      'actual_warehousing_date',
      'estimated_release_date',
      'actual_release_date',
      'aps_auto_query_enabled',
      'reference_contact_sheet',
      'notes'
    ];
    const restoreData = Object.fromEntries(
      restorableFields
        .filter((field) => Object.prototype.hasOwnProperty.call(before, field))
        .map((field) => [field, before[field]])
    );
    const versionFilter = currentSheet.updated_at
      ? `&updated_at=eq.${encodeURIComponent(currentSheet.updated_at)}`
      : '';
    await patch<ContactSheet>(
      `contact_sheets?id=eq.${sheetId}&contract_id=eq.${currentSheet.contract_id}${versionFilter}`,
      restoreData
    );
    await refreshAfterConfirmedWrite(true);
  },
  deleteContactSheet: async (id: string) => {
    await removeOne<ContactSheet>('contact_sheets', id, '联系单');
    await refreshAfterConfirmedWrite(true);
  },

  saveBatches: async (sheetId: string, batchList: any[]) => {
    const normalizedBatchNumbers = batchList.map((row) => String(row.batch_no || '').trim().toLocaleLowerCase());
    if (new Set(normalizedBatchNumbers).size !== normalizedBatchNumbers.length) {
      throw new Error('同一联系单内不能保存重复批号。');
    }
    batchList.forEach((row) => {
      if (!String(row.batch_no || '').trim()) throw new Error('批号不能为空。');
      assertPositiveNumber(row.batch_quantity, '批次数量');
    });
    await localRest<number>('rpc/replace_contact_sheet_batches', {
      method: 'POST',
      body: JSON.stringify({
        target_contact_sheet_id: sheetId,
        batch_rows: batchList.map((row) => ({
          batch_no: String(row.batch_no).trim(),
          batch_quantity: row.batch_quantity,
          production_date: row.production_date || null,
          expiry_date: row.expiry_date || null,
          warehouse_date: row.warehouse_date || null,
          release_date: row.release_date || null,
          notes: row.notes || null
        }))
      })
    });
    await refreshAfterConfirmedWrite(true);
  },
  updateBatch: async (id: string, data: Partial<Batch>) => {
    await localRest<number>('rpc/update_batch_tracking', {
      method: 'POST',
      body: JSON.stringify({
        target_batch_id: id,
        target_warehouse_date: data.warehouse_date || null,
        target_release_date: data.release_date || null,
        target_notes: data.notes || null
      })
    });
    await refreshAfterConfirmedWrite(true);
  },

  addPaymentReceipt: async (
    data: {
      customer_id: string;
      receipt_no?: string;
      payment_date: string;
      total_amount: number;
      currency: 'USD' | 'RMB';
      payment_type: Payment['payment_type'];
      exchange_rate?: number;
      notes?: string;
    },
    allocations: { contract_id: string; shipment_id?: string | null; amount: number; payment_type: PaymentType }[]
  ) => {
    assertPositiveNumber(data.total_amount, '收款总额');
    if (!cache.customers.some((row) => row.id === data.customer_id)) throw new Error('收款客户不存在，请刷新后重试。');
    const contracts = allocations.map((row) => cache.contracts.find((contract) => contract.id === row.contract_id));
    if (contracts.some((contract) => !contract || contract.customer_id !== data.customer_id)) throw new Error('合同分摊必须全部属于所选客户。');
    if (new Set(allocations.map((row) => row.contract_id)).size !== allocations.length) throw new Error('同一合同只能分摊一次。');
    if (contracts.some((contract) => contract?.currency !== data.currency)) throw new Error('合同币种必须与客户默认收款币种一致。');
    allocations.forEach((row) => {
      assertPositiveNumber(row.amount, '合同分摊金额');
      if (!isPaymentType(row.payment_type)) throw new Error('请选择每条合同分摊的收款类型。');
    });
    const allocationTotal = allocations.reduce((sum, row) => sum + Number(row.amount), 0);
    if (allocationTotal > data.total_amount + 0.01) throw new Error('合同分摊合计不能超过收款总额。');

    const id = await localRest<string>('rpc/create_payment_receipt_with_allocations', {
      method: 'POST',
      body: JSON.stringify({
        receipt_data: {
          ...data,
          receipt_no: data.receipt_no?.trim() || null,
          payment_date: data.payment_date || formatLocalDate(),
          exchange_rate: data.exchange_rate || null,
          notes: data.notes || null
        },
        allocation_rows: allocations.map((row) => ({ ...row, shipment_id: row.shipment_id || null }))
      })
    });
    await refreshAfterConfirmedWrite(true);
    return id;
  },
  updatePaymentReceipt: async (
    receiptId: string,
    data: { receipt_no?: string; payment_date: string; total_amount: number; currency: 'USD' | 'RMB'; payment_type: Payment['payment_type']; exchange_rate?: number; notes?: string; change_reason?: string },
    allocations: { contract_id: string; shipment_id?: string | null; amount: number; payment_type: PaymentType }[]
  ) => {
    const receipt = cache.paymentReceipts.find((row) => row.id === receiptId);
    if (!receipt) throw new Error('组合收款单不存在，请刷新后重试。');
    allocations.forEach((row) => {
      assertPositiveNumber(row.amount, '合同分摊金额');
      if (!isPaymentType(row.payment_type)) throw new Error('请选择每条合同分摊的收款类型。');
    });
    const replacementId = await localRest<string>('rpc/update_payment_receipt_with_allocations', {
      method: 'POST',
      body: JSON.stringify({
        target_receipt_id: receiptId,
        receipt_data: { ...data, receipt_no: data.receipt_no?.trim() || null, exchange_rate: data.exchange_rate || null, notes: data.notes || null },
        allocation_rows: allocations.map((row) => ({ ...row, shipment_id: row.shipment_id || null }))
      })
    });
    await refreshAfterConfirmedWrite(true);
    return replacementId;
  },
  returnPaymentAllocationToDeposit: async (paymentId: string) => {
    const payment = cache.payments.find((row) => row.id === paymentId);
    if (!payment?.receipt_id) throw new Error('该记录不是整笔收款中的合同分摊。');
    const receiptId = await localRest<string>('rpc/return_payment_allocation_to_deposit', {
      method: 'POST',
      body: JSON.stringify({ target_payment_id: paymentId })
    });
    await refreshAfterConfirmedWrite(true);
    return receiptId;
  },
  deletePaymentReceipt: async (id: string) => {
    await removeOne<PaymentReceipt>('payment_receipts', id, '组合收款单');
    await refreshAfterConfirmedWrite(true);
  },

  addPayment: async (data: any) => {
    assertPositiveNumber(data.amount, '收款金额');
    const contract = cache.contracts.find((row) => row.id === data.contract_id);
    if (!contract) throw new Error('收款关联的合同不存在，请刷新后重试。');
    if (data.shipment_id) {
      const shipment = cache.shipments.find((row) => row.id === data.shipment_id);
      if (!shipment || shipment.contract_id !== contract.id) {
        throw new Error('收款关联的发货记录不属于当前合同。');
      }
    }
    const exchangeRate = contract.currency === 'USD' && data.exchange_rate
      ? Number(data.exchange_rate)
      : null;
    if (exchangeRate !== null) assertPositiveNumber(exchangeRate, '收款汇率');
    const saved = await post<Payment>('payments', {
      owner_id: ownerId(),
      ...data,
      currency: contract.currency,
      payment_date: data.payment_date || formatLocalDate(),
      shipment_id: data.shipment_id || null,
      exchange_rate: exchangeRate,
      amount_rmb: contract.currency === 'RMB'
        ? data.amount
        : exchangeRate === null ? null : data.amount * exchangeRate
    });
    await refreshAfterConfirmedWrite(true);
    return saved;
  },
  updatePayment: async (id: string, data: Partial<Payment>) => {
    if (data.amount !== undefined) assertPositiveNumber(data.amount, '收款金额');
    const current = cache.payments.find((row) => row.id === id);
    if (current?.receipt_id) throw new Error('组合收款请从整笔收款单统一修改，不能单独改其中一条合同分摊。');
    const contractId = data.contract_id || current?.contract_id;
    const contract = cache.contracts.find((row) => row.id === contractId);
    if (!current || !contract) throw new Error('收款记录或关联合同不存在，请刷新后重试。');
    const amount = data.amount ?? current.amount;
    const linkedShipmentId = 'shipment_id' in data ? data.shipment_id : current.shipment_id;
    if (linkedShipmentId) {
      const linkedShipment = cache.shipments.find((row) => row.id === linkedShipmentId);
      if (!linkedShipment || linkedShipment.contract_id !== contract.id) {
        throw new Error('收款关联的发货记录不属于当前合同。');
      }
    }
    const exchangeRate = contract.currency === 'USD'
      ? (data.exchange_rate === undefined ? current.exchange_rate : data.exchange_rate)
      : null;
    if (exchangeRate !== null && exchangeRate !== undefined) assertPositiveNumber(exchangeRate, '收款汇率');
    await patch<Payment>(`payments?id=eq.${id}`, {
      contract_id: contract.id,
      payment_date: data.payment_date || current.payment_date,
      amount,
      currency: contract.currency,
      payment_type: data.payment_type || current.payment_type,
      shipment_id: linkedShipmentId || null,
      exchange_rate: exchangeRate,
      amount_rmb: contract.currency === 'RMB' ? amount : exchangeRate ? amount * exchangeRate : null,
      notes: data.notes === undefined ? current.notes : data.notes
    });
    await refreshAfterConfirmedWrite(true);
  },
  deletePayment: async (id: string) => {
    const payment = cache.payments.find((row) => row.id === id);
    if (payment?.receipt_id) throw new Error('组合收款不能只删除一条合同分摊，请删除整笔收款单。');
    await removeOne<Payment>('payments', id, '收款记录');
    await refreshAfterConfirmedWrite(true);
  },

  addShipmentGroup: async (
    groupData: { customer_id: string; shipment_no: string; shipment_date: string; status?: Shipment['status']; notes?: string },
    items: { contact_sheet_id: string; batch_id: string; shipped_quantity: number; unit_price: number }[]
  ) => {
    const number = String(groupData.shipment_no || '').trim();
    if (!number) throw new Error('发货单号不能为空。');
    if (cache.shipmentGroups.some((row) => row.shipment_no.trim().toLocaleLowerCase() === number.toLocaleLowerCase())
      || cache.shipments.some((row) => row.shipment_no.trim().toLocaleLowerCase() === number.toLocaleLowerCase())) {
      throw new Error(`发货单号“${number}”已经存在。`);
    }
    if (items.length === 0) throw new Error('请至少添加一条发货明细。');
    const grouped = new Map<string, typeof items>();
    items.forEach((item) => {
      const sheet = cache.contactSheets.find((row) => row.id === item.contact_sheet_id);
      const contract = cache.contracts.find((row) => row.id === sheet?.contract_id);
      if (!sheet || !contract || contract.customer_id !== groupData.customer_id) throw new Error('发货明细必须全部属于所选客户。');
      const list = grouped.get(contract.id) || [];
      list.push(item);
      grouped.set(contract.id, list);
    });
    const groupedContracts = Array.from(grouped.keys()).map((id) => cache.contracts.find((row) => row.id === id)!);
    if (new Set(groupedContracts.map((row) => row.currency)).size !== 1) throw new Error('一次合并发货只能包含同一币种的合同。');
    if (new Set(groupedContracts.map((row) => row.incoterm || '')).size !== 1) {
      throw new Error('一次合并发货只能包含相同贸易术语的合同，FOB 与 CIF 不能混发。');
    }

    const contractStatuses = Array.from(grouped.entries()).map(([contractId, contractItems]) => {
      validateShipmentItems(contractId, contractItems);
      const contract = cache.contracts.find((row) => row.id === contractId)!;
      const totalShipmentAmount = contractItems.reduce((sum, item) => sum + item.shipped_quantity * item.unit_price, 0);
      const contractPayments = cache.payments.filter((row) => row.contract_id === contract.id);
      const totalPaid = contractPayments.reduce((sum, row) => sum + row.amount, 0);
      const prepVal = contractPayments.filter((row) => row.payment_type === '预付款').reduce((sum, row) => sum + row.amount, 0);
      const contractAmount = cache.contactSheets.filter((row) => row.contract_id === contract.id).reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
      const check = checkPaymentTermsBeforeShipment(contract.payment_terms, contractAmount, prepVal, totalPaid, totalShipmentAmount);
      return {
        contract_id: contract.id,
        payment_check_status: check.status === 'approved' ? '可发货' : check.status === 'rejected' ? '不建议发货' : '需人工确认'
      };
    });

    const groupId = await localRest<string>('rpc/create_shipment_group_with_items', {
      method: 'POST',
      body: JSON.stringify({
        group_data: { ...groupData, shipment_no: number, shipment_date: groupData.shipment_date || null, status: groupData.status || '已发货', notes: groupData.notes || null },
        item_rows: items.map((item) => ({
          ...item,
          batch_id: item.batch_id || null,
          material_no: cache.contactSheets.find((row) => row.id === item.contact_sheet_id)?.material_no.trim() || '',
          notes: '合并发货明细'
        })),
        contract_status_rows: contractStatuses
      })
    });
    await refreshAfterConfirmedWrite(true);
    return groupId;
  },
  confirmShipmentGroupDispatched: async (
    groupId: string,
    actualShipmentDate: string,
    items: { contact_sheet_id: string; batch_id: string; shipped_quantity: number; unit_price: number }[],
    notes?: string
  ) => {
    const group = cache.shipmentGroups.find((row) => row.id === groupId);
    if (!group) throw new Error('发货安排不存在，请刷新后重试。');
    if (group.status !== '准备中') throw new Error('只有准备中的发货安排可以确认实际发货。');
    if (!actualShipmentDate) throw new Error('请填写真实发货日期。');
    if (!items.length) throw new Error('实际发货至少保留一条明细。');

    const contractItems = new Map<string, typeof items>();
    items.forEach((item) => {
      assertPositiveNumber(item.shipped_quantity, '实际发货数量');
      assertPositiveNumber(item.unit_price, '发货单价');
      const sheet = cache.contactSheets.find((row) => row.id === item.contact_sheet_id);
      const contract = cache.contracts.find((row) => row.id === sheet?.contract_id);
      if (!sheet || !contract || contract.customer_id !== group.customer_id || contract.currency !== group.currency || (contract.incoterm || null) !== (group.incoterm || null)) {
        throw new Error('实际发货明细必须属于原发货客户、币种和贸易术语，FOB 与 CIF 不能混发。');
      }
      const rows = contractItems.get(contract.id) || [];
      rows.push(item);
      contractItems.set(contract.id, rows);
    });

    const contractStatuses = Array.from(contractItems.entries()).map(([contractId, contractRows]) => {
      const contract = cache.contracts.find((row) => row.id === contractId)!;
      const totalShipmentAmount = contractRows.reduce((sum, item) => sum + item.shipped_quantity * item.unit_price, 0);
      const contractPayments = cache.payments.filter((row) => row.contract_id === contract.id);
      const totalPaid = contractPayments.reduce((sum, row) => sum + row.amount, 0);
      const prepVal = contractPayments.filter((row) => row.payment_type === '预付款').reduce((sum, row) => sum + row.amount, 0);
      const contractAmount = cache.contactSheets.filter((row) => row.contract_id === contract.id).reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
      const check = checkPaymentTermsBeforeShipment(contract.payment_terms, contractAmount, prepVal, totalPaid, totalShipmentAmount);
      return {
        contract_id: contract.id,
        payment_check_status: check.status === 'approved' ? '可发货' : check.status === 'rejected' ? '不建议发货' : '需人工确认'
      };
    });

    const result = await localRest<string>('rpc/confirm_shipment_group_dispatched', {
      method: 'POST',
      body: JSON.stringify({
        target_group_id: groupId,
        actual_shipment_date: actualShipmentDate,
        item_rows: items.map((item) => ({
          ...item,
          batch_id: item.batch_id || null,
          material_no: cache.contactSheets.find((row) => row.id === item.contact_sheet_id)?.material_no.trim() || '',
          notes: '实际发货确认明细'
        })),
        contract_status_rows: contractStatuses,
        actual_notes: notes || null
      })
    });
    await refreshAfterConfirmedWrite(true);
    return result;
  },
  deleteShipmentGroup: async (id: string) => {
    await removeOne<ShipmentGroup>('shipment_groups', id, '合并发货记录');
    await refreshAfterConfirmedWrite(true);
  },

  addShipment: async (shipmentData: any, items: { contact_sheet_id: string; batch_id: string; shipped_quantity: number; unit_price: number }[]) => {
    assertUniqueText(cache.shipments, 'shipment_no', shipmentData.shipment_no, '发货单号');
    const contract = cache.contracts.find((row) => row.id === shipmentData.contract_id);
    if (!contract) throw new Error('发货记录关联的合同不存在，请刷新后重试。');
    validateShipmentItems(contract.id, items);
    const totalShipmentAmount = items.reduce((sum, item) => sum + item.shipped_quantity * item.unit_price, 0);
    let paymentStatus = '需人工确认';
    const contractPayments = cache.payments.filter((row) => row.contract_id === contract.id);
    const totalPaid = contractPayments.reduce((sum, row) => sum + row.amount, 0);
    const prepVal = contractPayments.filter((row) => row.payment_type === '预付款').reduce((sum, row) => sum + row.amount, 0);
    const contractAmount = cache.contactSheets.filter((row) => row.contract_id === contract.id).reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
    const check = checkPaymentTermsBeforeShipment(contract.payment_terms, contractAmount, prepVal, totalPaid, totalShipmentAmount);
    paymentStatus = check.status === 'approved' ? '可发货' : check.status === 'rejected' ? '不建议发货' : '需人工确认';
    const savedShipmentId = await localRest<string>('rpc/create_shipment_with_items', {
      method: 'POST',
      body: JSON.stringify({
        shipment_data: {
          ...shipmentData,
          shipment_no: String(shipmentData.shipment_no).trim(),
          shipment_date: shipmentData.shipment_date || null,
          payment_check_status: paymentStatus
        },
        item_rows: items.map((item) => ({
          ...item,
          batch_id: item.batch_id || null,
          material_no: cache.contactSheets.find((row) => row.id === item.contact_sheet_id)?.material_no.trim() || '',
          notes: '新增发货明细'
        }))
      })
    });
    await refreshAfterConfirmedWrite(true);
    return cache.shipments.find((shipment) => shipment.id === savedShipmentId);
  },
  updateShipment: async (id: string, data: Partial<Shipment>) => {
    const current = cache.shipments.find((row) => row.id === id);
    if (current?.shipment_group_id) throw new Error('合并发货记录不能单独修改其中一个合同，请删除整笔后重新登记。');
    if (data.shipment_no !== undefined) {
      assertUniqueText(cache.shipments, 'shipment_no', data.shipment_no, '发货单号', id);
    }
    await patch<Shipment>(`shipments?id=eq.${id}`, {
      shipment_no: data.shipment_no?.trim(),
      ...(data.shipment_date !== undefined ? { shipment_date: data.shipment_date || null } : {}),
      status: data.status,
      notes: data.notes
    });
    await refreshAfterConfirmedWrite(true);
  },
  replaceShipmentItems: async (shipmentId: string, items: { contact_sheet_id: string; batch_id: string; shipped_quantity: number; unit_price: number }[]) => {
    const shipment = cache.shipments.find((row) => row.id === shipmentId);
    const contract = cache.contracts.find((row) => row.id === shipment?.contract_id);
    if (!shipment || !contract) throw new Error('发货记录或关联合同不存在，请刷新后重试。');
    if (shipment.shipment_group_id) {
      throw new Error('合并发货必须整单维护，不能单独修改其中一个合同的发货明细。请删除后重新创建整笔合并发货。');
    }
    validateShipmentItems(contract.id, items, shipmentId);
    const totalShipmentAmount = items.reduce((sum, item) => sum + item.shipped_quantity * item.unit_price, 0);
    let paymentStatus = shipment?.payment_check_status || '需人工确认';
    if (contract) {
      const contractPayments = cache.payments.filter((row) => row.contract_id === contract.id);
      const totalPaid = contractPayments.reduce((sum, row) => sum + row.amount, 0);
      const prepVal = contractPayments.filter((row) => row.payment_type === '预付款').reduce((sum, row) => sum + row.amount, 0);
      const contractAmount = cache.contactSheets.filter((row) => row.contract_id === contract.id).reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
      const check = checkPaymentTermsBeforeShipment(contract.payment_terms, contractAmount, prepVal, totalPaid, totalShipmentAmount);
      paymentStatus = check.status === 'approved' ? '可发货' : check.status === 'rejected' ? '不建议发货' : '需人工确认';
    }

    await localRest<number>('rpc/replace_shipment_items', {
      method: 'POST',
      body: JSON.stringify({
        target_shipment_id: shipmentId,
        target_payment_status: paymentStatus,
        item_rows: items.map((item) => ({
          ...item,
          batch_id: item.batch_id || null,
          material_no: cache.contactSheets.find((row) => row.id === item.contact_sheet_id)?.material_no.trim() || '',
          notes: '调整发货明细'
        }))
      })
    });
    await refreshAfterConfirmedWrite(true);
  },
  updateShipmentWithItems: async (
    shipmentId: string,
    data: Pick<Shipment, 'shipment_no' | 'shipment_date' | 'status' | 'notes'>,
    items: { contact_sheet_id: string; batch_id: string; shipped_quantity: number; unit_price: number }[]
  ) => {
    const shipment = cache.shipments.find((row) => row.id === shipmentId);
    if (shipment?.shipment_group_id) throw new Error('合并发货记录不能单独修改其中一个合同，请删除整笔后重新登记。');
    const contract = cache.contracts.find((row) => row.id === shipment?.contract_id);
    if (!shipment || !contract) throw new Error('发货记录或关联合同不存在，请刷新后重试。');
    assertUniqueText(cache.shipments, 'shipment_no', data.shipment_no, '发货单号', shipmentId);
    validateShipmentItems(contract.id, items, shipmentId, data.status);

    const totalShipmentAmount = items.reduce((sum, item) => sum + item.shipped_quantity * item.unit_price, 0);
    const contractPayments = cache.payments.filter((row) => row.contract_id === contract.id);
    const totalPaid = contractPayments.reduce((sum, row) => sum + row.amount, 0);
    const prepVal = contractPayments.filter((row) => row.payment_type === '预付款').reduce((sum, row) => sum + row.amount, 0);
    const contractAmount = cache.contactSheets
      .filter((row) => row.contract_id === contract.id)
      .reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
    const check = checkPaymentTermsBeforeShipment(contract.payment_terms, contractAmount, prepVal, totalPaid, totalShipmentAmount);
    const paymentStatus = check.status === 'approved' ? '可发货' : check.status === 'rejected' ? '不建议发货' : '需人工确认';

    await localRest<number>('rpc/update_shipment_with_items', {
      method: 'POST',
      body: JSON.stringify({
        target_shipment_id: shipmentId,
        shipment_data: {
          shipment_no: data.shipment_no.trim(),
          shipment_date: data.shipment_date || null,
          status: data.status,
          notes: data.notes
        },
        target_payment_status: paymentStatus,
        item_rows: items.map((item) => ({
          ...item,
          batch_id: item.batch_id || null,
          material_no: cache.contactSheets.find((row) => row.id === item.contact_sheet_id)?.material_no.trim() || '',
          notes: '调整发货明细'
        }))
      })
    });
    await refreshAfterConfirmedWrite(true);
  },
  deleteShipment: async (id: string) => {
    const shipment = cache.shipments.find((row) => row.id === id);
    if (shipment?.shipment_group_id) throw new Error('合并发货记录不能只删除其中一个合同，请删除整笔合并发货记录。');
    await removeOne<Shipment>('shipments', id, '发货记录');
    await refreshAfterConfirmedWrite(true);
  },

  markPhysicalShipmentInvoiced: async (
    shipmentId: string,
    data: { invoice_no?: string; invoice_date: string; notes?: string; freight_insurance_amount?: number | null }
  ) => {
    if (!data.invoice_date) throw new Error('请填写实际开完票日期。');
    if (String(data.invoice_no || '').trim()) {
      assertUniqueText(cache.invoices, 'invoice_no', data.invoice_no, '发票编号');
    }
    const id = await localRest<string>('rpc/mark_physical_shipment_invoiced', {
      method: 'POST',
      body: JSON.stringify({
        target_shipment_id: shipmentId,
        invoice_data: {
          invoice_no: data.invoice_no?.trim() || null,
          invoice_date: data.invoice_date,
          notes: data.notes?.trim() || null,
          freight_insurance_amount: data.freight_insurance_amount ?? null
        }
      })
    });
    await refreshAfterConfirmedWrite(true);
    return id;
  },

  updatePhysicalShipmentInvoice: async (
    invoiceId: string,
    data: { invoice_no?: string; invoice_date: string; notes?: string; freight_insurance_amount?: number | null }
  ) => {
    if (!data.invoice_date) throw new Error('请填写实际开完票日期。');
    if (String(data.invoice_no || '').trim()) {
      assertUniqueText(cache.invoices, 'invoice_no', data.invoice_no, '发票编号', invoiceId);
    }
    const id = await localRest<string>('rpc/update_physical_shipment_invoice', {
      method: 'POST',
      body: JSON.stringify({
        target_invoice_id: invoiceId,
        invoice_data: {
          invoice_no: data.invoice_no?.trim() || null,
          invoice_date: data.invoice_date,
          notes: data.notes?.trim() || null,
          freight_insurance_amount: data.freight_insurance_amount ?? null
        }
      })
    });
    await refreshAfterConfirmedWrite(true);
    return id;
  },

  addInvoiceWithShipments: async (
    data: { invoice_no?: string; invoice_date?: string; amount: number; status: Invoice['status']; notes?: string },
    allocations: { shipment_id: string; allocated_amount: number }[]
  ) => {
    assertPositiveNumber(data.amount, '开票金额');
    if (String(data.invoice_no || '').trim()) assertUniqueText(cache.invoices, 'invoice_no', data.invoice_no, '发票编号');
    if (allocations.length === 0) throw new Error('请至少选择一条已发货记录。');
    allocations.forEach((row) => assertPositiveNumber(row.allocated_amount, '发票分摊金额'));
    const linkedShipments = allocations.map((row) => cache.shipments.find((shipment) => shipment.id === row.shipment_id));
    if (linkedShipments.some((shipment) => !shipment || shipment.status !== '已发货')) throw new Error('发票只能关联已发货记录。');
    if (new Set(linkedShipments.map((shipment) => shipment?.customer_id)).size !== 1) throw new Error('一张发票只能覆盖同一客户。');
    if (new Set(linkedShipments.map((shipment) => shipment?.currency)).size !== 1) throw new Error('一张发票只能覆盖同一币种。');
    const allocated = allocations.reduce((sum, row) => sum + row.allocated_amount, 0);
    if (Math.abs(allocated - data.amount) > 0.01) throw new Error('发货分摊合计必须等于发票总额。');
    const id = await localRest<string>('rpc/create_invoice_with_shipments', {
      method: 'POST',
      body: JSON.stringify({ invoice_data: { ...data, invoice_no: data.invoice_no?.trim() || null, invoice_date: data.invoice_date || null, notes: data.notes || null }, shipment_rows: allocations })
    });
    await refreshAfterConfirmedWrite(true);
    return id;
  },
  updateInvoiceWithShipments: async (
    id: string,
    data: { invoice_no?: string; invoice_date?: string; amount: number; status: Invoice['status']; notes?: string },
    allocations: { shipment_id: string; allocated_amount: number }[]
  ) => {
    if (String(data.invoice_no || '').trim()) assertUniqueText(cache.invoices, 'invoice_no', data.invoice_no, '发票编号', id);
    const replacementId = await localRest<string>('rpc/update_invoice_with_shipments', {
      method: 'POST',
      body: JSON.stringify({ target_invoice_id: id, invoice_data: { ...data, invoice_no: data.invoice_no?.trim() || null, invoice_date: data.invoice_date || null, notes: data.notes || null }, shipment_rows: allocations })
    });
    await refreshAfterConfirmedWrite(true);
    return replacementId;
  },
  addInvoice: async (data: any) => {
    assertPositiveNumber(data.amount, '开票金额');
    if (String(data.invoice_no || '').trim()) {
      assertUniqueText(cache.invoices, 'invoice_no', data.invoice_no, '发票编号');
    }
    const shipment = cache.shipments.find((row) => row.id === data.shipment_id);
    if (!shipment) throw new Error('发票关联的发货记录不存在，请刷新后重试。');
    const contract = cache.contracts.find((row) => row.id === shipment.contract_id);
    if (!contract) throw new Error('发票关联合同不存在，请刷新后重试。');
    const id = await db.addInvoiceWithShipments({
      invoice_no: data.invoice_no,
      invoice_date: data.invoice_date,
      amount: data.amount,
      status: data.status || '未申请',
      notes: data.notes
    }, [{ shipment_id: shipment.id, allocated_amount: data.amount }]);
    return cache.invoices.find((row) => row.id === id);
  },
  updateInvoice: async (id: string, data: Partial<Invoice>) => {
    if (data.amount !== undefined) assertPositiveNumber(data.amount, '开票金额');
    if (data.invoice_no !== undefined && data.invoice_no.trim()) {
      assertUniqueText(cache.invoices, 'invoice_no', data.invoice_no, '发票编号', id);
    }
    const patchData: Record<string, unknown> = {};
    if ('shipment_id' in data) patchData.shipment_id = data.shipment_id;
    if ('invoice_no' in data) patchData.invoice_no = data.invoice_no?.trim() || null;
    if ('invoice_date' in data) patchData.invoice_date = data.invoice_date || null;
    if ('amount' in data) patchData.amount = data.amount;
    if ('currency' in data) patchData.currency = data.currency;
    if ('invoice_type' in data) patchData.invoice_type = data.invoice_type;
    if ('status' in data) patchData.status = data.status;
    if ('notes' in data) patchData.notes = data.notes;
    await patch<Invoice>(`invoices?id=eq.${id}`, patchData);
    await refreshAfterConfirmedWrite(true);
  },
  deleteInvoice: async (id: string) => {
    await removeOne<Invoice>('invoices', id, '发票记录');
    await refreshAfterConfirmedWrite(true);
  },

  saveExchangeRates: async (rates: ExchangeRate[]) => {
    try {
      await waitForAll(rates.map((rate) => post<ExchangeRate>('exchange_rates?on_conflict=owner_id,effective_month,currency_pair', {
        owner_id: PUBLIC_EXCHANGE_RATE_OWNER_ID,
        effective_month: rate.effective_month,
        currency_pair: rate.currency_pair,
        rate: rate.rate,
        source_date: rate.source_date || null,
        source: rate.source,
        notes: rate.notes
      }, { Prefer: 'resolution=merge-duplicates,return=representation' })));
    } catch (error) {
      await initDataStore().catch(() => undefined);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`汇率未能全部同步，请核对当前汇率列表后重试：${detail}`);
    }
    await refreshAfterConfirmedWrite();
  },
  deleteExchangeRate: async (id: string) => {
    await removeOne<ExchangeRate>('exchange_rates', id, '汇率记录');
    await refreshAfterConfirmedWrite();
  },

  updateAlertStatus: async (id: string, status: Alert['status'], snoozedUntil?: string) => {
    if (status === '稍后提醒' && !snoozedUntil) throw new Error('请选择稍后提醒日期。');
    await patch<Alert>(`alerts?id=eq.${id}`, {
      status,
      handled_at: ['已处理', '忽略'].includes(status) ? new Date().toISOString() : null,
      snoozed_until: status === '稍后提醒' ? snoozedUntil : null
    });
    await refreshAfterConfirmedWrite();
  },
  deleteAlert: async (id: string) => {
    await removeOne<Alert>('alerts', id, '提醒');
    await refreshAfterConfirmedWrite();
  },
  addSyncLog: async (log: Omit<SyncLog, 'id'>) => {
    const saved = await post<SyncLog>('sync_logs', { owner_id: ownerId(), ...log });
    await refreshAfterConfirmedWrite();
    return saved;
  }
};
