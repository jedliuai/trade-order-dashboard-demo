import { useMemo, useState } from 'react';
import { BarChart3, CircleDollarSign, ListOrdered, UsersRound } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { ColorIconBadge, type ColorIconTone } from '../../components/ColorIconBadge';
import { loadAnalyticsDataSnapshot } from '../../services/analyticsDataService';
import {
  buildCustomerConcentration,
  type CustomerConcentrationMetric,
  type CustomerConcentrationRow
} from '../../services/customerConcentrationAnalytics';
import { getFiscalYearRange } from '../../services/fiscalYear';
import { CustomerAnalysisPeriodFilter } from './CustomerAnalysisPeriodFilter';

interface CustomerConcentrationTabProps {
  onOpenCustomer: (customerId: string) => void;
  onRefreshTrigger: number;
}

const metricMeta: Record<CustomerConcentrationMetric, { label: string; shortLabel: string; description: string }> = {
  sales: { label: '销售额', shortLabel: '销售', description: '按实际发货日期及统一汇率折算' },
  payment: { label: '实际回款额', shortLabel: '回款', description: '按实际到账日期及统一回款口径' },
  profit: { label: '实际利润额', shortLabel: '利润', description: '仅使用已确认的 v_shipment_profit 利润' }
};

const formatMoney = (value: number) => `¥${value.toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;
const formatWan = (value: number) => `${(value / 10_000).toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})} 万元`;
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
const formatAxisMoney = (value: number) => {
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
};

function ParetoTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: CustomerConcentrationRow & { cumulativePercent: number } }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="min-w-52 rounded-xl border border-border bg-surface p-3 text-xs shadow-xl">
      <div className="font-semibold text-ink">#{row.rank} {row.customerName}</div>
      <div className="mt-2 flex justify-between gap-5"><span className="text-muted">金额</span><span className="font-semibold text-ink">{formatMoney(row.amount)}</span></div>
      <div className="mt-1 flex justify-between gap-5"><span className="text-muted">单户贡献</span><span className="font-semibold text-ink">{formatPercent(row.share)}</span></div>
      <div className="mt-1 flex justify-between gap-5"><span className="text-muted">累计贡献</span><span className="font-semibold text-brand-cyan">{formatPercent(row.cumulativeShare)}</span></div>
    </div>
  );
}

export function CustomerConcentrationTab({ onOpenCustomer, onRefreshTrigger }: CustomerConcentrationTabProps) {
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const [startDate, setStartDate] = useState(fiscalRange.startDate);
  const [endDate, setEndDate] = useState(fiscalRange.endDate);
  const [metric, setMetric] = useState<CustomerConcentrationMetric>('sales');
  const snapshot = useMemo(() => {
    void onRefreshTrigger;
    return loadAnalyticsDataSnapshot();
  }, [onRefreshTrigger]);
  const result = useMemo(
    () => buildCustomerConcentration(snapshot, { startDate, endDate }, metric),
    [snapshot, startDate, endDate, metric]
  );
  const chartRows = useMemo(
    () => result.rows.map((row) => ({ ...row, cumulativePercent: row.cumulativeShare * 100 })),
    [result.rows]
  );
  const missingRateCount = metric === 'sales'
    ? result.missingSalesRateCount
    : metric === 'payment'
      ? result.missingPaymentRateCount
      : 0;

  const summaryCards: Array<{ label: string; value: string; hint: string; tone: ColorIconTone; icon: typeof UsersRound }> = [
    { label: '第一大客户贡献', value: formatPercent(result.top1Share), hint: '当前指标正贡献客户', tone: 'teal', icon: UsersRound },
    { label: 'Top 3 贡献', value: formatPercent(result.top3Share), hint: '前三名累计贡献', tone: 'green', icon: BarChart3 },
    { label: 'Top 5 贡献', value: formatPercent(result.top5Share), hint: '前五名累计贡献', tone: 'amber', icon: CircleDollarSign },
    { label: 'N80', value: result.n80 ? `${result.n80} 家` : '—', hint: '达到累计 80% 的最少客户数', tone: 'purple', icon: ListOrdered }
  ];

  return (
    <div className="space-y-5">
      <CustomerAnalysisPeriodFilter
        startDate={startDate}
        endDate={endDate}
        fiscalRange={fiscalRange}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      <section className="glass-panel rounded-2xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-heading text-base font-bold text-ink">分析指标</h2>
            <p className="mt-1 text-xs text-muted">客户按所选指标从高到低排列；零贡献客户不进入帕累托分母。</p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface-muted p-1" role="group" aria-label="集中度指标">
            {(Object.keys(metricMeta) as CustomerConcentrationMetric[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={metric === item}
                onClick={() => setMetric(item)}
                className={`min-w-24 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${metric === item ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {metricMeta[item].label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-subtle">当前口径：{metricMeta[metric].description}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => (
          <article key={item.label} className="glass-panel flex min-h-[108px] items-center gap-3 rounded-2xl p-4">
            <ColorIconBadge tone={item.tone} size="lg" shape="circle"><item.icon className="h-5 w-5" /></ColorIconBadge>
            <div className="min-w-0">
              <div className="text-xs text-muted">{item.label}</div>
              <div className="mt-1 text-xl font-bold text-ink">{item.value}</div>
              <div className="mt-1 text-[10px] leading-4 text-subtle">{item.hint}</div>
            </div>
          </article>
        ))}
      </section>

      {missingRateCount > 0 && (
        <div className="rounded-xl border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
          有 {missingRateCount} 条{metricMeta[metric].shortLabel}明细缺少业务发生月份汇率，暂未计入人民币金额。
        </div>
      )}

      <section className="glass-panel rounded-2xl p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-heading text-base font-bold text-ink">80% 帕累托图</h2>
            <p className="mt-1 text-xs text-muted">柱形为客户{metricMeta[metric].label}，折线为累计贡献；虚线标识累计 80%。</p>
          </div>
          <div className="text-xs text-muted">正贡献合计 <span className="ml-1 font-semibold text-ink">{formatWan(result.totalAmount)}</span></div>
        </div>
        {chartRows.length ? (
          <div className="mt-5 overflow-x-auto pb-2">
            <div className="h-[360px]" style={{ minWidth: `${Math.max(820, chartRows.length * 66)}px` }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartRows} margin={{ top: 12, right: 18, left: 8, bottom: 62 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="customerName"
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={76}
                    tick={{ fill: 'var(--color-muted)', fontSize: 10 }}
                    tickFormatter={(value: string) => value.length > 8 ? `${value.slice(0, 8)}…` : value}
                  />
                  <YAxis yAxisId="amount" tickFormatter={formatAxisMoney} tick={{ fill: 'var(--color-muted)', fontSize: 10 }} width={62} />
                  <YAxis yAxisId="percent" orientation="right" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(value) => `${value}%`} tick={{ fill: 'var(--color-muted)', fontSize: 10 }} width={48} />
                  <Tooltip content={<ParetoTooltip />} />
                  <ReferenceLine yAxisId="percent" y={80} stroke="var(--color-brand-amber)" strokeDasharray="6 5" label={{ value: '80%', position: 'insideTopRight', fill: 'var(--color-brand-amber)', fontSize: 10 }} />
                  <Bar yAxisId="amount" dataKey="amount" fill="var(--color-brand-cyan)" fillOpacity={0.7} radius={[5, 5, 0, 0]} maxBarSize={38} />
                  <Line yAxisId="percent" type="monotone" dataKey="cumulativePercent" stroke="var(--color-brand-purple)" strokeWidth={2.2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex h-56 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted">当前范围没有正贡献客户</div>
        )}
      </section>

      <section className="glass-panel overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-heading text-base font-bold text-ink">客户明细</h2>
            <p className="mt-1 text-xs text-muted">点击客户名称进入现有客户产品分析入口。</p>
          </div>
          <span className="text-xs text-subtle">{result.rows.length} 家正贡献客户</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr><th className="px-5 py-3">排名</th><th className="px-4 py-3">客户</th><th className="px-4 py-3 text-right">{metricMeta[metric].label}</th><th className="px-4 py-3 text-right">贡献占比</th><th className="px-5 py-3 text-right">累计贡献</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.rows.map((row) => (
                <tr key={row.customerId} className="transition-colors hover:bg-surface-muted/70">
                  <td className="px-5 py-3 font-semibold text-subtle">#{row.rank}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => onOpenCustomer(row.customerId)} className="font-semibold text-brand-cyan hover:underline">{row.customerName}</button></td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{formatMoney(row.amount)}</td>
                  <td className="px-4 py-3 text-right text-body">{formatPercent(row.share)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-body">{formatPercent(row.cumulativeShare)}</td>
                </tr>
              ))}
              {!result.rows.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-muted">当前范围暂无明细</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {metric === 'profit' && (
        <section className="glass-panel overflow-hidden rounded-2xl border border-brand-rose/20">
          <div className="flex flex-col gap-1 border-b border-brand-rose/15 bg-brand-rose/5 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-heading text-base font-bold text-ink">亏损客户（单列）</h2>
              <p className="mt-1 text-xs text-muted">亏损客户不进入利润累计贡献、Top 贡献和 N80 的分母。</p>
            </div>
            <span className="text-xs text-brand-rose">{result.lossRows.length} 家 · 合计 {formatMoney(result.totalLossRmb)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="bg-surface-muted text-muted"><tr><th className="px-5 py-3">客户</th><th className="px-4 py-3 text-right">实际利润额</th><th className="px-5 py-3 text-right">处理方式</th></tr></thead>
              <tbody className="divide-y divide-border">
                {result.lossRows.map((row) => (
                  <tr key={row.customerId} className="hover:bg-surface-muted/70">
                    <td className="px-5 py-3"><button type="button" onClick={() => onOpenCustomer(row.customerId)} className="font-semibold text-brand-cyan hover:underline">{row.customerName}</button></td>
                    <td className="px-4 py-3 text-right font-semibold text-brand-rose">{formatMoney(row.amount)}</td>
                    <td className="px-5 py-3 text-right text-muted">不计入正利润集中度</td>
                  </tr>
                ))}
                {!result.lossRows.length && <tr><td colSpan={3} className="px-5 py-8 text-center text-muted">当前范围没有亏损客户</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
