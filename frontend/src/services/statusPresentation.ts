import type { StatusTone } from '../components/StatusBadge';

export const BUSINESS_STATUS_TONES = {
  '正常': 'success',
  '已确认': 'success',
  '已完成': 'success',
  '已发货': 'success',
  '发货完成': 'success',
  '已开票': 'success',
  '已收齐': 'success',
  '已收全款': 'success',
  '可发货': 'success',
  '进行中': 'progress',
  '生产完成': 'progress',
  '部分发货': 'progress',
  '生成中': 'progress',
  '预估': 'warning',
  '准备中': 'warning',
  '待收款': 'warning',
  '部分收款': 'warning',
  '未收款': 'warning',
  '需人工确认': 'warning',
  '待开票': 'warning',
  '发货后开票': 'warning',
  '待计算': 'danger',
  '需要检查': 'danger',
  '不建议发货': 'danger',
  '取消': 'danger',
  '已取消': 'danger',
  '交货期已逾期': 'danger',
  '已归档': 'neutral'
} as const satisfies Record<string, StatusTone>;

export function getBusinessStatusTone(label: string, fallback: StatusTone = 'neutral'): StatusTone {
  const exact = BUSINESS_STATUS_TONES[label as keyof typeof BUSINESS_STATUS_TONES];
  if (exact) return exact;
  if (label.startsWith('待开票')) return 'warning';
  if (label.includes('逾期') || label.includes('失败') || label.includes('异常')) return 'danger';
  return fallback;
}
