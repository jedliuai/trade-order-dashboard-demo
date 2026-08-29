import { useMemo, useState } from 'react';
import { Activity, MoonStar, RotateCcw, UserPlus } from 'lucide-react';
import { ColorIconBadge, type ColorIconTone } from '../../components/ColorIconBadge';
import { StatusBadge, type StatusTone } from '../../components/StatusBadge';
import { loadAnalyticsDataSnapshot } from '../../services/analyticsDataService';
import {
  buildCustomerActivity,
  type CustomerActivityStatus
} from '../../services/customerActivityAnalytics';
import { getFiscalYearRange } from '../../services/fiscalYear';
import { CustomerAnalysisPeriodFilter } from './CustomerAnalysisPeriodFilter';

interface CustomerActivityTabProps {
  onOpenCustomer: (customerId: string) => void;
  onRefreshTrigger: number;
}

const statusMeta: Record<CustomerActivityStatus, {
  label: string;
  hint: string;
  tone: StatusTone;
  cardTone: ColorIconTone;
  icon: typeof Activity;
}> = {
  new: { label: '新客户', hint: '系统首次发货发生在所选范围', tone: 'accent', cardTone: 'purple', icon: UserPlus },
  active: { label: '活跃客户', hint: '最近发货距截止日不足沉睡阈值', tone: 'success', cardTone: 'green', icon: Activity },
  dormant: { label: '沉睡客户', hint: '距最近发货已达到沉睡阈值', tone: 'warning', cardTone: 'amber', icon: MoonStar },
  reactivated: { label: '重新激活', hint: '所选范围内在长期空窗后再次发货', tone: 'progress', cardTone: 'teal', icon: RotateCcw }
};

export function CustomerActivityTab({ onOpenCustomer, onRefreshTrigger }: CustomerActivityTabProps) {
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const [startDate, setStartDate] = useState(fiscalRange.startDate);
  const [endDate, setEndDate] = useState(fiscalRange.endDate);
  const snapshot = useMemo(() => {
    void onRefreshTrigger;
    return loadAnalyticsDataSnapshot();
  }, [onRefreshTrigger]);
  const result = useMemo(
    () => buildCustomerActivity(snapshot, { startDate, endDate }),
    [snapshot, startDate, endDate]
  );

  return (
    <div className="space-y-5">
      <CustomerAnalysisPeriodFilter
        startDate={startDate}
        endDate={endDate}
        fiscalRange={fiscalRange}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      <section className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/8 px-4 py-3 text-xs leading-5 text-body">
        有效合作事件仅取“已发货”且有实际发货日期的记录；合并发货按发货组去重。首次、最近、次数和平均间隔统计截至 {result.asOfDate} 的系统历史记录，开始日期仅用于判断本期新客户与重新激活客户。沉睡阈值统一为 <strong className="text-ink">{result.dormancyDays} 天</strong>。
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(statusMeta) as CustomerActivityStatus[]).map((status) => {
          const meta = statusMeta[status];
          const Icon = meta.icon;
          return (
            <article key={status} className="glass-panel flex min-h-[116px] items-center gap-3 rounded-2xl p-4">
              <ColorIconBadge tone={meta.cardTone} size="lg" shape="circle"><Icon className="h-5 w-5" /></ColorIconBadge>
              <div className="min-w-0">
                <div className="text-xs text-muted">{meta.label}</div>
                <div className="mt-1 text-xl font-bold text-ink">{result.counts[status]} 家</div>
                <div className="mt-1 text-[10px] leading-4 text-subtle">{meta.hint}</div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="glass-panel overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-heading text-base font-bold text-ink">客户活跃度明细</h2>
            <p className="mt-1 text-xs text-muted">平均复购间隔按不同发货日之间的相邻间隔计算；同日多次物理发货仍分别计数。</p>
          </div>
          <span className="text-xs text-subtle">{result.rows.length} 家有有效发货客户</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-5 py-3">客户</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">首次发货（系统记录）</th>
                <th className="px-4 py-3">最近发货</th>
                <th className="px-4 py-3 text-right">物理发货次数</th>
                <th className="px-5 py-3 text-right">平均复购间隔</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.rows.map((row) => {
                const meta = statusMeta[row.status];
                return (
                  <tr key={row.customerId} className="transition-colors hover:bg-surface-muted/70">
                    <td className="px-5 py-3"><button type="button" onClick={() => onOpenCustomer(row.customerId)} className="font-semibold text-brand-cyan hover:underline">{row.customerName}</button></td>
                    <td className="px-4 py-3"><StatusBadge tone={meta.tone} dot>{meta.label}</StatusBadge></td>
                    <td className="px-4 py-3 text-body">{row.firstShipmentDate}</td>
                    <td className="px-4 py-3 font-semibold text-ink">{row.latestShipmentDate}</td>
                    <td className="px-4 py-3 text-right font-semibold text-body">{row.physicalShipmentCount}</td>
                    <td className="px-5 py-3 text-right text-body">{row.averageRepurchaseIntervalDays === null ? '—' : `${row.averageRepurchaseIntervalDays.toFixed(1)} 天`}</td>
                  </tr>
                );
              })}
              {!result.rows.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">截止当前日期暂无有效发货客户</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
