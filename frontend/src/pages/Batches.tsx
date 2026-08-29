import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheckBig,
  Edit2,
  History,
  Layers,
  ListTree,
  Search,
  X
} from 'lucide-react';
import { db } from '../services/dataStore';
import type { Batch } from '../services/dataStore';
import { formatLocalDate } from '../services/dateUtils';
import { resolveBatchTracking, validateBatchProgressDates } from '../services/batchTracking';
import { summarizeBatchWorkspace } from '../services/batchWorkspace';
import { FilterPanel, PageHeader } from '../components/PageHeader';
import { IconButton } from '../components/IconButton';
import { ColorIconBadge } from '../components/ColorIconBadge';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { PaginationControls } from '../components/PaginationControls';
import { usePagedRows } from '../hooks/usePagedRows';

interface BatchesProps {
  onNavigate: (tab: string) => void;
  onRefreshData: () => void;
  onRefreshTrigger: number;
}

type BatchView = 'attention' | 'active' | 'history';

export const Batches: React.FC<BatchesProps> = ({ onNavigate, onRefreshData, onRefreshTrigger }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<BatchView>('attention');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [warehouseDate, setWarehouseDate] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [editError, setEditError] = useState('');
  const [operationError, setOperationError] = useState('');

  const data = useMemo(() => {
    void onRefreshTrigger;
    return {
      batches: db.getBatches(),
      contactSheets: db.getContactSheets()
    };
  }, [onRefreshTrigger]);

  const today = formatLocalDate();
  const trackedBatches = useMemo(() => {
    const sheetById = new Map(data.contactSheets.map((sheet) => [sheet.id, sheet]));
    return data.batches.map((batch) => {
      const sheet = sheetById.get(batch.contact_sheet_id);
      const tracking = resolveBatchTracking({
        batchNo: batch.batch_no,
        productName: batch.product_name,
        productionDate: batch.production_date,
        expiryDate: batch.expiry_date,
        warehouseDate: batch.warehouse_date,
        releaseDate: batch.release_date,
        apsScheduledDate: sheet?.aps_scheduled_date,
        estimatedReleaseDate: sheet?.estimated_release_date
      }, today);
      return { batch, sheet, tracking };
    });
  }, [data.batches, data.contactSheets, today]);

  const groups = useMemo(() => {
    const summaries = summarizeBatchWorkspace(trackedBatches.map(({ batch, sheet, tracking }) => ({
      id: batch.id,
      contactSheetId: batch.contact_sheet_id,
      phase: tracking.phase,
      severity: tracking.severity,
      batchQuantity: batch.batch_quantity,
      warehouseDate: batch.warehouse_date || '',
      releaseDate: batch.release_date || '',
      sheetWarehouseDate: sheet?.actual_warehousing_date || '',
      sheetReleaseDate: sheet?.actual_release_date || ''
    })));
    const trackedById = new Map(trackedBatches.map((item) => [item.batch.id, item]));
    const sheetById = new Map(data.contactSheets.map((sheet) => [sheet.id, sheet]));
    return summaries.map((summary) => ({
      ...summary,
      sheet: sheetById.get(summary.contactSheetId),
      items: summary.batchIds.map((id) => trackedById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item))
    })).sort((left, right) => {
      if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1;
      if (left.maxSeverity !== right.maxSeverity) return right.maxSeverity - left.maxSeverity;
      return (left.sheet?.contact_sheet_no || '').localeCompare(right.sheet?.contact_sheet_no || '', 'zh-CN');
    });
  }, [trackedBatches, data.contactSheets]);

  const counts = useMemo(() => ({
    attention: groups.filter((group) => !group.allReleased && group.needsAttention).length,
    active: groups.filter((group) => !group.allReleased).length,
    divergent: groups.filter((group) => !group.allReleased && (group.hasPhaseDivergence || group.hasSheetDateMismatch)).length,
    history: groups.filter((group) => group.allReleased).length
  }), [groups]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return groups.filter((group) => {
      if (view === 'attention' && (group.allReleased || !group.needsAttention)) return false;
      if (view === 'active' && group.allReleased) return false;
      if (view === 'history' && !group.allReleased) return false;
      if (!query) return true;
      return [
        group.sheet?.contact_sheet_no,
        group.sheet?.contract_no,
        group.sheet?.material_no,
        group.sheet?.product_name,
        ...group.items.map((item) => item.batch.batch_no)
      ].some((value) => String(value || '').toLocaleLowerCase().includes(query));
    });
  }, [groups, searchQuery, view]);
  const batchGroupPage = usePagedRows(filteredGroups, `${view}|${searchQuery}`);

  const switchView = (nextView: BatchView) => {
    setView(nextView);
    setEditingId(null);
    setEditError('');
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleOpenContactSheet = (sheetId: string) => {
    const sheet = data.contactSheets.find((item) => item.id === sheetId);
    if (!sheet) return;
    sessionStorage.setItem('highlight_contact_sheet_id', sheet.id);
    sessionStorage.setItem('return_to_contract_id', sheet.contract_id);
    sessionStorage.setItem('return_to_contract_no', sheet.contract_no || '原合同');
    onNavigate('contact_sheets');
  };

  const handleStartEdit = (batch: Batch) => {
    setEditingId(batch.id);
    setWarehouseDate(batch.warehouse_date || '');
    setReleaseDate(batch.release_date || '');
    setNotes(batch.notes || '');
    setEditError('');
  };

  const handleSaveEdit = async (batch: Batch) => {
    const validationError = validateBatchProgressDates(warehouseDate, releaseDate);
    setEditError(validationError);
    if (validationError) return;
    setOperationError('');
    try {
      await db.updateBatch(batch.id, { warehouse_date: warehouseDate, release_date: releaseDate, notes });
      setEditingId(null);
      onRefreshData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title="批次异常与差异"
        description="联系单是日常主视图；这里只处理少数批次不同步、资料缺项或逾期情况"
      />

      {operationError && (
        <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">{operationError}</div>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-brand-cyan/20 bg-brand-cyan/[0.06] px-4 py-3 text-xs text-body">
        <CircleCheckBig className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
        <div><span className="font-semibold text-ink">这个页面不是第二套联系单。</span> 当同一联系单的各批次状态一致时，只显示一条汇总；只有存在差异或异常时，才需要展开逐批处理。</div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" onClick={() => switchView('attention')} className={`glass-panel flex items-center gap-3 p-4 text-left transition-colors ${view === 'attention' ? 'border-brand-rose/35 bg-brand-rose/5' : 'hover:border-brand-rose/25'}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-rose/10 text-brand-rose"><AlertTriangle className="h-5 w-5" /></span>
          <span><span className="block text-xl font-bold text-ink">{counts.attention}</span><span className="text-[11px] text-muted">需关注联系单</span></span>
        </button>
        <button type="button" onClick={() => switchView('active')} className={`glass-panel flex items-center gap-3 p-4 text-left transition-colors ${view === 'active' ? 'border-brand-cyan/35 bg-brand-cyan/5' : 'hover:border-brand-cyan/25'}`}>
          <ColorIconBadge tone="purple" size="md" shape="circle"><Layers className="h-5 w-5" /></ColorIconBadge>
          <span><span className="block text-xl font-bold text-ink">{counts.active}</span><span className="text-[11px] text-muted">进行中联系单</span></span>
        </button>
        <button type="button" onClick={() => switchView('attention')} className="glass-panel flex items-center gap-3 p-4 text-left transition-colors hover:border-brand-amber/25">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-amber/10 text-brand-amber"><ListTree className="h-5 w-5" /></span>
          <span><span className="block text-xl font-bold text-ink">{counts.divergent}</span><span className="text-[11px] text-muted">状态或日期不同步</span></span>
        </button>
        <button type="button" onClick={() => switchView('history')} className={`glass-panel flex items-center gap-3 p-4 text-left transition-colors ${view === 'history' ? 'border-brand-emerald/35 bg-brand-emerald/5' : 'hover:border-brand-emerald/25'}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-emerald/10 text-brand-emerald"><History className="h-5 w-5" /></span>
          <span><span className="block text-xl font-bold text-ink">{counts.history}</span><span className="text-[11px] text-muted">全部放行历史</span></span>
        </button>
      </div>

      <div className="glass-panel flex flex-col gap-3 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap rounded-lg bg-surface-muted p-1">
          {([
            ['attention', `需关注（${counts.attention}）`],
            ['active', `全部进行中（${counts.active}）`],
            ['history', `放行历史（${counts.history}）`]
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => switchView(id)} className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors ${view === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        <div className="px-2 text-[11px] text-muted">当前按联系单汇总，共显示 {filteredGroups.length} 组</div>
      </div>

      <FilterPanel>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input type="text" placeholder="搜索联系单号、合同号、物料、产品或具体批号" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm text-ink" />
        </div>
      </FilterPanel>

      <div className="space-y-3.5">
        {filteredGroups.length > 0 ? batchGroupPage.rows.map((group) => {
          const expanded = expandedGroups.has(group.contactSheetId);
          const firstTracking = group.items[0]?.tracking;
          const statusLabel = group.hasPhaseDivergence ? '批次进度不一致' : firstTracking?.label || '状态待确认';
          const statusTone = group.hasPhaseDivergence ? 'danger' : firstTracking?.tone || 'neutral';
          const risks = Array.from(new Set(group.items.flatMap((item) => item.tracking.risks.filter((risk) => risk.severity >= 2).map((risk) => risk.label))));
          return (
            <article key={group.contactSheetId} className={`overflow-hidden rounded-2xl border bg-surface shadow-sm ${group.needsAttention && !group.allReleased ? 'border-brand-amber/30' : 'border-border'}`}>
              <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
                      <span className="rounded-md border border-border bg-surface-muted px-2 py-1">合同 {group.sheet?.contract_no || group.items[0]?.batch.contract_no || '未关联'}</span>
                      <span className="rounded-md border border-border bg-surface-muted px-2 py-1">联系单 {group.sheet?.contact_sheet_no || group.items[0]?.batch.contact_sheet_no || '未填写'}</span>
                      <span>物料 {group.sheet?.material_no || group.items[0]?.batch.material_no || '未填写'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5">
                      <h3 className="text-sm font-bold text-ink">{group.sheet?.product_name || group.items[0]?.batch.product_name || '未命名产品'}</h3>
                      <StatusBadge tone={statusTone} dot>{statusLabel}</StatusBadge>
                      {group.hasSheetDateMismatch && <StatusBadge tone="warning">与联系单日期不一致</StatusBadge>}
                    </div>
                    <div className="mt-2 text-[11px] text-muted">
                      {group.batchCount} 个批次 · 合计 {group.totalQuantity.toLocaleString()} {group.sheet?.unit || ''}
                      {!group.needsAttention && !group.allReleased ? ` · 全部批次当前均为“${statusLabel}”` : ''}
                    </div>
                    {risks.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">{risks.slice(0, 4).map((risk) => <StatusBadge key={risk} tone="danger">{risk}</StatusBadge>)}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {group.sheet && <Button onClick={() => handleOpenContactSheet(group.contactSheetId)} tone="secondary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>查看联系单</Button>}
                    <Button onClick={() => toggleGroup(group.contactSheetId)} tone={group.needsAttention && !group.allReleased ? 'subtle' : 'secondary'} size="sm" icon={expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}>
                      {expanded ? '收起批次' : `展开 ${group.batchCount} 批`}
                    </Button>
                  </div>
                </div>
              </div>

              {expanded && (
                <div className="divide-y divide-border border-t border-border bg-surface-muted/20">
                  {group.items.map(({ batch, tracking }) => {
                    const isEditing = editingId === batch.id;
                    return (
                      <div key={batch.id} className="px-4 py-4 sm:px-5">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="font-heading text-sm font-bold text-ink">批号 {batch.batch_no}</span>
                            <StatusBadge tone={tracking.tone} size="sm">{tracking.label}</StatusBadge>
                            <span className="text-[11px] text-muted">数量 {batch.batch_quantity.toLocaleString()}</span>
                            <span className="text-[11px] text-muted">入库 {batch.warehouse_date || '—'}</span>
                            <span className="text-[11px] text-muted">放行 {batch.release_date || '—'}</span>
                            {tracking.risks.filter((risk) => risk.severity >= 2).map((risk) => <StatusBadge key={risk.label} tone={risk.tone}>{risk.label}</StatusBadge>)}
                          </div>
                          {!isEditing && <Button onClick={() => handleStartEdit(batch)} tone="secondary" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />}>单独调整</Button>}
                        </div>
                        {isEditing && (
                          <div className="mt-3 rounded-xl border border-brand-cyan/20 bg-surface p-4">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
                              <label className="space-y-1 text-[11px] font-medium text-muted"><span>实际入库日期</span><input type="date" value={warehouseDate} onChange={(event) => { setWarehouseDate(event.target.value); setEditError(''); }} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" /></label>
                              <label className="space-y-1 text-[11px] font-medium text-muted"><span>实际放行日期</span><input type="date" value={releaseDate} onChange={(event) => { setReleaseDate(event.target.value); setEditError(''); }} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" aria-invalid={Boolean(editError) || undefined} /></label>
                              <label className="space-y-1 text-[11px] font-medium text-muted"><span>备注说明</span><input type="text" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="仅记录该批次的特殊情况" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" /></label>
                              <div className="flex justify-end gap-2"><IconButton onClick={() => void handleSaveEdit(batch)} label="保存批次日期" tone="success" icon={<Check className="h-4 w-4" />} /><IconButton onClick={() => { setEditingId(null); setEditError(''); }} label="取消编辑批次" icon={<X className="h-4 w-4" />} /></div>
                            </div>
                            {editError && <p role="alert" className="mt-2 text-[11px] font-medium text-brand-rose">{editError}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        }) : (
          <div className="glass-panel flex flex-col items-center py-16 text-center">
            {view === 'attention' ? <CircleCheckBig className="h-7 w-7 text-brand-emerald" /> : <Layers className="h-7 w-7 text-subtle" />}
            <div className="mt-3 text-sm font-semibold text-body">{view === 'attention' ? '当前没有需要单独处理的批次差异' : '没有匹配的联系单批次'}</div>
            <div className="mt-1 max-w-lg text-xs leading-6 text-muted">{view === 'attention' ? '说明现有批次与联系单主进度保持同步，日常只需继续使用联系单管理。' : '可以调整搜索条件，或切换到其他批次视图。'}</div>
            {view === 'attention' && counts.active > 0 && <Button onClick={() => switchView('active')} tone="secondary" size="sm" className="mt-4">查看全部进行中联系单</Button>}
          </div>
        )}
      </div>
      <PaginationControls {...batchGroupPage} onPageChange={batchGroupPage.setPage} itemLabel="组联系单批次" />
    </div>
  );
};
