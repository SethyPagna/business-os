// Cursor/snapshot paging for the "each record" report lists (sales,
// returns, expenses) over the /api/reports/business-summary/* readers:
// page 1 pins `snapshot_max_id`, every later page passes the previous
// page's `next_cursor`, so rows created while the person scrolls never
// shift the list. Responses that arrive after the inputs changed are
// dropped (sequence guard), and a Load-more that fails keeps the rows
// already shown.
import { useCallback, useEffect, useRef, useState } from 'react'

export interface PageCursor {
  snapshotMaxId: number | null
  cursor: Record<string, unknown> | null
}

export interface PagedReport<Row> {
  rows: Row[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  reload: () => void
}

interface PageResponse {
  rows?: unknown[]
  snapshot_max_id?: number | null
  has_more?: boolean
  next_cursor?: Record<string, unknown> | null
}

export function usePagedReport<Row>(
  fetchPage: (page: PageCursor) => Promise<unknown>,
  depsKey: string,
  enabled: boolean,
  mapRow: (raw: unknown, index: number) => Row,
): PagedReport<Row> {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState<boolean>(enabled)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  const pageRef = useRef<PageCursor>({ snapshotMaxId: null, cursor: null })
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const mapRef = useRef(mapRow)
  mapRef.current = mapRow

  const run = useCallback((first: boolean) => {
    const mine = ++seq.current
    if (first) {
      pageRef.current = { snapshotMaxId: null, cursor: null }
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    setError(null)
    fetchRef
      .current(pageRef.current)
      .then((raw) => {
        if (seq.current !== mine) return
        const res = (raw && typeof raw === 'object' ? raw : {}) as PageResponse
        const mapped = Array.isArray(res.rows) ? res.rows.map((r, i) => mapRef.current(r, i)) : []
        pageRef.current = {
          snapshotMaxId: typeof res.snapshot_max_id === 'number' ? res.snapshot_max_id : pageRef.current.snapshotMaxId,
          cursor: res.next_cursor && typeof res.next_cursor === 'object' ? res.next_cursor : null,
        }
        setHasMore(!!res.has_more && !!res.next_cursor)
        setRows((prev) => (first ? mapped : [...prev, ...mapped]))
        setLoading(false)
        setLoadingMore(false)
      })
      .catch((err: unknown) => {
        if (seq.current !== mine) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
        setLoadingMore(false)
      })
  }, [])

  useEffect(() => {
    if (!enabled) {
      seq.current += 1
      setRows([])
      setLoading(false)
      setLoadingMore(false)
      setError(null)
      setHasMore(false)
      return
    }
    run(true)
  }, [depsKey, enabled, tick, run])

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return
    run(false)
  }, [hasMore, loading, loadingMore, run])

  const reload = useCallback(() => setTick((n) => n + 1), [])

  return { rows, loading, loadingMore, error, hasMore, loadMore, reload }
}
