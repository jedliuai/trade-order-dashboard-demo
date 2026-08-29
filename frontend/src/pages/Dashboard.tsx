import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  ChevronRight,
  PackageCheck,
  Truck
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { FiscalProgressRing } from '../components/FiscalProgressRing';
import {
  calculateGrowthPercent,
  emptyDashboardPeriodMetrics,
  fetchDashboardPeriodMetrics,
  getDashboardMonthComparisonRanges,
  getFullMonthRange,
  type DashboardKpiMetric,
  type DashboardPeriodMetrics,
  type DashboardPeriodRange
} from '../services/dashboardOperatingMetrics';
import { db, type Alert, type ContactSheet, type Contract, type Shipment } from '../services/dataStore';
import { formatChinaDate } from '../services/dateUtils';
import { getFiscalYearRange, getPreviousFiscalYearRange, listMonthsInRange } from '../services/fiscalYear';
import { getPhysicalShipmentRows, resolvePhysicalShipmentInvoice } from '../services/shipmentInvoicing';

interface DashboardProps {
  onNavigate: (tab: string) => void;
  onRefreshTrigger: number;
}

type PriorityTone = 'rose' | 'amber' | 'blue' | 'green';

interface PriorityRecord {
  id: string;
  title: string;
  description: string;
  customer: string;
  contract: string;
  product: string;
  date: string;
  status: string;
  tab: string;
  sheetId?: string;
  tone: PriorityTone;
}

const PRIORITY_TONES: Record<PriorityTone, string> = {
  rose: 'border-[#e6b4aa] bg-[#fff3f0] text-[#a94f3d]',
  amber: 'border-[#e9d0a3] bg-[#fff8e8] text-[#9b6c1f]',
  blue: 'border-[#b8d2e4] bg-[#f0f7fb] text-[#3e708f]',
  green: 'border-[#b9d7c2] bg-[#eff8f1] text-[#467657]'
};

function formatWan(value: number) {
  return (Number(value || 0) / 10000).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatOriginalCurrencies(metric: DashboardKpiMetric) {
  const parts: string[] = [];
  if (metric.originalRmb > 0) {
    parts.push(`人民币 ￥${metric.originalRmb.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`);
  }
  if (metric.originalUsd > 0) {
    parts.push(`美元 $${metric.originalUsd.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`);
  }
  return parts.length ? parts.join(' · ') : '本期暂无原币金额';
}

function shortDate(value: string) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : value;
}

function rangeKey(range: DashboardPeriodRange) {
  return `${range.startDate}:${range.endDate}`;
}

