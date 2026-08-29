import type { AnalyticsDataSnapshot } from './analyticsDataService';
import {
  getFiscalYearPeriod,
  getProductSkuKey,
  toRmb,
  type DateRange,
  type ProductTrendYear
} from './customerValueAnalytics.ts';
import { PRODUCT_OPERATING_CONFIG } from './productOperatingConfig.ts';
import type { ProductIdentityCatalog } from './productIdentityService';

export type ProductOperatingMetric = 'sales' | 'profit';
export type ProductIdentityState = 'mapped' | 'unmapped' | 'conflict';

export interface ProductOperatingRow {
  key: string;
  productName: string;
  specification: string;
  materialNumbers: string[];
  identityState: ProductIdentityState;
  salesRmb: number;
  confirmedSalesRmb: number;
  profitBasisRmb: number;
  profitRmb: number;
  grossMargin: number | null;
  activeCustomerCount: number;
  contactSheetCount: number;
  linkedBatchCount: number;
  physicalShipmentCount: number;
  amount: number;
  rank: number;
  share: number;
  cumulativeShare: number;
}

export interface ProductOperatingSummary {
  productCount: number;
  amount: number;
  share: number;
}

export interface ProductOperatingResult {
  metric: ProductOperatingMetric;
  rows: ProductOperatingRow[];
  allRows: ProductOperatingRow[];
  lossRows: ProductOperatingRow[];
  totalAmount: number;
  totalLossRmb: number;
  top1Share: number;
  top3Share: number;
  top5Share: number;
  n80: number;
  core: ProductOperatingSummary;
  tail: ProductOperatingSummary;
  missingSalesRateCount: number;
  pendingProfitLineCount: number;
  unmappedProductCount: number;
  conflictingProductCount: number;
  unlinkedBatchLineCount: number;
}

interface ResolvedIdentity {
  key: string;
  productName: string;
  specification: string;
  identityState: ProductIdentityState;
}

interface MutableProductRow {
  key: string;
  productName: string;
  specification: string;
  materialNumbers: Set<string>;
  identityState: ProductIdentityState;
  salesRmb: number;
  confirmedSalesRmb: number;
  profitBasisRmb: number;
  profitRmb: number;
  customerIds: Set<string>;
  contactSheetIds: Set<string>;
  batchIds: Set<string>;
  physicalShipmentIds: Set<string>;
}

const clean = (value: unknown) => String(value ?? '').trim();
const identityTextKey = (value: unknown) => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const within = (value: string, range: DateRange) => {
  const date = clean(value).slice(0, 10);
  return Boolean(date && date >= range.startDate && date <= range.endDate);
};

function createIdentityResolver(catalog: ProductIdentityCatalog) {
  const productById = new Map(catalog.products.map((product) => [product.id, product]));
  const variantById = new Map(catalog.products.flatMap((product) => product.variants.map((variant) => [variant.id, variant] as const)));
  const variantsBySnapshot = new Map<string, Set<string>>();
  for (const product of catalog.products) {
    const names = [product.productName, ...(product.aliases || [])].map(identityTextKey).filter(Boolean);
    for (const variant of product.variants) {
      for (const name of names) {
        const key = `${name}\u0000${identityTextKey(variant.specification)}`;
        const ids = variantsBySnapshot.get(key) || new Set<string>();
        ids.add(variant.id);
        variantsBySnapshot.set(key, ids);
      }
    }
  }

  return (details: {
    productVariantId?: string | null;
    materialNo: string;
    productName: string;
    specification: string;
    unit: string;
  }): ResolvedIdentity => {
    const directVariant = details.productVariantId ? variantById.get(details.productVariantId) : undefined;
    const snapshotCandidates = variantsBySnapshot.get(
      `${identityTextKey(details.productName)}\u0000${identityTextKey(details.specification)}`
    ) || new Set<string>();
    const candidateIds = directVariant ? new Set([directVariant.id]) : snapshotCandidates;
    const hasConflict = !directVariant && candidateIds.size > 1;
    if (!hasConflict && candidateIds.size === 1) {
      const variantId = [...candidateIds][0];
      const variant = variantById.get(variantId);
      const product = variant ? productById.get(variant.productId) : undefined;
      if (variant && product) {
        return {
          key: `variant:${variant.id}`,
          productName: clean(product.productName) || clean(product.englishName) || product.productCode,
          specification: clean(variant.specification) || clean(details.specification) || '—',
          identityState: 'mapped'
        };
      }
    }

    return {
      key: `sku:${getProductSkuKey(details.materialNo, details.productName, details.specification, details.unit)}`,
      productName: clean(details.productName) || '未命名产品',
      specification: clean(details.specification) || '—',
      identityState: hasConflict ? 'conflict' : 'unmapped'
    };
  };
}

