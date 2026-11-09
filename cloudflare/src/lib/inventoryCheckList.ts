import type { Context } from 'hono'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { projectAcquisitionCosts } from './acquisitionCostAccess'
import { cacheIdentity, cachedJsonResponse, getVersionWithFallback } from './cache'
import { getDb } from './db'
import { getInventoryCheckAccess, InventoryCheckQueryError, validateInventoryCheckQuery, type InventoryCheckAccess } from './inventoryCheckAccess'
import { InventoryCheckSessionError, waitingLineSql } from './inventoryCheckSessions'
import { getPlanLimits } from './planTier'
import type { PermissionUser } from './permissions'

// The wired Inventory Check list (INV-A S4a, behind the read switch `ic_wired`): the rows are the Products list for the scope, read by the SAME reader and from the
// SAME cache entry as GET /api/products/search; Inventory adds only the users' check entries (lib/inventoryCheckOverlay.ts) and, for the check-state filters, an id
// set. Nothing here reads the stock ledger, verifies stock, or reads cost: Inventory shows the Products figures and a count is a user's input.
//
//   planInventoryList     the IC query -> the canonical Products query (the keys, defaults and include string Products sends; no IC keys; no surface)
//   readCheckStateSets    the id sets of the check-state filters and the counts, from IC tables, cached on the inventory_checks version
//   projectInventoryList  the shared payload cut down to what this viewer's Inventory Check grants allow

export const LIST_CHECK_STATES = ['not_checked', 'ok', 'issue', 'pending'] as const
export type ListCheckState = typeof LIST_CHECK_STATES[number]

/** The include string Products sends; the `lots` token is added after the cache and never belongs to the key. */
export const LIST_INCLUDE = 'branch_stock,images,batches,tagged_lots'
const DEFAULT_PAGE_SIZE = 50
// The id sets are version-keyed (inventory_checks, bumped by every IC writer), so the plan's productListCacheSeconds only bounds how long a copy may live.
const STOCK_STATES: Record<string, string> = { in_stock: 'in_stock', low_stock: 'low', out_of_stock: 'out' }

const invalid = (parameter: string): never => { throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', parameter) }

export type InventoryListPlan = {
  access: InventoryCheckAccess
  branchId: number | null
  checkState: ListCheckState | null
  /** The query Products would send for this scope. */
  productsQuery: Record<string, string>
  /** A barcode-blind viewer's search text that looks like a whole code: the route looks it up exactly, and only an exact hit is searched by id. */
  codeLookup: string | null
  /** Any narrowing at all (search, brand, category, stock state, ids or a check state): the catalogue total is then not the page's total. */
  filtered: boolean
  wantSummary: boolean
}

function integer(value: string | undefined, fallback: number, maximum: number, key: string): number {
  if (value === undefined || value === '') return fallback
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) invalid(key)
  return Number(value)
}

/** A whole code, not a word: no spaces, a digit in it, 4 to 64 characters of the kind barcodes and SKUs use. */
const looksLikeCode = (text: string): boolean => /^[A-Za-z0-9._-]{4,64}$/.test(text) && /\d/.test(text)

