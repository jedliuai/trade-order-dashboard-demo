import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Download,
  PackageSearch,
  TrendingDown,
  TrendingUp
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Button } from '../components/Button';
import { ColorIconBadge, type ColorIconTone } from '../components/ColorIconBadge';
import { PageHeader } from '../components/PageHeader';
import { CustomerSelect } from '../components/CustomerSelect';
import { ProductTrendDialog } from '../components/ProductTrendDialog';
import { loadAnalyticsDataSnapshot } from '../services/analyticsDataService';
import { formatLocalDate } from '../services/dateUtils';
import {
  buildCustomerProductAnalysis,
  buildProductTrend,
  fiscalYearForDate,
  type ProductAnalysisBasis,
  type ProductAnalysisRow,
  type ProductMetric
} from '../services/customerValueAnalytics';

interface CustomerProductAnalysisProps {
  onNavigate: (tab: string) => void;
  onRefreshTrigger: number;
}

const COLORS = ['#B08A58', '#4D9D83', '#65AFC2', '#C99B45', '#C46E4F', '#847562', '#7A9A87', '#D2B07A'];
const formatWan = (value: number) => `${(value / 10_000).toFixed(2)} 万元`;
const formatPercent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const metricLabels: Record<ProductMetric, string> = {
  sales: '销售金额',
  profit: '利润额',
  margin: '毛利率',
  quantity: '数量'
};

function metricValue(row: ProductAnalysisRow, metric: ProductMetric) {
  if (metric === 'profit') return row.profitRmb;
  if (metric === 'margin') return (row.grossMargin || 0) * 100;
  if (metric === 'quantity') return row.quantity;
  return row.salesRmb;
}

function metricDisplay(value: number, metric: ProductMetric, unit = '') {
  if (metric === 'margin') return `${value.toFixed(1)}%`;
  if (metric === 'quantity') return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${unit}`;
  return formatWan(value);
}

function metricAxisTick(value: number, metric: ProductMetric) {
  if (metric === 'margin') return `${value.toFixed(0)}%`;
  if (metric === 'quantity') {
    if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, '')} 万`;
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  return `${(value / 10_000).toFixed(1).replace(/\.0$/, '')} 万`;
}

