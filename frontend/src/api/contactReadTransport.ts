import { apiFetch, isInvalidSessionError } from './http.ts'
import type { QueryParams } from './query.ts'
import { filterSelectableCustomerRows } from '../utils/customerIdentity.ts'
import { salesCustomerPickerFallbackMatches } from './customerPickerMatch.ts'
import { assertActorReadScope, captureActorReadScope, invalidateActorReadChannel, isActorReadScopeCurrent, type ActorReadScope } from './actorReadScope.ts'
import { getSyncServerUrl } from './httpState.ts'

type ContactTableName = 'customers' | 'suppliers' | 'delivery_contacts'

type ContactReadConfig = {
  endpoint: string
  routeKey: string
  tableName: ContactTableName
}

type CacheEntry = {
  data: unknown
  ts: number
  scope: ActorReadScope
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
const inflightReads = new Map<string, { promise: Promise<unknown>; scope: ActorReadScope }>()
// Legacy table rows have no actor provenance. Only a completed mirror owned
// by this still-current session can authorize their offline fallback.
const localMirrorScopes = new Map<ContactTableName, ActorReadScope>()

function canUseLocalContactMirror(): boolean {
  if (getSyncServerUrl()) return false
  try {
    if (typeof window !== 'undefined' && (
      /^https?:/.test(window.location?.origin || '')
      || window.sessionStorage?.getItem('businessos_user')
      || window.localStorage?.getItem('businessos_user')
    )) return false
  } catch { return false }
  return true
}
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
  if (!record || !isActorReadScopeCurrent(record.scope) || Date.now() - record.ts > CONTACT_READ_CACHE_MS) return null
  return record.data
}

function setCachedRead(cacheKey: string, data: unknown, scope: ActorReadScope): unknown {
  assertActorReadScope(scope)
  readCache.set(cacheKey, { data, ts: Date.now(), scope })
  return data
}

function scheduleLateMirror(config: ContactReadConfig, data: unknown, scope: ActorReadScope): void {
  if (typeof window === 'undefined' || !canUseLocalContactMirror()) return
  window.setTimeout(() => {
    const run = async () => {
      if (!isActorReadScopeCurrent(scope)) return
      const { mirrorTable, shouldPersistLocalMirror } = await import('./localMirrors.ts')
      if (!isActorReadScopeCurrent(scope) || !canUseLocalContactMirror() || !shouldPersistLocalMirror(config.tableName)) return
      await mirrorTable(config.tableName, scope)(data)
      if (isActorReadScopeCurrent(scope) && canUseLocalContactMirror() && shouldPersistLocalMirror(config.tableName)) localMirrorScopes.set(config.tableName, scope)
    }
    const idle = (window as unknown as { requestIdleCallback?: (callback: IdleCallback, options?: { timeout?: number }) => number }).requestIdleCallback
    if (typeof idle === 'function') {
      idle(() => { void run().catch(() => {}) }, { timeout: CONTACT_MIRROR_DELAY_MS })
      return
    }
    void run().catch(() => {})
  }, CONTACT_MIRROR_DELAY_MS)
}

function readContacts(config: ContactReadConfig, params: QueryParams = {}): Promise<unknown> {
  const scope = captureActorReadScope(config.routeKey)
  const query = buildQueryString(params)
  const cacheKey = `${config.routeKey}:${query}`
  const cached = getCachedRead(cacheKey)
  if (cached !== null) return Promise.resolve().then(() => { assertActorReadScope(scope); return cached })

  const existing = inflightReads.get(cacheKey)
  if (existing && isActorReadScopeCurrent(existing.scope)) return existing.promise.then((data) => { assertActorReadScope(scope); return data })

  const groupCtrl = beginContactSearchGroup(config.tableName)
  const promise = apiFetch('GET', appendQuery(config.endpoint, query), undefined, undefined, { signal: groupCtrl.signal })
    .then((data) => {
      assertActorReadScope(scope)
      setCachedRead(cacheKey, data, scope)
      if (!query) scheduleLateMirror(config, data, scope)
      return data
    })
    .catch(async (error) => {
      assertActorReadScope(scope)
      const status = Number((error as { status?: unknown } | null)?.status)
      if (status === 401 || status === 403 || isInvalidSessionError(error)) throw error
      if (isAbortError(error)) {
        // Superseded by a newer search in this same tab -- not a real
        // failure, and reading local data for a query the user has
        // already moved on from would be pure waste, so just propagate.
        throw error
      }
      const provenance = localMirrorScopes.get(config.tableName)
      if (!canUseLocalContactMirror() || !provenance || !isActorReadScopeCurrent(provenance)) throw error
      const localRows = await readLocalContacts(config.tableName)
      assertActorReadScope(scope)
      setCachedRead(cacheKey, localRows, scope)
      return localRows
    })
    .finally(() => {
      if (inflightReads.get(cacheKey)?.promise === promise) inflightReads.delete(cacheKey)
      endContactSearchGroup(config.tableName, groupCtrl)
    })

  inflightReads.set(cacheKey, { promise, scope })
  return promise
}

export function getCustomers(params: QueryParams = {}): Promise<unknown> {
  const scope = captureActorReadScope(CUSTOMER_READ.routeKey)
  return readContacts(CUSTOMER_READ, params).then((data) => {
    assertActorReadScope(scope)
    if (Array.isArray(data)) return filterSelectableCustomerRows(data)
    if (!data || typeof data !== 'object') return data
    const payload = data as Record<string, unknown>
    if (!Array.isArray(payload.items)) return data
    const items = filterSelectableCustomerRows(payload.items)
    return items.length === payload.items.length ? data : { ...payload, items }
  })
}

