import React, { useMemo, useState } from 'react';
import { db } from '../services/dataStore';
import { AlertTriangle, AlertCircle, Info, Check, EyeOff, Trash2, Search, RotateCcw, ArrowRight, ChevronDown, ChevronUp, Clock3 } from 'lucide-react';
import { PageHeader, FilterPanel } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { IconButton } from '../components/IconButton';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Dialog } from '../components/Dialog';
import { filterAlertWorkspace, getAlertNavigationTab, groupAlertWorkspace } from '../services/alertWorkspace';
import { DEMO_PACKAGING_BOX_ARTWORK_ALERT_TYPE } from '../services/boxArtworkReminder';
import { addDaysToLocalDate, formatLocalDate } from '../services/dateUtils';

interface AlertsProps {
  onNavigate: (tab: string) => void;
  onRefreshData: () => void;
  onRefreshTrigger: number;
}

const statusByTab = { pending: '未处理', snoozed: '稍后提醒', handled: '已处理', ignored: '忽略' } as const;
const relatedTypeLabels: Record<string, string> = {
  contract: '合同',
  contact_sheet: '联系单',
  batch: '批次',
  shipment: '发货',
  invoice: '开票',
  payment: '收款'
};

export const Alerts: React.FC<AlertsProps> = ({ onNavigate, onRefreshData, onRefreshTrigger }) => {
  const { confirm, notify } = useFeedback();
  const [activeTab, setActiveTab] = useState<keyof typeof statusByTab>('pending');
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [relatedTypeFilter, setRelatedTypeFilter] = useState('');
  const [alertTypeFilter, setAlertTypeFilter] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [operationError, setOperationError] = useState('');
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const [snoozeAlertId, setSnoozeAlertId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState(() => addDaysToLocalDate(formatLocalDate(), 3));

  const data = useMemo(() => {
    void onRefreshTrigger;
    return {
      alerts: db.getAlerts(),
      contracts: db.getContracts(),
      contactSheets: db.getContactSheets(),
      batches: db.getBatches(),
      shipments: db.getShipments(),
      invoices: db.getInvoices(),
      payments: db.getPayments()
    };
  }, [onRefreshTrigger]);

  const { alerts, contracts, contactSheets, batches, shipments, invoices, payments } = data;

  const alertTargets = useMemo(() => new Map(alerts.map((alert) => {
    let label = `${relatedTypeLabels[alert.related_type] || '业务记录'} ${alert.related_id.slice(0, 8)}`;
    let detail = '';
    if (alert.related_type === 'contract') {
      const contract = contracts.find((row) => row.id === alert.related_id);
      if (contract) { label = `合同 ${contract.contract_no}`; detail = contract.customer_name; }
    } else if (alert.related_type === 'contact_sheet') {
      const sheet = contactSheets.find((row) => row.id === alert.related_id);
      const contract = contracts.find((row) => row.id === sheet?.contract_id);
      if (sheet) { label = `联系单 ${sheet.contact_sheet_no || '待编号'}`; detail = `${contract?.contract_no || '未关联合同'} · ${sheet.product_name}`; }
    } else if (alert.related_type === 'batch') {
      const batch = batches.find((row) => row.id === alert.related_id);
      const sheet = contactSheets.find((row) => row.id === batch?.contact_sheet_id);
      if (batch) { label = `批号 ${batch.batch_no || '待填写'}`; detail = `${sheet?.contact_sheet_no || '未关联联系单'} · ${sheet?.product_name || ''}`; }
    } else if (alert.related_type === 'shipment') {
      const shipment = shipments.find((row) => row.id === alert.related_id);
      if (shipment) { label = `发货 ${shipment.group_shipment_no || shipment.shipment_no}`; detail = `${shipment.contract_no} · ${shipment.customer_name}`; }
    } else if (alert.related_type === 'invoice') {
      const invoice = invoices.find((row) => row.id === alert.related_id);
      if (invoice) { label = `发票 ${invoice.invoice_no || '未编号'}`; detail = `${invoice.shipment_no} · ${invoice.customer_name || ''}`; }
    } else if (alert.related_type === 'payment') {
      const payment = payments.find((row) => row.id === alert.related_id);
      if (payment) { label = `收款 ${payment.payment_date}`; detail = `${payment.contract_no} · ${payment.customer_name}`; }
    }
    return [alert.id, {
      label,
      detail,
      tab: getAlertNavigationTab(alert.related_type),
      searchText: `${label} ${detail}`
    }];
  })), [alerts, contracts, contactSheets, batches, shipments, invoices, payments]);

  const alertTypeOptions = useMemo(() => Array.from(new Set(alerts.map((alert) => alert.alert_type))).sort(), [alerts]);
  const filteredAlerts = useMemo(() => filterAlertWorkspace(alerts, {
    status: statusByTab[activeTab],
    query,
    priority: priorityFilter,
    relatedType: relatedTypeFilter,
    alertType: alertTypeFilter
  }, (alert) => alertTargets.get(alert.id)?.searchText || ''), [alerts, activeTab, query, priorityFilter, relatedTypeFilter, alertTypeFilter, alertTargets]);
  const alertGroups = useMemo(() => groupAlertWorkspace(filteredAlerts), [filteredAlerts]);
  const summary = useMemo(() => ({
    high: filteredAlerts.filter((alert) => alert.priority === 'high').length,
    medium: filteredAlerts.filter((alert) => alert.priority === 'medium').length,
    low: filteredAlerts.filter((alert) => alert.priority === 'low').length
  }), [filteredAlerts]);
  const hasFilters = Boolean(query || priorityFilter || relatedTypeFilter || alertTypeFilter);

  const clearFilters = () => {
    setQuery('');
    setPriorityFilter('');
    setRelatedTypeFilter('');
    setAlertTypeFilter('');
  };

  const handleEnterProcessing = (alert: (typeof alerts)[number]) => {
    if (alert.related_type === 'contract') {
      sessionStorage.setItem('open_contract_detail_id', alert.related_id);
      onNavigate('contracts');
      return;
    }
    if (alert.related_type === 'contact_sheet') {
      const sheet = contactSheets.find((row) => row.id === alert.related_id);
      if (sheet) {
        sessionStorage.setItem('highlight_contact_sheet_id', sheet.id);
        sessionStorage.setItem('return_to_contract_id', sheet.contract_id);
        sessionStorage.setItem('return_to_contract_no', sheet.contract_no || '原合同');
      }
      onNavigate('contact_sheets');
      return;
    }
    if (alert.related_type === 'batch') {
      const batch = batches.find((row) => row.id === alert.related_id);
      const sheet = contactSheets.find((row) => row.id === batch?.contact_sheet_id);
      if (sheet) {
        sessionStorage.setItem('highlight_contact_sheet_id', sheet.id);
        sessionStorage.setItem('return_to_contract_id', sheet.contract_id);
        sessionStorage.setItem('return_to_contract_no', sheet.contract_no || '原合同');
        onNavigate('contact_sheets');
        return;
      }
    }
    onNavigate(alertTargets.get(alert.id)?.tab || 'alerts');
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleUpdateStatus = async (id: string, status: '未处理' | '已处理' | '忽略') => {
    setOperationError('');
    setPendingAlertId(id);
    try {
      await db.updateAlertStatus(id, status);
      onRefreshData();
      notify({
        title: status === '已处理' ? '提醒已标记为解决' : status === '忽略' ? '提醒已忽略' : '提醒已恢复为待办',
        message: status === '已处理' ? '该记录已移入处理历史。' : status === '忽略' ? '该记录已移入忽略列表，业务数据没有被修改。' : '该记录已重新进入未处理列表。',
        tone: 'success'
      });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAlertId(null);
    }
  };

  const handleOpenSnooze = (id: string) => {
    setSnoozeAlertId(id);
    setSnoozeDate(addDaysToLocalDate(formatLocalDate(), 3));
  };

  const handleSnooze = async () => {
    if (!snoozeAlertId || !snoozeDate) return;
    if (snoozeDate < formatLocalDate()) {
      setOperationError('稍后提醒日期不能早于今天。');
      return;
    }
    setOperationError('');
    setPendingAlertId(snoozeAlertId);
    try {
      await db.updateAlertStatus(snoozeAlertId, '稍后提醒', `${snoozeDate}T09:00:00+08:00`);
      setSnoozeAlertId(null);
      onRefreshData();
      notify({ title: '已设置稍后提醒', message: `${snoozeDate} 后可在“稍后提醒”列表中恢复为待办。`, tone: 'success' });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAlertId(null);
    }
  };

  const handleDeleteAlert = async (id: string) => {
    const target = alerts.find((alert) => alert.id === id);
    const confirmed = await confirm({
      title: '彻底删除这条提醒？',
      message: `类型：${target?.alert_type || '未命名提醒'}\n内容：${target?.message || '无详细内容'}\n\n删除后不会再出现在提醒历史中，且无法恢复。`,
      confirmLabel: '删除提醒',
      tone: 'danger'
    });
    if (!confirmed) return;
    setOperationError('');
    setPendingAlertId(id);
    try {
      await db.deleteAlert(id);
      onRefreshData();
      notify({ title: '提醒已删除', message: '该提醒已从提醒中心彻底移除。', tone: 'success' });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAlertId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="提醒与预警中心"
        description="按业务对象和风险优先级整理提醒；先进入对应工作区处理，再明确标记解决或忽略"
      />

      {operationError && (
        <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">提醒操作失败：{operationError}</div>
      )}

      <div className="flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-surface-muted p-1 text-xs">
        {([
          ['pending', '未处理', '未处理'],
          ['snoozed', '稍后提醒', '稍后提醒'],
          ['handled', '已处理', '已处理'],
          ['ignored', '已忽略', '忽略']
        ] as const).map(([tab, label, status]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2 font-semibold transition-colors ${activeTab === tab ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-body'}`}
          >
            {label} ({alerts.filter((alert) => alert.status === status).length})
          </button>
        ))}
      </div>

      <FilterPanel className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2 xl:grid-cols-6">
        <FormField label="搜索提醒" className="xl:col-span-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="类型、内容、合同号、联系单号或发货号" className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-ink" />
          </div>
        </FormField>
        <FormField label="风险等级" htmlFor="alert-priority-filter">
          <select id="alert-priority-filter" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-body">
            <option value="">全部等级</option><option value="high">高风险</option><option value="medium">中风险</option><option value="low">日常</option>
          </select>
        </FormField>
        <FormField label="业务对象" htmlFor="alert-related-filter">
          <select id="alert-related-filter" value={relatedTypeFilter} onChange={(event) => setRelatedTypeFilter(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-body">
            <option value="">全部对象</option>
            {Object.entries(relatedTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </FormField>
        <FormField label="提醒类型" htmlFor="alert-type-filter">
          <select id="alert-type-filter" value={alertTypeFilter} onChange={(event) => setAlertTypeFilter(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-body">
            <option value="">全部类型</option>
            {alertTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </FormField>
        <div className="flex items-end justify-end">
          {hasFilters && <Button onClick={clearFilters} tone="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />}>清空筛选</Button>}
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3 md:col-span-2 xl:col-span-6">
          <span className="text-[11px] text-muted">显示 {filteredAlerts.length} 条，折叠为 {alertGroups.length} 组</span>
          <StatusBadge tone="danger">高风险 {summary.high}</StatusBadge>
          <StatusBadge tone="warning">中风险 {summary.medium}</StatusBadge>
          <StatusBadge tone="progress">日常 {summary.low}</StatusBadge>
        </div>
      </FilterPanel>

      <div className="space-y-4">
        {alertGroups.length > 0 ? alertGroups.map((group) => {
          const expanded = expandedGroups.has(group.key);
          const visibleAlerts = expanded || group.alerts.length <= 2 ? group.alerts : group.alerts.slice(0, 2);
          const GroupIcon = group.priority === 'high' ? AlertCircle : group.priority === 'medium' ? AlertTriangle : Info;
          const groupTone = group.priority === 'high' ? 'danger' : group.priority === 'medium' ? 'warning' : 'progress';
          return (
            <section key={group.key} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted/55 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${group.priority === 'high' ? 'bg-brand-rose/10 text-brand-rose' : group.priority === 'medium' ? 'bg-brand-amber/10 text-brand-amber' : 'bg-brand-blue/10 text-brand-blue'}`}><GroupIcon className="h-4 w-4" /></span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="font-heading text-sm font-bold text-ink">{group.alertType}</span><StatusBadge tone={groupTone}>{group.alerts.length} 条</StatusBadge></div>
                    <div className="mt-1 text-[11px] text-muted">关联对象：{relatedTypeLabels[group.relatedType] || group.relatedType}</div>
                  </div>
                </div>
                {group.alerts.length > 2 && (
                  <Button onClick={() => toggleGroup(group.key)} tone="secondary" size="sm" icon={expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}>
                    {expanded ? '收起同类提醒' : `展开其余 ${group.alerts.length - 2} 条`}
                  </Button>
                )}
              </header>

              <div className="divide-y divide-border">
                {visibleAlerts.map((alert) => {
                  const target = alertTargets.get(alert.id);
                  const priorityTone = alert.priority === 'high' ? 'danger' : alert.priority === 'medium' ? 'warning' : 'progress';
                  const isBoxArtworkAlert = alert.alert_type === DEMO_PACKAGING_BOX_ARTWORK_ALERT_TYPE;
                  return (
                    <div key={alert.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={priorityTone}>{alert.priority === 'high' ? '高风险' : alert.priority === 'medium' ? '中风险' : '日常'}</StatusBadge>
                          <span className="rounded-md border border-border bg-surface-muted px-2 py-1 text-[10px] font-semibold text-body">{target?.label}</span>
                          {target?.detail && <span className="text-[10px] text-muted">{target.detail}</span>}
                        </div>
                        <p className="mt-2 text-xs leading-6 text-body">{alert.message}</p>
                        {alert.status === '稍后提醒' && alert.snoozed_until && (
                          <div className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold ${alert.snoozed_until.slice(0, 10) <= formatLocalDate() ? 'bg-brand-rose/10 text-brand-rose' : 'bg-brand-amber/10 text-brand-amber'}`}>
                            <Clock3 className="h-3 w-3" />{alert.snoozed_until.slice(0, 10) <= formatLocalDate() ? '已到提醒日期' : `提醒日期 ${alert.snoozed_until.slice(0, 10)}`}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] text-subtle">{alert.created_at.replace('T', ' ').slice(0, 19)}</div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {alert.status === '未处理' && isBoxArtworkAlert ? (
                          <Button onClick={() => handleEnterProcessing(alert)} tone="danger" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>进入联系单确认盒子版式</Button>
                        ) : alert.status === '未处理' ? (
                          <>
                            <Button onClick={() => handleEnterProcessing(alert)} tone="secondary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>进入处理</Button>
                            <Button onClick={() => void handleUpdateStatus(alert.id, '已处理')} disabled={pendingAlertId !== null} tone="subtle" size="sm" icon={<Check className="h-3.5 w-3.5" />}>{pendingAlertId === alert.id ? '处理中' : '标记已解决'}</Button>
                            <Button onClick={() => handleOpenSnooze(alert.id)} disabled={pendingAlertId !== null} tone="warning" size="sm" icon={<Clock3 className="h-3.5 w-3.5" />}>稍后提醒</Button>
                            <Button onClick={() => void handleUpdateStatus(alert.id, '忽略')} disabled={pendingAlertId !== null} tone="secondary" size="sm" icon={<EyeOff className="h-3.5 w-3.5" />}>忽略</Button>
                          </>
                        ) : (
                          <>
                            <Button onClick={() => void handleUpdateStatus(alert.id, '未处理')} disabled={pendingAlertId !== null} tone="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />}>恢复待办</Button>
                            <IconButton onClick={() => void handleDeleteAlert(alert.id)} disabled={pendingAlertId !== null} label="删除提醒记录" tone="danger" icon={<Trash2 className="h-3.5 w-3.5" />} />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        }) : (
          <div className="glass-panel rounded-2xl py-16 text-center text-sm text-muted">暂无匹配的提醒；可以清空筛选或切换处理状态查看历史。</div>
        )}
      </div>

      {snoozeAlertId && (
        <Dialog onClose={() => setSnoozeAlertId(null)} ariaLabel="设置稍后提醒日期">
          <div className="dialog-panel w-full max-w-md space-y-5 p-6">
            <div>
              <h3 className="font-heading text-lg font-bold text-ink">设置稍后提醒</h3>
              <p className="mt-1 text-xs leading-5 text-muted">提醒会从未处理列表移出，并保留在“稍后提醒”中；到期后可一键恢复待办。</p>
            </div>
            <FormField label="再次提醒日期" required hint="默认延后 3 天，也可以选择今天或更晚日期。">
              <input type="date" min={formatLocalDate()} value={snoozeDate} onChange={(event) => setSnoozeDate(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setSnoozeAlertId(null)} tone="secondary">取消</Button>
              <Button onClick={() => void handleSnooze()} disabled={!snoozeDate || pendingAlertId !== null} tone="warning" icon={<Clock3 className="h-4 w-4" />}>{pendingAlertId ? '保存中' : '确认稍后提醒'}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
