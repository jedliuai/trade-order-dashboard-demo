import React, { useEffect, useRef, useState } from 'react';
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
  X,
  type LucideIcon
} from 'lucide-react';
import { ColorIconBadge, type ColorIconTone } from './ColorIconBadge';

interface SidebarProps {
  currentTab: string;
  setTab: (tab: string) => void;
  alertCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
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

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, setTab, alertCount, collapsed, onToggleCollapsed, mobileOpen, onMobileClose }) => {
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (isDesktop) {
      if (mobileOpen) onMobileClose();
      return;
    }
    if (!mobileOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => mobileCloseRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onMobileClose();
        return;
      }
      if (event.key !== 'Tab' || !sidebarRef.current || window.innerWidth >= 1024) return;
      const focusable = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [isDesktop, mobileOpen, onMobileClose]);

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
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="关闭主导航"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
        />
      )}
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        role={!isDesktop ? 'dialog' : undefined}
        aria-modal={!isDesktop && mobileOpen ? true : undefined}
        aria-label="主导航面板"
        aria-hidden={!isDesktop && !mobileOpen ? true : undefined}
        inert={!isDesktop && !mobileOpen ? true : undefined}
        className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-border bg-surface-muted/95 backdrop-blur-xl transition-[width,transform] duration-300 lg:z-20 lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'lg:w-20' : 'lg:w-64'}`}
      >
      {/* Brand Header */}
      <div className={`relative flex h-14 items-center border-b border-border px-6 ${collapsed ? 'lg:justify-center lg:px-3' : ''}`}>
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/brand/trade-tracker-app-icon.svg"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 shrink-0 rounded-[10px] shadow-sm"
          />
          <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
            <h1 className="font-heading text-sm font-semibold leading-tight text-ink">个人订单驾驶舱</h1>
            <span className="text-[10px] tracking-wider text-subtle">TRADE TRACKER V1.0</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          className="absolute -right-3 top-4 z-30 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-subtle shadow-sm transition-colors hover:border-brand-cyan/40 hover:text-brand-cyan lg:flex"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
        <button
          ref={mobileCloseRef}
          type="button"
          onClick={onMobileClose}
          aria-label="关闭主导航"
          className="absolute right-4 top-3 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:text-ink lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Nav List */}
      <nav aria-label="主导航" className={`flex-1 overflow-y-auto px-4 py-4 ${collapsed ? 'lg:px-2' : ''}`}>
        <div className="space-y-4">
          {menuGroups.map((group, groupIndex) => (
            <div key={group.label} className={`${collapsed && groupIndex > 0 ? 'lg:border-t lg:border-border/70 lg:pt-3' : ''} space-y-1`}>
              <div className={`px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle ${collapsed ? 'lg:hidden' : ''}`}>
                  {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setTab(item.id);
                      onMobileClose();
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.name}
                    title={collapsed ? item.name : undefined}
                    className={`group relative flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-left text-sm transition-all duration-200 ${collapsed ? 'lg:justify-center lg:px-2' : ''} ${
                      isActive
                        ? 'bg-brand-cyan/15 border border-brand-cyan/25 text-brand-cyan font-bold shadow-sm'
                        : 'border border-transparent text-muted hover:bg-surface/70 hover:text-body'
                    }`}
                  >
                    <div className={`flex items-center gap-3 ${collapsed ? 'lg:justify-center lg:gap-0' : ''}`}>
                      <ColorIconBadge tone={item.tone} size="xs" className="transition-transform duration-200 group-hover:scale-105">
                        <Icon className="h-3.5 w-3.5" />
                      </ColorIconBadge>
                      <span className={collapsed ? 'lg:hidden' : ''}>{item.name}</span>
                    </div>

                    {item.badge !== undefined && item.badge > 0 && (
                      <span className={`min-w-5 rounded-full border border-brand-rose/20 bg-brand-rose/25 px-2 py-0.5 text-center text-[10px] font-bold text-brand-rose animate-pulse-slow ${collapsed ? 'lg:absolute lg:-right-0.5 lg:-top-1 lg:px-1' : ''}`}>
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
      <div className={`border-t border-border bg-surface-muted/40 p-4 ${collapsed ? 'lg:px-3 lg:py-4' : ''}`}>
        <div className={`flex items-center gap-3 ${collapsed ? 'lg:justify-center lg:gap-0' : ''}`} title={collapsed ? '个人订单驾驶舱' : undefined}>
          <img
            src="/brand/trade-tracker-mark.svg"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 shrink-0"
          />
          <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="text-xs font-semibold text-body">订单工作台</div>
            <div className="text-[10px] tracking-[0.14em] text-subtle">TRADE TRACKER</div>
          </div>
        </div>
      </div>
      </aside>
    </>
  );
};
