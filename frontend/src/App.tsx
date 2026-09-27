import { useState, useEffect, useMemo } from 'react';
import { initDataStore, db } from './services/dataStore';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { lazy, Suspense } from 'react';
import { formatLocalMonth } from './services/dateUtils';
import { LoaderCircle } from 'lucide-react';
import { getCurrentAccountIdentity, IS_PUBLIC_DEMO } from './services/localClient';
import { loadCustomerDisplayOrder } from './services/customerOrdering';

const loadDashboard = () => import('./pages/Dashboard');
// The dashboard is preloaded alongside business data; other workspaces still load on demand.
const Dashboard = lazy(() => loadDashboard().then((module) => ({ default: module.Dashboard })));
const ContactSheets = lazy(() => import('./pages/ContactSheets').then((module) => ({ default: module.ContactSheets })));
const Contracts = lazy(() => import('./pages/Contracts').then((module) => ({ default: module.Contracts })));
const Batches = lazy(() => import('./pages/Batches').then((module) => ({ default: module.Batches })));
const Shipments = lazy(() => import('./pages/Shipments').then((module) => ({ default: module.Shipments })));
const Payments = lazy(() => import('./pages/Payments').then((module) => ({ default: module.Payments })));
const Profit = lazy(() => import('./pages/Profit').then((module) => ({ default: module.Profit })));
const Analytics = lazy(() => import('./pages/Analytics').then((module) => ({ default: module.Analytics })));
const CustomerOperatingAnalysis = lazy(() => import('./pages/CustomerOperatingAnalysis').then((module) => ({ default: module.CustomerOperatingAnalysis })));
const CustomerProductAnalysis = lazy(() => import('./pages/CustomerProductAnalysis').then((module) => ({ default: module.CustomerProductAnalysis })));
const ProductOperatingAnalysis = lazy(() => import('./pages/ProductOperatingAnalysis').then((module) => ({ default: module.ProductOperatingAnalysis })));
const Customers = lazy(() => import('./pages/Customers').then((module) => ({ default: module.Customers })));
const ProductMasterData = lazy(() => import('./pages/ProductMasterData').then((module) => ({ default: module.ProductMasterData })));
const PackagingMasterData = lazy(() => import('./pages/PackagingMasterData').then((module) => ({ default: module.PackagingMasterData })));
const Alerts = lazy(() => import('./pages/Alerts').then((module) => ({ default: module.Alerts })));
const Exports = lazy(() => import('./pages/Exports').then((module) => ({ default: module.Exports })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));

let appBootstrapPromise: Promise<void> | null = null;

function bootstrapApplication() {
  if (!appBootstrapPromise) {
    appBootstrapPromise = Promise.all([initDataStore(), loadDashboard(), loadCustomerDisplayOrder()]).then(() => undefined);
  }
  return appBootstrapPromise;
}

