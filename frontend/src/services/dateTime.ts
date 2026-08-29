export const CHINA_TIME_ZONE = 'Asia/Shanghai';

export function formatChinaDateTime(value?: string): string {
  if (!value) return '----/--/-- --:--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 19) || '----/--/-- --:--:--';
  return date.toLocaleString('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}
