export interface ProductGroupRecord {
  id?: unknown
  parent_id?: unknown
  name?: unknown
  is_group?: unknown
  stock_quantity?: unknown
  selling_price_usd?: unknown
  created_at?: unknown
  [key: string]: unknown
}

export interface ProductGroup {
  key: string
  id: number
  anchorId: number
  name: string
  normalizedName: string
  explicitRootId: number
  ids: number[]
  matchedIds: number[]
  items: ProductGroupRecord[]
  leadProduct: ProductGroupRecord
  sellableItems: Array<ProductGroupRecord & {
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
  ids: number[]
  items: ProductGroupRecord[]
  groups: ProductGroup[]
}

export function normalizeProductGroupName(value: unknown): string
export function getNameInitialSection(value: unknown): string
export function buildProductGroups(
  products?: ProductGroupRecord[],
  productsById?: Map<unknown, ProductGroupRecord>,
): ProductGroup[]
export function buildProductGroupSections(products?: ProductGroupRecord[], options?: {
  productsById?: Map<unknown, ProductGroupRecord>
  sortDirection?: unknown
}): ProductGroupSection[]
