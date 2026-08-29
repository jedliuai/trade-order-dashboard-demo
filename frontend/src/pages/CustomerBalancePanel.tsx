import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  Download,
  Filter,
  PackageCheck,
  Scale,
  Search,
  Users,
  WalletCards,
  X
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { db } from '../services/dataStore';
import type { ShipmentItem } from '../services/dataStore';
import { formatLocalDate } from '../services/dateUtils';
import {
  balanceStatusLabel,
  calculateCustomerBalances,
  formatBalanceAmount,
  type CustomerBalanceRow,
  type CustomerBalanceStatus
} from '../services/customerBalance';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { IconButton } from '../components/IconButton';
import { ColorIconBadge } from '../components/ColorIconBadge';

interface CustomerBalancePanelProps {
  onRefreshTrigger: number;
}

type DisplayMode = 'rmb' | 'native';
type StatusFilter = 'all' | CustomerBalanceStatus;

function formatRmb(value: number, maximumFractionDigits = 2) {
  return `￥${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits
  })}`;
}

function formatWan(value: number) {
  return `${(Math.abs(value) / 10000).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} 万元`;
}

function balanceTone(status: CustomerBalanceStatus) {
  if (status === 'customer_owes') return 'border-brand-emerald/25 bg-brand-emerald/10 text-brand-emerald';
  if (status === 'we_owe_goods') return 'border-[#ef8b54]/30 bg-[#ef8b54]/10 text-[#d86d36]';
  return 'border-border bg-surface-muted text-muted';
}

function csvCell(value: string | number) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function formatUsdWan(value: number) {
  return `${(value / 10000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 万美元`;
}

function CustomerBalanceTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload?: { customerName?: string; balanceRmb?: number; balance?: number; currency?: 'USD' | 'RMB'; status?: CustomerBalanceStatus } }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload.find((entry) => entry.payload?.customerName)?.payload;
  if (!row?.customerName || row.balanceRmb === undefined || !row.status) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3.5 py-3 text-xs shadow-lg">
      <div className="font-semibold text-ink">{row.customerName}</div>
      <div className={`mt-1.5 font-semibold ${row.status === 'we_owe_goods' ? 'text-[#d86d36]' : 'text-brand-emerald'}`}>
        {balanceStatusLabel(row.status)}：{formatWan(row.balanceRmb)}
      </div>
      {row.balance !== undefined && row.currency === 'USD' && (
        <div className="mt-1 text-[11px] text-muted">原币：{formatUsdWan(row.balance)}</div>
      )}
    </div>
  );
}

