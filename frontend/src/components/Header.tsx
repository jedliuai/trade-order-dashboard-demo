import React, { useState } from 'react';
import { RefreshCw, Database, TrendingUp, Settings2 } from 'lucide-react';
import { initDataStore } from '../services/dataStore';
import { DEMO_ACCOUNTS, getLocalSession, IS_PUBLIC_DEMO, setDemoAccount } from '../services/localClient';
import { useFeedback } from './FeedbackProvider';

interface HeaderProps {
  title: string;
  currentRate: number | null;
  currentRateMonth: string;
  onRefreshData: () => void;
  onNavigate: (tab: string) => void;
  sidebarCollapsed?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ title, currentRate, currentRateMonth, onRefreshData, onNavigate, sidebarCollapsed = false }) => {
  const [refreshing, setRefreshing] = useState(false);
  const { notify } = useFeedback();
  const refresh = async () => {
    setRefreshing(true);
    try {
      await initDataStore(true);
      onRefreshData();
    } catch (error) {
      notify({ title: '演示数据刷新失败', message: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally { setRefreshing(false); }
  };
  return (
    <header className={`fixed right-0 top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/95 px-6 backdrop-blur transition-[left] ${sidebarCollapsed ? 'left-20' : 'left-64'}`}>
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-sm font-semibold text-ink">{title}</h1>
        <span className="hidden items-center gap-1.5 rounded-full border border-brand-emerald/20 bg-brand-emerald/10 px-2.5 py-1 text-[10px] font-semibold text-brand-emerald xl:flex">
          <Database className="h-3 w-3" />{IS_PUBLIC_DEMO ? '公网只读演示' : '本地演示'} · 全部虚构
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <span className="hidden items-center gap-1.5 text-muted 2xl:flex" title={`${currentRateMonth} 演示汇率，不代表实时市场价格`}>
          <TrendingUp className="h-3.5 w-3.5" />USD/CNY {currentRate?.toFixed(4) || '未配置'}
        </span>
        <select aria-label="切换演示身份" value={getLocalSession().user.id} onChange={event => {
          setDemoAccount(event.target.value);
          window.location.reload();
        }} className="max-w-48 rounded-lg border border-border bg-surface px-2 py-2 text-body">
          {DEMO_ACCOUNTS.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-body hover:bg-surface-muted disabled:opacity-50" title={IS_PUBLIC_DEMO ? '重新读取演示快照' : '重新读取本地数据库'}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '读取中' : '刷新数据'}
        </button>
        <button type="button" onClick={() => onNavigate('settings')} aria-label="演示设置与汇报" className="rounded-lg p-2 text-muted hover:bg-surface-muted"><Settings2 className="h-4 w-4" /></button>
      </div>
    </header>
  );
};
