// The client product-search index (G37 phase 1).
//
// The admin pickers match on the client with the shared core
// (utils/searchCore.ts, a byte copy of the Worker's lib/searchCore.ts) over
// the catalog's search fields, downloaded from GET /api/products/search-index
// in fixed id-range pages. Matching costs no round trip; the ranked ids then
// hydrate through the normal product endpoints (?rankIds=&rankTiers=), so
// prices, stock, images, promotions and permissions stay server-side.
//
// Freshness: pages are revalidated with their hash (?have=) when a picker
// mounts, when a "products" sync update arrives, and at most every
// backstop (revalidateMs(): 15 minutes with the sync socket up, 60 s without) while searching; an unchanged page answers in a few bytes.
// Until the index is ready (first load, a denied or older Worker) every
// picker keeps the legacy server text search, so nothing regresses.
import { useEffect, useState } from 'react'
import { apiFetch } from './http.ts'
import { isWSConnected } from './websocket.ts'
import { captureActorReadScope, isActorReadScopeCurrent, subscribeCatalogueChange, type ActorReadScope } from './actorReadScope.ts'
import {
  SEARCH_CORE_VERSION,
  SEARCH_TIER_EXACT_CODE,
  createSearchIndexBuilder,
  searchTermIndex,
  type SearchOptions,
  type SearchResult,
  type SearchTermIndex,
} from '../utils/searchCore.ts'

const INDEX_FORMAT = 1
// The index holds catalogue text and identity only (id, name, brand, category, barcode, sku: no stock, price or promotion), so its read scope is its own entity and not 'products'. A sale or a
// stock write invalidates 'products:search' (the rows a list shows), which moves the whole 'products' entity revision; under that key it reset this index and sent the till back to the server
// text search. Under its own entity only an actor change, a data epoch or a clear-everything moves the scope; a real catalogue change marks the index stale through subscribeCatalogueChange
// and the usual ?have= revalidation brings it up to date without dropping it. The key also no longer starts with 'products:search', so methods.ts stops deleting the stored copy on every sync.
const STORE_KEY = 'catalogIndex:search-index:v1'
// The backstop only catches a change nobody announced. With the sync socket up, a catalogue change made anywhere is pushed (and marks the index stale, revalidated after SYNC_REVALIDATE_DELAY_MS),
// so the slow backstop is enough; with the socket down or not yet known, nothing is pushed and the short one stays what it was.
const REVALIDATE_MS_SOCKET_UP = 15 * 60_000
const REVALIDATE_MS_SOCKET_DOWN = 60_000
const SYNC_REVALIDATE_DELAY_MS = 1_500
const BUILD_SLICE_MS = 8
// Hydration sends at most this many ranked ids (the Worker's RANKED_ID_LIMIT).
export const RANKED_ID_LIMIT = 1500

type IndexRow = [number, string, string, string, string, string]

interface IndexPage {
  format: number
  page: number
  buckets: number[]
  hash: string
  rows?: IndexRow[]
  unchanged?: boolean
}

interface StoredPage {
  page: number
  hash: string
  rows: IndexRow[]
}

interface StoredIndex {
  format: number
  core: number
  pages: StoredPage[]
}

type Status = 'idle' | 'loading' | 'ready' | 'unavailable'

const state: {
  status: Status
  index: SearchTermIndex | null
  pages: Map<number, StoredPage>
  scope: ActorReadScope | null
  checkedAt: number
  stale: boolean
  // Counts markProductSearchIndexStale calls, so a load that finishes does not clear a mark made while it ran.
  staleMarks: number
  generation: number
  inflight: Promise<void> | null
  // Counts epoch resets: a load that began before one describes another database state and must not store anything.
  resets: number
} = { status: 'idle', index: null, pages: new Map(), scope: null, checkedAt: 0, stale: true, staleMarks: 0, generation: 0, inflight: null, resets: 0 }

const listeners = new Set<() => void>()
function notify(): void {
  state.generation += 1
  for (const listener of listeners) listener()
}

function revalidateMs(): number {
  return transport.socketUp() ? REVALIDATE_MS_SOCKET_UP : REVALIDATE_MS_SOCKET_DOWN
}

