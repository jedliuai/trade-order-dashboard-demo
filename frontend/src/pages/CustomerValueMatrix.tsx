import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Sparkles,
  TrendingUp,
  UsersRound
} from 'lucide-react';
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from 'recharts';
import { Button } from '../components/Button';
import { ColorIconBadge, type ColorIconTone } from '../components/ColorIconBadge';
import { PageHeader } from '../components/PageHeader';
import { getFiscalYearRange } from '../services/fiscalYear';
import { loadAnalyticsDataSnapshot } from '../services/analyticsDataService';
import {
  buildCustomerValueMatrix,
  type CustomerValueRow
} from '../services/customerValueAnalytics';

interface CustomerValueMatrixProps {
  onNavigate: (tab: string) => void;
  onRefreshTrigger: number;
  embedded?: boolean;
}

const moneyWan = (value: number) => `${(value / 10_000).toFixed(2)} 万元`;
const numberWan = (value: number) => Number((value / 10_000).toFixed(2));
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;

const quadrantMeta = {
  core: { label: '核心客户', tone: 'text-brand-emerald', bg: 'bg-brand-emerald/10' },
  scale: { label: '规模客户', tone: 'text-brand-amber', bg: 'bg-brand-amber/10' },
  potential: { label: '高潜客户', tone: 'text-brand-cyan', bg: 'bg-brand-cyan/10' },
  low: { label: '低贡献客户', tone: 'text-muted', bg: 'bg-surface-muted' }
} as const;

function bubbleColor(margin: number | null) {
  if (margin === null || margin < 0.05) return '#E98755';
  if (margin < 0.1) return '#F1B72D';
  if (margin < 0.15) return '#6E9FDF';
  if (margin < 0.25) return '#8BCB78';
  return '#43B99A';
}

interface BubblePoint extends CustomerValueRow {
  x: number;
  y: number;
  z: number;
  labelDx: number;
  labelDy: number;
}

const bubbleRadius = (activeMonths: number) => 14 + Math.min(activeMonths, 12) * 2;

