import React, { useState, useMemo } from 'react';
import { db } from '../services/dataStore';
import type { Customer } from '../services/dataStore';
import { Dialog } from '../components/Dialog';
import { PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { IconButton } from '../components/IconButton';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { SearchToolbar } from '../components/SearchToolbar';
import { CustomerSelect } from '../components/CustomerSelect';
import { CustomerOrderManager } from '../components/CustomerOrderManager';
import { normalizeCustomerIdentity, summarizeCustomerReferences } from '../services/customerMerge';
import { Plus, Edit2, Trash2, Globe, X, ArrowUpDown, CalendarRange, CreditCard, GitMerge, ArrowRight, ListOrdered, UsersRound } from 'lucide-react';

interface CustomersProps {
  onRefreshData: () => void;
  onRefreshTrigger: number;
}

export const Customers: React.FC<CustomersProps> = ({ onRefreshData, onRefreshTrigger }) => {
  const { confirm, notify } = useFeedback();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'name' | 'newest' | 'currency'>('name');
  const [activeSection, setActiveSection] = useState<'profiles' | 'display-order'>('profiles');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [isStaggeredMonth, setIsStaggeredMonth] = useState(false);
  const [expiryYears, setExpiryYears] = useState(3);
  const [defaultCurrency, setDefaultCurrency] = useState<'USD' | 'RMB'>('USD');
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState('30% 预付 + 70% 发货前付清');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [isMerging, setIsMerging] = useState(false);

  // Load customers
  const customers = useMemo(() => { void onRefreshTrigger; return db.getCustomers(); }, [onRefreshTrigger]);
  const hasMultipleOwners = useMemo(() => new Set(customers.map((customer) => customer.owner_id)).size > 1, [customers]);

  // Search & Filter
  const filteredCustomers = useMemo(() => {
    const matched = customers.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.owner_display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.country.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.notes && c.notes.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    return matched.sort((left, right) => {
      if (sortOrder === 'newest') return right.created_at.localeCompare(left.created_at);
      if (sortOrder === 'currency') {
        const currencyDifference = left.default_currency.localeCompare(right.default_currency);
        if (currencyDifference !== 0) return currencyDifference;
      }
      return left.name.localeCompare(right.name, 'zh-CN');
    });
  }, [customers, searchQuery, sortOrder]);

  const handleOpenAdd = () => {
    setOperationError('');
    setEditingId(null);
    setName('');
    setCountry('');
    setIsStaggeredMonth(false);
    setExpiryYears(3);
    setDefaultCurrency('USD');
    setDefaultPaymentTerms('30% 预付 + 70% 发货前付清');
    setNotes('');
    setShowModal(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setOperationError('');
    setEditingId(c.id);
    setName(c.name);
    setCountry(c.country);
    setIsStaggeredMonth(c.is_staggered_month);
    setExpiryYears(c.expiry_years);
    setDefaultCurrency(c.default_currency);
    setDefaultPaymentTerms(c.default_payment_terms);
    setNotes(c.notes);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const data = {
      name: name.trim(),
      country: country.trim(),
      is_staggered_month: isStaggeredMonth,
      expiry_years: Math.max(1, expiryYears || 1),
      default_currency: defaultCurrency,
      default_payment_terms: defaultPaymentTerms.trim(),
      notes: notes.trim()
    };

    setIsSaving(true);
    setOperationError('');
    try {
      if (editingId) {
        await db.updateCustomer(editingId, data);
      } else {
        await db.addCustomer(data);
      }
      setShowModal(false);
      onRefreshData();
      notify({ title: editingId ? '客户档案已更新' : '客户档案已创建', message: `${data.name}的默认业务参数已保存。`, tone: 'success' });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const customer = customers.find(item => item.id === id);
    const references = summarizeCustomerReferences(
      id,
      db.getContracts(),
      db.getPaymentReceipts(),
      db.getShipmentGroups()
    );
    if (references.total > 0) {
      setOperationError(
        `${customer?.name || '该客户'}仍关联 ${references.contracts} 个合同、${references.paymentReceipts} 笔整单收款、${references.shipmentGroups} 笔整单发货，不能直接删除。若它是重复档案，请使用“合并客户”把关联完整迁移到保留档案。`
      );
      return;
    }
    const confirmed = await confirm({
      title: '删除这个客户档案？',
      message: `客户：${customer?.name || '未知客户'}\n\n该档案目前没有关联合同、整单收款或整单发货。删除后无法恢复。`,
      confirmLabel: '删除客户',
      tone: 'danger'
    });
    if (!confirmed) return;
    setOperationError('');
    try {
      await db.deleteCustomer(id);
      onRefreshData();
      notify({ title: '客户档案已删除', message: `${customer?.name || '该客户'}已从客户档案中移除。`, tone: 'success' });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenMerge = (source: Customer) => {
    setOperationError('');
    const normalizedSource = normalizeCustomerIdentity(source.name);
    const suggestedTarget = customers.find((candidate) => (
      candidate.id !== source.id
      && candidate.owner_id === source.owner_id
      && normalizeCustomerIdentity(candidate.name) === normalizedSource
    ));
    setMergeSourceId(source.id);
    setMergeTargetId(suggestedTarget?.id || '');
  };

  const handleMerge = async () => {
    const source = customers.find((customer) => customer.id === mergeSourceId);
    const target = customers.find((customer) => customer.id === mergeTargetId);
    if (!source || !target) {
      setOperationError('请选择要保留的客户档案。');
      return;
    }
    const references = summarizeCustomerReferences(
      source.id,
      db.getContracts(),
      db.getPaymentReceipts(),
      db.getShipmentGroups()
    );
    const confirmed = await confirm({
      title: '确认合并这两个客户？',
      message: `待删除：${source.name}\n保留为：${target.name}\n\n将迁移 ${references.contracts} 个合同、${references.paymentReceipts} 笔整单收款、${references.shipmentGroups} 笔整单发货。迁移成功后会删除待合并档案；任一步失败都会整体回滚。`,
      confirmLabel: '确认合并',
      tone: 'danger'
    });
    if (!confirmed) return;

    setIsMerging(true);
    setOperationError('');
    try {
      const result = await db.mergeCustomers(source.id, target.id);
      setMergeSourceId('');
      setMergeTargetId('');
      onRefreshData();
      notify({
        title: '客户合并完成',
        message: `已将 ${result.moved_contracts} 个合同、${result.moved_payment_receipts} 笔整单收款、${result.moved_shipment_groups} 笔整单发货迁移到“${result.target_name}”。`,
        tone: 'success'
      });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMerging(false);
    }
  };

  const mergeSource = customers.find((customer) => customer.id === mergeSourceId);
  const mergeReferences = mergeSource
    ? summarizeCustomerReferences(mergeSource.id, db.getContracts(), db.getPaymentReceipts(), db.getShipmentGroups())
    : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="客户主数据"
        description="统一维护客户档案和当前账号的客户展示顺序"
        actions={activeSection === 'profiles' ? (
          <Button
            onClick={handleOpenAdd}
            icon={<Plus className="h-4 w-4" />}
          >
            新增客户档案
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="tablist" aria-label="客户主数据分区">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'profiles'}
          onClick={() => setActiveSection('profiles')}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${activeSection === 'profiles' ? 'border-brand-cyan/35 bg-brand-cyan/[0.07] shadow-sm' : 'border-border bg-surface hover:border-border-strong hover:bg-surface-muted'}`}
        >
          <UsersRound className={`mt-0.5 h-4 w-4 ${activeSection === 'profiles' ? 'text-brand-cyan' : 'text-muted'}`} />
          <span>
            <span className="block text-xs font-bold text-ink">客户档案</span>
            <span className="mt-1 block text-[10px] leading-4 text-muted">维护客户名称、国家、货币和默认业务规则</span>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'display-order'}
          onClick={() => {
            setShowModal(false);
            setActiveSection('display-order');
          }}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${activeSection === 'display-order' ? 'border-brand-cyan/35 bg-brand-cyan/[0.07] shadow-sm' : 'border-border bg-surface hover:border-border-strong hover:bg-surface-muted'}`}
        >
          <ListOrdered className={`mt-0.5 h-4 w-4 ${activeSection === 'display-order' ? 'text-brand-cyan' : 'text-muted'}`} />
          <span>
            <span className="block text-xs font-bold text-ink">客户展示顺序</span>
            <span className="mt-1 block text-[10px] leading-4 text-muted">决定下拉框及合同客户分组的排列，并按账号本地保存</span>
          </span>
        </button>
      </div>

      {activeSection === 'profiles' ? (
        <>
      {/* Search & Stats bar */}
      <SearchToolbar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="搜索客户名称、国家、备注..."
        ariaLabel="搜索和排序客户档案"
        filters={(
        <div className="relative w-full md:w-56">
          <ArrowUpDown className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)} className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-xs text-body">
            <option value="name">按客户名称排序</option>
            <option value="newest">按最近创建排序</option>
            <option value="currency">按默认货币排序</option>
          </select>
        </div>
        )}
        actions={(
        <div className="flex items-center justify-end gap-3 text-xs text-muted">
          <span>共 <strong className="text-ink">{customers.length}</strong> 个</span>
          <span className="h-4 w-px bg-border" />
          <span>当前 <strong className="text-brand-cyan">{filteredCustomers.length}</strong> 个</span>
        </div>
        )}
      />

      {/* Grid of Customer Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {operationError && (
          <div role="alert" className="md:col-span-2 lg:col-span-3 rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">
            {operationError}
          </div>
        )}
        {filteredCustomers.length > 0 ? (
          filteredCustomers.map((customer) => (
            <article key={customer.id} className="glass-panel glass-panel-hover flex min-h-64 flex-col justify-between rounded-2xl p-5">
              <div className="space-y-4">
                {/* Header */}
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 font-heading text-base font-bold text-ink">{customer.name}</h3>
                    {hasMultipleOwners && <div className="mt-1 text-[10px] font-semibold text-brand-cyan">负责人：{customer.owner_display_name}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface-muted px-2 py-1 text-[10px] text-muted">
                    <Globe className="h-3 w-3 text-brand-cyan" />
                    默认目的国：{customer.country || '待补充'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-border bg-surface-muted/55 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted"><CreditCard className="h-3.5 w-3.5" />默认货币</div>
                    <div className="mt-1.5 text-sm font-bold text-ink">{customer.default_currency === 'RMB' ? 'RMB 人民币' : 'USD 美元'}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-muted/55 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted"><CalendarRange className="h-3.5 w-3.5" />默认有效期</div>
                    <div className="mt-1.5 text-sm font-bold text-ink">{customer.expiry_years} 年</div>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="shrink-0 text-muted">有效期规则</span>
                    <StatusBadge tone={customer.is_staggered_month ? 'warning' : 'success'}>
                      {customer.is_staggered_month ? '默认错月' : '正常计算'}
                    </StatusBadge>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
                    <div className="text-[10px] text-muted">默认付款条件</div>
                    <div className="mt-1 line-clamp-2 min-h-8 font-medium leading-4 text-body">{customer.default_payment_terms || '尚未设置'}</div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs">
                <span className="max-w-[180px] truncate text-[10px] text-subtle" title={customer.notes}>
                  {customer.notes || '暂无备注说明'}
                </span>

                <div className="flex gap-2">
                  <IconButton
                    onClick={() => handleOpenMerge(customer)}
                    label={`合并重复客户：${customer.name}`}
                    tone="warning"
                    icon={<GitMerge className="w-3.5 h-3.5" />}
                  />
                  <IconButton
                    onClick={() => handleOpenEdit(customer)}
                    label={`编辑客户：${customer.name}`}
                    icon={<Edit2 className="w-3.5 h-3.5" />}
                  />
                  <IconButton
                    onClick={() => handleDelete(customer.id)}
                    label={`删除客户：${customer.name}`}
                    tone="danger"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                  />
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="glass-panel col-span-full rounded-2xl py-16 text-center text-sm text-muted">
            暂无匹配的客户档案，点击右上角按钮创建
          </div>
        )}
      </div>
        </>
      ) : (
        <CustomerOrderManager customers={customers} />
      )}

      {/* Edit/Add Modal Overlay */}
      {showModal && (
        <Dialog onClose={() => setShowModal(false)} ariaLabel={editingId ? '编辑客户档案' : '新增客户档案'}>
          <div className="dialog-panel max-h-[90vh] w-full max-w-2xl space-y-6 overflow-y-auto p-6">
            <div className="flex justify-between items-center">
              <h3 className="font-heading text-lg font-bold text-ink">
                {editingId ? '编辑客户档案' : '新增客户档案'}
              </h3>
              <IconButton
                onClick={() => setShowModal(false)}
                label="关闭客户档案表单"
                icon={<X className="w-5 h-5" />}
              />
            </div>

            {operationError && <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">{operationError}</div>}

            <form onSubmit={handleSubmit} className="space-y-5 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="客户名称" required>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如 DEMO HORIZON LTD."
                  className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink"
                />
              </FormField>
              <FormField label="默认目的国" hint="创建新合同时自动带入；贸易客户的单份合同仍可修改为实际目的国。">
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="如 巴西 / 德国"
                  className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink"
                />
              </FormField>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="默认失效年限" hint="用于新建联系单时自动推算失效月份。">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={expiryYears}
                    onChange={(e) => setExpiryYears(parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink"
                  />
                </FormField>
                <div className="flex flex-col justify-end pb-1">
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 text-body select-none">
                    <input
                      type="checkbox"
                      checked={isStaggeredMonth}
                      onChange={(e) => setIsStaggeredMonth(e.target.checked)}
                      className="rounded border-slate-800 text-brand-cyan focus:ring-brand-cyan"
                    />
                    <span>默认计算错月</span>
                  </label>
                </div>
              </div>

              <FormField label="默认货币" hint="创建新合同时自动带入，单份合同仍可临时调整。">
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-muted p-1" role="group" aria-label="默认货币">
                  {(['USD', 'RMB'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={defaultCurrency === option}
                      onClick={() => setDefaultCurrency(option)}
                      className={`rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                        defaultCurrency === option
                          ? 'border-brand-cyan/40 bg-brand-cyan/15 text-brand-cyan'
                          : 'border-transparent text-muted hover:bg-surface hover:text-ink'
                      }`}
                    >
                      {option === 'USD' ? 'USD 美元' : 'RMB 人民币'}
                    </button>
                  ))}
                </div>
              </FormField>

              <FormField label="默认付款条款">
                <input
                  type="text"
                  value={defaultPaymentTerms}
                  onChange={(e) => setDefaultPaymentTerms(e.target.value)}
                  placeholder="如 30% 预付 + 70% 发货前付清"
                  className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink"
                />
              </FormField>

              <FormField label="备注说明">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="历史合作详情等..."
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink"
                />
              </FormField>

              <div className="pt-4 flex justify-end gap-3 text-sm">
                <Button
                  type="button"
                  onClick={() => setShowModal(false)}
                  tone="secondary"
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? '保存中...' : '确认保存'}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {mergeSource && (
        <Dialog onClose={() => !isMerging && setMergeSourceId('')} ariaLabel="合并重复客户档案">
          <div className="dialog-panel w-full max-w-2xl space-y-6 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">合并重复客户</h3>
                <p className="mt-1 text-xs text-muted">把重复档案的全部业务关联迁移到正确档案，再删除重复档案。</p>
              </div>
              <IconButton
                onClick={() => setMergeSourceId('')}
                disabled={isMerging}
                label="关闭客户合并窗口"
                icon={<X className="h-5 w-5" />}
              />
            </div>

            {operationError && <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">{operationError}</div>}

            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <FormField label="待合并并删除的档案">
                <div className="min-h-10 rounded-[10px] border border-brand-rose/20 bg-brand-rose/5 px-3.5 py-2.5 text-sm font-semibold text-ink">
                  {mergeSource.name}
                </div>
              </FormField>
              <ArrowRight className="mb-3 hidden h-5 w-5 text-brand-amber sm:block" />
              <FormField label="最终保留的客户档案" required>
                <CustomerSelect
                  value={mergeTargetId}
                  onChange={setMergeTargetId}
                  customers={customers.filter((customer) => customer.id !== mergeSource.id && customer.owner_id === mergeSource.owner_id)}
                  describeCustomer={(customer) => `${customer.owner_display_name} · ${customer.country || '未知国家'} · ${customer.default_currency}`}
                  ariaLabel="选择合并后保留的客户"
                  placeholder="搜索并选择正确客户"
                  searchPlaceholder="输入客户名称实时筛选"
                />
              </FormField>
            </div>

            <div className="rounded-xl border border-border bg-surface-muted/55 p-4">
              <div className="text-xs font-semibold text-ink">本次迁移范围</div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-surface px-2 py-3"><div className="text-lg font-bold text-ink">{mergeReferences?.contracts || 0}</div><div className="text-[10px] text-muted">合同</div></div>
                <div className="rounded-lg bg-surface px-2 py-3"><div className="text-lg font-bold text-ink">{mergeReferences?.paymentReceipts || 0}</div><div className="text-[10px] text-muted">整单收款</div></div>
                <div className="rounded-lg bg-surface px-2 py-3"><div className="text-lg font-bold text-ink">{mergeReferences?.shipmentGroups || 0}</div><div className="text-[10px] text-muted">整单发货</div></div>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-muted">联系单、收款分摊、发货明细和发票会沿现有合同及发货关联继续归属于正确客户；保留档案的名称、国家、默认货币和付款条款不会被覆盖。</p>
            </div>

            <div className="flex justify-end gap-3">
              <Button tone="secondary" onClick={() => setMergeSourceId('')} disabled={isMerging}>取消</Button>
              <Button tone="danger" onClick={handleMerge} disabled={isMerging || !mergeTargetId} icon={<GitMerge className="h-4 w-4" />}>
                {isMerging ? '正在合并…' : '迁移关联并合并'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
