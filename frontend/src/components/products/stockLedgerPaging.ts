// Paging for the Products > Stock Changes list (StockChangeSection) against GET /api/products/stock-ledger.
//
// A server with read switch `ledger_keyset` ON answers the first request with the rows AND the total and summary, and hands out `next_cursor`; every later
// page is asked for by that cursor and comes back with its rows only -- no COUNT, no summary (Worker lib/stockLedgerKeyset.ts). This pager keeps what makes
// that safe and cheap:
//   - the TOTAL and the summary from the request that carried them, so the page count stays true (Previous/Next with the real total, never a guess);
//   - the cursor that starts each page it has seen, so Next and Previous are one request (or none: a page seen in the last PAGE_TTL_MS is shown from memory);
//   - a short read-ahead (PREFETCH_AHEAD pages) once the person has paged forward, so the next Next is already here (the 27 Oct rule: the current page plus
//     about two ahead). It starts only after a first Next, never on open, so a visit that never pages costs what it always cost.
// A server that does not send next_cursor (switch OFF, or an older Worker) is paged by page number exactly as before: the same params, no cursor, and the
// total comes with every page. If the server's mode changes under an open tab the first answer that disagrees makes the pager forget its cursors and carry on.
import type { QueryParams } from '../../api/query.ts'

export type LedgerFetch = (params: QueryParams) => Promise<unknown>

export type LedgerSummary = { inCount: number; outCount: number; inQty: number; outQty: number; total: number }

export type LedgerPageResult<Row> = {
  items: Row[]
  total: number
  summary: LedgerSummary | null
  /** The page was served from memory (no request). */
  cached: boolean
}

type Wire<Row> = {
  items?: Row[]
  total?: number
  totalPages?: number
  pageSize?: number
  summary?: LedgerSummary
  next_cursor?: string | null
}

type Cached<Row> = { items: Row[]; at: number }

/** How long a page already shown may be shown again without asking. Writes made on this screen reset it (fresh). */
export const PAGE_TTL_MS = 30_000
/** How many pages ahead of the one on screen are read once the person has paged forward. */
export const PREFETCH_AHEAD = 2

export type PagerOptions = { now?: () => number; ttlMs?: number; prefetchAhead?: number }

export class StockLedgerPager<Row> {
  private readonly fetch: LedgerFetch
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly ahead: number
  private scopeKey = ''
  private pageSize = 0
  private pages = new Map<number, Cached<Row>>()
  private cursors = new Map<number, string>()
  private inFlight = new Map<number, Promise<void>>()
  private total = 0
  private summary: LedgerSummary | null = null
  private haveTotals = false
  private byCursor = false
  private generation = 0
  /** Requests sent, for tests and for the "no COUNT after page 1" proof: one entry per fetch, as it was asked. */
  readonly sent: QueryParams[] = []

  constructor(fetch: LedgerFetch, options: PagerOptions = {}) {
    this.fetch = fetch
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? PAGE_TTL_MS
    this.ahead = options.prefetchAhead ?? PREFETCH_AHEAD
  }

  /** True once the server has shown it pages by cursor. */
  get keyset(): boolean { return this.byCursor }

  private reset(scopeKey: string, pageSize: number): void {
    this.generation += 1
    this.scopeKey = scopeKey
    this.pageSize = pageSize
    this.pages.clear(); this.cursors.clear(); this.inFlight.clear()
    this.total = 0; this.summary = null; this.haveTotals = false
  }

  private absorb(page: number, wire: Wire<Row>, askedCursor: boolean): void {
    const items = Array.isArray(wire?.items) ? wire.items : []
    this.pages.set(page, { items, at: this.now() })
    if (Object.prototype.hasOwnProperty.call(wire ?? {}, 'next_cursor')) {
      this.byCursor = true
      if (typeof wire.next_cursor === 'string') this.cursors.set(page + 1, wire.next_cursor)
      else this.cursors.delete(page + 1)
    } else if (askedCursor) {
      // Asked by cursor, answered by page number: the switch went off under this tab. Forget the cursors; the page number serves.
      this.byCursor = false
      this.cursors.clear()
    } else if (this.byCursor) {
      this.byCursor = false
      this.cursors.clear()
    }
    if (typeof wire?.total === 'number') {
      this.total = Number(wire.total)
      this.summary = wire.summary ? { ...wire.summary } : this.summary
      this.haveTotals = true
    }
  }

  private params(scope: QueryParams, page: number, cursor: string | undefined, totals: boolean): QueryParams {
    return { ...scope, page, pageSize: this.pageSize, ...(cursor ? { cursor } : {}), ...(cursor && totals ? { totals: 1 } : {}) }
  }

