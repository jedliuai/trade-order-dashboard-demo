import type { ContactSheet, Contract, ExchangeRate, Payment, Shipment, ShipmentProfit } from './dataStore';

interface DashboardFinancialInput {
  contracts: Contract[];
  sheets: ContactSheet[];
  payments: Payment[];
  shipments?: Shipment[];
  shipmentProfits: ShipmentProfit[];
  exchangeRates: ExchangeRate[];
  startDate?: string;
  endDate?: string;
}

const dateIsInRange = (date: string | null | undefined, startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) return true;
  if (!date) return false;
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
};

const monthIsInRange = (month: string | null | undefined, startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) return true;
  if (!month) return false;
  const startMonth = startDate?.substring(0, 7);
  const endMonth = endDate?.substring(0, 7);
  return (!startMonth || month >= startMonth) && (!endMonth || month <= endMonth);
};

const collectionRate = (received: number, contracted: number) => (
  contracted > 0 ? received / contracted : null
);

export function calculateDashboardFinancialMetrics({
  contracts,
  sheets,
  payments,
  shipments = [],
  shipmentProfits,
  exchangeRates,
  startDate,
  endDate
}: DashboardFinancialInput) {
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const rateByMonth = new Map(exchangeRates.map((rate) => [rate.effective_month, rate.rate]));
  const missingRateMonths = new Set<string>();
  const totalContractRMB = sheets.reduce((total, sheet) => {
    const contract = contractById.get(sheet.contract_id);
    if (!contract || !dateIsInRange(contract.contract_date, startDate, endDate)) return total;
    const originalAmount = sheet.quantity * sheet.unit_price;
    if (contract.currency === 'RMB') return total + originalAmount;
    const month = contract.contract_date?.substring(0, 7);
    const rate = month ? rateByMonth.get(month) : undefined;
    if (!month || rate === undefined) {
      if (month) missingRateMonths.add(month);
      return total;
    }
    return total + originalAmount * rate;
  }, 0);

  const totalPaymentsRMB = payments.reduce((total, payment) => {
    if (!dateIsInRange(payment.payment_date, startDate, endDate)) return total;
    if (payment.currency === 'RMB') return total + payment.amount;
    if (payment.amount_rmb !== null && payment.amount_rmb !== undefined) return total + payment.amount_rmb;
    const month = payment.payment_date?.substring(0, 7);
    if (month) missingRateMonths.add(month);
    return total;
  }, 0);

  const totalShipmentRMB = shipments.reduce((total, shipment) => {
    if (shipment.status !== '已发货' || !dateIsInRange(shipment.shipment_date, startDate, endDate)) return total;
    if (shipment.currency === 'RMB') return total + shipment.amount;
    const month = shipment.shipment_date?.substring(0, 7);
    const rate = month ? rateByMonth.get(month) : undefined;
    if (!month || rate === undefined) {
      if (month) missingRateMonths.add(month);
      return total;
    }
    return total + shipment.amount * rate;
  }, 0);

  const fiscalProfitRows = shipmentProfits.filter((row) => monthIsInRange(row.invoice_month, startDate, endDate));
  const calculatedProfitRows = fiscalProfitRows.filter((row) => row.profit !== null && (row.profit_basis_amount_rmb ?? row.sales_amount_rmb) !== null);
  const confirmedProfitRows = calculatedProfitRows.filter((row) => row.is_estimated_profit !== true);
  const totalProfitRMB = calculatedProfitRows.reduce((sum, row) => sum + (row.profit || 0), 0);
  const totalProfitSalesRMB = calculatedProfitRows.reduce((sum, row) => sum + (row.profit_basis_amount_rmb ?? row.sales_amount_rmb ?? 0), 0);
  const confirmedProfitRMB = confirmedProfitRows.reduce((sum, row) => sum + (row.profit || 0), 0);

  return {
    totalContractRMB,
    totalPaymentsRMB,
    totalShipmentRMB,
    collectionRateRMB: collectionRate(totalPaymentsRMB, totalContractRMB),
    missingRateMonths: Array.from(missingRateMonths).sort(),
    totalProfitRMB,
    confirmedProfitRMB,
    grossMargin: totalProfitSalesRMB > 0 ? totalProfitRMB / totalProfitSalesRMB : null,
    hasEstimatedProfit: calculatedProfitRows.some((row) => row.is_estimated_profit),
    hasPendingProfit: fiscalProfitRows.some((row) => row.profit === null || (row.profit_basis_amount_rmb ?? row.sales_amount_rmb) === null)
  };
}

export function formatDashboardWan(value: number): string {
  return `${(value / 10_000).toFixed(1)} 万`;
}
