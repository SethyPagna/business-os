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
// REVALIDATE_MS while searching; an unchanged page answers in a few bytes.
// Until the index is ready (first load, a denied or older Worker) every
// picker keeps the legacy server text search, so nothing regresses.
import { useEffect, useState } from 'react'
import { apiFetch } from './http.ts'
import { captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from './actorReadScope.ts'
import {
  SEARCH_CORE_VERSION,
  createSearchIndexBuilder,
  searchTermIndex,
  type SearchOptions,
  type SearchResult,
  type SearchTermIndex,
} from '../utils/searchCore.ts'

const INDEX_FORMAT = 1
const STORE_KEY = 'products:search-index:v1'
const REVALIDATE_MS = 60_000
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
  generation: number
  inflight: Promise<void> | null
} = { status: 'idle', index: null, pages: new Map(), scope: null, checkedAt: 0, stale: true, generation: 0, inflight: null }

const listeners = new Set<() => void>()
function notify(): void {
  state.generation += 1
  for (const listener of listeners) listener()
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

// The three seams to the outside world; tests replace them.
const transport = {
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
async function revalidate(scope: ActorReadScope): Promise<boolean> {
  const held = new Map(state.pages)
  const pageNumbers = held.size ? [...held.keys()] : [0]
  const answers = await Promise.all(pageNumbers.map((page) => fetchPage(page, held.get(page)?.hash)))
  if (!isActorReadScopeCurrent(scope)) return false
  const buckets = answers.find((answer) => Array.isArray(answer?.buckets))?.buckets ?? []
  const missing = buckets.filter((page) => !pageNumbers.includes(page))
  const more = missing.length ? await Promise.all(missing.map((page) => fetchPage(page, undefined))) : []
  if (!isActorReadScopeCurrent(scope)) return false
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
  state.scope = scope
  if (!state.index) {
    const stored = await readStored()
    if (stored && isActorReadScopeCurrent(scope) && !state.index) {
      state.pages = new Map(stored.pages.map((page) => [page.page, page]))
      state.index = await buildIndex(state.pages)
      if (!isActorReadScopeCurrent(scope)) return
      state.status = 'ready'
      notify()
    }
  }
  const due = force || state.stale || Date.now() - state.checkedAt > REVALIDATE_MS
  if (!due && state.index) return
  if (state.status !== 'ready') state.status = 'loading'
  try {
    const changed = await revalidate(scope)
    if (!isActorReadScopeCurrent(scope)) return
    state.checkedAt = Date.now()
    state.stale = false
    if (changed || !state.index) {
      const index = await buildIndex(state.pages)
      if (!isActorReadScopeCurrent(scope)) return
      state.index = index
      writeStored(state.pages, scope)
    }
    state.status = 'ready'
    notify()
  } catch (error) {
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
  state.inflight = load(force).finally(() => { state.inflight = null })
  return state.inflight
}

export function markProductSearchIndexStale(): void {
  state.stale = true
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
  if (Date.now() - state.checkedAt > REVALIDATE_MS) void ensureProductSearchIndex()
  return searchTermIndex(state.index, query, options)
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
      state.stale = true
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
