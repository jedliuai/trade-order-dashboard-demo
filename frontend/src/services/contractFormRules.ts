export type ContractExportType = '自营' | '转口';
export type ContractCurrency = 'USD' | 'RMB';

export function currencyForExportType(exportType: ContractExportType): ContractCurrency {
  return exportType === '转口' ? 'RMB' : 'USD';
}

export function exportTypeForCustomerCurrency(currency: ContractCurrency): ContractExportType {
  return currency === 'RMB' ? '转口' : '自营';
}

export function copiedContractNotes(): string {
  return '';
}

export function hasDuplicateContractNumber(
  contracts: Array<{ id: string; contract_no: string }>,
  contractNumber: string,
  excludeId?: string | null
): boolean {
  const normalized = contractNumber.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return contracts.some((contract) => (
    contract.id !== excludeId
    && contract.contract_no.trim().toLocaleLowerCase() === normalized
  ));
}