export const CustomerBalancePanel: React.FC<CustomerBalancePanelProps> = ({ onRefreshTrigger }) => {
  const [asOfDate, setAsOfDate] = useState(formatLocalDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('rmb');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [onlyUnbalanced, setOnlyUnbalanced] = useState(true);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [currencyFilter, setCurrencyFilter] = useState<'all' | 'USD' | 'RMB'>('all');
  const [selectedRow, setSelectedRow] = useState<CustomerBalanceRow | null>(null);

  const data = useMemo(() => {
    void onRefreshTrigger;
    return {
      customers: db.getCustomers(),
      contracts: db.getContracts(),
      shipments: db.getShipments(),
      shipmentItems: db.getTable<ShipmentItem>('trade_shipment_items'),
      payments: db.getPayments(),
      paymentReceipts: db.getPaymentReceipts(),
      exchangeRates: db.getExchangeRates()
    };
  }, [onRefreshTrigger]);

  const summary = useMemo(() => calculateCustomerBalances({
    ...data,
    asOfDate
  }), [data, asOfDate]);

  const filteredRows = useMemo(() => {
    const keyword = searchQuery.trim().toLocaleLowerCase();
    return summary.rows.filter((row) => {
      if (onlyUnbalanced && row.status === 'balanced') return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (currencyFilter !== 'all' && row.currency !== currencyFilter) return false;
      if (keyword && !row.customerName.toLocaleLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [summary.rows, searchQuery, onlyUnbalanced, statusFilter, currencyFilter]);

  const chartRows = useMemo(() => filteredRows
    .filter((row) => !row.currencyConflict && row.status !== 'balanced' && row.balanceRmb !== null)
    .sort((left, right) => Math.abs(right.balanceRmb || 0) - Math.abs(left.balanceRmb || 0))
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      customerName: row.customerName,
      customerLabel: row.currency === 'USD' ? `${row.customerName} · ${formatUsdWan(row.balance)}` : row.customerName,
      customerOwes: row.status === 'customer_owes' ? row.balanceRmb || 0 : 0,
      weOweGoods: row.status === 'we_owe_goods' ? row.balanceRmb || 0 : 0,
      balanceRmb: row.balanceRmb || 0,
      balance: row.balance,
      currency: row.currency,
      status: row.status
    })), [filteredRows]);

  const topRows = useMemo(() => summary.rows
    .filter((row) => !row.currencyConflict && row.status !== 'balanced' && row.balanceRmb !== null)
    .sort((left, right) => Math.abs(right.balanceRmb || 0) - Math.abs(left.balanceRmb || 0))
    .slice(0, 3), [summary.rows]);

  const handleExport = () => {
    const header = ['截止日期', '客户', '原币', '累计收款', '累计发货', '原币差额', '折合人民币差额', '状态', '最近业务日期'];
    const rows = filteredRows.map((row) => [
      asOfDate,
      row.customerName,
      row.currency,
      row.totalPayment,
      row.totalShipment,
      row.balance,
      row.balanceRmb ?? '缺参考汇率',
      balanceStatusLabel(row.status),
      row.recentBusinessDate
    ]);
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `客户货款平衡-${asOfDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const visibleCustomerCount = new Set(filteredRows.map((row) => row.customerId)).size;

  return (
    <div className="space-y-5">
      {(summary.missingRateCount > 0 || summary.currencyConflictCount > 0) && (
        <div role="alert" className="rounded-xl border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
          {summary.missingRateCount > 0 && `有 ${summary.missingRateCount} 位美元客户缺少当前参考汇率，保留原币余额但暂不计入人民币总览。`}
          {summary.missingRateCount > 0 && summary.currencyConflictCount > 0 && ' '}
          {summary.currencyConflictCount > 0 && `有 ${summary.currencyConflictCount} 位客户存在多币种历史记录，明细继续展示，但在核对客户归属前不计入人民币汇总与图表。`}
        </div>
      )}

      <section className="glass-panel p-4" aria-label="客户货款平衡筛选">
        <div className="grid gap-3 xl:grid-cols-[180px_minmax(220px,1fr)_auto_auto_auto] xl:items-end">
          <label className="space-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5 font-medium"><CalendarDays className="h-3.5 w-3.5" />截止日期</span>
            <input
              type="date"
              value={asOfDate}
              max={formatLocalDate()}
              onChange={(event) => setAsOfDate(event.target.value || formatLocalDate())}
              className="w-full px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-xs text-muted">
            <span className="font-medium">客户搜索</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索客户名称"
                className="w-full py-2 pl-9 pr-3"
              />
            </span>
          </label>

          <div className="space-y-1 text-xs text-muted">
            <span className="font-medium">金额显示</span>
            <div className="flex rounded-[10px] border border-border bg-surface-muted p-1">
              <button type="button" onClick={() => setDisplayMode('rmb')} className={`rounded-lg px-3 py-1.5 font-semibold ${displayMode === 'rmb' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted'}`}>统一折人民币</button>
              <button type="button" onClick={() => setDisplayMode('native')} className={`rounded-lg px-3 py-1.5 font-semibold ${displayMode === 'native' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted'}`}>原币</button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOnlyUnbalanced((value) => !value)}
            aria-pressed={onlyUnbalanced}
            className={`h-10 rounded-[10px] border px-3 text-xs font-semibold transition-colors ${onlyUnbalanced ? 'border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan' : 'border-border bg-surface text-muted'}`}
          >
            {onlyUnbalanced ? '仅显示未平衡' : '显示全部客户'}
          </button>

          <div className="flex items-center gap-2">
            <Button
              tone="secondary"
              onClick={() => setShowMoreFilters((value) => !value)}
              icon={<Filter className="h-3.5 w-3.5" />}
            >
              更多筛选
            </Button>
            <Button tone="secondary" onClick={handleExport} icon={<Download className="h-3.5 w-3.5" />}>
              导出
            </Button>
          </div>
        </div>

        {showMoreFilters && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted">
              <span className="font-medium">状态</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="w-full px-3 py-2">
                <option value="all">全部状态</option>
                <option value="customer_owes">客户待付款</option>
                <option value="we_owe_goods">我方待交货</option>
                <option value="balanced">基本平衡</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted">
              <span className="font-medium">原币</span>
              <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value as typeof currencyFilter)} className="w-full px-3 py-2">
                <option value="all">全部币种</option>
                <option value="USD">USD 美元</option>
                <option value="RMB">RMB 人民币</option>
              </select>
            </label>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="客户货款平衡汇总">
        <div className="glass-panel flex items-center gap-4 p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-emerald/12 text-brand-emerald"><WalletCards className="h-6 w-6" /></span>
          <div className="min-w-0"><div className="text-xs text-muted">客户欠款总额</div><div className="mt-1 whitespace-nowrap font-heading text-xl font-bold text-brand-emerald 2xl:text-2xl">{formatRmb(summary.customerOwesRmb)}</div><div className="mt-1 text-[10px] text-subtle">{summary.customerOwesCount} 位客户已发货尚未收款</div></div>
        </div>
        <div className="glass-panel flex items-center gap-4 p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ef8b54]/12 text-[#d86d36]"><PackageCheck className="h-6 w-6" /></span>
          <div className="min-w-0"><div className="text-xs text-muted">我方待交货总额</div><div className="mt-1 whitespace-nowrap font-heading text-xl font-bold text-[#d86d36] 2xl:text-2xl">{formatRmb(summary.weOweGoodsRmb)}</div><div className="mt-1 text-[10px] text-subtle">{summary.weOweGoodsCount} 位客户已收款尚未发货</div></div>
        </div>
        <div className="glass-panel flex items-center gap-4 p-5">
          <ColorIconBadge tone="teal" size="lg" shape="circle"><Scale className="h-6 w-6" /></ColorIconBadge>
          <div className="min-w-0"><div className="text-xs text-muted">净敞口（参考）</div><div className={`mt-1 whitespace-nowrap font-heading text-lg font-bold 2xl:text-xl ${summary.netExposureRmb >= 0 ? 'text-brand-emerald' : 'text-[#d86d36]'}`}>{summary.netExposureRmb < 0 ? '-' : ''}{formatRmb(summary.netExposureRmb)}</div><div className="mt-1 text-[10px] text-subtle">客户欠款－我方待交货，不替代两侧总额</div></div>
        </div>
        <div className="glass-panel flex items-center gap-4 p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-amber/12 text-brand-amber"><Users className="h-6 w-6" /></span>
          <div><div className="text-xs text-muted">未平衡客户</div><div className="mt-1 font-heading text-2xl font-bold text-brand-amber">{summary.customerOwesCount + summary.weOweGoodsCount}</div><div className="mt-1 text-[10px] text-subtle">另有 {summary.balancedCount} 位客户基本平衡</div></div>
        </div>
      </section>

      <section className="glass-panel overflow-hidden" aria-label="平衡差额计算说明">
        <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1fr_0.8fr_1fr] lg:items-center">
          <div>
            <div className="font-semibold text-ink">平衡差额 = 累计发货金额 − 累计收款金额</div>
            <div className="mt-1 text-[10px] text-subtle">总览统一折人民币；客户是否平衡始终以原币差额为准</div>
          </div>
          <div className="border-l border-border pl-5 text-[#d86d36]"><strong className="text-xl">&lt; 0</strong><span className="ml-3 text-xs font-semibold">我方待交货</span></div>
          <div className="border-l border-border pl-5 text-muted"><strong className="text-xl">0</strong><span className="ml-3 text-xs font-semibold">基本平衡</span></div>
          <div className="border-l border-border pl-5 text-brand-emerald"><strong className="text-xl">&gt; 0</strong><span className="ml-3 text-xs font-semibold">客户待付款</span></div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)]">
        <div className="glass-panel p-5">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-heading text-base font-semibold text-ink">客户平衡分布（统一折人民币）</h3>
              <p className="mt-1 text-[11px] text-muted">按人民币差额绝对值从大到小排列；客户名称旁同时显示原币差额，左侧为我方待交货，右侧为客户待付款。</p>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-muted">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#ef8b54]" />我方待交货</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-brand-emerald" />客户待付款</span>
            </div>
          </div>
          {chartRows.length > 0 ? (
            <div style={{ height: Math.max(320, chartRows.length * 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ top: 6, right: 24, bottom: 8, left: 24 }} barCategoryGap="28%">
                  <CartesianGrid horizontal={false} stroke="#eee7dc" />
                  <XAxis type="number" tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万`} tick={{ fill: '#8c8270', fontSize: 10 }} axisLine={{ stroke: '#e2dac9' }} />
                  <YAxis
                    type="category"
                    dataKey="customerLabel"
                    width={190}
                    tickFormatter={(value) => String(value).length > 28 ? `${String(value).slice(0, 27)}…` : String(value)}
                    tick={{ fill: '#4a4238', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomerBalanceTooltip />} cursor={{ fill: 'rgba(176,137,86,0.04)' }} />
                  <ReferenceLine x={0} stroke="#8c8270" strokeWidth={1.3} />
                  <Bar dataKey="weOweGoods" fill="#ef8b54" radius={[5, 0, 0, 5]} />
                  <Bar dataKey="customerOwes" fill="#5c8567" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-80 items-center justify-center text-sm text-muted">当前筛选范围内没有可绘制的未平衡客户</div>
          )}
        </div>

        <div className="glass-panel p-5">
          <h3 className="font-heading text-base font-semibold text-ink">未平衡客户概览</h3>
          <div className="mt-4 space-y-3 border-b border-border pb-4 text-sm">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted"><i className="h-2.5 w-2.5 rounded-full bg-brand-emerald" />客户待付款</span><strong className="text-ink">{summary.customerOwesCount}</strong></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted"><i className="h-2.5 w-2.5 rounded-full bg-[#ef8b54]" />我方待交货</span><strong className="text-ink">{summary.weOweGoodsCount}</strong></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted"><i className="h-2.5 w-2.5 rounded-full bg-border-strong" />基本平衡</span><strong className="text-ink">{summary.balancedCount}</strong></div>
          </div>
          <div className="mt-4">
            <div className="text-[11px] font-semibold text-muted">差额最大的 3 位客户</div>
            <div className="mt-2 divide-y divide-border">
              {topRows.map((row, index) => (
                <button key={row.id} type="button" onClick={() => setSelectedRow(row)} className="flex w-full items-center gap-3 py-3 text-left">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[10px] font-semibold text-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">{row.customerName}</span>
                    {row.currency === 'USD' && <span className="mt-0.5 block text-[10px] text-muted">原币 {formatUsdWan(row.balance)}</span>}
                  </span>
                  <span className={`text-right text-[11px] font-semibold ${row.status === 'we_owe_goods' ? 'text-[#d86d36]' : 'text-brand-emerald'}`}>{formatRmb(row.balanceRmb || 0)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel overflow-hidden" aria-labelledby="customer-balance-table-title">
        <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="customer-balance-table-title" className="font-heading text-base font-semibold text-ink">客户余额明细</h3>
            <p className="mt-1 text-[11px] text-muted">当前显示 {visibleCustomerCount} 位客户；点击“查看明细”可核对每笔收款和发货如何形成余额。</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-emerald"><Check className="h-3.5 w-3.5" />首页摘要已启用</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-surface-muted/60 text-muted">
              <tr>
                <th className="px-5 py-3 font-semibold">客户</th>
                <th className="px-4 py-3 font-semibold">原币</th>
                <th className="px-4 py-3 text-right font-semibold">累计收款</th>
                <th className="px-4 py-3 text-right font-semibold">累计发货</th>
                <th className="px-4 py-3 text-right font-semibold">当前差额</th>
                <th className="px-4 py-3 font-semibold">状态</th>
                <th className="px-4 py-3 font-semibold">最近业务日期</th>
                <th className="px-5 py-3 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-3.5 font-semibold text-ink">{row.customerName}{row.currencyConflict && <span className="ml-2 text-[10px] text-brand-amber">币种待核对</span>}</td>
                  <td className="px-4 py-3.5 text-muted">{row.currency}</td>
                  <td className="px-4 py-3.5 text-right font-medium text-body">
                    {displayMode === 'native' || row.currency === 'RMB'
                      ? formatBalanceAmount(row.totalPayment, row.currency)
                      : row.referenceRate === null ? '缺参考汇率' : formatRmb(row.totalPayment * row.referenceRate)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-medium text-body">
                    {displayMode === 'native' || row.currency === 'RMB'
                      ? formatBalanceAmount(row.totalShipment, row.currency)
                      : row.referenceRate === null ? '缺参考汇率' : formatRmb(row.totalShipment * row.referenceRate)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className={`font-semibold ${row.status === 'we_owe_goods' ? 'text-[#d86d36]' : row.status === 'customer_owes' ? 'text-brand-emerald' : 'text-muted'}`}>
                      {displayMode === 'native' || row.currency === 'RMB'
                        ? formatBalanceAmount(row.balance, row.currency)
                        : row.balanceRmb === null ? '缺参考汇率' : formatRmb(row.balanceRmb)}
                    </div>
                    {row.currency === 'USD' && (
                      <div className="mt-0.5 text-[10px] text-subtle">
                        {displayMode === 'native'
                          ? row.balanceRmb === null ? '缺参考汇率' : `参考 ${formatRmb(row.balanceRmb)}`
                          : `原币 ${formatBalanceAmount(row.balance, 'USD')}`}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${balanceTone(row.status)}`}>{balanceStatusLabel(row.status)}</span></td>
                  <td className="px-4 py-3.5 text-muted">{row.recentBusinessDate || '-'}</td>
                  <td className="px-5 py-3.5 text-right"><button type="button" onClick={() => setSelectedRow(row)} className="inline-flex items-center gap-1 font-semibold text-brand-cyan hover:underline">查看明细<ArrowRight className="h-3 w-3" /></button></td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-muted">当前筛选条件下没有客户余额记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedRow && (
        <Dialog onClose={() => setSelectedRow(null)} ariaLabel={`${selectedRow.customerName} 余额形成明细`} className="justify-end p-0">
          <div className="h-screen w-full max-w-lg overflow-y-auto border-l border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
              <div>
                <div className="text-[11px] font-semibold text-brand-cyan">客户余额形成明细</div>
                <h3 className="mt-1 font-heading text-xl font-bold text-ink">{selectedRow.customerName}</h3>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${balanceTone(selectedRow.status)}`}>{balanceStatusLabel(selectedRow.status)}</span>
                  <span className="text-xs text-muted">{selectedRow.currency}</span>
                </div>
              </div>
              <IconButton onClick={() => setSelectedRow(null)} label="关闭客户余额明细" icon={<X className="h-5 w-5" />} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-muted p-4"><div className="text-[10px] text-muted">累计收款</div><div className="mt-1 font-semibold text-ink">{formatBalanceAmount(selectedRow.totalPayment, selectedRow.currency)}</div></div>
              <div className="rounded-xl bg-surface-muted p-4"><div className="text-[10px] text-muted">累计发货</div><div className="mt-1 font-semibold text-ink">{formatBalanceAmount(selectedRow.totalShipment, selectedRow.currency)}</div></div>
            </div>
            <div className={`mt-3 rounded-xl border p-4 ${balanceTone(selectedRow.status)}`}>
              <div className="text-[10px]">截至 {asOfDate} 的当前差额</div>
              <div className="mt-1 font-heading text-2xl font-bold">{formatBalanceAmount(selectedRow.balance, selectedRow.currency)}</div>
              {selectedRow.currency === 'USD' && selectedRow.balanceRmb !== null && <div className="mt-1 text-[11px]">按参考汇率 {selectedRow.referenceRate?.toFixed(4)}，约 {formatRmb(selectedRow.balanceRmb)}</div>}
            </div>

            <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-ink"><CircleDollarSign className="h-4 w-4 text-brand-cyan" />收款与发货时间线</div>
            <div className="mt-3 space-y-0">
              {selectedRow.events.slice().reverse().map((event, index) => {
                const status = event.runningBalance > 0.01 ? 'customer_owes' : event.runningBalance < -0.01 ? 'we_owe_goods' : 'balanced';
                return (
                  <div key={event.id} className="relative flex gap-3 pb-5">
                    {index < selectedRow.events.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-border" />}
                    <span className={`relative z-10 mt-1 h-5 w-5 shrink-0 rounded-full border-4 border-surface ${event.kind === 'shipment' ? 'bg-brand-emerald' : 'bg-brand-cyan'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div><span className="font-semibold text-ink">{event.kind === 'shipment' ? '发货' : '收款'}</span><span className="ml-2 text-[10px] text-subtle">{event.date}</span></div>
                        <strong className={event.kind === 'shipment' ? 'text-brand-emerald' : 'text-brand-cyan'}>{event.kind === 'shipment' ? '+' : '-'}{formatBalanceAmount(event.amount, event.currency)}</strong>
                      </div>
                      <div className="mt-1 truncate text-[10px] text-muted" title={event.reference}>{event.reference}</div>
                      <div className="mt-1 text-[10px] text-subtle">事件后：<span className="font-semibold">{balanceStatusLabel(status)} {formatBalanceAmount(event.runningBalance, event.currency)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
