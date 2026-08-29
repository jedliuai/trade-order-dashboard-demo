export const DEFAULT_LIST_PAGE_SIZE = 50;

export interface PageRequest {
  page: number;
  pageSize?: number;
}

export interface PageResult<T> {
  rows: T[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  from: number;
  to: number;
}

function normalizePositiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * 当前从本地完整缓存中切页；返回结构刻意与未来的 SQLite 服务端分页保持一致。
 * 页面只依赖 PageResult，不需要知道数据是本地切片还是远端 range 查询。
 */
export function queryLocalPage<T>(allRows: readonly T[], request: PageRequest): PageResult<T> {
  const pageSize = normalizePositiveInteger(request.pageSize ?? DEFAULT_LIST_PAGE_SIZE, DEFAULT_LIST_PAGE_SIZE);
  const totalRows = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(normalizePositiveInteger(request.page, 1), totalPages);
  const startIndex = (page - 1) * pageSize;
  const rows = allRows.slice(startIndex, startIndex + pageSize);

  return {
    rows,
    page,
    pageSize,
    totalRows,
    totalPages,
    from: rows.length ? startIndex + 1 : 0,
    to: rows.length ? startIndex + rows.length : 0
  };
}
