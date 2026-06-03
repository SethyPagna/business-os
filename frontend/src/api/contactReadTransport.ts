import { apiFetch, isInvalidSessionError } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { mirrorTable } from './localMirrors.ts'

type ContactTableName = 'customers' | 'delivery_contacts'

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

const readCache = new Map<string, CacheEntry>()
const inflightReads = new Map<string, Promise<unknown>>()

async function readLocalContacts(tableName: ContactTableName): Promise<unknown[]> {
  const db = await getLocalDb()
  return db.table(tableName).orderBy('name').toArray()
}

function getCachedRead(routeKey: string): unknown | null {
  const record = readCache.get(routeKey)
  if (!record || Date.now() - record.ts > CONTACT_READ_CACHE_MS) return null
  return record.data
}

function setCachedRead(routeKey: string, data: unknown): unknown {
  readCache.set(routeKey, { data, ts: Date.now() })
  return data
}

function scheduleLateMirror(config: ContactReadConfig, data: unknown): void {
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    const run = () => {
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

function readContacts(config: ContactReadConfig): Promise<unknown> {
  const cached = getCachedRead(config.routeKey)
  if (cached !== null) return Promise.resolve(cached)

  const existing = inflightReads.get(config.routeKey)
  if (existing) return existing

  const promise = apiFetch('GET', config.endpoint)
    .then((data) => {
      setCachedRead(config.routeKey, data)
      scheduleLateMirror(config, data)
      return data
    })
    .catch(async (error) => {
      if (isInvalidSessionError(error)) throw error
      const localRows = await readLocalContacts(config.tableName)
      setCachedRead(config.routeKey, localRows)
      return localRows
    })
    .finally(() => {
      inflightReads.delete(config.routeKey)
    })

  inflightReads.set(config.routeKey, promise)
  return promise
}

export function getCustomers(): Promise<unknown> {
  return readContacts(CUSTOMER_READ)
}

export function getDeliveryContacts(): Promise<unknown> {
  return readContacts(DELIVERY_CONTACT_READ)
}