  private async request(scope: QueryParams, page: number, totals: boolean): Promise<void> {
    const cursor = this.byCursor ? this.cursors.get(page) : undefined
    const generation = this.generation
    const params = this.params(scope, page, cursor, totals)
    this.sent.push(params)
    let wire: Wire<Row>
    try {
      wire = await this.fetch(params) as Wire<Row>
    } catch (error) {
      // A cursor the server no longer accepts: start this page again by number. Anything else is the caller's to show.
      if (cursor && (error as { code?: unknown } | null)?.code === 'invalid_cursor') {
        this.cursors.clear()
        const retry = this.params(scope, page, undefined, false)
        this.sent.push(retry)
        wire = await this.fetch(retry) as Wire<Row>
        if (generation === this.generation) this.absorb(page, wire, false)
        return
      }
      throw error
    }
    if (generation === this.generation) this.absorb(page, wire, Boolean(cursor))
  }

  /**
   * The page `page` of `scope`. A change of scope or page size starts over; `fresh` (after a write on this screen) drops what was seen but keeps the position:
   * the page is read again, by its cursor when it has one, together with the totals the write may have moved.
   */
  async load(scope: QueryParams, page: number, pageSize: number, options: { fresh?: boolean } = {}): Promise<LedgerPageResult<Row>> {
    const key = JSON.stringify(scope)
    if (key !== this.scopeKey || pageSize !== this.pageSize) this.reset(key, pageSize)
    let needTotals = !this.haveTotals
    if (options.fresh) {
      this.generation += 1
      const keep = this.byCursor ? this.cursors.get(page) : undefined
      this.pages.clear(); this.cursors.clear(); this.inFlight.clear()
      if (keep) this.cursors.set(page, keep)
      needTotals = true
    }
    const seen = this.pages.get(page)
    if (seen && this.haveTotals && this.now() - seen.at <= this.ttlMs) return { items: seen.items, total: this.total, summary: this.summary, cached: true }
    const waiting = this.inFlight.get(page)
    if (waiting) await waiting
    else {
      const run = this.request(scope, page, needTotals)
      this.inFlight.set(page, run.then(() => undefined, () => undefined))
      try { await run } finally { this.inFlight.delete(page) }
    }
    const page1 = this.pages.get(page)
    return { items: page1?.items ?? [], total: this.total, summary: this.summary, cached: false }
  }

  /**
   * Reads the pages after `page` (up to the read-ahead and the last page) so the next Next is already here. Quiet: a failure only leaves the page to be asked for
   * when it is wanted. Does nothing for a server that pages by number (a page there carries its own COUNT, so reading ahead would multiply it).
   */
  async prefetch(scope: QueryParams, page: number): Promise<void> {
    if (!this.byCursor || JSON.stringify(scope) !== this.scopeKey) return
    const generation = this.generation
    const lastPage = Math.max(1, Math.ceil(this.total / Math.max(1, this.pageSize)))
    for (let next = page + 1; next <= Math.min(lastPage, page + this.ahead); next += 1) {
      if (generation !== this.generation || !this.byCursor || !this.cursors.has(next)) return
      const seen = this.pages.get(next)
      if (seen && this.now() - seen.at <= this.ttlMs) continue
      if (this.inFlight.has(next)) continue
      try { await this.request(scope, next, false) } catch { return }
    }
  }
}

/**
 * Every row of a scope for the CSV export: page 1 by number (it carries the total), the rest by cursor when the server hands them out, by number when it does
 * not. The page size is whatever the server answers with (it caps a page by the plan), so a smaller page only means more pages; `maxRows` is the export's cap.
 */
export async function walkLedgerForExport<Row>(fetch: LedgerFetch, scope: QueryParams, asked: number, maxRows: number): Promise<{ rows: Row[]; grandTotal: number }> {
  const rows: Row[] = []
  let grandTotal = 0
  let cursor: string | undefined
  let size = asked
  for (let page = 1; rows.length < maxRows; page += 1) {
    const wire = await fetch({ ...scope, page, pageSize: asked, ...(cursor ? { cursor } : {}) }) as Wire<Row>
    const items = Array.isArray(wire?.items) ? wire.items : []
    if (page === 1 || typeof wire?.total === 'number') grandTotal = Number(wire?.total || grandTotal)
    if (Number.isFinite(Number(wire?.pageSize)) && Number(wire.pageSize) > 0) size = Number(wire.pageSize)
    rows.push(...items)
    cursor = typeof wire?.next_cursor === 'string' ? wire.next_cursor : undefined
    if (rows.length >= grandTotal || items.length < size) break
  }
  return { rows: rows.slice(0, maxRows), grandTotal }
}