function resetForNewActor(): void {
  state.status = 'idle'
  state.index = null
  state.pages = new Map()
  state.scope = null
  state.checkedAt = 0
  state.stale = true
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function buildIndex(pages: Map<number, StoredPage>): Promise<SearchTermIndex> {
  const builder = createSearchIndexBuilder()
  let sliceStart = Date.now()
  for (const page of [...pages.values()].sort((a, b) => a.page - b.page)) {
    for (const [id, name, brand, category, barcode, sku] of page.rows) {
      builder.add({ id, name, brand, category, barcode, sku })
      if (Date.now() - sliceStart > BUILD_SLICE_MS) {
        await yieldToBrowser()
        sliceStart = Date.now()
      }
    }
  }
  return builder.finish()
}

// The three seams to the outside world (and the socket's state); tests replace them.
const transport = {
  socketUp(): boolean {
    try { return isWSConnected() } catch { return false }
  },
  fetchPage(page: number, have: string | undefined): Promise<IndexPage> {
    const query = `page=${page}${have ? `&have=${encodeURIComponent(have)}` : ''}`
    return apiFetch('GET', `/api/products/search-index?${query}`) as Promise<IndexPage>
  },
  async readStored(): Promise<unknown> {
    const { readCachedQueryResult } = await import('./queryCache.ts')
    return readCachedQueryResult<StoredIndex>(STORE_KEY)
  },
  async writeStored(value: StoredIndex, scope: ActorReadScope): Promise<void> {
    const { writeCachedQueryResult } = await import('./queryCache.ts')
    if (isActorReadScopeCurrent(scope)) await writeCachedQueryResult(STORE_KEY, value, scope)
  },
  async clearStored(): Promise<void> {
    const { clearCachedQueryResults } = await import('./queryCache.ts')
    await clearCachedQueryResults([STORE_KEY])
  },
}

async function readStored(): Promise<StoredIndex | null> {
  try {
    const stored = (await transport.readStored()) as StoredIndex | null
    if (!stored || stored.format !== INDEX_FORMAT || stored.core !== SEARCH_CORE_VERSION || !Array.isArray(stored.pages)) return null
    return stored
  } catch {
    return null
  }
}

function writeStored(pages: Map<number, StoredPage>, scope: ActorReadScope): void {
  const value: StoredIndex = { format: INDEX_FORMAT, core: SEARCH_CORE_VERSION, pages: [...pages.values()] }
  transport.writeStored(value, scope).catch(() => {})
}

function fetchPage(page: number, have: string | undefined): Promise<IndexPage> {
  return transport.fetchPage(page, have)
}

// One revalidation wave: every page the client holds goes out in parallel
// with its hash; pages the first answer lists but the client lacks follow.
async function revalidate(scope: ActorReadScope, mark: number): Promise<boolean> {
  const stillCurrent = () => isActorReadScopeCurrent(scope) && state.resets === mark
  const held = new Map(state.pages)
  const pageNumbers = held.size ? [...held.keys()] : [0]
  const answers = await Promise.all(pageNumbers.map((page) => fetchPage(page, held.get(page)?.hash)))
  if (!stillCurrent()) return false
  const buckets = answers.find((answer) => Array.isArray(answer?.buckets))?.buckets ?? []
  const missing = buckets.filter((page) => !pageNumbers.includes(page))
  const more = missing.length ? await Promise.all(missing.map((page) => fetchPage(page, undefined))) : []
  if (!stillCurrent()) return false
  const next = new Map<number, StoredPage>()
  let changed = false
  for (const answer of [...answers, ...more]) {
    if (!answer || answer.format !== INDEX_FORMAT || !buckets.includes(answer.page)) continue
    if (answer.unchanged) {
      const kept = held.get(answer.page)
      if (kept) next.set(answer.page, kept)
      continue
    }
    if (!Array.isArray(answer.rows)) continue
    next.set(answer.page, { page: answer.page, hash: answer.hash, rows: answer.rows })
    changed = true
  }
  if (next.size !== held.size || [...held.keys()].some((page) => !next.has(page))) changed = true
  if (buckets.some((page) => !next.has(page))) throw new Error('search index incomplete')
  state.pages = next
  return changed
}

async function load(force: boolean): Promise<void> {
  if (state.scope && !isActorReadScopeCurrent(state.scope)) resetForNewActor()
  const scope = state.scope ?? captureActorReadScope(STORE_KEY)
  const mark = state.resets
  const staleMarksAtStart = state.staleMarks
  const current = () => isActorReadScopeCurrent(scope) && state.resets === mark
  state.scope = scope
  if (!state.index) {
    const stored = await readStored()
    if (stored && current() && !state.index) {
      state.pages = new Map(stored.pages.map((page) => [page.page, page]))
      state.index = await buildIndex(state.pages)
      if (!current()) return
      state.status = 'ready'
      notify()
    }
  }
  const due = force || state.stale || Date.now() - state.checkedAt > revalidateMs()
  if (!due && state.index) return
  if (state.status !== 'ready') state.status = 'loading'
  try {
    const changed = await revalidate(scope, mark)
    if (!current()) return
    state.checkedAt = Date.now()
    if (state.staleMarks === staleMarksAtStart) state.stale = false
    if (changed || !state.index) {
      const index = await buildIndex(state.pages)
      if (!current()) return
      state.index = index
      writeStored(state.pages, scope)
    }
    state.status = 'ready'
    notify()
  } catch (error) {
    if (!current()) return
    state.checkedAt = Date.now()
    // 403/404: this account (or this Worker) has no index; the pickers keep
    // the server text search. Anything else keeps whatever index is held.
    const status = Number((error as { status?: unknown })?.status)
    if (!state.index || status === 403 || status === 404) {
      state.status = 'unavailable'
      state.index = status === 403 || status === 404 ? null : state.index
      notify()
    }
  }
}

export function ensureProductSearchIndex(force = false): Promise<void> {
  if (state.inflight) return state.inflight
  state.inflight = loadAndCatchUp(force).finally(() => { state.inflight = null })
  return state.inflight
}

// A catalogue change that is marked while a load runs finds that load as the in-flight one (ensureProductSearchIndex returns it) and the load does not clear the mark, so with the slow backstop it
// would wait up to 15 minutes. When the load finishes with such a mark still standing, load once more.
async function loadAndCatchUp(force: boolean): Promise<void> {
  const marksAtStart = state.staleMarks
  await load(force)
  if (state.stale && state.staleMarks !== marksAtStart && state.index) await load(false)
}

export function markProductSearchIndexStale(): void {
  state.stale = true
  state.staleMarks += 1
}

// A catalogue change made on this device (the plain 'products' invalidation): mark the index stale and, when one is held, revalidate its pages by hash shortly after, the same delay a
// 'products' sync update uses, instead of waiting out the backstop. Several changes in a row make one revalidation.
let catalogueChangeTimer: ReturnType<typeof setTimeout> | null = null
subscribeCatalogueChange(() => {
  markProductSearchIndexStale()
  if (state.status !== 'ready') return
  if (catalogueChangeTimer) clearTimeout(catalogueChangeTimer)
  catalogueChangeTimer = setTimeout(() => { catalogueChangeTimer = null; void ensureProductSearchIndex() }, SYNC_REVALIDATE_DELAY_MS)
})

// A socket that dropped and came back may have missed pushes made while it was down, and the slow backstop would not look for 15 minutes: revalidate once on reconnect.
if (typeof window !== 'undefined') {
  window.addEventListener('sync:reconnected', () => {
    markProductSearchIndexStale()
    if (state.status === 'ready') void ensureProductSearchIndex()
  })
}

/**
 * A new data epoch (a restore, a cutover): what this tab holds, in memory and on disk, describes another database state. Both go, a
 * load already running is fenced from storing anything, and the next use downloads the index again.
 */
export async function resetProductSearchIndexForNewEpoch(): Promise<void> {
  resetForNewActor()
  state.resets += 1
  state.inflight = null
  notify()
  await transport.clearStored()
}

/**
 * The core's ranked matches over the index, or null when the index is not
 * ready (callers then use the server text search).
 */
export function searchProductIndex(query: string, options: SearchOptions = {}): SearchResult | null {
  if (state.status !== 'ready' || !state.index) return null
  if (state.scope && !isActorReadScopeCurrent(state.scope)) {
    resetForNewActor()
    return null
  }
  if (Date.now() - state.checkedAt > revalidateMs()) void ensureProductSearchIndex()
  return searchTermIndex(state.index, query, options)
}

/**
 * Whether some catalog product carries this scanned code as its barcode, by the index's own exact-code rule (leading
 * zeros fold, UPC-E pairs with UPC-A, Khmer digits fold; never a name or a substring). The list a page shows is
 * narrowed by its filters, the index is not, so this is how a page tells "hidden by the filters" from "no such
 * product" without another request. Null while the index cannot say (not loaded, or this account has none).
 */
export function catalogHasBarcode(code: string): boolean | null {
  const result = searchProductIndex(code)
  return result ? result.hits.some((hit) => hit.tier === SEARCH_TIER_EXACT_CODE) : null
}

/** Query params that hand a ranked result to the product endpoints. */
export function rankedIdParams(result: SearchResult, limit = RANKED_ID_LIMIT): { rankIds: string; rankTiers: string } {
  const hits = result.hits.slice(0, limit)
  return { rankIds: hits.map((hit) => hit.id).join(','), rankTiers: hits.map((hit) => hit.tier).join('') }
}

/**
 * Picker hook: loads the index on mount, revalidates on product sync
 * updates, and re-renders when it becomes ready or changes. Returns the
 * index generation (changes whenever results could change).
 */
export function useProductSearchIndex(enabled = true): number {
  const [generation, setGeneration] = useState(state.generation)
  useEffect(() => {
    if (!enabled) return undefined
    const listener = () => setGeneration(state.generation)
    listeners.add(listener)
    void ensureProductSearchIndex()
    let timer: ReturnType<typeof setTimeout> | null = null
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ channel?: unknown; reason?: unknown }>).detail || {}
      if (detail.reason === 'cache-refresh') return
      const channel = String(detail.channel || '').split(':')[0]
      if (channel && channel !== 'products' && channel !== 'all') return
      markProductSearchIndexStale()
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void ensureProductSearchIndex() }, SYNC_REVALIDATE_DELAY_MS)
    }
    window.addEventListener('sync:update', onSync)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('sync:update', onSync)
      if (timer) clearTimeout(timer)
    }
  }, [enabled])
  return generation
}

