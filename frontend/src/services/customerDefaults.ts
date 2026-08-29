export type CustomerCurrency = 'USD' | 'RMB';

export interface CustomerDefaultsLike {
  default_currency?: unknown;
  default_payment_terms?: unknown;
  country?: unknown;
}

export const FALLBACK_PAYMENT_TERMS = '30% 预付 + 70% 发货前付清';

export function normalizeCustomerCurrency(value: unknown): CustomerCurrency {
  return String(value || '').toUpperCase() === 'RMB' ? 'RMB' : 'USD';
}

export function getNewContractDefaults(customer?: CustomerDefaultsLike | null) {
  const paymentTerms = String(customer?.default_payment_terms || '').trim();
  return {
    paymentTerms: paymentTerms || FALLBACK_PAYMENT_TERMS,
    destinationCountry: String(customer?.country || '').trim()
  };
}
