import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, RotateCcw, Search } from 'lucide-react';
import type { Customer } from '../services/dataStore';
import {
  CUSTOMER_ORDER_CHANGED_EVENT,
  loadCustomerDisplayOrder,
  readCustomerDisplayOrder,
  saveCustomerDisplayOrder,
  sortCustomersForDisplay
} from '../services/customerOrdering';
import { Button } from './Button';
import { IconButton } from './IconButton';

interface CustomerOrderManagerProps {
  customers: Customer[];
}

export function CustomerOrderManager({ customers }: CustomerOrderManagerProps) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState(() => readCustomerDisplayOrder());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const orderedCustomers = useMemo(() => sortCustomersForDisplay(customers, order), [customers, order]);
  const visibleCustomers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return orderedCustomers;
    return orderedCustomers.filter((customer) => `${customer.name} ${customer.country}`.toLocaleLowerCase().includes(normalized));
  }, [orderedCustomers, query]);

  useEffect(() => {
    const handleOrderChange = () => setOrder(readCustomerDisplayOrder());
    window.addEventListener(CUSTOMER_ORDER_CHANGED_EVENT, handleOrderChange);
    void loadCustomerDisplayOrder().catch((error) => {
      setSaveError(error instanceof Error ? error.message : String(error));
    });
    return () => window.removeEventListener(CUSTOMER_ORDER_CHANGED_EVENT, handleOrderChange);
  }, []);

  const persistOrder = async (nextOrder: string[]) => {
    const previousOrder = order;
    setOrder(nextOrder);
    setIsSaving(true);
    setSaveError('');
    try {
      await saveCustomerDisplayOrder(nextOrder);
    } catch (error) {
      setOrder(previousOrder);
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const moveCustomer = (customerId: string, direction: -1 | 1) => {
    const current = orderedCustomers.map((customer) => customer.id);
    const index = current.indexOf(customerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
    void persistOrder(current);
  };

  const moveCustomerToEdge = (customerId: string, edge: 'top' | 'bottom') => {
    const current = orderedCustomers.map((customer) => customer.id).filter((id) => id !== customerId);
    if (edge === 'top') current.unshift(customerId);
    else current.push(customerId);
    void persistOrder(current);
  };

  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-sm font-bold text-ink">客户下拉展示顺序</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted">顺序保存在这台电脑的演示数据库中，刷新后仍会保留；不会修改客户 ID、合同关联或历史业务数据。</p>
        </div>
        <Button
          tone="secondary"
          size="sm"
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          onClick={() => void persistOrder([])}
          disabled={isSaving}
        >
          恢复名称排序
        </Button>
      </div>
      {saveError && (
        <div role="alert" className="mt-3 rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-3 py-2 text-xs text-brand-rose">
          {saveError}
        </div>
      )}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索客户后调整位置"
          className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-ink"
        />
      </div>
      <div className="mt-3 max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-surface">
        {visibleCustomers.map((customer) => {
          const absoluteIndex = orderedCustomers.findIndex((item) => item.id === customer.id);
          return (
            <div key={customer.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-7 shrink-0 text-center text-[11px] font-semibold text-subtle">{absoluteIndex + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{customer.name}</span>
                <span className="block truncate text-[10px] text-muted">{customer.country || '未设置国家'}</span>
              </span>
              <IconButton
                label={`直接置顶 ${customer.name}`}
                icon={<ArrowUpToLine className="h-3.5 w-3.5" />}
                onClick={() => moveCustomerToEdge(customer.id, 'top')}
                disabled={isSaving || absoluteIndex <= 0}
              />
              <IconButton
                label={`上移 ${customer.name}`}
                icon={<ArrowUp className="h-3.5 w-3.5" />}
                onClick={() => moveCustomer(customer.id, -1)}
                disabled={isSaving || absoluteIndex <= 0}
              />
              <IconButton
                label={`下移 ${customer.name}`}
                icon={<ArrowDown className="h-3.5 w-3.5" />}
                onClick={() => moveCustomer(customer.id, 1)}
                disabled={isSaving || absoluteIndex >= orderedCustomers.length - 1}
              />
              <IconButton
                label={`直接移到底部 ${customer.name}`}
                icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
                onClick={() => moveCustomerToEdge(customer.id, 'bottom')}
                disabled={isSaving || absoluteIndex >= orderedCustomers.length - 1}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
