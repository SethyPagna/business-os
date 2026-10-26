// Products -> Conflicts: the two data gaps no merge can settle, only an edit.
//
//   unknown_cost   cost_price_usd IS NULL. Owner, 14 Oct: NULL means "never recorded", so the product is flagged;
//                  a typed 0 is a recorded $0 (a $0 loss) and is NOT a gap.
//   empty_barcode  barcode NULL, '' or whitespace. The barcode is the only thing that tells two rows of one name apart.
//
// The flag is per products row, not per name group. A row is self-describing (it carries its own cost and barcode),
// the barcode is what makes it a distinct child row, and a fix is made on one row. Flagging the group would hide a
// healthy sibling behind a broken one, or the reverse. The legacy is_group parent container (is_group=1 AND
// parent_id=0) holds no stock, cost or barcode of its own and is never listed; inactive rows are not listed either
// (an inactive product is out of the catalog, so there is nothing to fix there).
//
// Read cost: the list is keyset-paged on the rowid (id > @after ORDER BY id LIMIT n+1), so a page reads rows only
// until it is full instead of the whole table. There is no index on either predicate; the count is one pass over
// products and is cached by the route on the products version. A partial index on each predicate would make both
// reads proportional to the matches, but that needs a migration.
import type { getDb } from './db'

type Db = ReturnType<typeof getDb>

export const PRODUCT_DATA_GAP_KINDS = ['unknown_cost', 'empty_barcode'] as const
export type ProductDataGapKind = typeof PRODUCT_DATA_GAP_KINDS[number]

export const PRODUCT_DATA_GAP_PAGE_SIZE = 50
export const PRODUCT_DATA_GAP_MAX_PAGE_SIZE = 100

const UNKNOWN_COST_SQL = 'p.cost_price_usd IS NULL'
const EMPTY_BARCODE_SQL = "(p.barcode IS NULL OR TRIM(p.barcode) = '')"
const LISTED_ROW_SQL = 'p.is_active = 1 AND NOT (COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)'

const GAP_SQL: Record<ProductDataGapKind, string> = {
  unknown_cost: UNKNOWN_COST_SQL,
  empty_barcode: EMPTY_BARCODE_SQL,
}

export function parseProductDataGapKind(value: unknown): ProductDataGapKind | null {
  return PRODUCT_DATA_GAP_KINDS.find((kind) => kind === value) ?? null
}

export type ProductDataGapRow = {
  id: number
  name: string | null
  barcode: string | null
  sku: string | null
  brand: string | null
  category: string | null
  stock_quantity: number
  image_path: string | null
}

export type ProductDataGapPage = {
  kind: ProductDataGapKind
  items: ProductDataGapRow[]
  has_more: boolean
  /** Pass back as `after` for the next page; null on the last page. */
  next_after: number | null
}

export type ProductDataGapCounts = Record<ProductDataGapKind, number>

export async function listProductDataGaps(
  db: Db,
  kind: ProductDataGapKind,
  options: { after?: unknown; limit?: unknown } = {},
): Promise<ProductDataGapPage> {
  const afterNumber = Math.floor(Number(options.after))
  const after = Number.isFinite(afterNumber) && afterNumber > 0 ? afterNumber : 0
  const limitNumber = Math.floor(Number(options.limit))
  const limit = Number.isFinite(limitNumber) && limitNumber > 0
    ? Math.min(limitNumber, PRODUCT_DATA_GAP_MAX_PAGE_SIZE)
    : PRODUCT_DATA_GAP_PAGE_SIZE
  // One extra row tells "there is a next page" without a second count read.
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.barcode, p.sku, p.brand, p.category,
           COALESCE(p.stock_quantity, 0) AS stock_quantity, p.image_path
    FROM products p
    WHERE p.id > @after AND ${LISTED_ROW_SQL} AND ${GAP_SQL[kind]}
    ORDER BY p.id ASC
    LIMIT @limit
  `).all<ProductDataGapRow>({ after, limit: limit + 1 })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { kind, items, has_more: hasMore, next_after: hasMore ? items[items.length - 1].id : null }
}

export async function countProductDataGaps(db: Db): Promise<ProductDataGapCounts> {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN ${UNKNOWN_COST_SQL} THEN 1 ELSE 0 END), 0) AS unknown_cost,
           COALESCE(SUM(CASE WHEN ${EMPTY_BARCODE_SQL} THEN 1 ELSE 0 END), 0) AS empty_barcode
    FROM products p
    WHERE ${LISTED_ROW_SQL}
  `).get<ProductDataGapCounts>({})
  return { unknown_cost: Number(row?.unknown_cost || 0), empty_barcode: Number(row?.empty_barcode || 0) }
}