export function planInventoryList(user: PermissionUser, raw: Record<string, string>, options: { pendingAvailable: boolean; maxIds: number }): InventoryListPlan {
  const access = getInventoryCheckAccess(user)
  for (const alias of ['sort_by', 'sort_direction', 'check_state']) if (Object.hasOwn(raw, alias)) invalid(alias)
  const { sortBy: rawSortBy, checkState: rawCheckState, ids: rawIds, ...rest } = raw
  const validated = validateInventoryCheckQuery(rest, access, true)
  const sortBy = rawSortBy?.trim() || 'created'
  if (sortBy !== 'created' && sortBy !== 'name') invalid('sortBy')
  const direction = validated.sortDirection ?? (sortBy === 'name' ? 'asc' : 'desc')
  const branchId = validated.branchId && validated.branchId.toLowerCase() !== 'all' ? integer(validated.branchId, 0, Number.MAX_SAFE_INTEGER, 'branchId') : null
  const checkWord = rawCheckState?.trim() || ''
  if (checkWord && !(LIST_CHECK_STATES as readonly string[]).includes(checkWord)) invalid('checkState')
  const checkState = (checkWord || null) as ListCheckState | null
  if (checkState && branchId === null) invalid('branchId')
  // 'pending' while ic_fix_stock is OFF (or the viewer may not see stock) is a valid choice with nothing in it: an empty page, never a 400 that a tab would repeat.

  const productsQuery: Record<string, string> = { searchMode: 'smart', sort: `${sortBy}_${direction}`, include: LIST_INCLUDE }
  const page = integer(validated.page, 1, 100000, 'page'), pageSize = integer(validated.pageSize, DEFAULT_PAGE_SIZE, 100, 'pageSize')
  productsQuery.page = String(page); productsQuery.pageSize = String(pageSize)
  if (branchId !== null) productsQuery.branchId = String(branchId)
  const stockWord = validated.stockState && validated.stockState !== 'all' ? STOCK_STATES[validated.stockState] : undefined
  if (stockWord) productsQuery.stockState = stockWord
  for (const field of ['brand', 'category'] as const) if (validated[field] && validated[field].toLowerCase() !== 'all') productsQuery[field] = validated[field]

  let codeLookup: string | null = null
  if (validated.query) {
    productsQuery.query = validated.query
    // Products matches a partial barcode or SKU, which would let a viewer without the barcode field rebuild a code from prefixes. They search by name only;
    // a whole code that is typed or scanned is looked up exactly (the old Inventory rule), by the route.
    if (!access.fields.barcode) { productsQuery.searchFields = 'name'; if (looksLikeCode(validated.query)) codeLookup = validated.query }
  }
  if (rawIds !== undefined && rawIds.trim() !== '') {
    if (checkState) invalid('ids')
    const ids = [...new Set(rawIds.split(',').map((part) => part.trim()))]
    if (!ids.length || ids.length > options.maxIds || ids.some((id) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) invalid('ids')
    productsQuery.ids = ids.join(','); productsQuery.page = '1'; productsQuery.pageSize = String(ids.length)
  }
  const filtered = Boolean(productsQuery.query || productsQuery.brand || productsQuery.category || productsQuery.stockState || productsQuery.ids || checkState)
  return { access, branchId, checkState, productsQuery, codeLookup, filtered, wantSummary: validated.summary !== '0' }
}

/** The request the shared cache key is built from: the canonical Products URL. Host and scheme never count; only the path and the sorted parameters do. */
export function canonicalProductsRequest(productsQuery: Record<string, string>): Request {
  return new Request(`https://products.invalid/api/products/search?${new URLSearchParams(productsQuery).toString()}`, { method: 'GET' })
}

export class InventoryCheckFilterTooLargeError extends InventoryCheckSessionError {
  constructor() { super(503, 'inventory_check_filter_too_large') }
}

export type CheckStateSets = { ok: number[]; issue: number[]; pending: number[]; tooLarge: boolean }

// The latest done/issue item of each product in the branch scope, inside the viewer's organization (items of other organizations and items whose branch differs
// from their session's are never read): the same scope the ic_simple list used.
const LATEST_ITEMS_SQL = `WITH latest AS (
    SELECT i.product_id AS product_id, i.state AS state,
           ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.updated_at DESC, i.session_id DESC) AS rn
    FROM inventory_check_sessions s JOIN inventory_check_items i ON i.session_id = s.id AND i.branch_id = s.branch_id
    WHERE s.organization_id IS @organization AND s.branch_id = @branchId AND i.state IN ('done', 'issue'))
  SELECT product_id, state FROM latest WHERE rn = 1 LIMIT @limit`
// Products with a count line still waiting for approval at the branch (the same line rule the row tag uses).
const PENDING_ITEMS_SQL = `SELECT DISTINCT i.product_id AS product_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id = a.session_id AND i.branch_id = a.branch_id
  WHERE a.organization_id IS @organization AND a.branch_id = @branchId AND ${waitingLineSql('a', 'i')} LIMIT @limit`

/** The inventory_checks cache version: every Inventory Check writer moves it (awaited), so the sets below and every restricted list key on it. */
export const inventoryChecksVersion = (env: Env): Promise<string> => getVersionWithFallback(env, 'inventory_checks')

export async function readCheckStateSets(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, branchId: number, withPending: boolean): Promise<{ sets: CheckStateSets; version: string }> {
  const user = c.get('user'), env = c.env, db = getDb(env)
  const limit = getPlanLimits(env).inventoryCheckFilterMaxIds
  const version = await inventoryChecksVersion(env)
  const organization = user.organization_id ?? null
  const sets = await cachedJsonResponse(new Request(`https://ic.invalid/__bos/ic-state?branchId=${branchId}&pending=${withPending ? 1 : 0}`, { method: 'GET' }), c.executionCtx,
    `ic:${version}`, getPlanLimits(env).productListCacheSeconds, async (): Promise<CheckStateSets> => {
      const latest = await db.prepare(LATEST_ITEMS_SQL).all<{ product_id: number; state: string }>({ organization, branchId, limit: limit + 1 })
      const pending = withPending ? await db.prepare(PENDING_ITEMS_SQL).all<{ product_id: number }>({ organization, branchId, limit: limit + 1 }) : []
      if (latest.length > limit || pending.length > limit) return { ok: [], issue: [], pending: [], tooLarge: true }
      return { ok: latest.filter((row) => row.state === 'done').map((row) => Number(row.product_id)), issue: latest.filter((row) => row.state === 'issue').map((row) => Number(row.product_id)),
        pending: pending.map((row) => Number(row.product_id)), tooLarge: false }
    }, cacheIdentity(c))
  return { sets, version }
}

/** The restriction a check state puts on the Products cohort: the ids to keep, or the checked ids to leave out. */
export function checkStateRestriction(state: ListCheckState, sets: CheckStateSets): { restrictIdsJson?: string; excludeIdsJson?: string } {
  if (sets.tooLarge) throw new InventoryCheckFilterTooLargeError()
  if (state === 'not_checked') return { excludeIdsJson: JSON.stringify([...new Set([...sets.ok, ...sets.issue])]) }
  return { restrictIdsJson: JSON.stringify(state === 'ok' ? sets.ok : state === 'issue' ? sets.issue : sets.pending) }
}

// ---- projection ------------------------------------------------------------------------------------------------------------------------------------------------------

const GROUP_KEYS = {
  stock: ['stock_quantity', 'low_stock_threshold', 'out_of_stock_threshold'],
  barcode: ['barcode', 'sku'],
  price: ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd',
    'discount_amount_khr', 'discount_label', 'discount_badge_color', 'discount_starts_at', 'discount_ends_at'],
  category: ['category', 'categories'],
  brand: ['brand', 'brands'],
  received: ['batch_count', 'expiry_date', 'expiry_alert_days'],
} as const
// Nobody's Inventory answer carries cost, whatever the grant: the page counts and shows figures, not money.
const COST_KEYS = ['cost_price_usd', 'cost_price_khr', 'cost_needs_review', 'purchase_price_usd', 'purchase_price_khr', 'cost_review_key']
// Products-page fields that are not Inventory Check grants: they stay for a viewer who may also read the Products page.
const PRODUCTS_PAGE_KEYS = ['supplier', 'description']

