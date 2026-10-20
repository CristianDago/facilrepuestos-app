import { useState, useMemo } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 20, 50];

export function usePagination<T>(items: T[], defaultSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);
  const goTo = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const changeSize = (size: number) => { setPageSize(size); setPage(1); };
  return { paged, page: safePage, pageSize, totalPages, totalItems: items.length, goTo, changeSize };
}
