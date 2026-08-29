import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { ProductMetric, ProductTrendYear } from '../services/customerValueAnalytics';
import { Dialog } from './Dialog';

interface ProductTrendDialogProps {
  productName: string;
  materialLabel: string;
  specification: string;
  unit?: string;
  scopeLabel: string;
  basisLabel: string;
  rows: ProductTrendYear[];
  latestYoY?: number | null;
  initialMetric?: ProductMetric;
  showQuantity?: boolean;
  onClose: () => void;
}

const labels: Record<ProductMetric, string> = {
  sales: '销售金额',
  profit: '利润额',
  margin: '毛利率',
  quantity: '数量'
};
const formatWan = (value: number) => `${(value / 10_000).toFixed(2)} 万元`;
const formatPercent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;

function displayValue(value: number, metric: ProductMetric, unit: string) {
  if (metric === 'margin') return `${value.toFixed(1)}%`;
  if (metric === 'quantity') return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${unit}`;
  return formatWan(value);
}

function axisValue(value: number, metric: ProductMetric) {
  if (metric === 'margin') return `${value.toFixed(0)}%`;
  if (metric === 'quantity') return Math.abs(value) >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : `${value}`;
  return `${(value / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
}

export function ProductTrendDialog({
  productName,
  materialLabel,
  specification,
  unit = '',
  scopeLabel,
  basisLabel,
  rows,
  latestYoY,
  initialMetric = 'sales',
  showQuantity = true,
  onClose
}: ProductTrendDialogProps) {
  const defaultMetric = !showQuantity && initialMetric === 'quantity' ? 'sales' : initialMetric;
  const [metric, setMetric] = useState<ProductMetric>(defaultMetric);
  useEffect(() => setMetric(defaultMetric), [defaultMetric, productName]);

  const metrics = (Object.keys(labels) as ProductMetric[]).filter((item) => showQuantity || item !== 'quantity');
  const chartRows = rows.map((row) => ({
    ...row,
    chartValue: metric === 'profit'
      ? row.profitRmb
      : metric === 'margin'
        ? (row.grossMargin || 0) * 100
        : metric === 'quantity'
          ? row.quantity
          : row.salesRmb
  }));
  const cumulativeSales = rows.reduce((sum, row) => sum + row.salesRmb, 0);
  const cumulativeProfit = rows.reduce((sum, row) => sum + row.profitRmb, 0);
  const cumulativeProfitBasis = rows.reduce((sum, row) => sum + row.profitBasisRmb, 0);
  const cards = [
    ['三年累计销售', formatWan(cumulativeSales)],
    ['三年累计利润', formatWan(cumulativeProfit)],
    ['平均毛利率', cumulativeProfitBasis > 0 ? formatPercent(cumulativeProfit / cumulativeProfitBasis) : '—'],
    ...(showQuantity ? [['三年累计数量', `${rows.reduce((sum, row) => sum + row.quantity, 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${unit}`]] : []),
    ...(latestYoY !== undefined ? [['最新同比', formatPercent(latestYoY)]] : [])
  ];

  return (
    <Dialog onClose={onClose} ariaLabel={`${productName}三财年趋势`}>
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-border bg-page shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-page/95 px-6 py-5 backdrop-blur">
          <div>
            <h2 className="text-xl font-bold text-ink">{productName} · 三财年趋势</h2>
            <p className="mt-1 text-xs text-muted">{scopeLabel} · {materialLabel || '未映射物料'} · {specification || '—'} · {basisLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-border bg-surface p-2 text-muted hover:text-ink" aria-label="关闭产品趋势">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className={`grid gap-3 sm:grid-cols-2 ${cards.length >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
            {cards.map(([label, value]) => (
              <article key={label} className="rounded-xl border border-border bg-surface p-4">
                <div className="text-[11px] text-muted">{label}</div>
                <div className={`mt-2 text-lg font-bold ${label.includes('利润') && cumulativeProfit < 0 ? 'text-brand-rose' : 'text-ink'}`}>{value}</div>
              </article>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink">{labels[metric]}趋势</h3>
                <p className="mt-1 text-xs text-muted">当前财年按截止日期展示，历史财年显示完整年度。</p>
              </div>
              <div className="flex rounded-xl border border-border bg-surface-muted p-1">
                {metrics.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMetric(item)}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${metric === item ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:text-ink'}`}
                  >
                    {labels[item]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 h-[330px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 20, right: 30, bottom: 10, left: 10 }}>
                  <CartesianGrid stroke="#E8E0D2" strokeDasharray="3 5" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#81786B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#81786B' }} tickFormatter={(value) => axisValue(Number(value), metric)} />
                  <Tooltip formatter={(value) => displayValue(Number(value), metric, unit)} labelFormatter={(label) => `${label}`} />
                  <Line type="monotone" dataKey="chartValue" stroke="#B08A58" strokeWidth={3} dot={{ r: 5, fill: '#B08A58' }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-4 py-3">财年</th>
                  <th className="px-4 py-3">统计范围</th>
                  <th className="px-4 py-3 text-right">销售额</th>
                  <th className="px-4 py-3 text-right">利润</th>
                  <th className="px-4 py-3 text-right">毛利率</th>
                  {showQuantity && <th className="px-4 py-3 text-right">数量</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.fiscalYear}>
                    <td className="px-4 py-3 font-semibold text-ink">{row.label}</td>
                    <td className="px-4 py-3 text-muted">{row.cutoffLabel}</td>
                    <td className="px-4 py-3 text-right text-ink">{formatWan(row.salesRmb)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${row.profitRmb < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>{formatWan(row.profitRmb)}</td>
                    <td className="px-4 py-3 text-right text-ink">{formatPercent(row.grossMargin)}</td>
                    {showQuantity && <td className="px-4 py-3 text-right text-ink">{row.quantity.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} {row.unit}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
