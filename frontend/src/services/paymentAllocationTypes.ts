export const PAYMENT_TYPE_OPTIONS = [
  '预付款',
  '尾款',
  '分批付款',
  '提单后付款',
  '信用证',
  '其他'
] as const;

export type PaymentType = (typeof PAYMENT_TYPE_OPTIONS)[number];

export function isPaymentType(value: string): value is PaymentType {
  return PAYMENT_TYPE_OPTIONS.includes(value as PaymentType);
}

export function deriveReceiptPaymentType(rows: Array<{ payment_type: PaymentType }>): PaymentType {
  if (!rows.length) return '其他';
  const first = rows[0].payment_type;
  return rows.every((row) => row.payment_type === first) ? first : '其他';
}