export function productSearchIndexStatus(): Status {
  return state.status
}

/**
 * One typed character that is not a digit is never sent to the server: no
 * product is found by a single letter, and each such request reads a whole
 * page. Digits always search (barcodes). Counted in code points.
 */
export function isProductSearchTooShort(query: string): boolean {
  const characters = [...String(query || '').trim()]
  return characters.length === 1 && !/\p{Nd}/u.test(characters[0])
}

/** Typed text a picker may send: not empty, and not a lone non-digit character. */
export function canSearchProductText(query: string): boolean {
  return String(query || '').trim().length > 0 && !isProductSearchTooShort(query)
}

/**
 * What a picker sends for typed text: the ranked ids when the index is ready
 * and found something, otherwise the text itself for the server search (an
 * index that is still loading, or a product created elsewhere seconds ago
 * that no revalidation has brought in yet).
 */
export function productSearchRequest(query: string, options: SearchOptions = {}): { params: Record<string, string>; result: SearchResult | null } {
  const text = String(query || '').trim()
  if (!text) return { params: {}, result: null }
  const result = searchProductIndex(text, options)
  if (!result || !result.total) return { params: { query: text }, result }
  return { params: rankedIdParams(result), result }
}

/**
 * For callers that already build their own `query` param: the overrides
 * that swap it for ranked ids (empty when the text search applies). Takes
 * productSearchRequest(...).params or its JSON.
 */
export function rankedSearchOverride(params: string | Record<string, string>): Record<string, string | undefined> {
  const parsed = typeof params === 'string' ? (JSON.parse(params || '{}') as Record<string, string>) : params
  if (!parsed?.rankIds) return {}
  return { query: undefined, q: undefined, search: undefined, rankIds: parsed.rankIds, rankTiers: parsed.rankTiers }
}

// Test seam: lets tests drive the module without a browser or a Worker.
export const __productSearchIndexTest = {
  transport,
  reset(): void {
    resetForNewActor()
    state.inflight = null
    state.generation = 0
  },
  state,
}
