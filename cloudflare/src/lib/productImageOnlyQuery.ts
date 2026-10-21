// Server-trusted query contract for the "image upload only" Products reader.
//
// That role may only filter by what its grants let it SEE. A filter is an
// oracle: `stockState=out` on a user without the stock grant would reveal which
// products are out of stock even though the stock column is stripped from every
// row. So the image-only branch of the product reads accepts a closed set of
// keys, refuses any filter whose field is not granted, and hands the route a
// rebuilt query that contains nothing the user did not ask for and may not use.
//
// Barcode search is deliberately NOT restricted here (owner ruling 19 Oct 2026):
// scanning a barcode into the search box works for every image-only user; the
// barcode column itself is still stripped from the rows unless
// products_image_only_show_barcode is granted. Only edits are restricted.
//
// Pure module: no database, no framework imports.

export class ImageOnlyQueryError extends Error {
  constructor(readonly status: 400 | 403, readonly code: 'image_only_filter_invalid' | 'image_only_filter_hidden', readonly parameter: string) {
    super(code)
  }
}

export const IMAGE_ONLY_STOCK_STATES = ['in_stock', 'low', 'out', 'healthy'] as const
export const IMAGE_ONLY_SORTS = ['name_asc', 'name_desc'] as const

export type ImageOnlyReceivedWindow = { receivedFrom: string | null; receivedTo: string | null }

export type ImageOnlyGrants = {
  category: boolean
  brand: boolean
  stock: boolean
  batches: boolean
  branchStock: boolean
}

export type ImageOnlyQuery = {
  /** Rebuilt query: only keys searchProductsPayload understands, nothing the user may not use. */
  query: Record<string, string>
  received: ImageOnlyReceivedWindow
  grants: ImageOnlyGrants
}

const SEARCH_KEYS = ['query', 'q', 'search'] as const
const PLAIN_KEYS = ['page', 'pageSize', 'surface', 'sort'] as const

export function imageOnlyGrants(mergedPermissions: Record<string, unknown> | null | undefined): ImageOnlyGrants {
  const perms = mergedPermissions || {}
  return {
    category: perms.products_image_only_show_category === true,
    brand: perms.products_image_only_show_brand === true,
    stock: perms.products_image_only_show_stock === true,
    batches: perms.products_image_only_show_batches === true,
    branchStock: perms.products_image_only_show_branch_stock === true,
  }
}

const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

const isAbsent = (value: string | undefined) => value === undefined || value.trim() === ''
const isAll = (value: string) => value.trim().toLowerCase() === 'all'

/**
 * Validates and rebuilds an image-only product read query.
 *
 * `extraKeys` lets a sibling route (bootstrap) allow its own transport keys
 * without widening what /search accepts; they are dropped from the output.
 *
 * Errors: an unknown key or a malformed/inverted value is 400
 * `image_only_filter_invalid`; a recognised filter whose grant is missing is 403
 * `image_only_filter_hidden`. Both carry the offending parameter name.
 */
