import React, { useMemo, useState } from 'react';
import { Calculator, CheckCircle2, CircleAlert, ReceiptText, RotateCcw, Search, TrendingUp, Users } from 'lucide-react';
import { db } from '../services/dataStore';
import type { ShipmentProfit } from '../services/dataStore';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { FilterPanel, PageHeader } from '../components/PageHeader';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { CustomerSelect } from '../components/CustomerSelect';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable } from '../components/DataTable';
import { PaginationControls } from '../components/PaginationControls';
import { usePagedRows } from '../hooks/usePagedRows';
import { getBusinessStatusTone } from '../services/statusPresentation';
import { getFiscalYearRange } from '../services/fiscalYear';
import {
  filterProfitWorkspace,
  listProfitFilterOptions,
  resolveProfitStatus,
  summarizeProfitByContactSheet,
  summarizeProfitByCustomer,
  summarizeShipmentProfitByCustomer,
  summarizeProfitWorkspace,
  type ProfitStatusFilter
} from '../services/profitWorkspace';

interface ProfitProps {
  onRefreshTrigger: number;
}

const formatMonth = (month: string) => month ? `${month.slice(0, 4)}年${month.slice(5, 7)}月` : '未确定';

export const Profit: React.FC<ProfitProps> = ({ onRefreshTrigger }) => {
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState(fiscalRange.startMonth);
  const [dateTo, setDateTo] = useState(fiscalRange.endMonth);
  const [customerFilter, setCustomerFilter] = useState('all');
  const [contractFilter, setContractFilter] = useState('all');
  const [contactSheetFilter, setContactSheetFilter] = useState('all');
  const [exportFilter, setExportFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<ProfitStatusFilter>('all');
  const [groupByCustomer, setGroupByCustomer] = useState(false);

  const profitRows = useMemo(() => {
    void onRefreshTrigger;
    return db.getShipmentProfits();
  }, [onRefreshTrigger]);

  const profitList = useMemo(() => profitRows.map((row: ShipmentProfit) => ({
    id: `${row.shipment_id}-${row.contact_sheet_no}-${row.batch_no || row.material_no}`,
    shipment_no: row.shipment_no,
    shipment_date: row.shipment_date,
    invoice_month: row.invoice_month,
    contract_no: row.contract_no,
    contact_sheet_no: row.contact_sheet_no,
    export_type: row.export_type,
    currency: row.currency,
    customer_name: row.customer_name,
    product_name: row.product_name,
    material_no: row.material_no,
    quantity: row.shipped_quantity,
    unit: row.unit,
    price: row.unit_price,
    costNoTax: row.unit_cost,
    exchangeRate: row.exchange_rate,
    salesRmb: row.sales_amount_rmb,
    profitBasisRmb: row.profit_basis_amount_rmb,
    profit: row.profit,
    margin: row.gross_margin === null ? null : row.gross_margin * 100,
    isEstimate: row.is_estimated_profit,
    costTotalRmb: row.product_cost_total_rmb,
    incoterm: row.incoterm,
    freightInsuranceAmount: row.freight_insurance_amount
  })), [profitRows]);

  const filterOptions = useMemo(() => listProfitFilterOptions(profitList), [profitList]);
  const filteredProfits = useMemo(() => filterProfitWorkspace(profitList, {
    query: searchQuery,
    month: 'all',
    dateFrom,
    dateTo,
    customer: customerFilter,
    contract: contractFilter,
    contactSheet: contactSheetFilter,
    exportType: exportFilter,
    status: statusFilter
  }), [profitList, searchQuery, dateFrom, dateTo, customerFilter, contractFilter, contactSheetFilter, exportFilter, statusFilter]);
  const contactSheetSummaries = useMemo(() => summarizeProfitByContactSheet(filteredProfits), [filteredProfits]);
  const customerProfitSummaries = useMemo(() => summarizeProfitByCustomer(contactSheetSummaries), [contactSheetSummaries]);
  const customerShipmentProfitSummaries = useMemo(() => summarizeShipmentProfitByCustomer(filteredProfits), [filteredProfits]);
  const resetKey = `${searchQuery}|${dateFrom}|${dateTo}|${customerFilter}|${contractFilter}|${contactSheetFilter}|${exportFilter}|${statusFilter}`;
  const summaryPage = usePagedRows(contactSheetSummaries, `summary|${resetKey}`);
  const profitPage = usePagedRows(filteredProfits, `detail|${resetKey}`);
  const customerGroupPage = usePagedRows(customerProfitSummaries, `customer|${resetKey}`);
  const shipmentCustomerGroupPage = usePagedRows(customerShipmentProfitSummaries, `shipment-customer|${resetKey}`);
  const customers = useMemo(() => {
    void onRefreshTrigger;
    return db.getCustomers();
  }, [onRefreshTrigger]);
  const summaryStats = useMemo(() => summarizeProfitWorkspace(filteredProfits), [filteredProfits]);
  const confirmedMargin = Number(summaryStats.confirmedProfitBasisRmb || 0) > 0
    ? summaryStats.confirmedProfitRmb / Number(summaryStats.confirmedProfitBasisRmb) * 100
    : null;
  const hasFilters = Boolean(searchQuery || dateFrom !== fiscalRange.startMonth || dateTo !== fiscalRange.endMonth || customerFilter !== 'all' || contractFilter !== 'all' || contactSheetFilter !== 'all' || exportFilter !== 'all' || statusFilter !== 'all');

  const clearFilters = () => {
    setSearchQuery('');
    setDateFrom(fiscalRange.startMonth);
    setDateTo(fiscalRange.endMonth);
    setCustomerFilter('all');
    setContractFilter('all');
    setContactSheetFilter('all');
    setExportFilter('all');
    setStatusFilter('all');
  };

  const renderShipmentProfitRow = (row: (typeof profitList)[number]) => {
    const profitStatus = resolveProfitStatus(row);
    const missingRate = row.currency === 'USD' && row.exchangeRate === null;
    const pendingReason = [
      row.incoterm === 'CIF' && row.freightInsuranceAmount === null ? '缺运保费' : '',
      row.isEstimate && row.costNoTax !== null ? '成本仍为预估' : '',
      row.costNoTax === null ? '缺成本' : '',
      missingRate ? '缺汇率' : ''
    ].filter(Boolean).join('、') || '待计算';
    return (
      <tr key={row.id} className="transition-colors hover:bg-surface-muted/35">
        <td className="p-4">
          <span className="block font-heading font-semibold text-ink">{row.shipment_no}</span>
          <span className="text-[10px] text-subtle">{formatMonth(row.invoice_month)}</span>
        </td>
        <td className="p-4">
          <span className="block font-semibold text-body">{row.contract_no}</span>
          <span className="mt-0.5 block max-w-[190px] truncate text-[10px] text-muted" title={row.customer_name}>{row.customer_name}</span>
        </td>
        <td className="p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-brand-cyan/15 bg-brand-cyan/5 px-1.5 py-0.5 text-[10px] font-semibold text-brand-cyan">{row.material_no}</span>
            <span className="max-w-[180px] truncate text-body" title={row.product_name}>{row.product_name}</span>
          </div>
          <span className="mt-1 block text-[10px] font-semibold text-muted">联系单 {row.contact_sheet_no || '未填写'}</span>
        </td>
        <td className="p-4 font-medium text-body">{row.quantity.toLocaleString()} {row.unit}</td>
        <td className="p-4">
          <span className="block font-semibold text-ink">{row.currency === 'USD' ? '$' : '￥'}{(row.price * row.quantity).toLocaleString()}</span>
          <span className="text-[9px] text-subtle">单价 {row.currency === 'USD' ? '$' : '￥'}{row.price}</span>
        </td>
        <td className="p-4 text-body">
          {row.costNoTax === null
            ? '尚未匹配'
            : <>
                <span className="block">￥{row.costNoTax.toFixed(2)} / {row.unit}</span>
                <span className="mt-0.5 block text-[9px] text-subtle">成本合计 ￥{Number(row.costTotalRmb || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </>}
        </td>
        <td className="p-4">
          <div className="flex items-center gap-2">
            <StatusBadge tone={getBusinessStatusTone(profitStatus === 'confirmed' ? '已确认' : '待计算')}>
              {profitStatus === 'confirmed' ? '已确认' : '待计算'}
            </StatusBadge>
            <span className={`font-bold ${profitStatus === 'pending' || (row.profit !== null && row.profit < 0) ? 'text-brand-rose' : 'text-brand-emerald'}`}>
              {profitStatus === 'pending' ? pendingReason : `￥${Math.round(row.profit || 0).toLocaleString()}`}
            </span>
          </div>
        </td>
        <td className={`p-4 text-right font-bold ${profitStatus === 'confirmed' && row.margin !== null && row.margin < 0 ? 'text-brand-rose' : 'text-ink'}`}>{profitStatus === 'pending' || row.margin === null ? '—' : `${row.margin.toFixed(1)}%`}</td>
      </tr>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="销售利润分析"
        description={`默认统计${fiscalRange.label}；利润以开票为确认时点，与客户是否回款无关，成本按开票月份匹配`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">筛选范围销售额</span>
            <ReceiptText className="h-4 w-4 text-brand-cyan" />
          </div>
          <div className="mt-3 text-2xl font-extrabold text-ink">￥{(summaryStats.totalSalesRmb / 10000).toFixed(2)} 万</div>
          <p className="mt-1 text-[10px] text-subtle">仅统计已有人民币折算结果的开票明细</p>
        </div>

        <div className={`glass-panel rounded-2xl p-5 ${summaryStats.confirmedProfitRmb < 0 ? 'border-brand-rose/30' : 'border-brand-emerald/20'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">已确认毛利</span>
            <CheckCircle2 className={`h-4 w-4 ${summaryStats.confirmedProfitRmb < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`} />
          </div>
          <div className={`mt-3 text-2xl font-extrabold ${summaryStats.confirmedProfitRmb < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>￥{(summaryStats.confirmedProfitRmb / 10000).toFixed(2)} 万</div>
          <p className="mt-1 text-[10px] text-subtle">{summaryStats.confirmedCount} 条明细{confirmedMargin === null ? '，暂无可计算毛利率' : `，确认毛利率 ${confirmedMargin.toFixed(1)}%`}</p>
        </div>

        <div className="glass-panel rounded-2xl border-brand-amber/20 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">已确认毛利率</span>
            <TrendingUp className="h-4 w-4 text-brand-amber" />
          </div>
          <div className={`mt-3 text-2xl font-extrabold ${confirmedMargin !== null && confirmedMargin < 0 ? 'text-brand-rose' : 'text-brand-amber'}`}>{confirmedMargin === null ? '—' : `${confirmedMargin.toFixed(2)}%`}</div>
          <p className="mt-1 text-[10px] text-subtle">仅由已开票且成本、汇率齐全的明细计算</p>
        </div>

        <div className="glass-panel rounded-2xl border-brand-rose/20 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">待补齐计算条件</span>
            <CircleAlert className="h-4 w-4 text-brand-rose" />
          </div>
          <div className="mt-3 text-2xl font-extrabold text-brand-rose">{summaryStats.pendingCount} 条</div>
          <p className="mt-1 text-[10px] text-subtle">缺成本 {summaryStats.missingCostCount} 条 · 缺汇率 {summaryStats.missingRateCount} 条 · 预估成本 {summaryStats.estimatedCostCount} 条</p>
        </div>
      </div>

      <FilterPanel className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2 xl:grid-cols-8">
        <FormField label="搜索利润明细" className="xl:col-span-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              type="text"
              placeholder="发货单、合同号、产品、客户或物料号"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm text-ink"
            />
          </div>
        </FormField>
        <FormField label="开票月份从" htmlFor="profit-date-from">
          <input id="profit-date-from" type="month" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-body" />
        </FormField>
        <FormField label="至" htmlFor="profit-date-to">
          <input id="profit-date-to" type="month" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-body" />
        </FormField>
        <FormField label="客户">
          <CustomerSelect
            value={customerFilter}
            onChange={(value) => { setCustomerFilter(value); setContractFilter('all'); setContactSheetFilter('all'); }}
            customers={customers.filter((customer) => filterOptions.customers.includes(customer.name))}
            valueMode="name"
            allOption={{ value: 'all', label: '全部客户' }}
            ariaLabel="筛选利润客户"
            searchPlaceholder="输入客户名称"
            emptyMessage="没有匹配的客户"
            size="sm"
          />
        </FormField>
        <FormField label="合同">
          <SearchableCombobox
            value={contractFilter}
            onChange={(value) => { setContractFilter(value); setContactSheetFilter('all'); }}
            options={[{ value: 'all', label: '全部合同' }, ...filterOptions.contracts
              .filter((contractNo) => customerFilter === 'all' || profitList.some((row) => row.contract_no === contractNo && row.customer_name === customerFilter))
              .map((contractNo) => ({ value: contractNo, label: contractNo }))]}
            ariaLabel="筛选利润合同"
            searchPlaceholder="输入合同号"
            emptyMessage="没有匹配的合同"
            size="sm"
          />
        </FormField>
        <FormField label="联系单">
          <SearchableCombobox
            value={contactSheetFilter}
            onChange={setContactSheetFilter}
            options={[{ value: 'all', label: '全部联系单' }, ...filterOptions.contactSheets
              .filter((sheetNo) => profitList.some((row) => row.contact_sheet_no === sheetNo
                && (customerFilter === 'all' || row.customer_name === customerFilter)
                && (contractFilter === 'all' || row.contract_no === contractFilter)))
              .map((sheetNo) => ({ value: sheetNo, label: sheetNo }))]}
            ariaLabel="筛选利润联系单"
            searchPlaceholder="输入联系单号"
            emptyMessage="没有匹配的联系单"
            size="sm"
          />
        </FormField>
        <FormField label="利润状态" htmlFor="profit-status-filter">
          <select id="profit-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProfitStatusFilter)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-body">
            <option value="all">全部状态</option>
            <option value="confirmed">已确认毛利</option>
            <option value="pending">待计算</option>
          </select>
        </FormField>
        <FormField label="出口类型" htmlFor="profit-export-filter">
          <select id="profit-export-filter" value={exportFilter} onChange={(event) => setExportFilter(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-body">
            <option value="all">全部类型</option>
            <option value="自营">自营（美元结算）</option>
            <option value="转口">转口（人民币结算）</option>
          </select>
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 md:col-span-2 xl:col-span-8">
          <span className="text-[11px] text-muted">显示 {contactSheetSummaries.length} 张联系单 · {filteredProfits.length} 条发货利润明细</span>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setGroupByCustomer((current) => !current)}
              tone={groupByCustomer ? 'primary' : 'secondary'}
              size="sm"
              icon={<Users className="h-3.5 w-3.5" />}
            >
              {groupByCustomer ? '返回普通视图' : '按客户分组查看'}
            </Button>
            <Button onClick={() => { setDateFrom(''); setDateTo(''); }} tone="secondary" size="sm">全部历史</Button>
            {hasFilters && <Button onClick={clearFilters} tone="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />}>恢复本财年默认范围</Button>}
          </div>
        </div>
      </FilterPanel>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-base font-bold text-ink">{groupByCustomer ? '客户利润分组' : '联系单利润汇总'}</h2>
          <p className="mt-1 text-[11px] text-muted">{groupByCustomer ? '客户汇总统一折算为人民币，金额单位为万元并保留两位小数；展开后仍按联系单逐张核对。' : '同一联系单多次发货会自动合并；任一明细缺成本、缺汇率或仍为预估时，整张联系单标记为待计算。'}</p>
        </div>
        {groupByCustomer ? (
          <div className="space-y-4">
            {customerGroupPage.rows.map((group) => (
              <article key={group.customer_name} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                <header className="flex flex-col gap-3 border-b border-border bg-surface-muted/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-heading text-base font-bold text-ink">{group.customer_name}</h3>
                    <p className="mt-1 text-[11px] text-muted">{group.contactSheetCount} 张联系单 · 已确认 {group.confirmedContactSheetCount} 张 · 待计算 {group.pendingContactSheetCount} 张</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-right">
                    <div className="rounded-lg border border-border bg-surface px-3 py-2">
                      <div className="text-[10px] text-muted">销售额</div>
                      <div className="mt-0.5 font-bold text-ink">¥{(group.salesRmb / 10000).toFixed(2)} 万</div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface px-3 py-2">
                      <div className="text-[10px] text-muted">已确认毛利</div>
                      <div className={`mt-0.5 font-bold ${group.profitRmb < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>¥{(group.profitRmb / 10000).toFixed(2)} 万</div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface px-3 py-2">
                      <div className="text-[10px] text-muted">毛利率</div>
                      <div className={`mt-0.5 font-bold ${group.margin !== null && group.margin < 0 ? 'text-brand-rose' : 'text-ink'}`}>{group.margin === null ? '—' : `${group.margin.toFixed(2)}%`}</div>
                    </div>
                  </div>
                </header>
                <DataTable ariaLabel={`${group.customer_name} 联系单利润明细`} className="text-xs" tableClassName="min-w-[920px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted/25 font-semibold text-muted">
                      <th className="p-3">联系单</th>
                      <th className="p-3">合同</th>
                      <th className="p-3">物料与产品</th>
                      <th className="p-3 text-right">销售额（万元）</th>
                      <th className="p-3 text-right">毛利（万元）</th>
                      <th className="p-3 text-right">毛利率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.contactSheets.map((row) => (
                      <tr key={row.id} className="hover:bg-surface-muted/30">
                        <td className="p-3 font-bold text-ink">{row.contact_sheet_no}</td>
                        <td className="p-3 text-body">{row.contract_no}</td>
                        <td className="p-3"><span className="font-semibold text-brand-cyan">{row.material_no}</span><span className="ml-2 text-body">{row.product_name}</span></td>
                        <td className="p-3 text-right font-semibold text-ink">{row.salesRmb === null ? '—' : `¥${(row.salesRmb / 10000).toFixed(2)}`}</td>
                        <td className="p-3 text-right">{row.profit === null ? <StatusBadge tone="warning">待计算</StatusBadge> : <span className={`font-bold ${row.profit < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>¥{(row.profit / 10000).toFixed(2)}</span>}</td>
                        <td className={`p-3 text-right font-bold ${row.margin !== null && row.margin < 0 ? 'text-brand-rose' : 'text-ink'}`}>{row.margin === null ? '—' : `${row.margin.toFixed(2)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </article>
            ))}
            {customerProfitSummaries.length === 0 && <div className="rounded-2xl border border-border bg-surface p-10 text-center text-muted">没有匹配当前条件的客户利润数据</div>}
            <PaginationControls {...customerGroupPage} onPageChange={customerGroupPage.setPage} itemLabel="位客户" />
          </div>
        ) : (
          <>
        <DataTable ariaLabel="联系单利润汇总" className="text-xs" tableClassName="min-w-[980px]">
          <thead>
            <tr className="border-b border-border bg-surface-muted/55 font-semibold text-muted">
              <th className="p-4">联系单</th>
              <th className="p-4">合同 / 客户</th>
              <th className="p-4">物料与产品</th>
              <th className="p-4">开票范围</th>
              <th className="p-4 text-right">销售额（人民币）</th>
              <th className="p-4 text-right">毛利（人民币）</th>
              <th className="p-4 text-right">毛利率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summaryPage.rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-surface-muted/35">
                <td className="p-4">
                  <span className="block font-heading text-sm font-bold text-ink">{row.contact_sheet_no}</span>
                  <span className="mt-0.5 block text-[10px] text-muted">{row.quantity.toLocaleString()} {row.unit} · {row.shipmentCount} 笔发货</span>
                </td>
                <td className="p-4">
                  <span className="block font-semibold text-body">{row.contract_no}</span>
                  <span className="mt-0.5 block max-w-[190px] truncate text-[10px] text-muted" title={row.customer_name}>{row.customer_name}</span>
                </td>
                <td className="p-4">
                  <span className="rounded-md border border-brand-cyan/15 bg-brand-cyan/5 px-1.5 py-0.5 text-[10px] font-semibold text-brand-cyan">{row.material_no}</span>
                  <span className="mt-1 block max-w-[220px] truncate text-body" title={row.product_name}>{row.product_name}</span>
                </td>
                <td className="p-4 text-body">{row.invoiceMonthStart === row.invoiceMonthEnd ? formatMonth(row.invoiceMonthStart) : `${formatMonth(row.invoiceMonthStart)} 至 ${formatMonth(row.invoiceMonthEnd)}`}</td>
                <td className="p-4 text-right font-semibold text-ink">{row.salesRmb === null ? '—' : `￥${row.salesRmb.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</td>
                <td className="p-4 text-right">
                  {row.profit === null
                    ? <StatusBadge tone="warning">待计算 {row.pendingCount} 条</StatusBadge>
                    : <span className={`font-bold ${row.profit < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>￥{row.profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
                </td>
                <td className={`p-4 text-right font-bold ${row.margin !== null && row.margin < 0 ? 'text-brand-rose' : 'text-ink'}`}>{row.margin === null ? '—' : `${row.margin.toFixed(2)}%`}</td>
              </tr>
            ))}
            {contactSheetSummaries.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-muted">没有匹配当前条件的联系单利润汇总</td></tr>
            )}
          </tbody>
        </DataTable>
        <PaginationControls {...summaryPage} onPageChange={summaryPage.setPage} itemLabel="张联系单" />
          </>
        )}
      </section>

      <div>
        <h2 className="font-heading text-base font-bold text-ink">{groupByCustomer ? '客户发货利润分组' : '发货利润明细'}</h2>
        <p className="mt-1 text-[11px] text-muted">{groupByCustomer ? '与上方使用同一客户分组开关；每位客户下完整列出其发货利润、批次成本与开票月份。' : '用于追溯联系单汇总中的每笔发货、批次成本与开票月份。'}</p>
      </div>

      {groupByCustomer ? (
        <section className="space-y-4">
          {shipmentCustomerGroupPage.rows.map((group) => (
            <article key={group.customer_name} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <header className="flex flex-col gap-3 border-b border-border bg-surface-muted/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-heading text-base font-bold text-ink">{group.customer_name}</h3>
                  <p className="mt-1 text-[11px] text-muted">{group.shipmentCount} 笔发货 · {group.detailCount} 条利润明细 · 已确认 {group.confirmedDetailCount} 条 · 待计算 {group.pendingDetailCount} 条</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-right">
                  <div className="rounded-lg border border-border bg-surface px-3 py-2">
                    <div className="text-[10px] text-muted">销售额</div>
                    <div className="mt-0.5 font-bold text-ink">¥{(group.salesRmb / 10000).toFixed(2)} 万</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-3 py-2">
                    <div className="text-[10px] text-muted">已确认毛利</div>
                    <div className={`mt-0.5 font-bold ${group.profitRmb < 0 ? 'text-brand-rose' : 'text-brand-emerald'}`}>¥{(group.profitRmb / 10000).toFixed(2)} 万</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-3 py-2">
                    <div className="text-[10px] text-muted">确认毛利率</div>
                    <div className={`mt-0.5 font-bold ${group.margin !== null && group.margin < 0 ? 'text-brand-rose' : 'text-ink'}`}>{group.margin === null ? '—' : `${group.margin.toFixed(2)}%`}</div>
                  </div>
                </div>
              </header>
              <DataTable ariaLabel={`${group.customer_name} 发货利润明细`} className="text-xs" tableClassName="min-w-[1080px]">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/25 font-semibold text-muted">
                    <th className="p-4">发货单 / 开票月</th>
                    <th className="p-4">合同 / 客户</th>
                    <th className="p-4">物料与产品</th>
                    <th className="p-4">发货数量</th>
                    <th className="p-4">结算原值</th>
                    <th className="p-4">不含税成本</th>
                    <th className="p-4">毛利结果</th>
                    <th className="p-4 text-right">毛利率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">{group.shipments.map(renderShipmentProfitRow)}</tbody>
              </DataTable>
            </article>
          ))}
          {customerShipmentProfitSummaries.length === 0 && <div className="rounded-2xl border border-border bg-surface p-10 text-center text-muted">没有匹配当前条件的客户发货利润数据</div>}
          <PaginationControls {...shipmentCustomerGroupPage} onPageChange={shipmentCustomerGroupPage.setPage} itemLabel="位客户" />
        </section>
      ) : (
        <>
          <DataTable ariaLabel="利润分析明细" className="text-xs" tableClassName="min-w-[1080px]">
            <thead>
              <tr className="border-b border-border bg-surface-muted/55 font-semibold text-muted">
                <th className="p-4">发货单 / 开票月</th>
                <th className="p-4">合同 / 客户</th>
                <th className="p-4">物料与产品</th>
                <th className="p-4">发货数量</th>
                <th className="p-4">结算原值</th>
                <th className="p-4">不含税成本</th>
                <th className="p-4">毛利结果</th>
                <th className="p-4 text-right">毛利率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredProfits.length > 0 ? profitPage.rows.map(renderShipmentProfitRow) : (
                <tr>
                  <td colSpan={8} className="p-12 text-center">
                    <Calculator className="mx-auto h-7 w-7 text-subtle" />
                    <div className="mt-3 text-sm font-semibold text-body">{profitList.length ? '没有匹配当前条件的利润明细' : '还没有可展示的开票利润'}</div>
                    <div className="mx-auto mt-1 max-w-lg text-xs leading-6 text-muted">
                      {profitList.length ? '可切换到全部历史月份，或调整开票月份和客户范围。' : '先在发货记录中确认开票；如仍无法计算，请补充对应开票月的产品成本和 USD/CNY 汇率。'}
                    </div>
                    {profitList.length > 0 && hasFilters && <Button onClick={clearFilters} tone="secondary" size="sm" className="mt-4">恢复本财年默认范围</Button>}
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
          <PaginationControls {...profitPage} onPageChange={profitPage.setPage} itemLabel="条利润明细" />
        </>
      )}
    </div>
  );
};
