import { compareInitialKeys, getInitialKey } from './initials.mjs'

type ProductId = number

interface ProductRecord {
  id?: unknown
  parent_id?: unknown
  name?: unknown
  is_group?: unknown
  stock_quantity?: unknown
  selling_price_usd?: unknown
  created_at?: unknown
  [key: string]: unknown
}

interface ProductGroupBuildState {
  key: string
  ids: ProductId[]
  items: ProductRecord[]
  explicitRootId: ProductId
  normalizedName: string
  matchedIds: Set<ProductId>
}

export interface ProductGroup {
  key: string
  id: ProductId
  anchorId: ProductId
  name: string
  normalizedName: string
  explicitRootId: ProductId
  ids: ProductId[]
  matchedIds: ProductId[]
  items: ProductRecord[]
  leadProduct: ProductRecord
  sellableItems: Array<ProductRecord & {
    __variantOrdinal: number
    __variantLabel: string
  }>
  hasMultipleItems: boolean
  hasExplicitGroup: boolean
  groupKind: 'variant' | 'option'
  familyCount: number
  stockTotal: number
  latestCreatedAt: string
  minSellingPriceUsd: number
  maxSellingPriceUsd: number
}

export interface ProductGroupSection {
  id: string
  label: string
  ids: ProductId[]
  items: ProductRecord[]
  groups: ProductGroup[]
}

