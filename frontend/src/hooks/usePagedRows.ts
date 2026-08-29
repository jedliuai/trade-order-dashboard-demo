import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LIST_PAGE_SIZE, queryLocalPage } from '../services/listQuery';

export function usePagedRows<T>(rows: readonly T[], resetKey: string, pageSize = DEFAULT_LIST_PAGE_SIZE) {
  const [pagination, setPagination] = useState({ resetKey, page: 1 });
  const requestedPage = pagination.resetKey === resetKey ? pagination.page : 1;
  const result = useMemo(
    () => queryLocalPage(rows, { page: requestedPage, pageSize }),
    [rows, requestedPage, pageSize]
  );

  useEffect(() => {
    if (pagination.resetKey !== resetKey || pagination.page !== result.page) {
      setPagination({ resetKey, page: pagination.resetKey !== resetKey ? 1 : result.page });
    }
  }, [pagination, resetKey, result.page]);

  const setPage = useCallback((page: number) => {
    setPagination({ resetKey, page });
  }, [resetKey]);

  return { ...result, setPage };
}
