export interface FiscalYearRange {
  startDate: string;
  endDate: string;
  startMonth: string;
  endMonth: string;
  label: string;
}

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function getFiscalYearRange(today = new Date()): FiscalYearRange {
  const currentYear = today.getFullYear();
  const fiscalStartYear = today.getMonth() === 11 ? currentYear : currentYear - 1;
  const startDate = `${fiscalStartYear}-12-01`;
  const endDate = formatLocalDate(today);
  return {
    startDate,
    endDate,
    startMonth: startDate.substring(0, 7),
    endMonth: endDate.substring(0, 7),
    label: `${startDate} 至 ${endDate}`
  };
}

export function getPreviousFiscalYearRange(current: FiscalYearRange): FiscalYearRange {
  const startYear = Number(current.startDate.substring(0, 4)) - 1;
  const startDate = `${startYear}-12-01`;
  const endDate = `${startYear + 1}-11-30`;
  return {
    startDate,
    endDate,
    startMonth: startDate.substring(0, 7),
    endMonth: endDate.substring(0, 7),
    label: `${startDate} 至 ${endDate}`
  };
}

export function isDateInRange(date: string | null | undefined, startDate: string, endDate: string) {
  return Boolean(date && date >= startDate && date <= endDate);
}

export function isMonthInRange(month: string | null | undefined, startMonth: string, endMonth: string) {
  return Boolean(month && month >= startMonth && month <= endMonth);
}

export function listMonthsInRange(startMonth: string, endMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth) || startMonth > endMonth) return [];
  const result: string[] = [];
  let year = Number(startMonth.substring(0, 4));
  let month = Number(startMonth.substring(5, 7));
  const endYear = Number(endMonth.substring(0, 4));
  const end = Number(endMonth.substring(5, 7));
  while (year < endYear || (year === endYear && month <= end)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return result;
}