function projectLot(lot: Record<string, unknown>, access: InventoryCheckAccess, productsPage: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...lot }
  if (!productsPage) delete out.supplier_name
  if (!access.fields.stock && Array.isArray(out.branches)) out.branches = (out.branches as Array<Record<string, unknown>>).map(({ quantity: _quantity, ...entry }) => entry)
  return out
}

function projectRow(row: Record<string, unknown>, access: InventoryCheckAccess, productsPage: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const key of COST_KEYS) delete out[key]
  for (const field of Object.keys(GROUP_KEYS) as Array<keyof typeof GROUP_KEYS>) if (!access.fields[field]) for (const key of GROUP_KEYS[field]) delete out[key]
  if (!productsPage) for (const key of PRODUCTS_PAGE_KEYS) delete out[key]
  // The branch list stays (which branches exist is not a stock figure), without the quantities.
  if (!access.fields.stock && Array.isArray(out.branch_stock)) out.branch_stock = (out.branch_stock as Array<Record<string, unknown>>).map(({ quantity: _quantity, ...entry }) => entry)
  if (!access.fields.received) { delete out.lots; delete out.lots_more } else if (Array.isArray(out.lots)) out.lots = (out.lots as Array<Record<string, unknown>>).map((lot) => projectLot(lot, access, productsPage))
  return out
}

/**
 * The shared Products payload for this viewer. `projected` is false only when the viewer may also read the Products page and nothing at all was cut from what that page
 * would have answered them (the shared cost projection applied first): then the rows are Products' rows, and the page may hand them to Products' own store.
 */
export function projectInventoryList(payload: Record<string, unknown>, user: SessionUser, access: InventoryCheckAccess, productsPage: boolean): { body: Record<string, unknown>; projected: boolean } {
  const items = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : []
  const body: Record<string, unknown> = { ...payload, items: items.map((row) => projectRow(row, access, productsPage)) }
  if (!access.fields.price && !productsPage) delete body.promotion_rules
  if (!access.fields.stock) delete body.tagged_lots
  const asProducts = projectAcquisitionCosts(payload, user) as Record<string, unknown>
  const identity = productsPage && JSON.stringify(body) === JSON.stringify(asProducts)
  return { body, projected: !identity }
}
