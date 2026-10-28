export type ContractPaymentProgressStatus = '合同金额待形成' | '一次付清' | '部分回款' | '已收齐' | '分次付清';

export interface PaymentProgressLike {
  id: string;
  contract_id: string;
  amount: number;
  payment_date: string;
  allocation_effective_date?: string | null;
  created_at?: string;
}

export interface ContractPrepaymentLike {
  id: string;
  contract_date?: string | null;
  prepayment_ratio: number;
}

const MONEY_TOLERANCE = 0.005;

export function getPaymentEffectiveDate(payment: PaymentProgressLike): string {
  return payment.allocation_effective_date || payment.payment_date;
}

export function sortContractPayments<T extends PaymentProgressLike>(payments: readonly T[]): T[] {
  return [...payments].sort((left, right) => {
    const effectiveDateDiff = getPaymentEffectiveDate(left).localeCompare(getPaymentEffectiveDate(right));
    if (effectiveDateDiff) return effectiveDateDiff;
    const createdAtDiff = String(left.created_at || '').localeCompare(String(right.created_at || ''));
    return createdAtDiff || left.id.localeCompare(right.id, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

export function calculatePrepaymentMilestone(
  contract: ContractPrepaymentLike,
  contractTotal: number,
  allPayments: readonly PaymentProgressLike[]
): { requiredAmount: number; receivedAmount: number; reachedDate: string } {
  const ratio = Math.min(1, Math.max(0, Number(contract.prepayment_ratio || 0)));
  const requiredAmount = Math.max(0, Number(contractTotal || 0) * ratio);
  const contractPayments = sortContractPayments(
    allPayments.filter((payment) => payment.contract_id === contract.id)
  );
  const receivedAmount = contractPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  if (Number(contractTotal || 0) <= MONEY_TOLERANCE) {
    return { requiredAmount, receivedAmount, reachedDate: '' };
  }
  if (ratio <= 0) {
    return { requiredAmount: 0, receivedAmount, reachedDate: contract.contract_date || '' };
  }
  if (requiredAmount <= MONEY_TOLERANCE) {
    return { requiredAmount, receivedAmount, reachedDate: '' };
  }

  let cumulative = 0;
  for (const payment of contractPayments) {
    cumulative += Number(payment.amount || 0);
    if (cumulative + MONEY_TOLERANCE >= requiredAmount) {
      return { requiredAmount, receivedAmount, reachedDate: getPaymentEffectiveDate(payment) };
    }
  }
  return { requiredAmount, receivedAmount, reachedDate: '' };
}

export function deriveContractPaymentProgress(
  payment: PaymentProgressLike,
  contractTotal: number,
  allPayments: readonly PaymentProgressLike[]
): ContractPaymentProgressStatus {
  const ordered = sortContractPayments(allPayments.filter((row) => row.contract_id === payment.contract_id));
  const paymentIndex = ordered.findIndex((row) => row.id === payment.id);
  const priorPayments = paymentIndex >= 0 ? ordered.slice(0, paymentIndex) : ordered.filter((row) => row.id !== payment.id);
  const priorAmount = priorPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const afterAmount = priorAmount + Number(payment.amount || 0);
  const target = Number(contractTotal || 0);

  if (target <= MONEY_TOLERANCE) return '合同金额待形成';
  if (target > MONEY_TOLERANCE && priorAmount + MONEY_TOLERANCE >= target) return '已收齐';
  if (target > MONEY_TOLERANCE && afterAmount + MONEY_TOLERANCE >= target) {
    return priorAmount <= MONEY_TOLERANCE ? '一次付清' : '分次付清';
  }
  return '部分回款';
}
