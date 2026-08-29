import { db } from './dataStore';
import type {
  Alert,
  Batch,
  ContactSheet,
  Contract,
  Customer,
  ExchangeRate,
  Invoice,
  Payment,
  PaymentReceipt,
  Shipment,
  ShipmentItem,
  ShipmentProfit
} from './dataStore';
import type { AnalysisTemplateConfig } from './analyticsPresets';

export interface AnalyticsDataSnapshot {
  customers: Customer[];
  contracts: Contract[];
  sheets: ContactSheet[];
  payments: Payment[];
  paymentReceipts: PaymentReceipt[];
  shipments: Shipment[];
  shipmentItems: ShipmentItem[];
  invoices: Invoice[];
  alerts: Alert[];
  batches: Batch[];
  shipmentProfits: ShipmentProfit[];
  exchangeRates: ExchangeRate[];
}

/**
 * 页面只依赖这一层的数据快照。当前实现读取已同步的本地缓存；以后切换为
 * SQLite 汇总查询或服务端分页时，可以在这里替换，而不必重写页面组件。
 */
export function loadAnalyticsDataSnapshot(): AnalyticsDataSnapshot {
  return {
    customers: db.getCustomers(),
    contracts: db.getContracts(),
    sheets: db.getContactSheets(),
    payments: db.getPayments(),
    paymentReceipts: db.getPaymentReceipts(),
    shipments: db.getShipments(),
    shipmentItems: db.getTable<ShipmentItem>('trade_shipment_items'),
    invoices: db.getInvoices(),
    alerts: db.getAlerts(),
    batches: db.getBatches(),
    shipmentProfits: db.getShipmentProfits(),
    exchangeRates: db.getExchangeRates()
  };
}

export function getAnalyticsShipmentItems(snapshot: AnalyticsDataSnapshot, shipmentId: string): ShipmentItem[] {
  return snapshot.shipmentItems.filter((item) => item.shipment_id === shipmentId);
}

export function loadAnalyticsTemplates(): AnalysisTemplateConfig[] {
  return db.getAnalysisTemplates() as AnalysisTemplateConfig[];
}

export async function saveAnalyticsTemplates(templates: AnalysisTemplateConfig[]): Promise<void> {
  await db.saveAnalysisTemplates(templates);
}