export function parseImageOnlyQuery(
  raw: Record<string, string>,
  mergedPermissions: Record<string, unknown> | null | undefined,
  extraKeys: readonly string[] = [],
): ImageOnlyQuery {
  const grants = imageOnlyGrants(mergedPermissions)
  const gated = ['category', 'brand', 'stockState', 'startDate', 'endDate']
  const allowed = new Set<string>([...SEARCH_KEYS, ...PLAIN_KEYS, ...gated, ...extraKeys])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new ImageOnlyQueryError(400, 'image_only_filter_invalid', key)
  }

  const grantFor: Record<string, boolean> = {
    category: grants.category, brand: grants.brand, stockState: grants.stock,
    startDate: grants.batches, endDate: grants.batches,
  }
  const present = (key: string) => !isAbsent(raw[key]) && !((key === 'category' || key === 'brand' || key === 'stockState') && isAll(raw[key]))
  for (const key of gated) {
    if (present(key) && !grantFor[key]) throw new ImageOnlyQueryError(403, 'image_only_filter_hidden', key)
  }

  const query: Record<string, string> = {}

  // The three search aliases collapse to one canonical `query`, first non-empty
  // wins (the order the frontend transport uses). No searchFields is ever
  // forwarded, so name, SKU and barcode all match as for every other reader.
  const term = SEARCH_KEYS.map((key) => raw[key]).find((value) => !isAbsent(value))
  if (term !== undefined) query.query = term

  for (const key of ['page', 'pageSize'] as const) {
    const value = raw[key]
    if (isAbsent(value)) continue
    if (!/^\d+$/.test(value!.trim()) || !Number.isSafeInteger(Number(value))) throw new ImageOnlyQueryError(400, 'image_only_filter_invalid', key)
    query[key] = value!.trim()
  }

  if (!isAbsent(raw.sort)) {
    const sort = raw.sort.trim().toLowerCase()
    if (!(IMAGE_ONLY_SORTS as readonly string[]).includes(sort)) throw new ImageOnlyQueryError(400, 'image_only_filter_invalid', 'sort')
    query.sort = sort
  }

  for (const key of ['category', 'brand'] as const) {
    if (present(key)) query[key] = raw[key].trim()
  }

  if (present('stockState')) {
    const state = raw.stockState.trim().toLowerCase()
    if (!(IMAGE_ONLY_STOCK_STATES as readonly string[]).includes(state)) throw new ImageOnlyQueryError(400, 'image_only_filter_invalid', 'stockState')
    query.stockState = state
  }

  const received: ImageOnlyReceivedWindow = { receivedFrom: null, receivedTo: null }
  if (present('startDate')) {
    if (!validDay(raw.startDate.trim())) throw new ImageOnlyQueryError(400, 'image_only_filter_invalid', 'startDate')
    received.receivedFrom = raw.startDate.trim()
  }
  if (present('endDate')) {
    if (!validDay(raw.endDate.trim())) throw new ImageOnlyQueryError(400, 'image_only_filter_invalid', 'endDate')
    received.receivedTo = raw.endDate.trim()
  }
  if (received.receivedFrom && received.receivedTo && received.receivedFrom > received.receivedTo) {
    throw new ImageOnlyQueryError(400, 'image_only_filter_invalid', 'endDate')
  }

  return { query, received, grants }
}

/**
 * "Received in the window" = at least one lot of the product was received on a
 * day inside [from, to] (inclusive). `received_at` holds the business day the
 * lot was booked (sometimes with a time suffix), so its leading YYYY-MM-DD is
 * compared as written and never shifted by the Cambodia offset. A product with
 * no lot, or only undated or unreadable lots, is outside any bounded window.
 * With no bound at all there is no predicate (the all-time catalog).
 *
 * The bounds are plain text comparisons on the column (>= first day, < the day
 * after the last) rather than date(received_at) wraps, so the predicate stays
 * sargable (test-sargable-date-filters-pure.cjs). The GLOB keeps a value that
 * is not a day (free text sorts above every digit) out of an open-ended window.
 * Inventory's received filter wraps with date() instead; the two agree on every
 * date or ISO-timestamp value and differ only on exotic shapes (an explicit
 * UTC offset, which date() would convert).
 *
 * Kept out of buildSearchFilters on purpose: that function is shared by every
 * product reader and must stay all-time for them.
 */
export function pushReceivedWindow(where: string[], params: Record<string, unknown>, window: ImageOnlyReceivedWindow): void {
  if (!window.receivedFrom && !window.receivedTo) return
  params.receivedFrom = window.receivedFrom
  params.receivedBefore = window.receivedTo ? dayAfter(window.receivedTo) : null
  where.push(`EXISTS (SELECT 1 FROM product_batches receipt WHERE receipt.variant_product_id = p.id
      AND receipt.received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
      AND (@receivedFrom IS NULL OR receipt.received_at >= @receivedFrom)
      AND (@receivedBefore IS NULL OR receipt.received_at < @receivedBefore))`)
}

function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
}
