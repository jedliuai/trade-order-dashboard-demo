export interface AccountingAllocation {
  id: string;
  receipt_id?: string | null;
  contract_id: string;
  contract_no: string;
  customer_name: string;
  payment_date: string;
  amount: number;
  currency: 'USD' | 'RMB';
  payment_type: string;
  created_at?: string;
}

export interface AccountingReceipt {
  id: string;
  customer_name: string;
  payment_date: string;
  total_amount: number;
  currency: 'USD' | 'RMB';
  payment_type: string;
}

export interface AccountingContractTotal {
  contract_id: string;
  total_amount: number;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 6,
    useGrouping: true,
  }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

function formatChineseDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${year}年${month}月${day}日`;
}

export function buildPaymentAccountingMessage({
  receipt,
  allocations,
  allPayments,
  contractTotals,
}: {
  receipt: AccountingReceipt;
  allocations: AccountingAllocation[];
  allPayments: AccountingAllocation[];
  contractTotals: AccountingContractTotal[];
}): string {
  const totalsByContract = new Map(contractTotals.map((row) => [row.contract_id, row.total_amount]));
  const grouped = new Map<string, AccountingAllocation & { amount: number }>();

  allocations.forEach((allocation) => {
    const current = grouped.get(allocation.contract_id);
    if (current) current.amount += allocation.amount;
    else grouped.set(allocation.contract_id, { ...allocation });
  });

  const currencyLabel = receipt.currency === 'USD' ? '美金' : '人民币';
  const dateLabel = formatChineseDate(receipt.payment_date);
  const lines = Array.from(grouped.values()).map((allocation) => {
    const total = totalsByContract.get(allocation.contract_id) || 0;
    const receivedAsOfDate = allPayments
      .filter((payment) => payment.contract_id === allocation.contract_id && payment.payment_date <= receipt.payment_date)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const recoveryRate = total > 0 ? `${formatPercent((receivedAsOfDate / total) * 100)}%` : '无法计算';
    return `${allocation.customer_name || receipt.customer_name}，合同号：${allocation.contract_no || '未填写'}，货款类型：${allocation.payment_type || receipt.payment_type}，本次入账金额：${formatAmount(allocation.amount)}${currencyLabel}，入账时间：${dateLabel}，截止此日期此合同回款率：${recoveryRate}`;
  });

  const allocatedAmount = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const depositAmount = Math.max(0, receipt.total_amount - allocatedAmount);
  if (depositAmount > 0.005) {
    lines.push(`${receipt.customer_name}，货款类型：客户预存款，本次入账金额：${formatAmount(depositAmount)}${currencyLabel}，入账时间：${dateLabel}，暂未关联合同`);
  }

  return `张姐，收到，多谢。明细如下：\n${lines.join('\n')}`;
}
