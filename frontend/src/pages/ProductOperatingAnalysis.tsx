import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CircleDollarSign,
  ListOrdered,
  PackageSearch
} from 'lucide-react';
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
import { ColorIconBadge, type ColorIconTone } from '../components/ColorIconBadge';
import { PageHeader } from '../components/PageHeader';
import { ProductTrendDialog } from '../components/ProductTrendDialog';
import { loadAnalyticsDataSnapshot } from '../services/analyticsDataService';
import { fiscalYearForDate } from '../services/customerValueAnalytics';
import { formatLocalDate } from '../services/dateUtils';
import { getFiscalYearRange } from '../services/fiscalYear';
import {
  buildProductOperatingAnalysis,
  buildProductOperatingTrend,
  type ProductOperatingMetric,
  type ProductOperatingRow
} from '../services/productOperatingAnalytics';
import {
  loadProductIdentityCatalog,
  type ProductIdentityCatalog
} from '../services/productIdentityService';
import { getLocalSession } from '../services/localClient';

interface ProductOperatingAnalysisProps {
  onNavigate: (tab: string) => void;
  onRefreshTrigger: number;
}

const EMPTY_IDENTITY_CATALOG: ProductIdentityCatalog = {
  products: []
};

const metricMeta: Record<ProductOperatingMetric, { label: string; shortLabel: string; description: string }> = {
  sales: { label: '实际销售额', shortLabel: '销售', description: '已发货明细按发货月汇率折算，CIF 保留销售毛额' },
  profit: { label: '已确认利润', shortLabel: '利润', description: '仅使用 v_shipment_profit 非预估利润，CIF 按 FOB 利润基数' }
};

const formatMoney = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatWan = (value: number) => `${(value / 10_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 万元`;
const formatPercent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const formatAxisMoney = (value: number) => Math.abs(value) >= 10_000 ? `${(value / 10_000).toFixed(0)}万` : value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });

function ParetoTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: ProductOperatingRow & { cumulativePercent: number } }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="min-w-56 rounded-xl border border-border bg-surface p-3 text-xs shadow-xl">
      <div className="font-semibold text-ink">#{row.rank} {row.productName}</div>
      <div className="mt-1 text-[11px] text-muted">{row.specification} · {row.materialNumbers.join(' / ') || '未映射物料'}</div>
      <div className="mt-2 flex justify-between gap-5"><span className="text-muted">金额</span><b className="text-ink">{formatMoney(row.amount)}</b></div>
      <div className="mt-1 flex justify-between gap-5"><span className="text-muted">单品贡献</span><b className="text-ink">{formatPercent(row.share)}</b></div>
      <div className="mt-1 flex justify-between gap-5"><span className="text-muted">累计贡献</span><b className="text-brand-cyan">{formatPercent(row.cumulativeShare)}</b></div>
    </div>
  );
}

