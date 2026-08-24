import { compareInitialKeys, getInitialKey } from './initials.ts'

type ProductId = number

export interface ProductRecord {
  id?: unknown
  parent_id?: unknown
  name?: unknown
  is_group?: unknown
  stock_quantity?: unknown
  selling_price_usd?: unknown
  created_at?: unknown
  barcode?: unknown
  branch_stock?: unknown
  [key: string]: unknown
}

interface ProductGroupBuildState {
  key: string
  ids: ProductId[]
  items: ProductRecord[]
  explicitRootId: ProductId
  normalizedName: string
  matchedIds: Set<ProductId>
  // O(1) membership check for the dedupe below -- `ids` stays a plain array
  // (insertion order matters for display) but every id added to it is
  // mirrored here so we're not doing an O(k) `ids.includes()` scan per
  // product. Without this, a single large group (e.g. every unnamed/
  // no-name-fallback product, or a big variant family) turns the whole
  // build into O(k^2) on that group's size.
  seenIds: Set<ProductId>
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
  // Display rows after collapsing branch-only duplicates (see
  // mergeSameDetailRows): one entry per genuinely distinct product, each
  // possibly spanning multiple branches via its own combined branch_stock.
  // Products/Inventory list surfaces should iterate this, not `items`, so
  // same-name-same-details rows that differ only by branch render as a
  // single row instead of one row per branch. `items` is kept as-is (every
  // raw underlying product row) for selection/bulk-action scope and for
  // anything that needs the true per-row id list.
  rows: ProductGroupRow[]
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
  // Distinct branch names this group has any stock bookkeeping for, unioned
  // across every item's branch_stock array (a product can appear in several
  // branches at once, so this is a set, not a count derived from row count).
  // Used by the "wrap" collapsed-group header (name + rows + qty + branches)
  // on Products/Inventory/Branches -- see buildProductGroupSummaryParts.
  branchNames: string[]
}

export interface ProductGroupSection {
  id: string
  label: string
  ids: ProductId[]
  items: ProductRecord[]
  groups: ProductGroup[]
}

export interface ProductGroupRow extends ProductRecord {
  __mergedProductIds: ProductId[]
  __mergedRowCount: number
}

// Fields intentionally left out of the "is this the same product, just at a
// different branch" comparison. Two rows differing ONLY in these fields are
// considered the same underlying product and get merged into a single
// display row (see mergeSameDetailRows below):
//  - id / created_at / updated_at: bookkeeping, not a real-world detail.
//  - stock_quantity / branch_stock / rfid_confirmed_qty: exactly the
//    per-branch data that's supposed to differ -- that's the whole reason
//    two rows exist. Combined into the merged row's own branch_stock/
//    stock_quantity instead of being compared.
//  - client_request_id: import/dedupe bookkeeping from whichever request
//    created the row, not a product attribute.
//  - image_gallery: derived read-side data (product_images join), not a
//    stored column -- image_path (the real stored field) is still compared.
const ROW_MERGE_IGNORED_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'stock_quantity',
  'branch_stock',
  'rfid_confirmed_qty',
  'client_request_id',
  'image_gallery',
])

function normalizeSignatureValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildRowMergeSignature(item: ProductRecord): string {
  return Object.keys(item)
    .filter((key) => !ROW_MERGE_IGNORED_FIELDS.has(key))
    .sort()
    .map((key) => `${key}=${normalizeSignatureValue(item[key])}`)
    .join('\u0001')
}

function mergeBranchStockEntries(items: ProductRecord[]): Array<{ branch_id: unknown; branch_name: unknown; quantity: number }> {
  const byBranch = new Map<string, { branch_id: unknown; branch_name: unknown; quantity: number }>()
  for (const item of items) {
    const branchStock = Array.isArray(item?.branch_stock) ? item.branch_stock as Array<Record<string, unknown>> : []
    for (const entry of branchStock) {
      const branchId = entry?.branch_id
      if (branchId === null || branchId === undefined) continue
      const key = String(branchId)
      const qty = Number(entry?.quantity || 0)
      const existing = byBranch.get(key)
      if (existing) {
        existing.quantity += qty
        if (!existing.branch_name && entry?.branch_name) existing.branch_name = entry.branch_name
      } else {
        byBranch.set(key, { branch_id: branchId, branch_name: entry?.branch_name, quantity: qty })
      }
    }
  }
  return [...byBranch.values()]
}

