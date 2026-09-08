import { useState, useCallback } from "react";
import { unwrapPaged } from "../api/client";

/**
 * usePagination — generic hook for paginated backend list endpoints.
 *
 * Usage:
 *   const { items, loading, error, hasNext, loadMore, reload } =
 *     usePagination((page, size) => getTasks({ page, size }), 50);
 *
 * The fetchFn receives (page, size) and should return a Promise<AxiosResponse>.
 * Responses can be either the PagedResponse shape { data: [], totalElements, hasNext }
 * or a plain array — both are handled transparently via unwrapPaged().
 */
export function usePagination(fetchFn, pageSize = 50) {
  const [items,    setItems]    = useState([]);
  const [page,     setPage]     = useState(0);
  const [hasNext,  setHasNext]  = useState(false);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const load = useCallback(async (pageNum = 0, replace = true) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchFn(pageNum, pageSize);
      const paged    = unwrapPaged(response);
      setItems(prev  => replace ? paged.items : [...prev, ...paged.items]);
      setPage(paged.page);
      setHasNext(paged.hasNext);
      setTotal(paged.totalElements);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [fetchFn, pageSize]);

  const reload  = useCallback(() => load(0, true),  [load]);
  const loadMore= useCallback(() => load(page + 1, false), [load, page]);

  return { items, loading, error, hasNext, total, page, reload, loadMore };
}

/**
 * Simple hook that loads a full list using fetchFn that returns an array.
 * For endpoints that are not paginated (small lists).
 */
export function useList(fetchFn) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFn();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchFn]);

  return { items, loading, error, reload: load };
}
