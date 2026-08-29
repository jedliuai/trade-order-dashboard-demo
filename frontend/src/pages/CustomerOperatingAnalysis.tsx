import { lazy, Suspense, useCallback, useState } from 'react';
import { Activity, ArrowLeft, ChartNoAxesCombined, Grid2X2, LoaderCircle, TrendingUp } from 'lucide-react';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';

const CustomerValueMatrix = lazy(() => import('./CustomerValueMatrix').then((module) => ({ default: module.CustomerValueMatrix })));
const CustomerConcentrationTab = lazy(() => import('./customer-operating/CustomerConcentrationTab').then((module) => ({ default: module.CustomerConcentrationTab })));
const CustomerActivityTab = lazy(() => import('./customer-operating/CustomerActivityTab').then((module) => ({ default: module.CustomerActivityTab })));

type CustomerOperatingTab = 'value' | 'concentration' | 'activity';

interface CustomerOperatingAnalysisProps {
  onNavigate: (tab: string) => void;
  onRefreshTrigger: number;
}

const tabs: Array<{
  id: CustomerOperatingTab;
  label: string;
  description: string;
  icon: typeof Grid2X2;
}> = [
  { id: 'value', label: '客户价值矩阵', description: '回款、利润与活跃度四象限', icon: Grid2X2 },
  { id: 'concentration', label: '客户集中度', description: '贡献排名与 80% 帕累托', icon: ChartNoAxesCombined },
  { id: 'activity', label: '客户活跃度', description: '实际发货与合作状态', icon: Activity }
];

function TabLoading() {
  return (
    <div className="glass-panel flex min-h-64 items-center justify-center rounded-2xl text-sm text-muted">
      <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-brand-cyan" /> 正在载入客户分析
    </div>
  );
}

export function CustomerOperatingAnalysis({ onNavigate, onRefreshTrigger }: CustomerOperatingAnalysisProps) {
  const [activeTab, setActiveTab] = useState<CustomerOperatingTab>('value');
  const openCustomer = useCallback((customerId: string) => {
    sessionStorage.setItem('analytics-selected-customer', customerId);
    onNavigate('analytics_customer_product');
  }, [onNavigate]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-8">
      <PageHeader
        title="客户经营分析"
        description="沿用统一的实际发货、实际回款和已确认利润口径，分开查看客户价值、贡献集中度与合作活跃状态。"
        leading={(
          <button
            type="button"
            onClick={() => onNavigate('analytics')}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 返回数据分析中心
          </button>
        )}
        actions={(
          <Button
            tone="secondary"
            icon={<TrendingUp className="h-4 w-4" />}
            onClick={() => onNavigate('analytics_customer_product')}
          >
            客户产品分析
          </Button>
        )}
      />

      <nav className="glass-panel grid gap-2 rounded-2xl p-2 md:grid-cols-3" role="tablist" aria-label="客户经营分析页签">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`customer-operating-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`customer-operating-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                selected
                  ? 'border-brand-cyan/35 bg-brand-cyan/10 text-ink shadow-sm'
                  : 'border-transparent text-muted hover:border-border hover:bg-surface-muted hover:text-ink'
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-surface-muted text-subtle'}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted">{tab.description}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <section
        id={`customer-operating-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`customer-operating-tab-${activeTab}`}
        aria-label={tabs.find((tab) => tab.id === activeTab)?.label}
      >
        <Suspense fallback={<TabLoading />}>
          {activeTab === 'value' && (
            <CustomerValueMatrix embedded onNavigate={onNavigate} onRefreshTrigger={onRefreshTrigger} />
          )}
          {activeTab === 'concentration' && (
            <CustomerConcentrationTab onOpenCustomer={openCustomer} onRefreshTrigger={onRefreshTrigger} />
          )}
          {activeTab === 'activity' && (
            <CustomerActivityTab onOpenCustomer={openCustomer} onRefreshTrigger={onRefreshTrigger} />
          )}
        </Suspense>
      </section>
    </div>
  );
}
