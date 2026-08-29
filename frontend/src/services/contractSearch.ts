export function filterContractsByNumber<T extends { contract_no: string }>(contracts: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return contracts;
  return contracts.filter(contract => contract.contract_no.toLocaleLowerCase().includes(normalizedQuery));
}

export function findExistingContractById<T extends { id: string }>(contracts: T[], contractId: string): T | null {
  if (!contractId) return null;
  return contracts.find(contract => contract.id === contractId) || null;
}