// Collapses items that are the *same product* (identical in every field
// except branch/stock bookkeeping -- see ROW_MERGE_IGNORED_FIELDS) into one
// synthetic display row per unique signature, with branch_stock/
// stock_quantity combined across every underlying row. Items whose details
// genuinely differ (different price, barcode, category, etc.) stay as
// separate rows -- only the branch-duplicate case merges. No sorting is
// imposed here; rows come back in first-seen order within `items`.
export function mergeSameDetailRows(items: ProductRecord[] = []): ProductGroupRow[] {
  const source = Array.isArray(items) ? items : []
  const clusters = new Map<string, ProductRecord[]>()
  const order: string[] = []
  for (const item of source) {
    const signature = buildRowMergeSignature(item)
    if (!clusters.has(signature)) {
      clusters.set(signature, [])
      order.push(signature)
    }
    clusters.get(signature)?.push(item)
  }

  return order.map((signature): ProductGroupRow => {
    const cluster = [...(clusters.get(signature) || [])].sort((a, b) => toProductId(a?.id) - toProductId(b?.id))
    const lead = cluster[0] || {}
    const mergedProductIds = cluster.map((item) => toProductId(item?.id)).filter((id) => Number.isFinite(id) && id > 0)
    if (cluster.length <= 1) {
      return {
        ...lead,
        __mergedProductIds: mergedProductIds,
        __mergedRowCount: 1,
      }
    }
    const branchStock = mergeBranchStockEntries(cluster)
    const stockTotal = branchStock.length
      ? branchStock.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)
      : cluster.reduce((sum, item) => sum + Number(item?.stock_quantity || 0), 0)
    return {
      ...lead,
      id: lead.id,
      stock_quantity: stockTotal,
      branch_stock: branchStock,
      __mergedProductIds: mergedProductIds,
      __mergedRowCount: cluster.length,
    }
  })
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

// Resolves a stable "primary branch" label for a product that carries a
// branch_stock array (a product isn't intrinsically tied to one branch --
// it can have stock at several). For sort-ordering purposes, the primary
// branch is: the alphabetically-first branch name among branches where the
// product actually has stock (quantity > 0); if it has no in-stock
// branches, falls back to the alphabetically-first branch name among any
// listed branch (e.g. a branch with 0 qty); if branch_stock is missing or
// empty, returns null so the product sorts after every branch-assigned one.
function getPrimaryBranchLabel(product: ProductRecord): string | null {
  const branchStock = Array.isArray(product?.branch_stock) ? product.branch_stock as Array<Record<string, unknown>> : []
  if (!branchStock.length) return null
  const labelFor = (entry: Record<string, unknown>): string => {
    const name = entry?.branch_name
    if (typeof name === 'string' && name.trim()) return name.trim()
    const id = entry?.branch_id
    return id === null || id === undefined ? '' : String(id)
  }
  const inStock = branchStock.filter((entry) => Number(entry?.quantity || 0) > 0)
  const pool = inStock.length ? inStock : branchStock
  let best: string | null = null
  for (const entry of pool) {
    const label = labelFor(entry)
    if (!label) continue
    if (best === null || label.localeCompare(best, undefined, { sensitivity: 'base' }) < 0) best = label
  }
  return best
}

function compareBranchLabels(left: ProductRecord, right: ProductRecord): number {
  const leftLabel = getPrimaryBranchLabel(left)
  const rightLabel = getPrimaryBranchLabel(right)
  if (leftLabel === rightLabel) return 0
  if (leftLabel === null) return 1
  if (rightLabel === null) return -1
  return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' })
}

function compareBarcodes(left: ProductRecord, right: ProductRecord): number {
  const leftBarcode = String(left?.barcode || '').trim()
  const rightBarcode = String(right?.barcode || '').trim()
  if (leftBarcode === rightBarcode) return 0
  if (!leftBarcode) return 1
  if (!rightBarcode) return -1
  return leftBarcode.localeCompare(rightBarcode, undefined, { sensitivity: 'base', numeric: true })
}