export function ProductOperatingAnalysis({ onNavigate, onRefreshTrigger }: ProductOperatingAnalysisProps) {
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const today = formatLocalDate();
  const [startDate, setStartDate] = useState(fiscalRange.startDate);
  const [endDate, setEndDate] = useState(fiscalRange.endDate);
  const [metric, setMetric] = useState<ProductOperatingMetric>('sales');
  const [catalog, setCatalog] = useState<ProductIdentityCatalog>(EMPTY_IDENTITY_CATALOG);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityError, setIdentityError] = useState('');
  const [selectedProductKey, setSelectedProductKey] = useState('');
  const snapshot = useMemo(() => {
    void onRefreshTrigger;
    return loadAnalyticsDataSnapshot();
  }, [onRefreshTrigger]);

  useEffect(() => {
    let active = true;
    setIdentityLoading(true);
    setIdentityError('');
    if (!getLocalSession()) {
      setCatalog(EMPTY_IDENTITY_CATALOG);
      setIdentityError('请登录后读取产品主数据映射');
      setIdentityLoading(false);
      return () => { active = false; };
    }
    loadProductIdentityCatalog()
      .then((next) => {
        if (active) setCatalog(next);
      })
      .catch((error) => {
        if (!active) return;
        setCatalog(EMPTY_IDENTITY_CATALOG);
        setIdentityError(error instanceof Error ? error.message : '产品主数据映射加载失败');
      })
      .finally(() => {
        if (active) setIdentityLoading(false);
      });
    return () => { active = false; };
  }, [onRefreshTrigger]);

  const result = useMemo(
    () => buildProductOperatingAnalysis(snapshot, catalog, { startDate, endDate }, metric),
    [snapshot, catalog, startDate, endDate, metric]
  );
  const chartRows = useMemo(
    () => result.rows.map((row) => ({ ...row, cumulativePercent: row.cumulativeShare * 100 })),
    [result.rows]
  );
  const selectedProduct = result.allRows.find((row) => row.key === selectedProductKey);
  const trendFiscalYear = fiscalYearForDate(endDate || today);
  const trendRows = useMemo(
    () => selectedProductKey
      ? buildProductOperatingTrend(snapshot, catalog, trendFiscalYear, selectedProductKey, today)
      : [],
    [snapshot, catalog, trendFiscalYear, selectedProductKey, today]
  );
  const missingCount = metric === 'sales' ? result.missingSalesRateCount : result.pendingProfitLineCount;
  const summaryCards: Array<{ label: string; value: string; hint: string; tone: ColorIconTone; icon: typeof PackageSearch }> = [
    { label: 'Top 1 贡献', value: formatPercent(result.top1Share), hint: '第一大正贡献产品', tone: 'teal', icon: PackageSearch },
    { label: 'Top 3 贡献', value: formatPercent(result.top3Share), hint: '前三个产品累计贡献', tone: 'green', icon: BarChart3 },
    { label: 'Top 5 贡献', value: formatPercent(result.top5Share), hint: '前五个产品累计贡献', tone: 'amber', icon: CircleDollarSign },
    { label: '产品 N80', value: result.n80 ? `${result.n80} 个` : '—', hint: '达到累计 80% 的最少产品数', tone: 'purple', icon: ListOrdered }
  ];

  return (
    <div className="mx-auto max-w-[1540px] space-y-5 pb-8">
      <PageHeader
        title="产品经营分析"
        description="用最少指标查看产品贡献、集中度和三财年表现；ERP 物料仍负责成本利润，经营层优先按已确认 Product Variant 归并。"
        leading={
          <button type="button" onClick={() => onNavigate('analytics')} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回数据分析中心
          </button>
        }
      />

      <section className="glass-panel rounded-2xl p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-medium text-muted">
            开始日期
            <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink" />
          </label>
          <label className="text-xs font-medium text-muted">
            结束日期
            <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink" />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => { setStartDate(fiscalRange.startDate); setEndDate(fiscalRange.endDate); }}
              className="h-11 rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-body transition hover:border-brand-cyan/35 hover:text-brand-cyan"
            >
              恢复本财年
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-subtle">
          <span>当前范围：{startDate} 至 {endDate}</span>
          {endDate === fiscalRange.endDate && <span>当前财年尚未结束，数据截止 {fiscalRange.endDate}。</span>}
          <span>销售按实际发货日；利润按开票月份，两者时间归属不同。</span>
        </div>
      </section>

      <section className="glass-panel rounded-2xl p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-base font-bold text-ink">产品集中度</h2>
            <p className="mt-1 text-xs text-muted">只对当前指标的正贡献产品计算 Top、N80 和累计贡献。</p>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-muted p-1" role="group" aria-label="产品集中度指标">
            {(Object.keys(metricMeta) as ProductOperatingMetric[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={metric === item}
                onClick={() => setMetric(item)}
                className={`min-w-28 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${metric === item ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:text-ink'}`}
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
            <div><div className="text-xs text-muted">{item.label}</div><div className="mt-1 text-xl font-bold text-ink">{item.value}</div><div className="mt-1 text-[10px] text-subtle">{item.hint}</div></div>
          </article>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {[
          { label: '核心产品', summary: result.core, hint: `达到累计 80% 的最少产品集合（N80=${result.n80 || '—'}）`, tone: 'teal' as ColorIconTone },
          { label: '长尾产品', summary: result.tail, hint: '其余正贡献产品，仅展示结构，不代表淘汰建议', tone: 'slate' as ColorIconTone }
        ].map((item) => (
          <article key={item.label} className="glass-panel rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="font-heading font-bold text-ink">{item.label}</h3><p className="mt-1 text-xs text-muted">{item.hint}</p></div>
              <ColorIconBadge tone={item.tone} size="sm" shape="circle"><PackageSearch className="h-4 w-4" /></ColorIconBadge>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-2xl font-bold text-ink">{item.summary.productCount} 个</div><div className="mt-1 text-xs text-muted">{formatWan(item.summary.amount)}</div></div><div className="text-xl font-bold text-brand-cyan">{formatPercent(item.summary.share)}</div></div>
          </article>
        ))}
      </section>

      {(identityLoading || identityError || result.unmappedProductCount > 0 || result.conflictingProductCount > 0) && (
        <div className="rounded-xl border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs leading-5 text-brand-amber">
          {identityLoading
            ? '正在读取产品主数据与 Product Variant 映射…'
            : identityError
              ? `产品主数据映射暂不可用，当前按历史 SKU 兼容展示：${identityError}`
              : `当前有 ${result.unmappedProductCount} 个产品尚未归一${result.conflictingProductCount ? `，另有 ${result.conflictingProductCount} 个映射冲突` : ''}；它们继续按历史 SKU 展示，已确认映射补齐后会自动归并。`}
        </div>
      )}
      {missingCount > 0 && (
        <div className="rounded-xl border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
          {metric === 'sales'
            ? `有 ${missingCount} 条实际发货明细缺少发货月份汇率，暂未计入人民币销售额。`
            : `有 ${missingCount} 条利润明细尚未确认，未进入利润集中度和亏损判断。`}
        </div>
      )}
      {result.lossRows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose sm:flex-row sm:items-center sm:justify-between">
          <span><AlertTriangle className="mr-1.5 inline h-4 w-4" />当前范围有 {result.lossRows.length} 个亏损产品，合计 {formatMoney(result.totalLossRmb)}；亏损不进入正利润集中度分母。</span>
          <span className="font-semibold">{result.lossRows.slice(0, 4).map((row) => row.productName).join('、')}{result.lossRows.length > 4 ? '…' : ''}</span>
        </div>
      )}

      <section className="glass-panel rounded-2xl p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="font-heading text-base font-bold text-ink">80% 帕累托图</h2><p className="mt-1 text-xs text-muted">柱形为产品{metricMeta[metric].label}，折线为累计贡献；横向滚动保留全部正贡献产品。</p></div>
          <div className="text-xs text-muted">正贡献合计 <b className="ml-1 text-ink">{formatWan(result.totalAmount)}</b></div>
        </div>
        {chartRows.length ? (
          <div className="mt-5 overflow-x-auto pb-2">
            <div className="h-[370px]" style={{ minWidth: `${Math.max(820, chartRows.length * 76)}px` }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartRows} margin={{ top: 12, right: 18, left: 8, bottom: 72 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="productName" interval={0} angle={-35} textAnchor="end" height={86} tick={{ fill: 'var(--color-muted)', fontSize: 10 }} tickFormatter={(value: string) => value.length > 9 ? `${value.slice(0, 9)}…` : value} />
                  <YAxis yAxisId="amount" tickFormatter={formatAxisMoney} tick={{ fill: 'var(--color-muted)', fontSize: 10 }} width={62} />
                  <YAxis yAxisId="percent" orientation="right" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(value) => `${value}%`} tick={{ fill: 'var(--color-muted)', fontSize: 10 }} width={48} />
                  <Tooltip content={<ParetoTooltip />} />
                  <ReferenceLine yAxisId="percent" y={80} stroke="var(--color-brand-amber)" strokeDasharray="6 5" label={{ value: '80%', position: 'insideTopRight', fill: 'var(--color-brand-amber)', fontSize: 10 }} />
                  <Bar yAxisId="amount" dataKey="amount" fill="var(--color-brand-cyan)" fillOpacity={0.72} radius={[5, 5, 0, 0]} maxBarSize={38} />
                  <Line yAxisId="percent" type="monotone" dataKey="cumulativePercent" stroke="var(--color-brand-purple)" strokeWidth={2.2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : <div className="mt-5 flex h-56 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted">当前范围没有正贡献产品</div>}
      </section>

      <section className="glass-panel overflow-hidden rounded-2xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-heading text-base font-bold text-ink">产品明细</h2>
          <p className="mt-1 text-xs text-muted">点击产品查看全部客户范围的三财年趋势。业务次数为事实展示，不代表人工成本。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-5 py-3">产品 / 规格</th><th className="px-4 py-3">ERP 物料号</th><th className="px-4 py-3">归一状态</th>
                <th className="px-4 py-3 text-right">销售额</th><th className="px-4 py-3 text-right">确认利润</th><th className="px-4 py-3 text-right">毛利率</th>
                <th className="px-4 py-3 text-right">客户数</th><th className="px-4 py-3 text-right">联系单数</th><th className="px-4 py-3 text-right">已关联批次</th><th className="px-5 py-3 text-right">物理发货</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.allRows.map((row) => (
                <tr key={row.key} onClick={() => setSelectedProductKey(row.key)} className="cursor-pointer transition hover:bg-brand-cyan/5">
                  <td className="px-5 py-3"><div className="font-semibold text-brand-cyan">{row.productName}</div><div className="mt-1 text-[11px] text-muted">{row.specification}</div></td>
                  <td className="max-w-72 px-4 py-3 text-body"><span className="line-clamp-2">{row.materialNumbers.join('、') || '—'}</span></td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.identityState === 'mapped' ? 'bg-brand-emerald/10 text-brand-emerald' : row.identityState === 'conflict' ? 'bg-brand-rose/10 text-brand-rose' : 'bg-brand-amber/10 text-brand-amber'}`}>{row.identityState === 'mapped' ? '已归一' : row.identityState === 'conflict' ? '映射冲突' : '未归一'}</span></td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{formatMoney(row.salesRmb)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${row.profitRmb < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>{formatMoney(row.profitRmb)}</td>
                  <td className={`px-4 py-3 text-right ${row.grossMargin !== null && row.grossMargin < 0 ? 'text-brand-rose' : 'text-ink'}`}>{formatPercent(row.grossMargin)}</td>
                  <td className="px-4 py-3 text-right text-body">{row.activeCustomerCount}</td><td className="px-4 py-3 text-right text-body">{row.contactSheetCount}</td><td className="px-4 py-3 text-right text-body">{row.linkedBatchCount}</td><td className="px-5 py-3 text-right text-body">{row.physicalShipmentCount}</td>
                </tr>
              ))}
              {!result.allRows.length && <tr><td colSpan={10} className="px-5 py-10 text-center text-muted">当前范围暂无产品明细</td></tr>}
            </tbody>
          </table>
        </div>
        {result.unlinkedBatchLineCount > 0 && <div className="border-t border-border px-5 py-3 text-[11px] text-muted">有 {result.unlinkedBatchLineCount} 条实际发货明细未关联批次，批次数仅展示已关联事实。</div>}
      </section>

      {selectedProduct && (
        <ProductTrendDialog
          productName={selectedProduct.productName}
          materialLabel={selectedProduct.materialNumbers.join(' / ')}
          specification={selectedProduct.specification}
          scopeLabel="全部客户"
          basisLabel="实际发货销售 / 已确认利润"
          rows={trendRows}
          initialMetric={metric}
          showQuantity={false}
          onClose={() => setSelectedProductKey('')}
        />
      )}
    </div>
  );
}
