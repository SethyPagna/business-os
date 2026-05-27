import { withLoaderTimeout } from '../../../utils/loaders.mjs'

const LOOKUP_PRODUCT_PAGE_SIZE = 100
const LOOKUP_PRODUCT_NAME_CONCURRENCY = 2
const PRODUCT_RESTORE_BATCH_SIZE = 100

export function normalizeLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeProductRows(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function snapshotLookupProducts(products = [], field, names = []) {
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

function mergeUniqueSnapshots(current = [], next = []) {
  const byId = new Map((current || []).map((product) => [Number(product?.id || 0), product]))
  ;(next || []).forEach((product) => {
    const id = Number(product?.id || 0)
    if (Number.isFinite(id) && id > 0) byId.set(id, product)
  })
  return Array.from(byId.values())
}

async function mapLookupNames(names, mapper) {
  const list = Array.isArray(names) ? names : []
  const output = new Array(list.length)
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

async function fetchLookupProductSnapshotsForName({ client, field, name, label, timeoutMs }) {
  let snapshots = []
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
    const total = Number(payload?.total || 0)
    const pageSize = Number(payload?.pageSize || LOOKUP_PRODUCT_PAGE_SIZE) || LOOKUP_PRODUCT_PAGE_SIZE
    totalPages = Number(payload?.totalPages || Math.ceil(total / pageSize) || 1) || 1
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
}) {
  const client = api || window.api
  const cleanNames = Array.from(new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean)))
  if (!cleanNames.length || typeof client?.searchProducts !== 'function') return []

  const snapshotGroups = await mapLookupNames(cleanNames, (name) =>
    fetchLookupProductSnapshotsForName({ client, field, name, label, timeoutMs }))
  return snapshotGroups.reduce((merged, group) => mergeUniqueSnapshots(merged, group), [])
}

async function fetchProductsByIds({ api, ids = [], label, timeoutMs }) {
  const client = api || window.api
  const uniqueIds = Array.from(new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
  const latest = []
  for (let index = 0; index < uniqueIds.length; index += PRODUCT_RESTORE_BATCH_SIZE) {
    const batchIds = uniqueIds.slice(index, index + PRODUCT_RESTORE_BATCH_SIZE)
    const payload = await withLoaderTimeout(
      () => {
        if (typeof client?.getProductsByIds === 'function') return client.getProductsByIds(batchIds, { include: '' })
        return client.searchProducts({ page: 1, pageSize: batchIds.length, ids: batchIds.join(','), include: '' })
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
}) {
  if (!snapshots.length) return
  const client = api || window.api
  const latestProducts = await fetchProductsByIds({
    api: client,
    ids: snapshots.map((snapshot) => snapshot?.id),
    label,
    timeoutMs,
  })
  const latestMap = new Map(
    latestProducts
      .map((product) => [Number(product?.id || 0), product])
      .filter(([id]) => Number.isFinite(id) && id > 0),
  )
  for (const snapshot of snapshots) {
    const productId = Number(snapshot?.id || 0)
    const latest = latestMap.get(productId)
    if (!latest) continue
    const nextValue = String(snapshot?.[field] || '').trim()
    const currentValue = String(latest?.[field] || '').trim()
    if (currentValue === nextValue) continue
    await client.updateProduct(productId, {
      [field]: nextValue,
      expectedUpdatedAt: latest?.updated_at || snapshot?.updated_at || undefined,
      ...extraUpdateFields,
    })
  }
}