// Shared name -> branch -> price -> barcode ordering, exported so any other
// surface that lists same-name variants side by side (POS's variant-child
// list, for one) sorts them the same way instead of re-deriving its own
// rule. See getPrimaryBranchLabel just above for what "branch" means here.
export function compareProductsByNameBranchPriceBarcode(left: ProductRecord, right: ProductRecord): number {
  const leftName = String(left?.name || '')
  const rightName = String(right?.name || '')
  const nameDelta = leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
  if (nameDelta !== 0) return nameDelta

  const branchDelta = compareBranchLabels(left, right)
  if (branchDelta !== 0) return branchDelta

  const leftPrice = Number(left?.selling_price_usd || 0)
  const rightPrice = Number(right?.selling_price_usd || 0)
  if (leftPrice !== rightPrice) return leftPrice - rightPrice

  const barcodeDelta = compareBarcodes(left, right)
  if (barcodeDelta !== 0) return barcodeDelta

  return toProductId(left?.id) - toProductId(right?.id)
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

  // name -> branch -> price -> barcode, per the requested Groups sort order.
  return compareProductsByNameBranchPriceBarcode(left, right)
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
        seenIds: new Set(),
      })
    }
    const group = groups.get(key)
    if (!group) continue
    const productId = toProductId(product?.id)
    if (group.seenIds.has(productId)) continue
    group.seenIds.add(productId)
    group.ids.push(productId)
    group.items.push(product)
  }

  return [...groups.values()].map((group): ProductGroup => {
    const items = [...group.items].sort((left, right) => compareProductsWithinGroup(left, right, productsById))
    const familyRootIdSet = new Set(items.map((item) => resolveFamilyRootId(item, productsById)).filter((id) => Number.isFinite(id) && id > 0))
    const familyRootIds = [...familyRootIdSet]
    const leadProduct = items.find((item) => {
      const itemId = toProductId(item?.id)
      return !toProductId(item?.parent_id) && familyRootIdSet.has(itemId)
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
    const branchNameSet = new Set<string>()
    for (const item of items) {
      const branchStock = Array.isArray(item?.branch_stock) ? item.branch_stock as Array<Record<string, unknown>> : []
      for (const entry of branchStock) {
        const label = String(entry?.branch_name || '').trim()
        if (label) branchNameSet.add(label)
      }
    }
    const branchNames = [...branchNameSet].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
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
      rows: mergeSameDetailRows(items),
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
      branchNames,
    }
  }).sort((left, right) => {
    const nameDelta = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
    if (nameDelta !== 0) return nameDelta
    return Number(left?.anchorId || 0) - Number(right?.anchorId || 0)
  })
}

// Category-first sectioning (per the explicit decision recorded in
// progress.md's Products/Inventory display-layering item): category is now
// the primary grouping axis instead of name-initial letter. Sections are
// one per category, sorted A-Z by category name; groups inside each
// section are sorted A-Z by product name (the two-level "category A-Z,
// then name A-Z within category" sort the ask specified). Products with no
// category go into a single trailing section using `uncategorizedLabel`
// (translated by the caller -- this util has no access to t()), always
// sorted last regardless of what that label's text happens to be, via
// `sortsLast` rather than a magic-string comparison.
export function buildProductCategorySections(products: ProductRecord[] = [], {
  productsById = new Map(),
  sortDirection = 'asc',
  uncategorizedLabel = 'Uncategorized',
}: BuildGroupSectionsOptions & { uncategorizedLabel?: string } = {}): ProductGroupSection[] {
  const groups = buildProductGroups(products, productsById)
  const mode = String(sortDirection || 'asc').toLowerCase()
  const nameDirection = mode === 'name_desc' ? 'desc' : 'asc'

  interface CategorySectionState extends ProductGroupSection {
    sortsLast: boolean
  }
  const sections = new Map<string, CategorySectionState>()
  for (const group of groups) {
    const rawCategory = normalizeText(group.leadProduct?.category ?? group.items?.[0]?.category ?? '')
    const isUncategorized = !rawCategory
    const label = isUncategorized ? uncategorizedLabel : rawCategory
    // Case-insensitive key so "Perfume" and "perfume" (a data-entry slip)
    // land in the same section instead of splitting into two -- the
    // *first* casing seen becomes the displayed label, matching how
    // category chips elsewhere in the app already key off catMap.
    const sectionKey = isUncategorized ? '\u0000uncategorized' : rawCategory.toLocaleLowerCase()
    if (!sections.has(sectionKey)) {
      sections.set(sectionKey, {
        id: `product-category:${sectionKey}`,
        label,
        ids: [],
        items: [],
        groups: [],
        sortsLast: isUncategorized,
      })
    }
    const section = sections.get(sectionKey)
    if (!section) continue
    section.groups.push(group)
    section.ids.push(...group.ids)
    section.items.push(...group.items)
  }

  for (const section of sections.values()) {
    section.groups.sort((left, right) => {
      const nameDelta = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
      return nameDirection === 'desc' ? -nameDelta : nameDelta
    })
  }

  return [...sections.values()].sort((left, right) => {
    if (left.sortsLast !== right.sortsLast) return left.sortsLast ? 1 : -1
    return String(left.label || '').localeCompare(String(right.label || ''), undefined, { sensitivity: 'base' })
  })
}

export function buildProductGroupSections(products: ProductRecord[] = [], {
  productsById = new Map(),
  sortDirection = 'asc',
}: BuildGroupSectionsOptions = {}): ProductGroupSection[] {
  const groups = buildProductGroups(products, productsById)
  const mode = String(sortDirection || 'asc').toLowerCase()
  const byName = mode === 'name_asc' || mode === 'name_desc'
  const direction = (mode === 'desc' || mode === 'name_desc') ? 'desc' : 'asc'
  const orderedGroups = [...groups].sort((left, right) => {
    if (byName) {
      const nameDelta = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
      return direction === 'desc' ? -nameDelta : nameDelta
    }
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
