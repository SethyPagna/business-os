import { withLoaderTimeout } from '../../../utils/loaders'

const LOOKUP_PRODUCT_PAGE_SIZE = 100
const LOOKUP_PRODUCT_NAME_CONCURRENCY = 2
const PRODUCT_RESTORE_BATCH_SIZE = 100

type ProductRow = Record<string, unknown> & {
  id?: unknown
  name?: unknown
  updated_at?: unknown
}

type ProductPayload = ProductRow[] | {
  items?: ProductRow[]
  total?: unknown
  pageSize?: unknown
  totalPages?: unknown
}

type ProductApiClient = {
  searchProducts?: (params: Record<string, unknown>) => Promise<ProductPayload> | ProductPayload
  getProductsByIds?: (ids: number[], options: { include: string }) => Promise<ProductPayload> | ProductPayload
  updateProduct?: (id: number, payload: Record<string, unknown>) => Promise<unknown> | unknown
}

type ProductSearchClient = ProductApiClient & {
  searchProducts: (params: Record<string, unknown>) => Promise<ProductPayload> | ProductPayload
}

type LookupSnapshot = ProductRow & {
  id: number
  name: string
  updated_at: unknown
}

type LookupSnapshotOptions = {
  api?: ProductApiClient
  field: string
  names?: unknown[]
  label?: string
  timeoutMs?: number
}

type RestoreLookupSnapshotOptions = {
  api?: ProductApiClient
  field: string
  snapshots?: ProductRow[]
  label?: string
  timeoutMs?: number
  extraUpdateFields?: Record<string, unknown>
}

export function normalizeLookup(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function getFallbackApiClient(): ProductApiClient {
  return typeof window !== 'undefined'
    ? (window as Window & { api?: ProductApiClient }).api || {}
    : {}
}

function normalizeProductRows(payload: unknown): ProductRow[] {
  if (Array.isArray(payload)) return payload as ProductRow[]
  const items = (payload as { items?: ProductRow[] } | null | undefined)?.items
  if (Array.isArray(items)) return items
  return []
}

function getPayloadNumber(payload: unknown, key: 'total' | 'pageSize' | 'totalPages'): number {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return 0
  return Number((payload as Record<string, unknown>)[key] || 0)
}

function snapshotLookupProducts(products: unknown = [], field: string, names: unknown[] = []): LookupSnapshot[] {
  const lookups = new Set((names || []).map((name) => normalizeLookup(name)).filter(Boolean))
  if (!lookups.size) return []
  return normalizeProductRows(products)
    .filter((product) => lookups.has(normalizeLookup(product?.[field])))
    .map((product) => ({
      id: Number(product?.id || 0),
      name: String(product?.name || ''),
      updated_at: product?.updated_at || null,
      [field]: String(product?.[field] || ''),
    }))
    .filter((product) => Number.isFinite(product.id) && product.id > 0)
}

function mergeUniqueSnapshots(current: ProductRow[] = [], next: ProductRow[] = []): ProductRow[] {
  const byId = new Map((current || []).map((product) => [Number(product?.id || 0), product]))
  ;(next || []).forEach((product) => {
    const id = Number(product?.id || 0)
    if (Number.isFinite(id) && id > 0) byId.set(id, product)
  })
  return Array.from(byId.values())
}

async function mapLookupNames<T>(names: unknown[], mapper: (name: string, index: number) => Promise<T>): Promise<T[]> {
  const list = Array.isArray(names) ? names.map((name) => String(name || '')) : []
  const output = new Array<T>(list.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(LOOKUP_PRODUCT_NAME_CONCURRENCY, list.length) }, async () => {
    while (nextIndex < list.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      output[currentIndex] = await mapper(list[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
  return output
}

async function fetchLookupProductSnapshotsForName({
  client,
  field,
  name,
  label,
  timeoutMs,
}: {
  client: ProductSearchClient
  field: string
  name: string
  label: string
  timeoutMs?: number
}): Promise<ProductRow[]> {
  let snapshots: ProductRow[] = []
  let page = 1
  let totalPages = 1
  do {
    const payload = await withLoaderTimeout(
      () => client.searchProducts({
        page,
        pageSize: LOOKUP_PRODUCT_PAGE_SIZE,
        [field]: name,
        sort: 'name_asc',
      }),
      label,
      timeoutMs,
    )
    snapshots = mergeUniqueSnapshots(snapshots, snapshotLookupProducts(payload, field, [name]))
    const total = getPayloadNumber(payload, 'total')
    const pageSize = getPayloadNumber(payload, 'pageSize') || LOOKUP_PRODUCT_PAGE_SIZE
    totalPages = getPayloadNumber(payload, 'totalPages') || Math.ceil(total / pageSize) || 1
    page += 1
  } while (page <= totalPages)
  return snapshots
}

export async function fetchLookupProductSnapshots({
  api,
  field,
  names = [],
  label = 'Lookup product snapshots',
  timeoutMs,
}: LookupSnapshotOptions): Promise<ProductRow[]> {
  const client = api || getFallbackApiClient()
  const cleanNames = Array.from(new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean)))
  if (!cleanNames.length || typeof client?.searchProducts !== 'function') return []

  const snapshotGroups = await mapLookupNames(cleanNames, (name) =>
    fetchLookupProductSnapshotsForName({ client: client as ProductSearchClient, field, name, label, timeoutMs }))
  return snapshotGroups.reduce((merged, group) => mergeUniqueSnapshots(merged, group), [])
}

async function fetchProductsByIds({
  api,
  ids = [],
  label,
  timeoutMs,
}: {
  api?: ProductApiClient
  ids?: unknown[]
  label: string
  timeoutMs?: number
}): Promise<ProductRow[]> {
  const client = api || getFallbackApiClient()
  const uniqueIds = Array.from(new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
  const latest: ProductRow[] = []
  for (let index = 0; index < uniqueIds.length; index += PRODUCT_RESTORE_BATCH_SIZE) {
    const batchIds = uniqueIds.slice(index, index + PRODUCT_RESTORE_BATCH_SIZE)
    const payload = await withLoaderTimeout(
      () => {
        if (typeof client?.getProductsByIds === 'function') return client.getProductsByIds(batchIds, { include: '' })
        return client.searchProducts?.({ page: 1, pageSize: batchIds.length, ids: batchIds.join(','), include: '' })
      },
      label,
      timeoutMs,
    )
    latest.push(...normalizeProductRows(payload))
  }
  return latest
}

export async function restoreLookupProductSnapshots({
  api,
  field,
  snapshots = [],
  label = 'Lookup product restore',
  timeoutMs,
  extraUpdateFields = {},
}: RestoreLookupSnapshotOptions): Promise<void> {
  if (!snapshots.length) return
  const client = api || getFallbackApiClient()
  const latestProducts = await fetchProductsByIds({
    api: client,
    ids: snapshots.map((snapshot) => snapshot?.id),
    label,
    timeoutMs,
  })
  const latestMap = new Map(
    latestProducts
      .map((product) => [Number(product?.id || 0), product] as const)
      .filter(([id]) => Number.isFinite(id) && id > 0),
  )
  for (const snapshot of snapshots) {
    const productId = Number(snapshot?.id || 0)
    const latest = latestMap.get(productId)
    if (!latest) continue
    const nextValue = String(snapshot?.[field] || '').trim()
    const currentValue = String(latest?.[field] || '').trim()
    if (currentValue === nextValue) continue
    await client.updateProduct?.(productId, {
      [field]: nextValue,
      expectedUpdatedAt: latest?.updated_at || snapshot?.updated_at || undefined,
      ...extraUpdateFields,
    })
  }
}
