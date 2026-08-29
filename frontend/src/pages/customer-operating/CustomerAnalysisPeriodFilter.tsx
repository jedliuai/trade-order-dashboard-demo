import { Button } from '../../components/Button';
import type { FiscalYearRange } from '../../services/fiscalYear';

interface CustomerAnalysisPeriodFilterProps {
  startDate: string;
  endDate: string;
  fiscalRange: FiscalYearRange;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

export function CustomerAnalysisPeriodFilter({
  startDate,
  endDate,
  fiscalRange,
  onStartDateChange,
  onEndDateChange
}: CustomerAnalysisPeriodFilterProps) {
  return (
    <section className="glass-panel rounded-2xl p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-medium text-muted">
          开始日期
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => onStartDateChange(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          />
        </label>
        <label className="text-xs font-medium text-muted">
          结束日期
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => onEndDateChange(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          />
        </label>
        <div className="flex items-end">
          <Button
            tone="secondary"
            onClick={() => {
              onStartDateChange(fiscalRange.startDate);
              onEndDateChange(fiscalRange.endDate);
            }}
          >
            恢复本财年
          </Button>
        </div>
      </div>
      {endDate === fiscalRange.endDate && (
        <p className="mt-3 text-[11px] text-subtle">当前财年尚未结束，统计截止日期为 {fiscalRange.endDate}。</p>
      )}
    </section>
  );
}
