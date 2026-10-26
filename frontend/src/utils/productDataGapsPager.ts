// The paging state of Products -> Conflicts -> unknown cost / no barcode (lane 6.0.988), kept out of the component so it can be
// driven in a test. The Worker pages by keyset (`after` = the last id of the previous page), so the shared Previous/Next pager moves
// one page at a time and this keeps the cursor each page started from. Rules:
//   - the LAST request wins: a slow answer for a kind or page the user already left is dropped, never shown;
//   - a failed read is a visible `error` state (never an endless "Loading"), and `retry()` repeats it;
//   - changing the kind restarts at page 1; `reload()` re-reads the current page (after an edit, a decision or a Refresh);
//   - counts are advisory: a failed count read leaves the chips without a number.
import type { ProductDataGapCounts, ProductDataGapKind, ProductDataGapPage, ProductDataGapRow } from '../api/productWriteTransport.ts'

export type DataGapsStatus = 'loading' | 'ready' | 'error'

export type DataGapsState = {
  kind: ProductDataGapKind
  page: number
  rows: ProductDataGapRow[]
  hasMore: boolean
  status: DataGapsStatus
  counts: ProductDataGapCounts | null
}

export type DataGapsLoaders = {
  fetchPage: (kind: ProductDataGapKind, after: number | null) => Promise<ProductDataGapPage>
  fetchCounts: () => Promise<ProductDataGapCounts>
}

export function createDataGapsPager(loaders: DataGapsLoaders, initialKind: ProductDataGapKind) {
  let state: DataGapsState = { kind: initialKind, page: 1, rows: [], hasMore: false, status: 'loading', counts: null }
  // cursors[page - 1] is the `after` page `page` was read with; page 1 starts from the beginning.
  let cursors: Array<number | null> = [null]
  let nextAfter: number | null = null
  let request = 0
  let disposed = false
  const listeners = new Set<() => void>()

  const publish = (patch: Partial<DataGapsState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  async function load(kind: ProductDataGapKind, page: number): Promise<void> {
    const mine = ++request
    publish({ kind, page, status: 'loading' })
    try {
      const result = await loaders.fetchPage(kind, cursors[page - 1] ?? null)
      if (disposed || mine !== request) return
      // The last row of a later page was fixed meanwhile: step back to the previous page instead of showing an empty one.
      if (!result.items.length && page > 1) { await load(kind, page - 1); return }
      nextAfter = result.next_after ?? null
      if (result.has_more && nextAfter !== null) cursors[page] = nextAfter
      publish({ rows: result.items, hasMore: Boolean(result.has_more), status: 'ready' })
    } catch {
      if (disposed || mine !== request) return
      publish({ rows: [], hasMore: false, status: 'error' })
    }
  }

  async function loadCounts(): Promise<void> {
    try {
      const counts = await loaders.fetchCounts()
      if (!disposed) publish({ counts })
    } catch { /* the chips simply show no number */ }
  }

  return {
    getState: (): DataGapsState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** First read, and every Refresh: page 1 again, with fresh counts. */
    start(): Promise<void> {
      cursors = [null]
      nextAfter = null
      void loadCounts()
      return load(state.kind, 1)
    },
    setKind(kind: ProductDataGapKind): Promise<void> {
      cursors = [null]
      nextAfter = null
      return load(kind, 1)
    },
    /** Previous/Next only: a page the cursor stack cannot reach (a jump past the next page) is ignored. */
    goTo(page: number): Promise<void> {
      if (!Number.isInteger(page) || page < 1 || page === state.page) return Promise.resolve()
      if (page > state.page && !(page === state.page + 1 && state.hasMore && cursors[page - 1] != null)) return Promise.resolve()
      return load(state.kind, page)
    },
    /** Re-read the page on screen (after an edit or a decision) and the counts. */
    reload(): Promise<void> {
      void loadCounts()
      return load(state.kind, state.page)
    },
    retry(): Promise<void> {
      return load(state.kind, state.page)
    },
    dispose() { disposed = true; listeners.clear() },
  }
}

/** The total the shared pager draws "page / pages" from: the count when it covers what is on screen, else just enough to reach the next page. */
export function dataGapsPagerTotal(state: DataGapsState, pageSize: number): number {
  const known = state.counts?.[state.kind]
  const onScreen = (state.page - 1) * pageSize + state.rows.length + (state.hasMore ? 1 : 0)
  return typeof known === 'number' && known >= onScreen ? known : onScreen
}
