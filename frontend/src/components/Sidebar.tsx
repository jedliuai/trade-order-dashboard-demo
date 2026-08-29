import React from 'react';
import {
  LayoutDashboard,
  Users,
  FileText,
  ClipboardList,
  CreditCard,
  Truck,
  TrendingUp,
  AlertTriangle,
  Download,
  Settings,
  BarChart2,
  PackageSearch,
  Boxes,
  ChevronLeft,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';
import { ColorIconBadge, type ColorIconTone } from './ColorIconBadge';

interface SidebarProps {
  currentTab: string;
  setTab: (tab: string) => void;
  alertCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface MenuItem {
  id: string;
  name: string;
  icon: LucideIcon;
  tone: ColorIconTone;
  badge?: number;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, setTab, alertCount, collapsed, onToggleCollapsed }) => {
  const menuGroups: MenuGroup[] = [
    {
      label: '总览',
      items: [
        { id: 'dashboard', name: '首页面板', icon: LayoutDashboard, tone: 'amber' },
        { id: 'alerts', name: '提醒中心', icon: AlertTriangle, tone: 'rose', badge: alertCount }
      ]
    },
    {
      label: '订单履约',
      items: [
        { id: 'contracts', name: '合同管理', icon: FileText, tone: 'blue' },
        { id: 'contact_sheets', name: '联系单管理', icon: ClipboardList, tone: 'purple' },
        { id: 'shipments', name: '发货与开票', icon: Truck, tone: 'green' }
      ]
    },
    {
      label: '财务管理',
      items: [
        { id: 'payments', name: '收款流水', icon: CreditCard, tone: 'teal' },
        { id: 'profit', name: '利润分析', icon: TrendingUp, tone: 'amber' }
      ]
    },
    {
      label: '分析与资料',
      items: [
        { id: 'analytics', name: '数据分析中心', icon: BarChart2, tone: 'purple' },
        { id: 'exports', name: '导出中心', icon: Download, tone: 'blue' }
      ]
    },
    {
      label: '基础主数据',
      items: [
        { id: 'customers', name: '客户档案', icon: Users, tone: 'teal' },
        { id: 'product_master_data', name: '产品主数据', icon: PackageSearch, tone: 'blue' },
        { id: 'packaging_master_data', name: '包装主数据', icon: Boxes, tone: 'green' }
      ]
    },
    {
      label: '系统',
      items: [
        { id: 'settings', name: '系统设置', icon: Settings, tone: 'slate' }
      ]
    }
  ];

  return (
    <aside className={`${collapsed ? 'w-20' : 'w-64'} fixed left-0 top-0 z-20 flex h-screen flex-col border-r border-border bg-surface-muted/95 backdrop-blur-xl transition-[width] duration-300`}>
      {/* Brand Header */}
      <div className={`relative flex h-14 items-center border-b border-border ${collapsed ? 'justify-center px-3' : 'px-6'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/brand/trade-tracker-app-icon.svg"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 shrink-0 rounded-[10px] shadow-sm"
          />
          {!collapsed && <div className="min-w-0">
            <h1 className="font-heading text-sm font-semibold leading-tight text-ink">个人订单驾驶舱</h1>
            <span className="text-[10px] tracking-wider text-subtle">TRADE TRACKER V1.0</span>
          </div>}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          className="absolute -right-3 top-4 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-subtle shadow-sm transition-colors hover:border-brand-cyan/40 hover:text-brand-cyan"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Nav List */}
      <nav aria-label="主导航" className={`flex-1 overflow-y-auto py-4 ${collapsed ? 'px-2' : 'px-4'}`}>
        <div className="space-y-4">
          {menuGroups.map((group, groupIndex) => (
            <div key={group.label} className={`${collapsed && groupIndex > 0 ? 'border-t border-border/70 pt-3' : ''} space-y-1`}>
              {!collapsed && (
                <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.name}
                    title={collapsed ? item.name : undefined}
                    className={`relative w-full flex items-center rounded-lg py-2.5 text-sm transition-all duration-200 group text-left ${
                      collapsed ? 'justify-center px-2' : 'justify-between px-4'
                    } ${
                      isActive
                        ? 'bg-brand-cyan/15 border border-brand-cyan/25 text-brand-cyan font-bold shadow-sm'
                        : 'border border-transparent text-muted hover:bg-surface/70 hover:text-body'
                    }`}
                  >
                    <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
                      <ColorIconBadge tone={item.tone} size="xs" className="transition-transform duration-200 group-hover:scale-105">
                        <Icon className="h-3.5 w-3.5" />
                      </ColorIconBadge>
                      {!collapsed && <span>{item.name}</span>}
                    </div>

                    {item.badge !== undefined && item.badge > 0 && (
                      <span className={`${collapsed ? 'absolute -right-0.5 -top-1 min-w-5 px-1' : 'px-2'} py-0.5 text-[10px] font-bold rounded-full bg-brand-rose/25 text-brand-rose border border-brand-rose/20 animate-pulse-slow text-center`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* Brand Foot */}
      <div className={`${collapsed ? 'px-3 py-4' : 'p-4'} border-t border-border bg-surface-muted/40`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`} title={collapsed ? '个人订单驾驶舱' : undefined}>
          <img
            src="/brand/trade-tracker-mark.svg"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 shrink-0"
          />
          {!collapsed && <div className="min-w-0">
            <div className="text-xs font-semibold text-body">订单工作台</div>
            <div className="text-[10px] tracking-[0.14em] text-subtle">TRADE TRACKER</div>
          </div>}
        </div>
      </div>
    </aside>
  );
};
