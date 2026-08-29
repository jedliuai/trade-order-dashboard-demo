export interface AnalyticsProfitSummaryRow {
  profit: number | null;
  salesAmountRmb: number | null;
  confirmed: boolean;
}

export interface AnalyticsBusinessSummaryInput {
  contractAmountsRmb: Array<number | null>;
  paymentAmountsRmb: Array<number | null>;
  receivableAmountsRmb: Array<number | null>;
  profitRows: AnalyticsProfitSummaryRow[];
}

const sumKnown = (values: Array<number | null>) => values.reduce<number>((sum, value) => (
  value === null || !Number.isFinite(value) ? sum : sum + value
), 0);

/** 为首屏经营摘要提供与图表选择无关的稳定口径。 */
export function summarizeAnalyticsBusiness(input: AnalyticsBusinessSummaryInput) {
  const confirmedProfitRows = input.profitRows.filter((row) => row.confirmed && row.profit !== null);
  const confirmedProfit = confirmedProfitRows.reduce((sum, row) => sum + Number(row.profit || 0), 0);
  const confirmedSales = confirmedProfitRows.reduce((sum, row) => sum + Number(row.salesAmountRmb || 0), 0);

  return {
    contractAmount: sumKnown(input.contractAmountsRmb),
    paymentAmount: sumKnown(input.paymentAmountsRmb),
    currentReceivable: sumKnown(input.receivableAmountsRmb),
    confirmedProfit,
    confirmedGrossMargin: confirmedSales > 0 ? confirmedProfit / confirmedSales * 100 : null,
    confirmedProfitCount: confirmedProfitRows.length,
    missingContractRateCount: input.contractAmountsRmb.filter((value) => value === null).length,
    missingReceivableRateCount: input.receivableAmountsRmb.filter((value) => value === null).length
  };
}