function aggregateProducts(
  input: AnalyticsDataSnapshot,
  catalog: ProductIdentityCatalog,
  range: DateRange
) {
  const resolveIdentity = createIdentityResolver(catalog);
  const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const sheetById = new Map(input.sheets.map((sheet) => [sheet.id, sheet]));
  const sheetByBusinessKey = new Map(input.sheets.map((sheet) => [`${sheet.contract_no}\u0000${sheet.contact_sheet_no}`, sheet]));
  const rows = new Map<string, MutableProductRow>();
  let missingSalesRateCount = 0;
  let pendingProfitLineCount = 0;
  let unlinkedBatchLineCount = 0;

  const ensure = (identity: ResolvedIdentity) => {
    const existing = rows.get(identity.key);
    if (existing) {
      if (existing.identityState !== 'conflict' && identity.identityState === 'conflict') existing.identityState = 'conflict';
      return existing;
    }
    const row: MutableProductRow = {
      ...identity,
      materialNumbers: new Set<string>(),
      salesRmb: 0,
      confirmedSalesRmb: 0,
      profitBasisRmb: 0,
      profitRmb: 0,
      customerIds: new Set<string>(),
      contactSheetIds: new Set<string>(),
      batchIds: new Set<string>(),
      physicalShipmentIds: new Set<string>()
    };
    rows.set(identity.key, row);
    return row;
  };

  const shipmentById = new Map(input.shipments
    .filter((shipment) => shipment.status === '已发货' && within(shipment.shipment_date, range))
    .map((shipment) => [shipment.id, shipment]));

  for (const item of input.shipmentItems) {
    const shipment = shipmentById.get(item.shipment_id);
    if (!shipment) continue;
    const sheet = sheetById.get(item.contact_sheet_id);
    const materialNo = item.material_no || sheet?.material_no || '';
    const identity = resolveIdentity({
      materialNo,
      productVariantId: sheet?.product_variant_id,
      productName: item.product_name || sheet?.product_name || '',
      specification: item.specification || sheet?.specification || '',
      unit: item.unit || sheet?.unit || ''
    });
    const row = ensure(identity);
    if (clean(materialNo)) row.materialNumbers.add(clean(materialNo));
    const amount = item.amount || (item.shipped_quantity || 0) * (item.unit_price || 0);
    const converted = toRmb(amount, shipment.currency, shipment.shipment_date, input.exchangeRates);
    row.salesRmb += converted.value;
    if (converted.missingRate) missingSalesRateCount += 1;
    row.contactSheetIds.add(item.contact_sheet_id);
    if (item.batch_id) row.batchIds.add(item.batch_id);
    else unlinkedBatchLineCount += 1;
    row.physicalShipmentIds.add(shipment.shipment_group_id || shipment.id);
    const contract = contractById.get(shipment.contract_id);
    const customerId = shipment.customer_id || contract?.customer_id;
    if (customerId) row.customerIds.add(customerId);
  }

  for (const profit of input.shipmentProfits) {
    const invoiceDate = profit.invoice_month ? `${profit.invoice_month}-01` : '';
    if (!within(invoiceDate, range)) continue;
    if (profit.profit === null || profit.is_estimated_profit) {
      pendingProfitLineCount += 1;
      continue;
    }
    const sheet = sheetByBusinessKey.get(`${profit.contract_no}\u0000${profit.contact_sheet_no}`);
    const identity = resolveIdentity({
      materialNo: profit.material_no,
      productVariantId: sheet?.product_variant_id,
      productName: profit.product_name,
      specification: profit.specification,
      unit: profit.unit
    });
    const row = ensure(identity);
    if (clean(profit.material_no)) row.materialNumbers.add(clean(profit.material_no));
    row.profitRmb += profit.profit;
    row.confirmedSalesRmb += profit.sales_amount_rmb || 0;
    row.profitBasisRmb += profit.profit_basis_amount_rmb ?? profit.sales_amount_rmb ?? 0;
  }

  return {
    rows: [...rows.values()].map((row) => ({
      ...row,
      materialNumbers: [...row.materialNumbers].sort((left, right) => left.localeCompare(right, 'zh-CN')),
      grossMargin: row.profitBasisRmb > 0 ? row.profitRmb / row.profitBasisRmb : null,
      activeCustomerCount: row.customerIds.size,
      contactSheetCount: row.contactSheetIds.size,
      linkedBatchCount: row.batchIds.size,
      physicalShipmentCount: row.physicalShipmentIds.size
    })),
    missingSalesRateCount,
    pendingProfitLineCount,
    unlinkedBatchLineCount
  };
}

