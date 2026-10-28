export function sortCustomersForDisplay<T extends { id: string; name: string }>(
  customers: T[],
  order: string[] = []
): T[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...customers].sort((left, right) => {
    const leftPosition = positions.get(left.id);
    const rightPosition = positions.get(right.id);
    if (leftPosition !== undefined || rightPosition !== undefined) {
      if (leftPosition === undefined) return 1;
      if (rightPosition === undefined) return -1;
      if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    }
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

export function sortContractsByCustomerOrder<T extends {
  customer_id: string;
  contract_date?: string | null;
  created_at?: string | null;
  contract_no?: string | null;
}>(contracts: T[], orderedCustomerIds: string[]): T[] {
  const customerPositions = new Map(orderedCustomerIds.map((id, index) => [id, index]));
  return [...contracts].sort((left, right) => {
    const customerDiff = (customerPositions.get(left.customer_id) ?? Number.MAX_SAFE_INTEGER)
      - (customerPositions.get(right.customer_id) ?? Number.MAX_SAFE_INTEGER);
    if (customerDiff !== 0) return customerDiff;

    const contractDateDiff = String(right.contract_date || '').localeCompare(String(left.contract_date || ''));
    if (contractDateDiff !== 0) return contractDateDiff;

    const createdAtDiff = String(right.created_at || '').localeCompare(String(left.created_at || ''));
    if (createdAtDiff !== 0) return createdAtDiff;

    return String(left.contract_no || '').localeCompare(String(right.contract_no || ''), 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

const contractNumberCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
});

export function sortContractsByCustomerAndContractNumber<T extends {
  customer_id: string;
  contract_no: string;
}>(contracts: T[], orderedCustomerIds: string[]): T[] {
  const customerPositions = new Map(orderedCustomerIds.map((id, index) => [id, index]));
  return [...contracts].sort((left, right) => {
    const customerDiff = (customerPositions.get(left.customer_id) ?? Number.MAX_SAFE_INTEGER)
      - (customerPositions.get(right.customer_id) ?? Number.MAX_SAFE_INTEGER);
    if (customerDiff !== 0) return customerDiff;

    return contractNumberCollator.compare(right.contract_no, left.contract_no);
  });
}
