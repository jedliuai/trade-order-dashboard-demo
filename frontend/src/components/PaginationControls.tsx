import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

interface PaginationControlsProps {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

export function PaginationControls({
  page,
  pageSize,
  totalRows,
  totalPages,
  from,
  to,
  onPageChange,
  itemLabel = '条记录'
}: PaginationControlsProps) {
  if (totalRows <= pageSize) return null;

  return (
    <nav aria-label="列表分页" className="flex flex-col items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs sm:flex-row">
      <span className="text-muted">
        共 {totalRows.toLocaleString()} {itemLabel}，当前显示 {from.toLocaleString()}–{to.toLocaleString()}
      </span>
      <div className="flex items-center gap-1.5">
        <Button tone="secondary" size="sm" aria-label="第一页" title="第一页" disabled={page <= 1} onClick={() => onPageChange(1)} className="px-2" icon={<ChevronsLeft className="h-3.5 w-3.5" />}><span className="sr-only">第一页</span></Button>
        <Button tone="secondary" size="sm" aria-label="上一页" title="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="px-2" icon={<ChevronLeft className="h-3.5 w-3.5" />}><span className="sr-only">上一页</span></Button>
        <span className="min-w-24 px-2 text-center font-semibold text-body">第 {page} / {totalPages} 页</span>
        <Button tone="secondary" size="sm" aria-label="下一页" title="下一页" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="px-2" icon={<ChevronRight className="h-3.5 w-3.5" />}><span className="sr-only">下一页</span></Button>
        <Button tone="secondary" size="sm" aria-label="最后一页" title="最后一页" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} className="px-2" icon={<ChevronsRight className="h-3.5 w-3.5" />}><span className="sr-only">最后一页</span></Button>
      </div>
    </nav>
  );
}