function App() {
  const [currentTab, setTab] = useState('dashboard');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('trade-dashboard-sidebar-collapsed') === '1');

  useEffect(() => {
    localStorage.setItem('trade-dashboard-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  // Initialize local SQLite-backed data cache
  useEffect(() => {
    let active = true;
    bootstrapApplication()
      .catch((error) => console.error(error))
      .finally(() => {
        if (!active) return;
        setRefreshTrigger(prev => prev + 1);
        setIsBootstrapping(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Memoize counts to avoid redundant calculations
  const stats = useMemo(() => {
    void refreshTrigger;
    const alertsList = db.getAlerts().filter(a => a.status === '未处理');

    const currentMonth = formatLocalMonth();
    const rates = db.getExchangeRates();
    const activeRate = rates.find(r => r.effective_month === currentMonth)?.rate || null;

    return {
      alertCount: alertsList.length,
      currentRate: activeRate,
      currentRateMonth: currentMonth
    };
  }, [refreshTrigger]);

  const dataLoadError = useMemo(() => {
    void refreshTrigger;
    const error = db.getLastLoadError();
    return error;
  }, [refreshTrigger]);

  const accountIdentity = useMemo(() => {
    void refreshTrigger;
    return getCurrentAccountIdentity();
  }, [refreshTrigger]);

  // Tab page switcher mapping
  const renderPage = () => {
    switch (currentTab) {
      case 'dashboard':
        return <Dashboard onNavigate={setTab} onRefreshTrigger={refreshTrigger} />;
      case 'contact_sheets':
        return <ContactSheets onNavigate={setTab} onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'contracts':
        return <Contracts onNavigate={setTab} onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'batches':
        return <Batches onNavigate={setTab} onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'shipments':
        return <Shipments onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'payments':
        return <Payments onNavigate={setTab} onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'payments_balance':
        return <Payments initialView="balance" onNavigate={setTab} onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'invoices':
        return <Shipments onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'profit':
        return <Profit onRefreshTrigger={refreshTrigger} />;
      case 'analytics':
        return <Analytics onNavigate={setTab} onRefreshTrigger={refreshTrigger} />;
      case 'analytics_customer_value':
        return <CustomerOperatingAnalysis onNavigate={setTab} onRefreshTrigger={refreshTrigger} />;
      case 'analytics_customer_product':
        return <CustomerProductAnalysis onNavigate={setTab} onRefreshTrigger={refreshTrigger} />;
      case 'analytics_product_operating':
        return <ProductOperatingAnalysis onNavigate={setTab} onRefreshTrigger={refreshTrigger} />;
      case 'customers':
        return <Customers onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'product_master_data':
        return <ProductMasterData />;
      case 'packaging_master_data':
        return <PackagingMasterData />;
      case 'alerts':
        return <Alerts onNavigate={setTab} onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      case 'exports':
        return <Exports onRefreshTrigger={refreshTrigger} />;
      case 'settings':
        return <Settings onRefreshData={handleRefreshData} onRefreshTrigger={refreshTrigger} />;
      default:
        return <Dashboard onNavigate={setTab} onRefreshTrigger={refreshTrigger} />;
    }
  };

  // Header Title mapping
  const getHeaderTitle = () => {
    switch (currentTab) {
      case 'dashboard': return '经营驾驶舱';
      case 'contact_sheets': return '联系单业务执行进度';
      case 'contracts': return '销售合同目录';
      case 'batches': return '批次异常与差异';
      case 'shipments': return '发货与开票管理';
      case 'payments': return '收款流水明细';
      case 'payments_balance': return '客户货款平衡中心';
      case 'invoices': return '发货与开票管理';
      case 'profit': return '财务毛利统计表';
      case 'analytics': return '数据分析中心';
      case 'analytics_customer_value': return '客户经营分析';
      case 'analytics_customer_product': return '客户产品分析';
      case 'analytics_product_operating': return '产品经营分析';
      case 'customers': return '客户主数据';
      case 'product_master_data': return '产品主数据';
      case 'packaging_master_data': return '包装主数据';
      case 'alerts': return '异常风险通报';
      case 'exports': return '导出中心';
      case 'settings': return IS_PUBLIC_DEMO ? '演示设置与汇报' : '本地设置与汇报';
      default: return '外贸个人驾驶舱';
    }
  };

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-6 text-body">
        <div className="flex flex-col items-center text-center">
          <img
            src="/brand/trade-tracker-mark.svg"
            alt="个人订单驾驶舱"
            className="mb-4 h-16 w-16"
          />
          <LoaderCircle className="h-7 w-7 animate-spin text-brand-cyan" />
          <div className="mt-4 text-sm font-semibold text-ink">正在载入业务数据</div>
          <div className="mt-1 text-xs text-muted">数据准备好后再显示首页，避免出现前后两套状态。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-page text-body">
      {/* Navigation sidebar */}
      <Sidebar
        currentTab={
          currentTab === 'payments_balance'
            ? 'payments'
            : currentTab.startsWith('analytics_')
              ? 'analytics'
              : currentTab
        }
        setTab={setTab}
        alertCount={stats.alertCount}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />

      {/* Main panel layout container */}
      <div className={`min-w-0 flex-1 flex flex-col min-h-screen transition-[padding] duration-300 ${sidebarCollapsed ? 'pl-20' : 'pl-64'}`}>
        {/* Top Header info and sync buttons */}
        <Header
          title={getHeaderTitle()}
          currentRate={stats.currentRate}
          currentRateMonth={stats.currentRateMonth}
          onRefreshData={handleRefreshData}
          onNavigate={setTab}
          sidebarCollapsed={sidebarCollapsed}
        />

        {/* Dynamic page contents wrapper */}
        <main className="mt-14 min-w-0 flex-1 overflow-y-auto p-6 2xl:p-8">
          {accountIdentity?.isReadOnly && (
            <div role="status" className="mb-5 rounded-lg border border-brand-cyan/25 bg-brand-cyan/10 px-4 py-3 text-xs text-brand-cyan">
              {IS_PUBLIC_DEMO
                ? '当前为公网只读沙箱：可以切换虚构身份、浏览全部业务页面并下载演示报表；编辑、重置和实际消息发送已关闭。'
                : '当前为上级只读视图：可查看授权成员及合并汇总，不能新增、修改、删除或触发自动写库。'}
            </div>
          )}
          {dataLoadError && (
            <div role="alert" className="mb-5 rounded-lg border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
              演示数据提示：{dataLoadError}
            </div>
          )}
          <Suspense fallback={<div className="py-16 text-center text-sm text-muted">正在加载业务页面…</div>}>
            {renderPage()}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default App;