function topShare(rows: ProductOperatingRow[], count: number, total: number) {
  if (total <= 0) return 0;
  return rows.slice(0, count).reduce((sum, row) => sum + row.amount, 0) / total;
}

export function buildProductOperatingAnalysis(
  input: AnalyticsDataSnapshot,
  catalog: ProductIdentityCatalog,
  range: DateRange,
  metric: ProductOperatingMetric
): ProductOperatingResult {
  const aggregated = aggregateProducts(input, catalog, range);
  const baseRows = aggregated.rows.map((row) => ({
    ...row,
    amount: metric === 'profit' ? row.profitRmb : row.salesRmb,
    rank: 0,
    share: 0,
    cumulativeShare: 0
  }));
  const positiveRows = baseRows
    .filter((row) => row.amount > 0)
    .sort((left, right) => right.amount - left.amount || left.productName.localeCompare(right.productName, 'zh-CN') || left.key.localeCompare(right.key));
  const totalAmount = positiveRows.reduce((sum, row) => sum + row.amount, 0);
  let cumulativeAmount = 0;
  const rows = positiveRows.map((row, index) => {
    cumulativeAmount += row.amount;
    return {
      ...row,
      rank: index + 1,
      share: totalAmount > 0 ? row.amount / totalAmount : 0,
      cumulativeShare: totalAmount > 0 ? cumulativeAmount / totalAmount : 0
    };
  });
  const n80Index = rows.findIndex((row) => row.cumulativeShare >= PRODUCT_OPERATING_CONFIG.concentrationThreshold);
  const n80 = n80Index >= 0 ? n80Index + 1 : 0;
  const rankedByKey = new Map(rows.map((row) => [row.key, row]));
  const allRows = baseRows
    .map((row) => rankedByKey.get(row.key) || row)
    .sort((left, right) => right.amount - left.amount || left.productName.localeCompare(right.productName, 'zh-CN'));
  const lossRows = allRows.filter((row) => row.profitRmb < 0).sort((left, right) => left.profitRmb - right.profitRmb);
  const coreRows = n80 ? rows.slice(0, n80) : [];
  const tailRows = n80 ? rows.slice(n80) : rows;
  const summarize = (items: ProductOperatingRow[]): ProductOperatingSummary => {
    const amount = items.reduce((sum, row) => sum + row.amount, 0);
    return { productCount: items.length, amount, share: totalAmount > 0 ? amount / totalAmount : 0 };
  };

  return {
    metric,
    rows,
    allRows,
    lossRows,
    totalAmount,
    totalLossRmb: lossRows.reduce((sum, row) => sum + row.profitRmb, 0),
    top1Share: topShare(rows, 1, totalAmount),
    top3Share: topShare(rows, 3, totalAmount),
    top5Share: topShare(rows, 5, totalAmount),
    n80,
    core: summarize(coreRows),
    tail: summarize(tailRows),
    missingSalesRateCount: aggregated.missingSalesRateCount,
    pendingProfitLineCount: aggregated.pendingProfitLineCount,
    unmappedProductCount: allRows.filter((row) => row.identityState === 'unmapped').length,
    conflictingProductCount: allRows.filter((row) => row.identityState === 'conflict').length,
    unlinkedBatchLineCount: aggregated.unlinkedBatchLineCount
  };
}

export function buildProductOperatingTrend(
  input: AnalyticsDataSnapshot,
  catalog: ProductIdentityCatalog,
  selectedFiscalYear: number,
  selectedProductKey: string,
  asOfDate: string
): ProductTrendYear[] {
  return [selectedFiscalYear - 2, selectedFiscalYear - 1, selectedFiscalYear].map((fiscalYear) => {
    const period = getFiscalYearPeriod(fiscalYear, asOfDate);
    const row = aggregateProducts(input, catalog, period).rows.find((item) => item.key === selectedProductKey);
    return {
      fiscalYear,
      label: `FY${fiscalYear}`,
      startDate: period.startDate,
      endDate: period.endDate,
      cutoffLabel: period.isCurrent ? `截至 ${period.endDate}` : `${period.startDate}—${period.endDate}`,
      salesRmb: row?.salesRmb || 0,
      confirmedSalesRmb: row?.confirmedSalesRmb || 0,
      profitBasisRmb: row?.profitBasisRmb || 0,
      profitRmb: row?.profitRmb || 0,
      grossMargin: row?.grossMargin ?? null,
      quantity: 0,
      unit: ''
    };
  });
}
