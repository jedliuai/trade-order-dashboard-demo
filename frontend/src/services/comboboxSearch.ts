export interface SearchableOptionLike {
  label: string;
  searchText?: string;
}
function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN');
}

export function filterComboboxOptions<T extends SearchableOptionLike>(options: T[], query: string): T[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return options;
  return options.filter(option => normalizeSearchValue(option.searchText ?? option.label).includes(normalizedQuery));
}
