import { apiFetch, isInvalidSessionError } from './http.ts'
import type { QueryParams } from './query.ts'

type ContactTableName = 'customers' | 'suppliers' | 'delivery_contacts'

type ContactReadConfig = {
  endpoint: string
  routeKey: string
  tableName: ContactTableName
}

type CacheEntry = {
  data: unknown
  ts: number
}

type IdleCallback = (deadline?: unknown) => void

const CONTACT_READ_CACHE_MS = 20_000
const CONTACT_MIRROR_DELAY_MS = 8_000

const CUSTOMER_READ = {
  endpoint: '/api/customers',
  routeKey: 'customers',
  tableName: 'customers',
} satisfies ContactReadConfig

const DELIVERY_CONTACT_READ = {
  endpoint: '/api/delivery-contacts',
  routeKey: 'deliveryContacts',
  tableName: 'delivery_contacts',
} satisfies ContactReadConfig

const SUPPLIER_READ = {
  endpoint: '/api/suppliers',
  routeKey: 'suppliers',
  tableName: 'suppliers',
} satisfies ContactReadConfig

const readCache = new Map<string, CacheEntry>()
const inflightReads = new Map<string, Promise<unknown>>()
// One AbortController per contact table (customers/suppliers/delivery
// contacts), separate from the per-query `cacheKey` above -- that key is
// unique per query string on purpose (so distinct searches don't collide),
// which is exactly why it could never help cancel a superseded request.
// This map instead tracks "the current in-flight request for this tab's
// search box", so a new keystroke in e.g. CustomersTab aborts whatever
// customers request was still in flight rather than leaving it to keep
// running against the server after the UI has already moved on.
const searchGroupControllers = new Map<ContactTableName, AbortController>()

function beginContactSearchGroup(tableName: ContactTableName): AbortController {
  searchGroupControllers.get(tableName)?.abort()
  const ctrl = new AbortController()
  searchGroupControllers.set(tableName, ctrl)
  return ctrl
}

function endContactSearchGroup(tableName: ContactTableName, ctrl: AbortController): void {
  if (searchGroupControllers.get(tableName) === ctrl) searchGroupControllers.delete(tableName)
}

function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError'
}

async function readLocalContacts(tableName: ContactTableName): Promise<unknown[]> {
  const { getLocalDb } = await import('./lazyLocalDb.ts')
  const db = await getLocalDb()
  return db.table(tableName).orderBy('name').toArray()
}

function buildQueryString(params: QueryParams = {}): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null && item !== '') query.append(key, String(item))
      }
      continue
    }
    query.set(key, String(value))
  }
  return query.toString()
}

function appendQuery(path: string, query: string): string {
  if (!query) return path
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

function getCachedRead(cacheKey: string): unknown | null {
  const record = readCache.get(cacheKey)
  if (!record || Date.now() - record.ts > CONTACT_READ_CACHE_MS) return null
  return record.data
}

function setCachedRead(cacheKey: string, data: unknown): unknown {
  readCache.set(cacheKey, { data, ts: Date.now() })
  return data
}

function scheduleLateMirror(config: ContactReadConfig, data: unknown): void {
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    const run = async () => {
      const { mirrorTable } = await import('./localMirrors.ts')
      mirrorTable(config.tableName)(data).catch(() => {})
    }
    const idle = (window as unknown as { requestIdleCallback?: (callback: IdleCallback, options?: { timeout?: number }) => number }).requestIdleCallback
    if (typeof idle === 'function') {
      idle(run, { timeout: CONTACT_MIRROR_DELAY_MS })
      return
    }
    run()
  }, CONTACT_MIRROR_DELAY_MS)
}

function readContacts(config: ContactReadConfig, params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `${config.routeKey}:${query}`
  const cached = getCachedRead(cacheKey)
  if (cached !== null) return Promise.resolve(cached)

  const existing = inflightReads.get(cacheKey)
  if (existing) return existing

  const groupCtrl = beginContactSearchGroup(config.tableName)
  const promise = apiFetch('GET', appendQuery(config.endpoint, query), undefined, undefined, { signal: groupCtrl.signal })
    .then((data) => {
      setCachedRead(cacheKey, data)
      if (!query) scheduleLateMirror(config, data)
      return data
    })
    .catch(async (error) => {
      if (isInvalidSessionError(error)) throw error
      if (isAbortError(error)) {
        // Superseded by a newer search in this same tab -- not a real
        // failure, and reading local data for a query the user has
        // already moved on from would be pure waste, so just propagate.
        throw error
      }
      const localRows = await readLocalContacts(config.tableName)
      setCachedRead(cacheKey, localRows)
      return localRows
    })
    .finally(() => {
      inflightReads.delete(cacheKey)
      endContactSearchGroup(config.tableName, groupCtrl)
    })

  inflightReads.set(cacheKey, promise)
  return promise
}

export function getCustomers(params: QueryParams = {}): Promise<unknown> {
  return readContacts(CUSTOMER_READ, params)
}

export function getSuppliers(params: QueryParams = {}): Promise<unknown> {
  return readContacts(SUPPLIER_READ, params)
}

export function getDeliveryContacts(params: QueryParams = {}): Promise<unknown> {
  return readContacts(DELIVERY_CONTACT_READ, params)
}