interface BuildGroupSectionsOptions {
  productsById?: Map<unknown, ProductRecord>
  sortDirection?: unknown
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function toProductId(value: unknown): ProductId {
  const id = Number(value || 0)
  return Number.isFinite(id) ? id : 0
}

export function normalizeProductGroupName(value: unknown): string {
  return normalizeText(value).toLowerCase()
}

export function getNameInitialSection(value: unknown): string {
  return getInitialKey(value)
}

function compareSectionLabels(left: unknown, right: unknown): number {
  return compareInitialKeys(left, right)
}

function compareProducts(left: ProductRecord, right: ProductRecord, { rootId = 0 }: { rootId?: ProductId } = {}): number {
  const leftId = toProductId(left?.id)
  const rightId = toProductId(right?.id)
  const leftIsRoot = leftId === Number(rootId)
  const rightIsRoot = rightId === Number(rootId)
  if (leftIsRoot !== rightIsRoot) return leftIsRoot ? -1 : 1

  const leftParent = toProductId(left?.parent_id)
  const rightParent = toProductId(right?.parent_id)
  if (Boolean(leftParent) !== Boolean(rightParent)) return leftParent ? 1 : -1

  const leftName = String(left?.name || '')
  const rightName = String(right?.name || '')
  const nameDelta = leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
  if (nameDelta !== 0) return nameDelta

  const leftPrice = Number(left?.selling_price_usd || 0)
  const rightPrice = Number(right?.selling_price_usd || 0)
  if (leftPrice !== rightPrice) return leftPrice - rightPrice

  return leftId - rightId
}

function buildChildrenByParentId(products: ProductRecord[] = []): Map<ProductId, ProductRecord[]> {
  const map = new Map<ProductId, ProductRecord[]>()
  for (const product of Array.isArray(products) ? products : []) {
    const parentId = toProductId(product?.parent_id)
    if (!parentId) continue
    if (!map.has(parentId)) map.set(parentId, [])
    map.get(parentId)?.push(product)
  }
  return map
}

function resolveRootProduct(product: ProductRecord, productsById: Map<unknown, ProductRecord> = new Map()): ProductRecord {
  let current: ProductRecord | undefined = product
  const visited = new Set<ProductId>()
  while (current) {
    const currentId = toProductId(current?.id)
    if (currentId > 0) {
      if (visited.has(currentId)) break
      visited.add(currentId)
    }
    const parentId = toProductId(current?.parent_id)
    if (!parentId) break
    const parent = productsById.get(parentId)
    if (!parent) break
    current = parent
  }
  return current || product
}

function resolveFamilyRootId(product: ProductRecord, productsById: Map<unknown, ProductRecord> = new Map()): ProductId {
  return toProductId(resolveRootProduct(product, productsById)?.id || product?.id)
}

function compareProductsWithinGroup(left: ProductRecord, right: ProductRecord, productsById: Map<unknown, ProductRecord> = new Map()): number {
  const leftRootId = resolveFamilyRootId(left, productsById)
  const rightRootId = resolveFamilyRootId(right, productsById)

  if (leftRootId !== rightRootId) {
    const leftRootName = String(resolveRootProduct(left, productsById)?.name || left?.name || '')
    const rightRootName = String(resolveRootProduct(right, productsById)?.name || right?.name || '')
    const familyNameDelta = leftRootName.localeCompare(rightRootName, undefined, { sensitivity: 'base' })
    if (familyNameDelta !== 0) return familyNameDelta
    return leftRootId - rightRootId
  }

  return compareProducts(left, right, { rootId: leftRootId })
}

function resolveGroupKey(product: ProductRecord, { productsById = new Map() }: { productsById?: Map<unknown, ProductRecord> } = {}) {
  const root = resolveRootProduct(product, productsById)
  const productId = toProductId(product?.id)
  const rootId = toProductId(root?.id || productId)
  const normalizedName = normalizeProductGroupName(root?.name || product?.name || '')

  if (normalizedName) {
    return {
      key: `name:${normalizedName}`,
      explicitRootId: rootId,
      normalizedName,
    }
  }
  return {
    key: `id:${rootId || productId}`,
    explicitRootId: rootId || 0,
    normalizedName: '',
  }
}

export function buildProductGroups(products: ProductRecord[] = [], productsById: Map<unknown, ProductRecord> = new Map()): ProductGroup[] {
  const source = Array.isArray(products) ? products : []
  const universe = productsById instanceof Map && productsById.size > 0
    ? [...productsById.values()]
    : source
  const childrenByParentId = buildChildrenByParentId(universe)
  const activeKeys = new Set<string>()
  const matchedIdsByKey = new Map<string, Set<ProductId>>()

  for (const product of source) {
    const { key } = resolveGroupKey(product, { productsById })
    activeKeys.add(key)
    if (!matchedIdsByKey.has(key)) matchedIdsByKey.set(key, new Set())
    matchedIdsByKey.get(key)?.add(toProductId(product?.id))
  }

  const groups = new Map<string, ProductGroupBuildState>()
  for (const product of universe) {
    const { key, explicitRootId, normalizedName } = resolveGroupKey(product, {
      productsById,
    })
    if (!activeKeys.has(key)) continue
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ids: [],
        items: [],
        explicitRootId,
        normalizedName,
        matchedIds: matchedIdsByKey.get(key) || new Set(),
      })
    }
    const group = groups.get(key)
    if (!group) continue
    const productId = toProductId(product?.id)
    if (group.ids.includes(productId)) continue
    group.ids.push(productId)
    group.items.push(product)
  }

  return [...groups.values()].map((group): ProductGroup => {
    const items = [...group.items].sort((left, right) => compareProductsWithinGroup(left, right, productsById))
    const familyRootIds = [...new Set(items.map((item) => resolveFamilyRootId(item, productsById)).filter((id) => Number.isFinite(id) && id > 0))]
    const leadProduct = items.find((item) => {
      const itemId = toProductId(item?.id)
      return !toProductId(item?.parent_id) && familyRootIds.includes(itemId)
    }) || items[0] || {}
    const hasChildRows = items.some((item) => toProductId(item?.parent_id) > 0)
    const sellableItems = items.filter((item) => {
      const itemId = toProductId(item?.id)
      const isGroupOnlyRoot = Boolean(Number(item?.is_group || 0))
        && !toProductId(item?.parent_id)
        && (hasChildRows || childrenByParentId.has(itemId))
      return !isGroupOnlyRoot
    }).map((item, index) => ({
      ...item,
      __variantOrdinal: index + 1,
      __variantLabel: `#${index + 1}`,
    }))
    const priceValues = items
      .map((item) => Number(item?.selling_price_usd || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
    const stockTotal = items.reduce((sum, item) => sum + Number(item?.stock_quantity || 0), 0)
    const latestCreatedAt = items.reduce((latest, item) => {
      const value = String(item?.created_at || '')
      return value > latest ? value : latest
    }, '')
    return {
      key: group.key,
      id: toProductId(leadProduct?.id),
      anchorId: toProductId(leadProduct?.id),
      name: normalizeText(leadProduct?.name || items[0]?.name || ''),
      normalizedName: group.normalizedName,
      explicitRootId: toProductId(leadProduct?.id),
      ids: items.map((item) => toProductId(item?.id)).filter((id) => Number.isFinite(id) && id > 0),
      matchedIds: [...(group.matchedIds || new Set())].filter((id) => Number.isFinite(id) && id > 0),
      items,
      leadProduct,
      sellableItems,
      hasMultipleItems: items.length > 1,
      hasExplicitGroup: familyRootIds.length === 1 && items.some((item) => {
        const itemId = toProductId(item?.id)
        return toProductId(item?.parent_id) > 0 || childrenByParentId.has(itemId) || Boolean(Number(item?.is_group || 0))
      }),
      groupKind: familyRootIds.length === 1 && items.some((item) => toProductId(item?.parent_id) > 0)
        ? 'variant'
        : 'option',
      familyCount: familyRootIds.length,
      stockTotal,
      latestCreatedAt,
      minSellingPriceUsd: priceValues.length ? Math.min(...priceValues) : 0,
      maxSellingPriceUsd: priceValues.length ? Math.max(...priceValues) : 0,
    }
  }).sort((left, right) => {
    const nameDelta = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
    if (nameDelta !== 0) return nameDelta
    return Number(left?.anchorId || 0) - Number(right?.anchorId || 0)
  })
}

export function buildProductGroupSections(products: ProductRecord[] = [], {
  productsById = new Map(),
  sortDirection = 'asc',
}: BuildGroupSectionsOptions = {}): ProductGroupSection[] {
  const groups = buildProductGroups(products, productsById)
  const direction = String(sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
  const orderedGroups = [...groups].sort((left, right) => {
    const leftDate = String(left?.latestCreatedAt || '')
    const rightDate = String(right?.latestCreatedAt || '')
    if (leftDate !== rightDate) {
      return direction === 'desc'
        ? rightDate.localeCompare(leftDate)
        : leftDate.localeCompare(rightDate)
    }
    return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
  })

  const sections = new Map<string, ProductGroupSection>()
  for (const group of orderedGroups) {
    const letter = getNameInitialSection(group?.name || '')
    if (!sections.has(letter)) {
      sections.set(letter, {
        id: `product-letter:${letter}`,
        label: letter,
        ids: [],
        items: [],
        groups: [],
      })
    }
    const section = sections.get(letter)
    if (!section) continue
    section.groups.push(group)
    section.ids.push(...group.ids)
    section.items.push(...group.items)
  }

  return [...sections.values()].sort((left, right) => {
    return compareSectionLabels(left.label, right.label)
  })
}
