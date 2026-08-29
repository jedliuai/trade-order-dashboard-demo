import type { StatusTone } from '../components/StatusBadge';
import { calculateEstimatedReleaseDate } from './businessRules.ts';

export interface BatchTrackingInput {
  batchNo: string;
  productName: string;
  productionDate?: string | null;
  expiryDate?: string | null;
  warehouseDate?: string | null;
  releaseDate?: string | null;
  apsScheduledDate?: string | null;
  estimatedReleaseDate?: string | null;
}

export interface BatchTrackingRisk {
  label: string;
  tone: 'warning' | 'danger' | 'neutral';
  severity: 1 | 2 | 3;
}

export interface BatchTrackingResult {
  phase: 'pending_warehouse' | 'pending_release' | 'released';
  label: string;
  tone: StatusTone;
  risks: BatchTrackingRisk[];
  severity: number;
  targetDate: string;
}

const isIsoDate = (value?: string | null): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

const daysBetween = (earlier: string, later: string) => {
  const [startYear, startMonth, startDay] = earlier.split('-').map(Number);
  const [endYear, endMonth, endDay] = later.split('-').map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.max(0, Math.round((end - start) / 86_400_000));
};

export function resolveBatchTracking(input: BatchTrackingInput, today: string): BatchTrackingResult {
  const risks: BatchTrackingRisk[] = [];
  const warehouseDate = input.warehouseDate || '';
  const releaseDate = input.releaseDate || '';
  const apsScheduledDate = input.apsScheduledDate || '';
  const expectedReleaseDate = input.estimatedReleaseDate
    || calculateEstimatedReleaseDate(warehouseDate, input.productName)
    || '';

  let phase: BatchTrackingResult['phase'] = 'pending_warehouse';
  let label = apsScheduledDate ? '已排产，待入库' : '待入库';
  let tone: StatusTone = apsScheduledDate ? 'progress' : 'neutral';
  let targetDate = apsScheduledDate;

  if (releaseDate) {
    phase = 'released';
    label = '已放行';
    tone = 'success';
    targetDate = releaseDate;
  } else if (warehouseDate) {
    phase = 'pending_release';
    label = '已入库，待放行';
    tone = 'warning';
    targetDate = expectedReleaseDate;
  }

  if (!input.productionDate) {
    risks.push({ label: '缺少生产日期', tone: 'warning', severity: 2 });
  }
  if (!input.expiryDate) {
    risks.push({ label: '缺少失效日期', tone: 'warning', severity: 2 });
  }
  if (releaseDate && !warehouseDate) {
    risks.push({ label: '已放行但缺少入库日期', tone: 'danger', severity: 3 });
  } else if (isIsoDate(releaseDate) && isIsoDate(warehouseDate) && releaseDate < warehouseDate) {
    risks.push({ label: '放行日期早于入库日期', tone: 'danger', severity: 3 });
  }

  if (phase === 'pending_warehouse') {
    if (!isIsoDate(apsScheduledDate)) {
      risks.push({ label: '未记录 排产日期', tone: 'neutral', severity: 1 });
    } else if (isIsoDate(today) && apsScheduledDate <= today) {
      const overdueDays = daysBetween(apsScheduledDate, today);
      risks.push({
        label: overdueDays === 0 ? '今日排产，尚未入库' : `排产日已过 ${overdueDays} 天，仍未入库`,
        tone: overdueDays === 0 ? 'warning' : 'danger',
        severity: overdueDays === 0 ? 2 : 3
      });
    }
  }

  if (phase === 'pending_release' && isIsoDate(expectedReleaseDate) && isIsoDate(today) && expectedReleaseDate <= today) {
    const overdueDays = daysBetween(expectedReleaseDate, today);
    risks.push({
      label: overdueDays === 0 ? '预计今日放行，尚未完成' : `预计放行已逾期 ${overdueDays} 天`,
      tone: overdueDays === 0 ? 'warning' : 'danger',
      severity: overdueDays === 0 ? 2 : 3
    });
  }

  const severity = risks.reduce((highest, risk) => Math.max(highest, risk.severity), 0);
  return { phase, label, tone, risks, severity, targetDate };
}

export function validateBatchProgressDates(warehouseDate: string, releaseDate: string): string {
  if (releaseDate && !warehouseDate) return '填写实际放行日期前，请先填写入库日期。';
  if (isIsoDate(warehouseDate) && isIsoDate(releaseDate) && releaseDate < warehouseDate) {
    return '实际放行日期不能早于入库日期。';
  }
  return '';
}

export function validateBatchQuantityTotal(batchQuantities: number[], contactSheetQuantity: number): string {
  if (batchQuantities.length === 0) return '';
  const total = batchQuantities.reduce((sum, value) => sum + Number(value || 0), 0);
  if (Math.abs(total - Number(contactSheetQuantity || 0)) <= 0.000001) return '';
  return `批次数量合计必须等于联系单数量。当前合计 ${total}，联系单数量 ${contactSheetQuantity}，请调整后再保存。`;
}