function bubbleDisplayName(customerName: string) {
  const trimmed = customerName.trim();
  if (/[\u2E80-\u9FFF]/.test(trimmed)) {
    return trimmed
      .replace(/（.*?）|\(.*?\)/g, '')
      .replace(/股份有限公司|有限责任公司|有限公司|进出口|医药科技|生物科技|医药股份/g, '')
      .slice(0, 8) || trimmed.slice(0, 8);
  }
  return trimmed
    .replace(/\b(LABORATORIO|LABORATORIOS)\b/gi, '')
    .replace(/\b(S\.?A\.?S?\.?|S\.?A\.?C\.?|E\.?I\.?R\.?L\.?|L\.?L\.?C\.?|LTD\.?|LIMITED|CORP\.?|CO\.?)\b/gi, '')
    .replace(/[,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 2)
    .join(' ') || trimmed;
}

const estimatedBubbleLabelWidth = (label: string) => Array.from(label).reduce(
  (width, character) => width + (/[\u2E80-\u9FFF]/.test(character) ? 10 : 6.2),
  0
);

interface LabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlapArea = (first: LabelRect, second: LabelRect) => {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
};

function layoutOutsideBubbleLabels(points: Omit<BubblePoint, 'labelDx' | 'labelDy'>[]): BubblePoint[] {
  // Recharts' current desktop plot is approximately 680 × 425 px. We use this
  // virtual canvas only to choose collision-resistant label directions; the
  // final bubble coordinates remain responsive and are still drawn by Recharts.
  const plotWidth = 680;
  const plotHeight = 425;
  const positions = new Map<string, { dx: number; dy: number }>();
  const placedLabels: LabelRect[] = [
    { left: 0, right: 165, top: 8, bottom: 56 },
    { left: 515, right: 680, top: 8, bottom: 56 },
    { left: 0, right: 165, top: 365, bottom: 425 },
    { left: 515, right: 680, top: 365, bottom: 425 }
  ];
  const bubbleObstacles: LabelRect[] = points.map((point) => {
    const radius = bubbleRadius(point.activeMonths) + 3;
    const x = (point.x / 100) * plotWidth;
    const y = ((100 - point.y) / 100) * plotHeight;
    return { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
  });

  points
    .filter((point) => estimatedBubbleLabelWidth(bubbleDisplayName(point.customerName)) > bubbleRadius(point.activeMonths) * 1.9)
    .sort((first, second) => bubbleRadius(second.activeMonths) - bubbleRadius(first.activeMonths))
    .forEach((point) => {
      const x = (point.x / 100) * plotWidth;
      const y = ((100 - point.y) / 100) * plotHeight;
      const radius = bubbleRadius(point.activeMonths);
      const labelWidth = Math.min(estimatedBubbleLabelWidth(bubbleDisplayName(point.customerName)), 120);
      const labelHeight = 14;
      const horizontal = radius + 8 + labelWidth / 2;
      const vertical = radius + 10;
      const bottomVertical = radius + 24;
      const diagonalY = radius * 0.65 + 9;
      const candidates = point.y < 18
        ? [
            { dx: 0, dy: -bottomVertical },
            { dx: horizontal, dy: -bottomVertical },
            { dx: -horizontal, dy: -bottomVertical },
            { dx: horizontal, dy: -diagonalY },
            { dx: -horizontal, dy: -diagonalY },
            { dx: 0, dy: vertical }
          ]
        : point.x < 22
        ? [
            { dx: horizontal, dy: 0 },
            { dx: horizontal, dy: -diagonalY },
            { dx: horizontal, dy: diagonalY },
            { dx: 0, dy: -vertical },
            { dx: 0, dy: vertical },
            { dx: -horizontal, dy: 0 }
          ]
        : point.x > 78
          ? [
              { dx: -horizontal, dy: 0 },
              { dx: -horizontal, dy: -diagonalY },
              { dx: -horizontal, dy: diagonalY },
              { dx: 0, dy: -vertical },
              { dx: 0, dy: vertical },
              { dx: horizontal, dy: 0 }
            ]
          : [
                { dx: 0, dy: -vertical },
                { dx: horizontal, dy: 0 },
                { dx: -horizontal, dy: 0 },
                { dx: 0, dy: vertical },
                { dx: horizontal, dy: diagonalY },
                { dx: -horizontal, dy: diagonalY }
              ];

      const best = candidates
        .map((candidate, index) => {
          const centerX = x + candidate.dx;
          const centerY = y + candidate.dy;
          const rect = {
            left: centerX - labelWidth / 2,
            right: centerX + labelWidth / 2,
            top: centerY - labelHeight / 2,
            bottom: centerY + labelHeight / 2
          };
          const outsideWidth = Math.max(0, -rect.left) + Math.max(0, rect.right - plotWidth);
          const outsideHeight = Math.max(0, -rect.top) + Math.max(0, rect.bottom - plotHeight);
          const labelCollision = placedLabels.reduce((sum, placed) => sum + overlapArea(rect, placed), 0);
          const bubbleCollision = bubbleObstacles.reduce((sum, bubble) => sum + overlapArea(rect, bubble), 0);
          const score = (outsideWidth + outsideHeight) * 2_000 + labelCollision * 80 + bubbleCollision * 6 + index * 12;
          return { ...candidate, rect, score };
        })
        .sort((first, second) => first.score - second.score)[0];

      positions.set(point.customerId, { dx: best.dx, dy: best.dy });
      placedLabels.push(best.rect);
    });

  return points.map((point) => ({
    ...point,
    labelDx: positions.get(point.customerId)?.dx || 0,
    labelDy: positions.get(point.customerId)?.dy || 0
  }));
}

function createMedianScale(values: number[], midpoint: number, includeZero = false) {
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const lower = includeZero ? Math.min(0, minimum) : minimum;
  const upper = maximum;
  const toPlot = (value: number) => {
    if (value <= midpoint) {
      const span = midpoint - lower;
      return span > 0 ? ((value - lower) / span) * 50 : 50;
    }
    const span = upper - midpoint;
    return span > 0 ? 50 + ((value - midpoint) / span) * 50 : 50;
  };
  const fromPlot = (value: number) => {
    if (value <= 50) return lower + (midpoint - lower) * (value / 50);
    return midpoint + (upper - midpoint) * ((value - 50) / 50);
  };
  return { lower, upper, midpoint, toPlot, fromPlot };
}

function compactWanTick(value: number) {
  if (Math.abs(value) >= 100) return `${Math.round(value)} 万`;
  if (Math.abs(value) >= 10) return `${value.toFixed(1).replace(/\.0$/, '')} 万`;
  return `${value.toFixed(2).replace(/\.?0+$/, '')} 万`;
}

function BubbleShape(props: {
  cx?: number;
  cy?: number;
  payload?: BubblePoint;
}) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload) return null;
  const radius = bubbleRadius(payload.activeMonths);
  const displayName = bubbleDisplayName(payload.customerName);
  const estimatedLabelWidth = estimatedBubbleLabelWidth(displayName);
  const fitsInside = estimatedLabelWidth <= radius * 1.9;
  const labelDx = Number.isFinite(payload.labelDx) ? payload.labelDx : 0;
  const labelDy = Number.isFinite(payload.labelDy) ? payload.labelDy : 0;
  const labelX = cx + (fitsInside ? 0 : labelDx);
  const labelY = cy + (fitsInside ? 0 : labelDy);
  const vectorLength = Math.hypot(labelDx, labelDy) || 1;
  const vectorX = labelDx / vectorLength;
  const vectorY = labelDy / vectorLength;
  return (
    <g>
      <circle cx={cx} cy={cy} r={radius + 5} fill={bubbleColor(payload.grossMargin)} opacity={0.12} />
      <circle cx={cx} cy={cy} r={radius} fill={bubbleColor(payload.grossMargin)} opacity={0.82} />
      {!fitsInside && (
        <line
          x1={cx + vectorX * radius}
          y1={cy + vectorY * radius}
          x2={labelX - vectorX * 8}
          y2={labelY - vectorY * 8}
          stroke="#847A6C"
          strokeWidth={0.8}
        />
      )}
      <text
        x={labelX}
        y={labelY + 3.5}
        textAnchor="middle"
        fill="#2D2922"
        fontSize={fitsInside ? 9 : 10}
        fontWeight={fitsInside ? 700 : 600}
        paintOrder="stroke"
        stroke="#FAF7F2"
        strokeWidth={fitsInside ? 1.5 : 3}
        strokeLinejoin="round"
      >
        {displayName}
      </text>
    </g>
  );
}

function MatrixTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: BubblePoint }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="min-w-56 rounded-xl border border-border bg-surface p-3 text-xs shadow-xl">
      <div className="mb-2 font-semibold text-ink">{row.customerName}</div>
      <div className="space-y-1 text-muted">
        <div className="flex justify-between gap-4"><span>实际回款</span><b className="text-ink">{moneyWan(row.paymentRmb)}</b></div>
        <div className="flex justify-between gap-4"><span>实际利润</span><b className="text-ink">{moneyWan(row.profitRmb)}</b></div>
        <div className="flex justify-between gap-4"><span>毛利率</span><b className="text-ink">{percent(row.grossMargin)}</b></div>
        <div className="flex justify-between gap-4"><span>活跃月份</span><b className="text-ink">{row.activeMonths} 个月</b></div>
        <div className="flex justify-between gap-4"><span>合同 / 产品</span><b className="text-ink">{row.contractCount} / {row.productCount}</b></div>
      </div>
    </div>
  );
}

export const CustomerValueMatrix: React.FC<CustomerValueMatrixProps> = ({
  onNavigate,
  onRefreshTrigger,
  embedded = false
}) => {
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const [startDate, setStartDate] = useState(fiscalRange.startDate);
  const [endDate, setEndDate] = useState(fiscalRange.endDate);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const snapshot = useMemo(() => {
    void onRefreshTrigger;
    return loadAnalyticsDataSnapshot();
  }, [onRefreshTrigger]);
  const result = useMemo(
    () => buildCustomerValueMatrix(snapshot, { startDate, endDate }),
    [snapshot, startDate, endDate]
  );
  const paymentScale = useMemo(
    () => createMedianScale(result.rows.map((row) => numberWan(row.paymentRmb)), numberWan(result.paymentMedian), true),
    [result.rows, result.paymentMedian]
  );
  const profitScale = useMemo(
    () => createMedianScale(result.rows.map((row) => numberWan(row.profitRmb)), numberWan(result.profitMedian), true),
    [result.rows, result.profitMedian]
  );
  const chartRows = useMemo(
    () => layoutOutsideBubbleLabels(result.rows.map((row) => ({
      ...row,
      x: paymentScale.toPlot(numberWan(row.paymentRmb)),
      y: profitScale.toPlot(numberWan(row.profitRmb)),
      z: Math.max(row.activeMonths, 1)
    }))),
    [paymentScale, profitScale, result.rows]
  );

  const openCustomer = (customerId: string) => {
    sessionStorage.setItem('analytics-selected-customer', customerId);
    onNavigate('analytics_customer_product');
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-8">
      {!embedded && (
        <PageHeader
          title="客户价值矩阵"
          description="用实际回款与已确认利润识别核心、高潜和需要改善的客户；高低分界采用当前范围内活跃客户的中位数。"
          leading={
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> 返回数据分析中心
            </button>
          }
          actions={
            <Button
              tone="secondary"
              icon={<TrendingUp className="h-4 w-4" />}
              onClick={() => onNavigate('analytics_customer_product')}
            >
              客户产品分析
            </Button>
          }
        />
      )}

      <section className="glass-panel rounded-2xl p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-medium text-muted">
            开始日期
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            结束日期
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
            />
          </label>
          <div className="flex items-end">
            <Button
              tone="secondary"
              onClick={() => {
                setStartDate(fiscalRange.startDate);
                setEndDate(fiscalRange.endDate);
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: '活跃客户', value: `${result.activeCustomerCount} 家`, hint: '范围内有合同、发货或回款', icon: UsersRound, tone: 'teal' },
          { label: '实际回款', value: moneyWan(result.totalPaymentRmb), hint: '按到账月份汇率折算', icon: CircleDollarSign, tone: 'green' },
          { label: '实际利润', value: moneyWan(result.totalProfitRmb), hint: '只统计已开票且成本齐全', icon: TrendingUp, tone: 'amber' },
          { label: '综合毛利率', value: percent(result.overallGrossMargin), hint: '已确认利润 ÷ 对应销售额', icon: Sparkles, tone: 'purple' },
          { label: '平均回款周期（参考）', value: result.averagePaymentCycleDays === null ? '—' : `${result.averagePaymentCycleDays.toFixed(0)} 天`, hint: '合同签署至到账，按合同分摊回款金额加权', icon: Clock3, tone: 'blue' }
        ].map((item) => (
          <article key={item.label} className="glass-panel flex min-h-[108px] items-center gap-3 rounded-2xl p-4">
            <ColorIconBadge tone={item.tone as ColorIconTone} size="lg" shape="circle">
              <item.icon className="h-5 w-5" />
            </ColorIconBadge>
            <div className="min-w-0">
              <div className="text-xs text-muted">{item.label}</div>
              <div className="mt-1 text-xl font-bold text-ink">{item.value}</div>
              <div className="mt-1 truncate text-[10px] leading-4 text-subtle" title={item.hint}>{item.hint}</div>
            </div>
          </article>
        ))}
      </section>

      {result.missingRateCount > 0 && (
        <div className="rounded-xl border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
          有 {result.missingRateCount} 笔美元回款缺少业务发生月份汇率，暂未计入人民币金额。
        </div>
      )}

      <section className="grid gap-5 xl:h-[680px] xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.8fr)]">
        <div className="glass-panel rounded-2xl p-5 xl:h-full">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-ink">回款—利润客户分布</h3>
              <p className="mt-1 text-xs text-muted">气泡越大，代表本财年有订单的月份越多；点击气泡查看客户产品结构。</p>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted">
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-brand-emerald" />毛利率 ≥25%</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#8BCB78]" />15%—25%</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#6E9FDF]" />10%—15%</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#F1B72D]" />5%—10%</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#E98755]" />&lt;5%</span>
            </div>
          </div>
          <div className="relative mt-4 h-[520px]">
            {chartRows.length ? (
              <>
                <div className="pointer-events-none absolute inset-x-7 bottom-12 top-6 z-[1] ml-[72px] grid grid-cols-2 grid-rows-2 overflow-hidden rounded-lg">
                  <div className="border-b border-r border-brand-cyan/15 bg-brand-cyan/[0.045] p-4">
                    <div className="text-sm font-bold text-brand-cyan">低回款 + 高利润</div>
                    <div className="mt-1 text-[11px] text-muted">高潜客户</div>
                  </div>
                  <div className="border-b border-brand-emerald/15 bg-brand-emerald/[0.055] p-4 text-right">
                    <div className="text-sm font-bold text-brand-emerald">高回款 + 高利润</div>
                    <div className="mt-1 text-[11px] text-muted">核心价值客户</div>
                  </div>
                  <div className="flex flex-col justify-end border-r border-brand-rose/15 bg-brand-rose/[0.035] p-4">
                    <div className="text-sm font-bold text-brand-rose">低回款 + 低利润</div>
                    <div className="mt-1 text-[11px] text-muted">低贡献客户</div>
                  </div>
                  <div className="flex flex-col justify-end bg-brand-amber/[0.045] p-4 text-right">
                    <div className="text-sm font-bold text-brand-amber">高回款 + 低利润</div>
                    <div className="mt-1 text-[11px] text-muted">规模型客户</div>
                  </div>
                </div>
                <div className="pointer-events-none absolute left-[78px] top-0 z-[2] text-[11px] font-semibold text-muted">
                  实际利润（万元）
                </div>
                <div className="pointer-events-none absolute bottom-2 left-1/2 z-[2] -translate-x-1/2 rounded-md bg-surface/90 px-2 py-1 text-[10px] font-semibold text-brand-cyan">
                  回款中位数：{moneyWan(result.paymentMedian)}
                </div>
                <div className="pointer-events-none absolute left-0 top-1/2 z-[2] -translate-y-1/2 -rotate-90 rounded-md bg-surface/90 px-2 py-1 text-[10px] font-semibold text-brand-cyan">
                  利润中位数：{moneyWan(result.profitMedian)}
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 26, right: 28, bottom: 42, left: 26 }}>
                    <CartesianGrid stroke="#DED5C6" strokeDasharray="3 5" />
                    <ReferenceArea x1={0} x2={50} y1={50} y2={100} fill="#65AFC2" fillOpacity={0.025} />
                    <ReferenceArea x1={50} x2={100} y1={50} y2={100} fill="#4D9D83" fillOpacity={0.025} />
                    <ReferenceArea x1={0} x2={50} y1={0} y2={50} fill="#C45C52" fillOpacity={0.02} />
                    <ReferenceArea x1={50} x2={100} y1={0} y2={50} fill="#C99B45" fillOpacity={0.025} />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tickFormatter={(value) => compactWanTick(paymentScale.fromPlot(Number(value)))}
                      tick={{ fontSize: 10, fill: '#81786B' }}
                      axisLine={false}
                      tickLine={false}
                      name="实际回款"
                      label={{ value: '实际回款（万元）', position: 'bottom', offset: 18, fontSize: 11, fill: '#81786B' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tickFormatter={(value) => compactWanTick(profitScale.fromPlot(Number(value)))}
                      tick={{ fontSize: 10, fill: '#81786B' }}
                      axisLine={false}
                      tickLine={false}
                      width={72}
                      name="实际利润"
                    />
                    <ZAxis type="number" dataKey="z" range={[140, 900]} />
                    <ReferenceLine x={50} stroke="#65AFC2" strokeWidth={1.8} />
                    <ReferenceLine y={50} stroke="#65AFC2" strokeWidth={1.8} />
                    <ReferenceDot
                      x={50}
                      y={50}
                      r={4}
                      fill="#65AFC2"
                      stroke="#FBF8F2"
                      strokeWidth={2}
                    />
                    <Tooltip content={<MatrixTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter
                      data={chartRows}
                      shape={<BubbleShape />}
                      onClick={(point) => {
                        const payload = (point as unknown as { payload?: BubblePoint }).payload;
                        if (payload) openCustomer(payload.customerId);
                      }}
                      className="cursor-pointer"
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">当前范围没有活跃客户数据</div>
            )}
          </div>
          <div className="mt-2 rounded-xl border border-border bg-surface-muted/55 px-3 py-2 text-[10px] leading-4 text-muted">
            为确保四个象限始终清晰，中位数固定在图表中心；中位数左右、上下分别按各自数值范围展开。气泡位置保持大小关系，准确金额请悬停查看。
          </div>
        </div>

        <aside className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl xl:h-full">
          <div className="border-b border-border px-5 py-4">
            <h3 className="font-semibold text-ink">客户价值排名</h3>
            <p className="mt-1 text-xs text-muted">回款 45% + 利润 45% + 活跃度 10%</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {result.rows.map((row, index) => {
              const meta = quadrantMeta[row.quadrant];
              const selected = selectedCustomerId === row.customerId;
              return (
                <button
                  key={row.customerId}
                  type="button"
                  onMouseEnter={() => setSelectedCustomerId(row.customerId)}
                  onFocus={() => setSelectedCustomerId(row.customerId)}
                  onClick={() => openCustomer(row.customerId)}
                  className={`group mb-1 w-full rounded-xl border px-3 py-3 text-left transition ${
                    selected ? 'border-brand-cyan/30 bg-brand-cyan/5' : 'border-transparent hover:border-border hover:bg-surface-muted'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-muted">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{row.customerName}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-subtle transition group-hover:translate-x-0.5" />
                      </span>
                      <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted">
                        <span>回款 <b className="text-ink">{moneyWan(row.paymentRmb)}</b></span>
                        <span>利润 <b className={row.profitRmb < 0 ? 'text-brand-rose' : 'text-ink'}>{moneyWan(row.profitRmb)}</b></span>
                        <span>毛利率 <b className="text-ink">{percent(row.grossMargin)}</b></span>
                        <span>活跃 <b className="text-ink">{row.activeMonths} 月</b></span>
                      </span>
                      <span className="mt-2 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${meta.bg} ${meta.tone}`}>{meta.label}</span>
                        <span className="text-xs font-bold text-brand-amber">{row.score.toFixed(1)} 分</span>
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </section>
    </div>
  );
};