// Sales must distinguish an explicitly marked walk-in identity from an
// ordinary linked customer before choosing its editor. Keep this exact-id
// read separate from picker reads, which intentionally remove anonymous rows.
export function getCustomerIdentityById(id: number | string): Promise<unknown> {
  return readContacts(CUSTOMER_READ, { ids: [String(id)] })
}

export function invalidateCustomerReadCache(): void {
  invalidateActorReadChannel(CUSTOMER_READ.routeKey)
  for (const key of readCache.keys()) {
    if (key === CUSTOMER_READ.routeKey || key.startsWith(`${CUSTOMER_READ.routeKey}:`)) readCache.delete(key)
  }
  searchGroupControllers.get('customers')?.abort()
  searchGroupControllers.delete('customers')
}

// Sales/POS-only customer identity shape. The server omits Contacts finance
// and directory-only fields; an offline fallback is projected to the same
// allowlist so a cached directory row cannot widen the picker response.
export async function getSalesCustomerPicker(params: QueryParams = {}, options: { requireFresh?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
  const scope = captureActorReadScope(CUSTOMER_READ.routeKey)
  const query = buildQueryString({ ...params, fields: 'sales_picker' })
  try {
    const result = await apiFetch('GET', appendQuery(CUSTOMER_READ.endpoint, query), undefined, undefined, { signal: options.signal })
    assertActorReadScope(scope)
    return result
  } catch (error) {
    assertActorReadScope(scope)
    const status = Number((error as { status?: unknown } | null)?.status)
    if (options.requireFresh || status === 401 || status === 403 || isInvalidSessionError(error) || isAbortError(error)) throw error
    const provenance = localMirrorScopes.get('customers')
    if (!canUseLocalContactMirror() || !provenance || !isActorReadScopeCurrent(provenance)) throw error
    const search = String(params.search || params.q || '').trim()
    const ids = new Set(String(params.ids || '').split(',').map((value) => value.trim()).filter(Boolean))
    const rows = (await readLocalContacts('customers'))
      .filter((row) => {
        const value = row as Record<string, unknown>
        if (Number(value.is_anonymous || 0) === 1) return false
        if (ids.size && !ids.has(String(value.id ?? ''))) return false
        if (!search) return true
        return salesCustomerPickerFallbackMatches(value, search)
      })
      .slice(0, Math.max(1, Math.min(100, Number(params.pageSize || params.limit || 50) || 50)))
      .map((row) => {
        const value = row as Record<string, unknown>
        return Object.fromEntries(['id', 'name', 'phone', 'email', 'address', 'membership_number', 'updated_at', 'is_anonymous'].map((key) => [key, value[key]]))
      })
    assertActorReadScope(scope)
    return { items: rows, limit: rows.length }
  }
}

// Authenticated exact lookup: never mirror a balance or fall back after denial.
export function lookupCustomerMembership(membershipNumber: string): Promise<unknown> {
  return apiFetch('GET', `/api/customers/membership/${encodeURIComponent(membershipNumber.trim())}`)
}

export function getSuppliers(params: QueryParams = {}): Promise<unknown> {
  return readContacts(SUPPLIER_READ, params)
}

// D5 (Part 384): every batch attributed to one supplier, with received
// totals, unit costs, remaining stock, and paid/credit state. Server-gated
// by the contacts_suppliers permission like the rest of /suppliers.
export function getSupplierPurchases(id: number | string, params: QueryParams = {}): Promise<unknown> {
  return apiFetch('GET', appendQuery(`/api/suppliers/${encodeURIComponent(String(id))}/purchases`, buildQueryString(params)))
}

export function getDeliveryContacts(params: QueryParams = {}): Promise<unknown> {
  return readContacts(DELIVERY_CONTACT_READ, params)
}

// D1b: the Stock-In Invoice report -- purchases grouped supplier →
// received date → product lines, with branch/supplier/date filters.
// Server-gated by contacts_suppliers like the rest of /suppliers.
export function getStockInInvoiceReport(params: QueryParams = {}): Promise<unknown> {
  return apiFetch('GET', appendQuery('/api/suppliers/reports/stock-in-invoices', buildQueryString(params)))
}

// One invoice group's product lines, paged. The no-date group's day
// travels as 'none' (an empty value would be dropped from the query).
export function getStockInInvoiceLines(params: QueryParams = {}): Promise<unknown> {
  return apiFetch('GET', appendQuery('/api/suppliers/reports/stock-in-invoice-lines', buildQueryString(params)))
}

// The legacy supplier AP ledger (the old system's account-payable reports,
// stored as finance history by the Aug-30 migration). Server-gated by
// contacts_suppliers like the rest of /suppliers.
export function getSupplierApInvoices(params: QueryParams = {}): Promise<unknown> {
  return apiFetch('GET', appendQuery('/api/suppliers/reports/ap-invoices', buildQueryString(params)))
}

// Customer accounts-receivable ledger (migration 0094) -- the customer-side
// mirror of the supplier AP read above.
export function getCustomerReceivables(params: QueryParams = {}): Promise<unknown> {
  return apiFetch('GET', appendQuery('/api/customers/reports/ar-invoices', buildQueryString(params)))
}
