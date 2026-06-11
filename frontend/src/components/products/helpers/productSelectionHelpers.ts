interface ProductSelectionRecord {
  id?: unknown
  parent_id?: unknown
  [key: string]: unknown
}

interface ProductPaginationOptions {
  page?: unknown
  total?: unknown
  pageSize?: unknown
  fallbackPageSize?: unknown
  pending?: boolean
  pendingLabel?: string
  emptyLabel?: string
}

interface ProductPaginationState {
  safePage: number
  safePageSize: number
  totalPages: number
  start: number
  end: number
  summaryLabel: string
}

interface ProductJumpGroup {
  anchorId?: unknown
  leadProduct?: ProductSelectionRecord | null
  items?: ProductSelectionRecord[]
  [key: string]: unknown
}

interface ProductJumpSection {
  id?: unknown
  label?: unknown
  groups?: ProductJumpGroup[]
  [key: string]: unknown
}

type NumericIdSet = Set<unknown>

export function normalizePositiveProductIds<TValue>(
  values: TValue[] = [],
  selector: (value: TValue) => unknown = (value) => value,
): number[] {
  const ids: number[] = []
  for (const value of values) {
    const id = Number(selector(value))
    if (Number.isFinite(id) && id > 0) ids.push(id)
  }
  return ids
}

export function buildVisibleProductIds(products: ProductSelectionRecord[] = []): number[] {
  const ids: number[] = []
  for (const product of products) {
    const id = Number(product?.id)
    if (Number.isFinite(id)) ids.push(id)
  }
  return ids
}

export function buildProductIdMap<TProduct extends ProductSelectionRecord>(products: TProduct[] = []): Map<number, TProduct> {
  const productById = new Map<number, TProduct>()
  for (const product of products) {
    const id = Number(product?.id || 0)
    if (id) productById.set(id, product)
  }
  return productById
}

export function buildParentProductIdSet(products: ProductSelectionRecord[] = []): Set<number> {
  const parentIds = new Set<number>()
  for (const product of products) {
    const id = Number(product?.parent_id || 0)
    if (id) parentIds.add(id)
  }
  return parentIds
}

export function buildSelectedVisibleIds(selectedIds: NumericIdSet = new Set(), visibleIds: unknown[] = []): unknown[] {
  const visibleIdSet = new Set(visibleIds.map((id) => Number(id)))
  return [...selectedIds].filter((id) => visibleIdSet.has(Number(id)))
}

export function buildProductPaginationState({
  page = 1,
  total = 0,
  pageSize = 20,
  fallbackPageSize = 20,
  pending = false,
  pendingLabel = 'Loading',
  emptyLabel = '0 / 0',
}: ProductPaginationOptions = {}): ProductPaginationState {
  const safePageSize = Math.max(1, Number(pageSize || fallbackPageSize))
  const safeTotal = Math.max(0, Number(total || 0))
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize))
  const safePage = Math.max(1, Math.min(totalPages, Number(page || 1)))
  const start = safeTotal ? (((safePage - 1) * safePageSize) + 1) : 0
  const end = safeTotal ? Math.min(safeTotal, safePage * safePageSize) : 0
  const summaryLabel = safeTotal
    ? `${start.toLocaleString()}-${end.toLocaleString()} / ${safeTotal.toLocaleString()}`
    : (pending ? pendingLabel : emptyLabel)
  return {
    safePage,
    safePageSize,
    totalPages,
    start,
    end,
    summaryLabel,
  }
}

export function buildSelectedProducts<TProduct extends ProductSelectionRecord>(
  products: TProduct[] = [],
  selectedIds: NumericIdSet = new Set(),
): TProduct[] {
  return products.filter((product) => selectedIds.has(Number(product?.id)))
}

export function buildJumpTargetIdsByLetter(
  productSections: ProductJumpSection[] = [],
  collapsedSectionIds: Set<unknown> = new Set(),
): Map<unknown, number> {
  const targets = new Map<unknown, number>()
  productSections.forEach((section) => {
    if (collapsedSectionIds.has(section.id)) return
    const firstGroup = section.groups?.[0]
    if (!firstGroup) return
    targets.set(
      section.label,
      Number(firstGroup.anchorId || firstGroup.leadProduct?.id || firstGroup.items?.[0]?.id || 0),
    )
  })
  return targets
}

export function isSelectionScopeFullySelected(ids: unknown[] = [], selectedIds: NumericIdSet = new Set()): boolean {
  return ids.length > 0 && ids.every((id) => selectedIds.has(Number(id)))
}

export function isSelectionScopePartiallySelected(ids: unknown[] = [], selectedIds: NumericIdSet = new Set()): boolean {
  return ids.some((id) => selectedIds.has(Number(id))) && !isSelectionScopeFullySelected(ids, selectedIds)
}