function ProductTooltip({ active, payload, metric }: {
  active?: boolean;
  payload?: Array<{ payload: ProductAnalysisRow & { chartValue: number } }>;
  metric: ProductMetric;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="min-w-56 rounded-xl border border-border bg-surface p-3 text-xs shadow-xl">
      <div className="font-semibold text-ink">{row.productName}</div>
      <div className="mt-1 text-[11px] text-muted">{row.materialNo} · {row.specification}</div>
      <div className="mt-3 flex justify-between gap-5">
        <span className="text-muted">{metricLabels[metric]}</span>
        <b className={metric === 'profit' && row.chartValue < 0 ? 'text-brand-rose' : 'text-ink'}>
          {metricDisplay(row.chartValue, metric, row.unit)}
        </b>
      </div>
      <div className="mt-1 flex justify-between gap-5">
        <span className="text-muted">销售额 / 毛利率</span>
        <b className="text-ink">{formatWan(row.salesRmb)} / {formatPercent(row.grossMargin)}</b>
      </div>
    </div>
  );
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(rows: ProductAnalysisRow[], customerName: string, fiscalYear: number) {
  const headers = ['客户', '财年', '物料号', '产品名称', '规格', '单位', '数量', '销售额（人民币）', '已确认利润（人民币）', '毛利率', '金额占比', '同比'];
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => [
      customerName,
      `FY${fiscalYear}`,
      row.materialNo,
      row.productName,
      row.specification,
      row.unit,
      row.quantity,
      row.salesRmb.toFixed(2),
      row.profitRmb.toFixed(2),
      row.grossMargin === null ? '' : `${(row.grossMargin * 100).toFixed(2)}%`,
      `${(row.amountShare * 100).toFixed(2)}%`,
      row.yearOverYear === null ? '' : `${(row.yearOverYear * 100).toFixed(2)}%`
    ].map(csvEscape).join(','))
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${customerName}-FY${fiscalYear}-产品分析.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export const CustomerProductAnalysis: React.FC<CustomerProductAnalysisProps> = ({
  onNavigate,
  onRefreshTrigger
}) => {
  const today = formatLocalDate();
  const currentFiscalYear = fiscalYearForDate(today);
  const snapshot = useMemo(() => {
    void onRefreshTrigger;
    return loadAnalyticsDataSnapshot();
  }, [onRefreshTrigger]);
  const customers = useMemo(
    () => snapshot.customers
      .filter((customer) => snapshot.contracts.some((contract) => contract.customer_id === customer.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [snapshot]
  );
  const [customerId, setCustomerId] = useState(() => {
    const stored = sessionStorage.getItem('analytics-selected-customer') || '';
    return customers.some((item) => item.id === stored) ? stored : customers[0]?.id || '';
  });
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear);
  const [basis, setBasis] = useState<ProductAnalysisBasis>('shipment');
  const [metric, setMetric] = useState<ProductMetric>('sales');
  const [selectedProductKey, setSelectedProductKey] = useState('');

  useEffect(() => {
    if (!customerId && customers[0]) setCustomerId(customers[0].id);
  }, [customerId, customers]);

  const selectedCustomer = customers.find((item) => item.id === customerId);
  const result = useMemo(
    () => buildCustomerProductAnalysis(snapshot, customerId, fiscalYear, basis, today),
    [snapshot, customerId, fiscalYear, basis, today]
  );
  const chartRows = useMemo(
    () => result.rows
      .map((row) => ({ ...row, chartValue: metricValue(row, metric) }))
      .sort((a, b) => b.chartValue - a.chartValue)
      .slice(0, 10),
    [result.rows, metric]
  );
  const pieMetric: 'sales' | 'profit' | 'quantity' = metric === 'sales'
    ? 'sales'
    : metric === 'quantity' && !result.mixedQuantityUnits
      ? 'quantity'
      : metric === 'quantity'
        ? 'sales'
        : 'profit';
  const pieRows = useMemo(
    () => result.rows
      .map((row) => ({
        ...row,
        pieValue: pieMetric === 'sales'
          ? Math.max(row.salesRmb, 0)
          : pieMetric === 'quantity'
            ? Math.max(row.quantity, 0)
            : Math.max(row.profitRmb, 0)
      }))
      .filter((row) => row.pieValue > 0)
      .sort((a, b) => b.pieValue - a.pieValue)
      .slice(0, 8),
    [result.rows, pieMetric]
  );
  const selectedProduct = result.rows.find((row) => row.key === selectedProductKey);
  const trendRows = useMemo(
    () => selectedProductKey
      ? buildProductTrend(snapshot, customerId, fiscalYear, basis, selectedProductKey, today)
      : [],
    [snapshot, customerId, fiscalYear, basis, selectedProductKey, today]
  );
  const latestYoY = selectedProduct?.yearOverYear ?? null;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-8">
      <PageHeader
        title="客户产品分析"
        description="从客户的产品结构、贡献占比和三财年趋势判断增长来源；金额统一按业务发生月份汇率折算人民币。"
        leading={
          <button
            type="button"
            onClick={() => onNavigate('analytics_customer_value')}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 返回客户经营分析
          </button>
        }
        actions={
          <Button
            tone="secondary"
            icon={<Download className="h-4 w-4" />}
            disabled={!result.rows.length || !selectedCustomer}
            onClick={() => selectedCustomer && downloadCsv(result.rows, selectedCustomer.name, fiscalYear)}
          >
            导出当前产品明细
          </Button>
        }
      />

      <section className="glass-panel rounded-2xl p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-muted">
            客户
            <CustomerSelect
              value={customerId}
              onChange={(value) => {
                setCustomerId(value);
                sessionStorage.setItem('analytics-selected-customer', value);
              }}
              customers={customers}
              ariaLabel="选择客户"
              placeholder="选择客户"
              searchPlaceholder="输入客户名称"
              className="mt-1.5"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            财年
            <select
              value={fiscalYear}
              onChange={(event) => setFiscalYear(Number(event.target.value))}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
            >
              {[0, 1, 2, 3, 4].map((offset) => (
                <option key={currentFiscalYear - offset} value={currentFiscalYear - offset}>FY{currentFiscalYear - offset}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            统计口径
            <select
              value={basis}
              onChange={(event) => setBasis(event.target.value as ProductAnalysisBasis)}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
            >
              <option value="shipment">实际发货</option>
              <option value="contract">合同订单</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            币种
            <input
              readOnly
              value="人民币（统一折算）"
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-muted"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            分析指标
            <select
              value={metric}
              onChange={(event) => setMetric(event.target.value as ProductMetric)}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
            >
              <option value="sales">销售金额</option>
              <option value="profit">利润额</option>
              <option value="margin">毛利率</option>
              <option value="quantity">数量</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-subtle">
          <span>当前范围：{result.period.startDate} 至 {result.period.endDate}{result.period.isCurrent ? '（本财年截至今日）' : ''}</span>
          <span>利润按开票月份确认，只统计成本与汇率齐全的数据。</span>
          {result.missingRateCount > 0 && <span className="text-brand-amber">{result.missingRateCount} 条金额因缺汇率未折算。</span>}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: basis === 'shipment' ? '实际发货销售额' : '合同订单金额', value: formatWan(result.totalSalesRmb), icon: BarChart3, tone: 'blue' },
          { label: '已确认利润', value: formatWan(result.totalProfitRmb), icon: result.totalProfitRmb < 0 ? TrendingDown : TrendingUp, danger: result.totalProfitRmb < 0, tone: result.totalProfitRmb < 0 ? 'rose' : 'amber' },
          { label: '综合毛利率', value: formatPercent(result.overallGrossMargin), icon: TrendingUp, danger: (result.overallGrossMargin || 0) < 0, tone: (result.overallGrossMargin || 0) < 0 ? 'rose' : 'purple' },
          { label: '产品种类', value: `${result.rows.length} 种`, icon: PackageSearch, tone: 'teal' }
        ].map((item) => (
          <article key={item.label} className="glass-panel rounded-2xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted">{item.label}</div>
                <div className={`mt-2 text-xl font-bold ${item.danger ? 'text-brand-rose' : 'text-ink'}`}>{item.value}</div>
              </div>
              <ColorIconBadge tone={item.tone as ColorIconTone} size="sm" shape="circle"><item.icon className="h-4 w-4" /></ColorIconBadge>
            </div>
          </article>
        ))}
      </section>

      {metric === 'quantity' && result.mixedQuantityUnits && (
        <div className="rounded-xl border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
          当前客户包含多个计量单位。数量仅在各产品自身单位内展示，不计算跨单位总量；右侧结构图改用销售额占比。
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.7fr)]">
        <div className="glass-panel rounded-2xl p-5">
          <div>
            <h3 className="font-semibold text-ink">产品贡献排行</h3>
            <p className="mt-1 text-xs text-muted">点击柱形可查看该产品的三财年趋势。</p>
          </div>
          <div className="mt-4 h-[430px]">
            {chartRows.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 28, bottom: 12, left: 24 }}>
                  <CartesianGrid stroke="#E8E0D2" strokeDasharray="3 5" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: '#81786B' }}
                    tickFormatter={(value) => metricAxisTick(Number(value), metric)}
                  />
                  <YAxis
                    type="category"
                    dataKey="productName"
                    width={150}
                    tick={{ fontSize: 11, fill: '#4D473F' }}
                    tickFormatter={(value) => value.length > 11 ? `${value.slice(0, 10)}…` : value}
                  />
                  <Tooltip content={<ProductTooltip metric={metric} />} cursor={{ fill: 'rgba(176,138,88,0.07)' }} />
                  <Bar
                    dataKey="chartValue"
                    radius={[0, 7, 7, 0]}
                    onClick={(row) => {
                      const payload = (row as unknown as { payload?: ProductAnalysisRow }).payload;
                      if (payload) {
                        setSelectedProductKey(payload.key);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    {chartRows.map((row, index) => (
                      <Cell key={row.key} fill={row.chartValue < 0 ? '#C45C52' : COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">当前客户在该财年没有可分析的产品数据</div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <h3 className="font-semibold text-ink">产品构成占比</h3>
          <p className="mt-1 text-xs text-muted">
            {pieMetric === 'sales'
              ? metric === 'quantity' ? '数量单位不一致，改按销售金额' : '按销售金额'
              : pieMetric === 'quantity' ? `按数量（${result.quantityUnit}）` : '按正利润贡献'}展示。
          </p>
          <div className="mt-3 h-[310px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieRows}
                  dataKey="pieValue"
                  nameKey="productName"
                  innerRadius={72}
                  outerRadius={112}
                  paddingAngle={2}
                  onClick={(row) => {
                    const payload = (row as unknown as { payload?: ProductAnalysisRow }).payload;
                    if (payload) {
                      setSelectedProductKey(payload.key);
                    }
                  }}
                  className="cursor-pointer"
                >
                  {pieRows.map((row, index) => <Cell key={row.key} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => pieMetric === 'quantity'
                  ? `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${result.quantityUnit}`
                  : formatWan(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {pieRows.slice(0, 6).map((row, index) => (
              <button
                key={row.key}
                type="button"
                onClick={() => setSelectedProductKey(row.key)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
              >
                <span className="min-w-0 truncate text-body"><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />{row.productName}</span>
                <b className="shrink-0 text-ink">{pieMetric === 'quantity'
                  ? `${row.pieValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${result.quantityUnit}`
                  : formatWan(row.pieValue)}</b>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="glass-panel overflow-hidden rounded-2xl">
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-semibold text-ink">完整产品明细</h3>
          <p className="mt-1 text-xs text-muted">点击任意产品行查看该产品近三个财年的变化。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-5 py-3 font-semibold">产品 / 物料号</th>
                <th className="px-4 py-3 font-semibold">规格</th>
                <th className="px-4 py-3 text-right font-semibold">数量</th>
                <th className="px-4 py-3 text-right font-semibold">销售额</th>
                <th className="px-4 py-3 text-right font-semibold">已确认利润</th>
                <th className="px-4 py-3 text-right font-semibold">毛利率</th>
                <th className="px-4 py-3 text-right font-semibold">金额占比</th>
                <th className="px-5 py-3 text-right font-semibold">同比</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.rows.map((row) => (
                <tr
                  key={row.key}
                  onClick={() => setSelectedProductKey(row.key)}
                  className="cursor-pointer transition hover:bg-brand-cyan/5"
                >
                  <td className="px-5 py-3">
                    <div className="font-semibold text-ink">{row.productName}</div>
                    <div className="mt-1 text-[11px] text-muted">{row.materialNo}</div>
                  </td>
                  <td className="px-4 py-3 text-body">{row.specification}</td>
                  <td className="px-4 py-3 text-right text-body">{row.quantity.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} {row.unit}</td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{formatWan(row.salesRmb)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${row.profitRmb < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>{formatWan(row.profitRmb)}</td>
                  <td className={`px-4 py-3 text-right ${row.grossMargin !== null && row.grossMargin < 0 ? 'text-brand-rose' : 'text-ink'}`}>{formatPercent(row.grossMargin)}</td>
                  <td className="px-4 py-3 text-right text-body">{formatPercent(row.amountShare)}</td>
                  <td className={`px-5 py-3 text-right ${row.yearOverYear !== null && row.yearOverYear < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>
                    {formatPercent(row.yearOverYear)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedProduct && (
        <ProductTrendDialog
          productName={selectedProduct.productName}
          materialLabel={selectedProduct.materialNo}
          specification={selectedProduct.specification}
          unit={selectedProduct.unit}
          scopeLabel={selectedCustomer?.name || '当前客户'}
          basisLabel={basis === 'shipment' ? '实际发货口径' : '合同订单口径'}
          rows={trendRows}
          latestYoY={latestYoY}
          initialMetric={metric}
          onClose={() => setSelectedProductKey('')}
        />
      )}
    </div>
  );
};
