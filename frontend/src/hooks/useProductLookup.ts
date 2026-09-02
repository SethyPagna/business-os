// useProductLookup.ts -- P2-2 (search + barcode scan core). Reusable
// debounced product-search hook for any endpoint that speaks the shared
// search-tail contract this same effort put in place across
// cloudflare/src/routes/{products,portal,branches}.ts (and the prepared
// inventory.ts patch, bos-rc-workers/p2-2-inventory-tail.patch): a JSON
// response shaped `{ items, total, page, pageSize, totalPages,
// exact_barcode_hit_id }` (see e.g. products.ts's searchProductsPayload
// return, ~line 757).
//
// Built directly on the existing api/http.ts `route()`/`apiFetch()`
// primitives rather than a bespoke fetch+AbortController -- `route()` already
// gives every caller request dedup, retry, and (via its `searchGroup`
// option, passed through here as `cancelGroup`) exactly the "abort whatever
// was still in flight for this named group" cancellation semantics that
// api/productReadTransport.ts's searchProducts() already uses for the
// existing Products/POS search box (group `'products:search'`). Passing a
// distinct `cancelGroup` per adopting surface keeps them from cancelling
// each other; passing the SAME group as an existing caller (e.g. reusing
// 'products:search') interoperates with it directly, which is the point of
// building on `route()` instead of a fresh implementation.
//
// No local/offline fallback is wired here (`route()`'s `localFn` is null) --
// a live incremental search has nothing sensible to fall back to locally;
// route() will simply reject on failure and this hook surfaces that via
// `error`, same as any other network failure.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, route } from '../api/http.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../api/query.ts'
import { compactSearchText } from '../utils/searchMatch.ts'
import { resolveExactBarcodeHit, type ProductLookupCandidate } from '../utils/productLookup.ts'

export interface ProductLookupItem extends ProductLookupCandidate {
  [key: string]: unknown
}

interface ProductLookupResponse<T> {
  items?: T[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
  exact_barcode_hit_id?: number | string | null
}

export interface UseProductLookupOptions {
  /** API path, e.g. '/api/products/search'. Query string is built from `params` + the live query. */
  endpoint: string
  /** Extra fixed query params (branch id, status filter, ...) merged in on every request. */
  params?: QueryParams
  /** Debounce between the last keystroke and the request firing. */
  debounceMs?: number
  /** Minimum normalized query length before a request fires (0 = fetch on empty query too). */
  minChars?: number
  /** Passed straight through to route()'s searchGroup -- see file header. */
  cancelGroup: string
  pageSize?: number
  /** Set false to pause fetching entirely (e.g. picker not open yet). */
  enabled?: boolean
  /** The server field name to key the query on, e.g. 'query' (matches every P2-2-adopted endpoint's `query.query || query.q` reads). */
  queryParam?: string
}

export interface UseProductLookupResult<T extends ProductLookupItem = ProductLookupItem> {
  query: string
  setQuery: (value: string) => void
  results: T[]
  loading: boolean
  error: unknown
  page: number
  setPage: (page: number) => void
  hasMore: boolean
  total: number
  /** id of the single row on the current page whose barcode exactly matches
   * the query, or null. Server-computed when the endpoint provides it
   * (every P2-2-adopted route does); falls back to a client computation
   * otherwise. NEVER treat this as a selection -- decision 9 requires an
   * explicit user click/confirm regardless. */
  exactBarcodeHit: number | null
  refresh: () => void
}

const DEFAULT_DEBOUNCE_MS = 180
const DEFAULT_MIN_CHARS = 1
const DEFAULT_PAGE_SIZE = 20
const DEFAULT_QUERY_PARAM = 'query'

export function useProductLookup<T extends ProductLookupItem = ProductLookupItem>({
  endpoint,
  params,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  minChars = DEFAULT_MIN_CHARS,
  cancelGroup,
  pageSize = DEFAULT_PAGE_SIZE,
  enabled = true,
  queryParam = DEFAULT_QUERY_PARAM,
}: UseProductLookupOptions): UseProductLookupResult<T> {
  const [query, setQueryState] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [results, setResults] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [exactBarcodeHit, setExactBarcodeHit] = useState<number | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const requestIdRef = useRef(0)

  const setQuery = useCallback((value: string) => {
    setQueryState(value)
    setPage(1)
  }, [])

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), [])

  // Debounce query -> debouncedQuery. Page changes (pagination, refresh())
  // are NOT debounced -- only the raw keystroke stream is.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs)
    return () => clearTimeout(timer)
  }, [query, debounceMs])

  useEffect(() => {
    if (!enabled) return
    const normalizedLength = compactSearchText(debouncedQuery).length
    if (normalizedLength < minChars) {
      setResults([])
      setTotal(0)
      setTotalPages(1)
      setExactBarcodeHit(null)
      setLoading(false)
      setError(null)
      return
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    const queryParams: QueryParams = { ...(params || {}), [queryParam]: debouncedQuery, page, pageSize }
    const qs = buildQueryString(queryParams)
    const path = appendQuery(endpoint, qs)
    const channel = `lookup:${cancelGroup}:${path}`

    route<ProductLookupResponse<T>>(
      channel,
      async (signal?: AbortSignal) => apiFetch('GET', path, undefined, undefined, { signal }),
      null,
      { searchGroup: cancelGroup, raceLocalFallback: false },
    )
      .then((response) => {
        if (requestIdRef.current !== requestId) return // stale-response guard
        const items = (response?.items || []) as T[]
        setResults(items)
        setTotal(typeof response?.total === 'number' ? response.total : items.length)
        setTotalPages(typeof response?.totalPages === 'number' ? response.totalPages : 1)
        // Deliberately NOT `?? null` here -- resolveExactBarcodeHit treats an
        // explicit server `null` (a real "no confident hit" answer) and a
        // genuinely missing field (`undefined`, an endpoint that hasn't
        // adopted exact_barcode_hit_id) differently; coalescing would erase
        // that distinction. See productLookup.ts's resolveExactBarcodeHit.
        setExactBarcodeHit(resolveExactBarcodeHit(response?.exact_barcode_hit_id, items, debouncedQuery))
        setLoading(false)
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return
        // AbortError means a newer request superseded this one -- not a
        // real error, don't surface it (and don't clear results out from
        // under whatever the newer request is about to populate).
        const isAbort = err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
        if (isAbort) return
        setError(err)
        setLoading(false)
      })

    // eslint-disable-next-line react-hooks/exhaustive-deps -- `params` is an
    // object literal from the caller; re-stringify-comparing it here would
    // require its own memoization contract this hook doesn't want to impose.
    // JSON.stringify is used deliberately as the effect dependency instead.
  }, [debouncedQuery, page, pageSize, endpoint, cancelGroup, queryParam, enabled, minChars, refreshTick, JSON.stringify(params || {})])

  const hasMore = page < totalPages

  return { query, setQuery, results, loading, error, page, setPage, hasMore, total, exactBarcodeHit, refresh }
}

export default useProductLookup