function ComparisonBadge({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return <span className="rounded-full bg-[#f3efe9] px-2 py-1 text-[10px] text-[#897f73]">{label} 暂无基数</span>;
  }
  const positive = value > 0;
  const negative = value < 0;
  const tone = positive
    ? 'bg-[#edf7f0] text-[#427653]'
    : negative
      ? 'bg-[#fff0ed] text-[#b65342]'
      : 'bg-[#f3efe9] text-[#746c62]';
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[10px] font-semibold ${tone}`}>
      {positive && <ArrowUpRight className="h-3 w-3" />}
      {label} {positive ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

function alertContext(
  alert: Alert,
  contracts: Contract[],
  sheets: ContactSheet[],
  shipments: Shipment[]
) {
  if (alert.related_type === 'contact_sheet') {
    const sheet = sheets.find((row) => row.id === alert.related_id);
    return { contractId: sheet?.contract_id, sheet, shipment: undefined };
  }
  if (alert.related_type === 'contract') {
    return { contractId: alert.related_id, sheet: undefined, shipment: undefined };
  }
  if (alert.related_type === 'shipment') {
    const shipment = shipments.find((row) => row.id === alert.related_id);
    return { contractId: shipment?.contract_id, sheet: undefined, shipment };
  }
  const contract = contracts.find((row) => row.id === alert.related_id);
  return { contractId: contract?.id, sheet: undefined, shipment: undefined };
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate, onRefreshTrigger }) => {
  const data = useMemo(() => {
    void onRefreshTrigger;
    return {
      contracts: db.getContracts(),
      sheets: db.getContactSheets(),
      shipments: db.getShipments(),
      invoices: db.getInvoices(),
      alerts: db.getAlerts()
    };
  }, [onRefreshTrigger]);

  const asOfDate = formatChinaDate();
  const fiscalRange = useMemo(
    () => getFiscalYearRange(new Date(`${asOfDate}T12:00:00+08:00`)),
    [asOfDate]
  );
  const previousFiscalRange = useMemo(() => getPreviousFiscalYearRange(fiscalRange), [fiscalRange]);
  const monthRanges = useMemo(() => getDashboardMonthComparisonRanges(asOfDate), [asOfDate]);

  const trendRanges = useMemo(
    () => listMonthsInRange(fiscalRange.startMonth, fiscalRange.endMonth).map((month) => ({
      month,
      range: getFullMonthRange(month, month === asOfDate.slice(0, 7) ? asOfDate : undefined)
    })),
    [fiscalRange, asOfDate]
  );
  const [operatingMetrics, setOperatingMetrics] = useState<Record<string, DashboardPeriodMetrics>>({});
  const [operatingMetricsError, setOperatingMetricsError] = useState('');

  useEffect(() => {
    let active = true;
    const uniqueRanges = new Map<string, DashboardPeriodRange>();
    [monthRanges.current, monthRanges.previous, monthRanges.yearAgo, fiscalRange, previousFiscalRange]
      .forEach((range) => uniqueRanges.set(rangeKey(range), range));
    trendRanges.forEach(({ range }) => uniqueRanges.set(rangeKey(range), range));
    Promise.all([...uniqueRanges.entries()].map(async ([key, range]) => [
      key,
      await fetchDashboardPeriodMetrics(range)
    ] as const))
      .then((entries) => {
        if (!active) return;
        setOperatingMetrics(Object.fromEntries(entries));
        setOperatingMetricsError('');
      })
      .catch((error) => {
        if (!active) return;
        setOperatingMetricsError(error instanceof Error ? error.message : '经营指标读取失败。');
      });
    return () => { active = false; };
  }, [monthRanges, fiscalRange, previousFiscalRange, trendRanges, onRefreshTrigger]);

  const metricFor = (range: DashboardPeriodRange) => (
    operatingMetrics[rangeKey(range)] || emptyDashboardPeriodMetrics()
  );
  const currentMonth = metricFor(monthRanges.current);
  const previousMonth = metricFor(monthRanges.previous);
  const yearAgoMonth = metricFor(monthRanges.yearAgo);
  const currentFiscal = metricFor(fiscalRange);
  const previousFiscal = metricFor(previousFiscalRange);
  const customerBalanceSummary = currentMonth.customerBalance;

  const activeContractIds = useMemo(() => new Set(
    data.contracts.filter((contract) => !contract.archived && !contract.is_historical).map((contract) => contract.id)
  ), [data.contracts]);

  const readyToShipSheets = useMemo(() => data.sheets.filter((sheet) => (
    activeContractIds.has(sheet.contract_id)
    && !sheet.is_historical
    && Number(sheet.shipped_quantity || 0) < Number(sheet.quantity || 0)
    && (sheet.business_type === '原料药' || Boolean(sheet.actual_release_date))
  )), [data.sheets, activeContractIds]);

  const pendingInvoiceShipments = useMemo(() => {
    const seen = new Set<string>();
    return data.shipments.filter((shipment) => {
      const physicalId = shipment.shipment_group_id || shipment.id;
      if (seen.has(physicalId)) return false;
      seen.add(physicalId);
      const rows = getPhysicalShipmentRows(shipment, data.shipments);
      if (rows.some((row) => row.status !== '已发货')) return false;
      if (!rows.some((row) => activeContractIds.has(row.contract_id))) return false;
      return resolvePhysicalShipmentInvoice(rows, data.invoices).state !== 'invoiced';
    });
  }, [data.shipments, data.invoices, activeContractIds]);

  const priorityRecords = useMemo(() => {
    const records: PriorityRecord[] = [];
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const pendingAlerts = data.alerts
      .filter((alert) => alert.status === '未处理')
      .sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || right.created_at.localeCompare(left.created_at));

    pendingAlerts.slice(0, 2).forEach((alert) => {
      const context = alertContext(alert, data.contracts, data.sheets, data.shipments);
      const contract = data.contracts.find((row) => row.id === context.contractId);
      records.push({
        id: `alert:${alert.id}`,
        title: alert.alert_type,
        description: alert.message,
        customer: context.sheet?.customer_name || context.shipment?.customer_name || contract?.customer_name || '待核对',
        contract: context.sheet?.contract_no || context.shipment?.contract_no || contract?.contract_no || '—',
        product: context.sheet ? `${context.sheet.product_name} ${context.sheet.specification}`.trim() : '—',
        date: alert.created_at,
        status: alert.priority === 'high' ? '高优先级' : alert.priority === 'medium' ? '中优先级' : '一般',
        tab: 'alerts',
        sheetId: context.sheet?.id,
        tone: alert.priority === 'high' ? 'rose' : 'amber'
      });
    });

    readyToShipSheets.slice(0, 2).forEach((sheet) => {
      records.push({
        id: `shipping:${sheet.id}`,
        title: '安排产品发货',
        description: `尚有 ${(Number(sheet.quantity || 0) - Number(sheet.shipped_quantity || 0)).toLocaleString('zh-CN')} ${sheet.unit} 待安排发货`,
        customer: sheet.customer_name,
        contract: sheet.contract_no,
        product: `${sheet.product_name} ${sheet.specification}`.trim(),
        date: sheet.actual_release_date || sheet.estimated_release_date,
        status: '可发货',
        tab: 'shipments',
        sheetId: sheet.id,
        tone: 'green'
      });
    });

    pendingInvoiceShipments.slice(0, 2).forEach((shipment) => {
      records.push({
        id: `invoice:${shipment.id}`,
        title: '确认发货开票',
        description: `${shipment.shipment_no || '该次发货'} 已发货，尚未完成开票确认`,
        customer: shipment.customer_name,
        contract: shipment.contract_no,
        product: '—',
        date: shipment.shipment_date,
        status: '待开票',
        tab: 'shipments',
        tone: 'blue'
      });
    });

    return records.slice(0, 4);
  }, [data, readyToShipSheets, pendingInvoiceShipments]);

  const monthlyCards = [
    { key: 'orders' as const, title: '本月新增订单', icon: PackageCheck, color: '#ad8557', countUnit: '份合同' },
    { key: 'payments' as const, title: '本月到账回款', icon: Banknote, color: '#5d8768', countUnit: '笔收款' },
    { key: 'shipments' as const, title: '本月实际发货', icon: Truck, color: '#a8624d', countUnit: '次发货' }
  ];

  const fiscalCards = [
    { key: 'orders' as const, title: '新增订单', color: '#ad8557', current: currentFiscal.orders.amountRmb, previous: previousFiscal.orders.amountRmb },
    { key: 'payments' as const, title: '到账回款', color: '#5d8768', current: currentFiscal.payments.amountRmb, previous: previousFiscal.payments.amountRmb },
    { key: 'shipments' as const, title: '实际发货', color: '#a8624d', current: currentFiscal.shipments.amountRmb, previous: previousFiscal.shipments.amountRmb },
    { key: 'profit' as const, title: '已确认毛利', color: '#a17b30', current: currentFiscal.confirmedProfitRmb, previous: previousFiscal.confirmedProfitRmb }
  ];

  const trendData = useMemo(() => trendRanges.map(({ month, range }) => {
    const metrics = operatingMetrics[rangeKey(range)] || emptyDashboardPeriodMetrics();
    return {
      name: `${Number(month.slice(5))}月`,
      orders: Math.round(metrics.orders.amountRmb / 10000),
      payments: Math.round(metrics.payments.amountRmb / 10000),
      shipments: Math.round(metrics.shipments.amountRmb / 10000)
    };
  }), [trendRanges, operatingMetrics]);

  const missingRateMonths = useMemo(() => [...new Set([
    ...currentMonth.missingRateMonths,
    ...previousMonth.missingRateMonths,
    ...yearAgoMonth.missingRateMonths,
    ...currentFiscal.missingRateMonths,
    ...previousFiscal.missingRateMonths
  ])].sort(), [currentMonth, previousMonth, yearAgoMonth, currentFiscal, previousFiscal]);

  const openPriority = (record: PriorityRecord) => {
    if (record.tab === 'contact_sheets' && record.sheetId) {
      sessionStorage.setItem('highlight_contact_sheet_id', record.sheetId);
    }
    onNavigate(record.tab);
  };

  return (
    <div className="mx-auto max-w-[1124px] space-y-8 pb-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-[#a47b4e]">BUSINESS OVERVIEW</p>
          <h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-ink">经营驾驶舱</h1>
          <p className="mt-2 text-sm text-muted">用真实业务进展看清订单、回款、交付与当下要处理的事情。</p>
        </div>
        <div className="rounded-2xl border border-[#ded5c8] bg-white/85 px-5 py-3 text-right shadow-[0_10px_30px_rgba(69,54,37,0.05)]">
          <div className="text-[11px] text-muted">数据截止日期</div>
          <div className="mt-1 font-heading text-lg font-bold text-ink">{asOfDate.replaceAll('-', ' / ')}</div>
        </div>
      </header>

      {missingRateMonths.length > 0 && (
        <div role="alert" className="rounded-xl border border-[#e8cf9c] bg-[#fff8e8] px-4 py-3 text-xs text-[#8e651f]">
          缺少 {missingRateMonths.join('、')} 的 USD/CNY 汇率；相关美元金额暂不计入人民币汇总，请在系统设置中补充。
        </div>
      )}

      {operatingMetricsError && (
        <div role="alert" className="rounded-xl border border-[#e2b7ad] bg-[#fff3f0] px-4 py-3 text-xs text-[#a04e3e]">
          {operatingMetricsError}
        </div>
      )}

      <section className="space-y-4" aria-labelledby="operating-performance-heading">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="operating-performance-heading" className="font-heading text-xl font-bold text-ink">经营业绩</h2>
            <p className="mt-1 text-xs text-muted">本月对比均按同等已过天数 · 金额为折合人民币</p>
          </div>
          <span className="text-[11px] text-subtle">原币金额保留展示，汇率缺失时不进行猜测</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {monthlyCards.map((card) => {
            const metric = currentMonth[card.key];
            const Icon = card.icon;
            return (
              <article key={card.key} className="relative overflow-hidden rounded-2xl border border-[#ded6cb] bg-white p-5 shadow-[0_12px_35px_rgba(70,54,35,0.055)]">
                <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: card.color }} />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#645c53]">{card.title}</p>
                    <div className="mt-3 font-heading text-[28px] font-extrabold leading-none text-ink">￥{formatWan(metric.amountRmb)} 万</div>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: card.color, backgroundColor: `${card.color}14` }}>
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ComparisonBadge label="环比" value={calculateGrowthPercent(metric.amountRmb, previousMonth[card.key].amountRmb)} />
                  <ComparisonBadge label="同比" value={calculateGrowthPercent(metric.amountRmb, yearAgoMonth[card.key].amountRmb)} />
                </div>
                <div className="mt-4 border-t border-[#eee8e0] pt-3 text-[11px] leading-5 text-muted">
                  <span className="font-semibold text-[#595149]">{metric.count} {card.countUnit}</span>
                  <span className="mx-2 text-[#c5b9aa]">·</span>
                  {formatOriginalCurrencies(metric)}
                </div>
              </article>
            );
          })}
        </div>

        <div className="pt-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-ink">本财年进度</h3>
              <p className="mt-1 text-[11px] text-muted">{fiscalRange.label}，当前累计与上一完整财年合计对比</p>
            </div>
            <span className="text-[11px] text-subtle">每 100% 为一圈，进度沿同一条螺旋连续向外延伸</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {fiscalCards.map((card) => (
              <article key={card.key} className="flex min-h-40 items-center justify-between gap-3 rounded-2xl border border-[#ded6cb] bg-[#fffdf9] p-4">
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-muted">{card.title}</h4>
                  <div className="mt-2 font-heading text-xl font-extrabold" style={{ color: card.color }}>￥{formatWan(card.current)} 万</div>
                  <p className="mt-3 text-[10px] leading-4 text-subtle">上财年 ￥{formatWan(card.previous)} 万</p>
                </div>
                <FiscalProgressRing current={card.current} previous={card.previous} color={card.color} />
              </article>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-subtle">订单按签约日期、回款按到账日期、发货按实际发货日期；毛利仅累计已取得实际成本的数据，预估利润不进入“已确认毛利”。</p>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="exposure-heading">
        <div>
          <h2 id="exposure-heading" className="font-heading text-xl font-bold text-ink">当前经营敞口</h2>
          <p className="mt-1 text-xs text-muted">从全部历史发货和收款计算到今天，不受财年范围限制</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <button type="button" onClick={() => onNavigate('payments_balance')} className="group rounded-2xl border border-[#c9decf] bg-[#f3faf5] p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-bold text-[#416e51]">客户欠我方金额</div>
                <div className="mt-3 font-heading text-3xl font-extrabold text-[#335f42]">￥{formatWan(customerBalanceSummary.customerOwesRmb)} 万</div>
                <p className="mt-2 text-xs text-[#64806d]">{customerBalanceSummary.customerOwesCount} 位客户已完成发货，但累计收到的货款仍不足</p>
              </div>
              <ArrowRight className="mt-1 h-5 w-5 text-[#6d9379] transition-transform group-hover:translate-x-1" />
            </div>
          </button>
          <button type="button" onClick={() => onNavigate('payments_balance')} className="group rounded-2xl border border-[#ead0c7] bg-[#fff6f2] p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-bold text-[#9d5946]">我方欠客户金额</div>
                <div className="mt-3 font-heading text-3xl font-extrabold text-[#934d3b]">￥{formatWan(customerBalanceSummary.weOweCustomerRmb)} 万</div>
                <p className="mt-2 text-xs text-[#9a7065]">{customerBalanceSummary.weOweCustomerCount} 位客户已收到款项，但对应货物尚未完成交付</p>
              </div>
              <ArrowRight className="mt-1 h-5 w-5 text-[#b67766] transition-transform group-hover:translate-x-1" />
            </div>
          </button>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="priority-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="priority-heading" className="font-heading text-xl font-bold text-ink">今日优先事项</h2>
            <p className="mt-1 text-xs text-muted">直接展示需要处理的业务，不再只显示笼统分类数量</p>
          </div>
          <button type="button" onClick={() => onNavigate('alerts')} className="inline-flex items-center gap-1 text-xs font-semibold text-[#9d7549] hover:text-ink">
            查看全部提醒 <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#ded6cb] bg-white shadow-[0_12px_35px_rgba(70,54,35,0.045)]">
          {priorityRecords.length > 0 ? (
            <div className="divide-y divide-[#eee8e0]">
              {priorityRecords.map((record) => (
                <button key={record.id} type="button" onClick={() => openPriority(record)} className="group grid w-full gap-3 px-5 py-4 text-left transition hover:bg-[#fcfaf6] md:grid-cols-[1.25fr_1fr_0.9fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_TONES[record.tone]}`}>{record.status}</span>
                      <span className="truncate text-sm font-bold text-ink">{record.title}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{record.description}</p>
                  </div>
                  <div className="min-w-0 text-xs">
                    <div className="truncate font-semibold text-[#574f47]">{record.customer}</div>
                    <div className="mt-1 truncate text-subtle">合同 {record.contract}</div>
                  </div>
                  <div className="min-w-0 text-xs">
                    <div className="truncate text-[#574f47]">{record.product}</div>
                    <div className="mt-1 text-subtle">{shortDate(record.date)}</div>
                  </div>
                  <ChevronRight className="hidden h-4 w-4 text-[#a59787] transition-transform group-hover:translate-x-1 md:block" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-7 text-[#487256]">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#edf7f0]"><CheckCircle2 className="h-5 w-5" /></span>
              <div>
                <div className="text-sm font-bold">当前没有明确的优先待办</div>
                <div className="mt-1 text-xs text-muted">业务链路状态正常，可以继续关注新订单和客户跟进。</div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="trend-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="trend-heading" className="font-heading text-xl font-bold text-ink">经营节奏趋势</h2>
            <p className="mt-1 text-xs text-muted">本财年每月订单、回款与发货，单位：人民币万元</p>
          </div>
          <button type="button" onClick={() => onNavigate('analytics')} className="inline-flex items-center gap-1 rounded-lg border border-[#d8c8b5] bg-[#fffaf2] px-3 py-2 text-xs font-semibold text-[#8c6740] transition hover:bg-[#f7eddf]">
            进入数据分析 <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="rounded-2xl border border-[#ded6cb] bg-white p-5 shadow-[0_12px_35px_rgba(70,54,35,0.045)]">
          <div className="h-80 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#eee8e0" strokeDasharray="3 3" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#81776c', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#81776c', fontSize: 10 }} />
                <Tooltip
                  cursor={{ fill: '#f7f2eb' }}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #ded6cb', borderRadius: 12, boxShadow: '0 12px 30px rgba(70,54,35,.08)' }}
                  labelStyle={{ color: '#332e28', fontWeight: 700 }}
                  formatter={(value, name) => [`${Number(value).toLocaleString('zh-CN')} 万元`, String(name)]}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: 16, fontSize: 11 }} />
                <Bar dataKey="orders" name="新增订单" fill="#ad8557" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="payments" name="到账回款" fill="#5d8768" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="shipments" name="实际发货" fill="#a8624d" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
};
