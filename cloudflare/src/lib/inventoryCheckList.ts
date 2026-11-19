import type { Context } from 'hono'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { isInventoryCheckGrouping, type InventoryCheckGrouping } from './inventoryCheckGrouping'
import { projectAcquisitionCosts } from './acquisitionCostAccess'
import { cacheIdentity, cachedJsonResponse, getVersionWithFallback, isUnsafeVersion } from './cache'
import { unsafeVersionToken } from './cacheKey'
import { getDb } from './db'
import { getInventoryCheckAccess, InventoryCheckQueryError, validateInventoryCheckQuery, type InventoryCheckAccess } from './inventoryCheckAccess'
import { InventoryCheckSessionError, waitingLineSql } from './inventoryCheckSessions'
import { getPlanLimits } from './planTier'
import { catalogProductSql } from './productStockGuard'
import { localDateExpr } from './businessDateWindow'
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
/** The most rows (families, for the wired list) one page may ask for. */
export const LIST_MAX_PAGE_SIZE = 100
// The id sets are version-keyed (inventory_checks, bumped by every IC writer), so the plan's productListCacheSeconds only bounds how long a copy may live.
const STOCK_STATES: Record<string, string> = { in_stock: 'in_stock', low_stock: 'low', out_of_stock: 'out' }

const invalid = (parameter: string): never => { throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', parameter) }

export type InventoryListPlan = {
  access: InventoryCheckAccess
  branchId: number | null
  checkState: ListCheckState | null
  /** groupBy=checked|category (sortBy=checked is the old spelling of groupBy=checked): the families are ranked by the grouping and every row carries its group_key. */
  grouping: InventoryCheckGrouping | null
  /** The query Products would send for this scope. */
  productsQuery: Record<string, string>
  /** A barcode-blind viewer's search text that looks like a whole code: the route looks it up exactly, and only an exact hit is searched by id. */
  codeLookup: string | null
  /** checkedOn=YYYY-MM-DD: only products whose LATEST count at the branch was on that Cambodia business day. */
  checkedOn: string | null
  /** Any narrowing at all (search, brand, category, stock state, ids, a check state or a day): the catalogue total is then not the page's total. */
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
  // sortBy=checked is the spelling older open tabs send for the date order: it is groupBy=checked, and its direction is ignored (newest first, "Never checked" last).
  const sortWord = rawSortBy?.trim() || ''
  if (sortWord === 'checked') delete rest.sortDirection
  const validated = validateInventoryCheckQuery(rest, access, true, { checkedOn: true })
  const sortBy = sortWord || 'created'
  if (sortBy !== 'created' && sortBy !== 'name' && sortBy !== 'checked') invalid('sortBy')
  if (validated.groupBy && sortWord && sortWord !== 'checked') invalid('sortBy')
  if (sortWord === 'checked' && validated.groupBy && validated.groupBy !== 'checked') invalid('sortBy')
  const requestedGrouping: InventoryCheckGrouping | null = validated.groupBy ? (isInventoryCheckGrouping(validated.groupBy) ? validated.groupBy : invalid('groupBy')) : sortWord === 'checked' ? 'checked' : null
  // A typed search is answered FLAT: the family date and the header counts would be computed over the matched rows while the page shows every member of a family (routes/products.ts),
  // so a group could disagree with the rows under it. The groupBy (or the old sortBy=checked spelling) is accepted and ignored, exactly as the switch-off path ignores it; the page
  // itself sends none while a search is typed, and grouping returns when the search is cleared.
  const grouping: InventoryCheckGrouping | null = validated.query ? null : requestedGrouping
  const direction = validated.sortDirection ?? (sortBy === 'name' ? 'asc' : 'desc')
  const branchId = validated.branchId && validated.branchId.toLowerCase() !== 'all' ? integer(validated.branchId, 0, Number.MAX_SAFE_INTEGER, 'branchId') : null
  const checkWord = rawCheckState?.trim() || ''
  if (checkWord && !(LIST_CHECK_STATES as readonly string[]).includes(checkWord)) invalid('checkState')
  const checkState = (checkWord || null) as ListCheckState | null
  if (checkState && branchId === null) invalid('branchId')
  const checkedOn = validated.checkedOn ?? null
  if (checkedOn && branchId === null) invalid('branchId')
  // 'pending' while ic_fix_stock is OFF (or the viewer may not see stock) is a valid choice with nothing in it: an empty page, never a 400 that a tab would repeat.

  const productsQuery: Record<string, string> = { searchMode: 'smart', sort: grouping ? 'name_asc' : `${sortBy === 'checked' ? 'created' : sortBy}_${direction}`, include: LIST_INCLUDE }
  const page = integer(validated.page, 1, 100000, 'page'), pageSize = integer(validated.pageSize, DEFAULT_PAGE_SIZE, LIST_MAX_PAGE_SIZE, 'pageSize')
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
    if (checkState || checkedOn) invalid('ids')
    if (requestedGrouping) invalid('groupBy')
    const ids = [...new Set(rawIds.split(',').map((part) => part.trim()))]
    if (!ids.length || ids.length > options.maxIds || ids.some((id) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) invalid('ids')
    productsQuery.ids = ids.join(','); productsQuery.page = '1'; productsQuery.pageSize = String(ids.length)
  }
  const filtered = Boolean(productsQuery.query || productsQuery.brand || productsQuery.category || productsQuery.stockState || productsQuery.ids || checkState || checkedOn)
  return { access, branchId, checkState, checkedOn, grouping, productsQuery, codeLookup, filtered, wantSummary: validated.summary !== '0' }
}

/** The request the shared cache key is built from: the canonical Products URL. Host and scheme never count; only the path and the sorted parameters do. */
export function canonicalProductsRequest(productsQuery: Record<string, string>): Request {
  return new Request(`https://products.invalid/api/products/search?${new URLSearchParams(productsQuery).toString()}`, { method: 'GET' })
}

export class InventoryCheckFilterTooLargeError extends InventoryCheckSessionError {
  constructor() { super(503, 'inventory_check_filter_too_large') }
}

/** days: the Cambodia business day of each product's LATEST count at the branch, newest day first, with the products whose latest count that was (the date chips and the checkedOn filter). */
export type CheckStateSets = { ok: number[]; issue: number[]; pending: number[]; days: Array<{ day: string; ids: number[] }>; tooLarge: boolean }

// The latest done/issue item of each product in the branch scope, inside the viewer's organization (items of other organizations and items whose branch differs
// from their session's are never read): the same scope the ic_simple list used.
// The DAY is the day the product was COUNTED, never the day it was approved. An item's updated_at is the time of its COUNT (a submission's commit, an observation's save, the Set that closed an Issue) and
// nothing else writes it: the approval flip changes the state only. So "latest" (ORDER BY updated_at: index 0285) and the day read the same column, and approving an older count never makes it the newer one.
export const LATEST_ITEMS_SQL = `WITH latest AS (
    SELECT i.product_id AS product_id, i.state AS state, i.updated_at AS updated_at,
           ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.updated_at DESC, i.session_id DESC) AS rn
    FROM inventory_check_sessions s JOIN inventory_check_items i ON i.session_id = s.id AND i.branch_id = s.branch_id
    WHERE s.organization_id IS @organization AND s.branch_id = @branchId AND i.state IN ('done', 'issue'))
  SELECT product_id, state, ${localDateExpr('updated_at')} AS day FROM latest WHERE rn = 1 ORDER BY updated_at DESC, product_id LIMIT @limit`
// Products with a count line still waiting for approval at the branch (the same line rule the row tag uses).
const PENDING_ITEMS_SQL = `SELECT i.product_id AS product_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id = a.session_id AND i.branch_id = a.branch_id
  WHERE a.organization_id IS @organization AND a.branch_id = @branchId AND ${waitingLineSql('a', 'i')} GROUP BY i.product_id ORDER BY MAX(a.submitted_at) DESC, i.product_id LIMIT @limit`

/** The inventory_checks cache version: every Inventory Check writer moves it (awaited), so the sets below and every restricted list key on it. */
export const inventoryChecksVersion = (env: Env): Promise<string> => getVersionWithFallback(env, 'inventory_checks')

export async function readCheckStateSets(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, branchId: number, withPending: boolean, knownVersion?: string): Promise<{ sets: CheckStateSets; version: string }> {
  const user = c.get('user'), env = c.env, db = getDb(env)
  const limit = getPlanLimits(env).inventoryCheckFilterMaxIds
  const version = knownVersion ?? await inventoryChecksVersion(env)
  const organization = user.organization_id ?? null
  const sets = await cachedJsonResponse(new Request(`https://ic.invalid/__bos/ic-state?branchId=${branchId}&pending=${withPending ? 1 : 0}&order=2`, { method: 'GET' }), c.executionCtx,
    `ic:${version}`, getPlanLimits(env).productListCacheSeconds, async (): Promise<CheckStateSets> => {
      const latest = await db.prepare(LATEST_ITEMS_SQL).all<{ product_id: number; state: string; day: string | null }>({ organization, branchId, limit: limit + 1 })
      const pending = withPending ? await db.prepare(PENDING_ITEMS_SQL).all<{ product_id: number }>({ organization, branchId, limit: limit + 1 }) : []
      if (latest.length > limit || pending.length > limit) return { ok: [], issue: [], pending: [], days: [], tooLarge: true }
      const byDay = new Map<string, number[]>()
      for (const row of latest) if (row.day) byDay.set(row.day, [...byDay.get(row.day) ?? [], Number(row.product_id)])
      return { ok: latest.filter((row) => row.state === 'done').map((row) => Number(row.product_id)), issue: latest.filter((row) => row.state === 'issue').map((row) => Number(row.product_id)),
        pending: pending.map((row) => Number(row.product_id)), days: [...byDay.entries()].sort((a, b) => a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0).map(([day, ids]) => ({ day, ids })), tooLarge: false }
    }, cacheIdentity(c))
  return { sets, version }
}

// The status counts of one branch, ONE object for /list and /overlay. The unit is the product row (never a name family) and the population is the rows the unfiltered list can show: the list's own
// scope, catalogProductSql (an active product; the branch only picks which stock to display). ok/issue/pending are the rows of that population whose LATEST count at the branch has the state, so a
// count made on a product that has since left the list is in no figure, and not_checked = total - ok - issue holds by construction. Each number is what the matching chip shows when tapped.
export type CheckSummary = { ok: number; issue: number; pending?: number; not_checked: number; total: number; days: Array<{ day: string; count: number }> } | { tooLarge: true }

// The population: the active product rows that are not family headers (a header is the family's title, never a product to count, and the wired page never lets one be counted). The count reads the
// partial index idx_products_inventory_population (0317), so it is a covering count, and it is cached on the membership token alone: the token changes only when a row enters or leaves the population.
export const POPULATION_TOTAL_SQL = `SELECT COUNT(*) AS n FROM products p WHERE ${catalogProductSql('p')} AND COALESCE(p.is_group, 0) = 0`
// Which of the checked ids are in the population: json_each drives primary-key seeks, nothing else is read.
export const POPULATION_CHECKED_SQL = `SELECT p.id AS id FROM products p WHERE ${catalogProductSql('p', false)} AND COALESCE(p.is_group, 0) = 0 AND p.id IN (SELECT value FROM json_each(@ids))`
export const POPULATION_TOKEN_SQL = "SELECT stamp AS token FROM inventory_population_token WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND CASE WHEN json_valid(value) THEN json_extract(value, '$.mode') = 'restore' ELSE 1 END)"
const TOKEN_FORM = /^[0-9a-f]{16}$/

export function summaryFromSets(sets: CheckStateSets, withPending: boolean, population: { total: number; inList: ReadonlySet<number> }): CheckSummary {
  if (sets.tooLarge) return { tooLarge: true }
  const inList = (ids: readonly number[]) => ids.filter((id) => population.inList.has(id)).length
  const ok = inList(sets.ok), issue = inList(sets.issue)
  return { ok, issue, ...(withPending ? { pending: inList(sets.pending) } : {}), not_checked: population.total - ok - issue, total: population.total,
    days: sets.days.map((entry) => ({ day: entry.day, count: inList(entry.ids) })).filter((entry) => entry.count > 0) }
}

type Ctx = Context<{ Bindings: Env; Variables: { user: SessionUser } }>

/** The token out of the rows of POPULATION_TOKEN_SQL: null when there is none (a restore, no table) or it is not a token. */
export function populationTokenOf(rows: ReadonlyArray<{ token?: unknown }> | undefined): string | null {
  const token = rows?.[0]?.token
  return typeof token === 'string' && TOKEN_FORM.test(token) ? token : null
}

/** The membership token (one row, one statement), or an unsafe token that no cache key accepts when the table cannot be read: the counts are then computed uncached. */
async function readPopulationToken(env: Env): Promise<string> {
  try {
    const token = (await getDb(env).prepare(POPULATION_TOKEN_SQL).get<{ token: string }>())?.token
    if (typeof token === 'string' && TOKEN_FORM.test(token)) return token
  } catch { /* unreadable: no safe key */ }
  return unsafeVersionToken()
}

const populationRequest = (): Request => new Request('https://ic.invalid/__bos/ic-population?order=2', { method: 'GET' })
const NOT_CACHED = new Error('not cached')

/** The cached population total for a token, or null. The producer never runs: a miss throws out of it, and nothing is stored. */
async function peekPopulationTotal(c: Ctx, token: string): Promise<number | null> {
  try { return await cachedJsonResponse(populationRequest(), c.executionCtx, `icn:${token}`, getPlanLimits(c.env).productListCacheSeconds, (): number => { throw NOT_CACHED }, cacheIdentity(c)) } catch (error) {
    if (error === NOT_CACHED) return null
    throw error
  }
}

type Population = { total: number; inList: ReadonlySet<number> }

/**
 * The total and the checked ids in the population, from ONE snapshot. The token, the count and the seek run in one db.batch, so they describe the same rows, and the count is cached under the token
 * the batch itself read. A total already cached for the token is reused: the batch then holds the token and the seek, and when its token is not the one the total was cached under (a row entered
 * or left in between) the three are read again together.
 */
async function readPopulation(c: Ctx, token: string, ids: readonly number[]): Promise<Population> {
  const env = c.env, db = getDb(env)
  const idStatement = ids.length ? [{ sql: POPULATION_CHECKED_SQL, params: { ids: JSON.stringify(ids) } }] : []
  // An unreadable token (the table is missing) leaves the token statement out: the figures are still read together, and nothing is cached.
  const withToken = !isUnsafeVersion(token)
  const read = async (withTotal: boolean) => {
    const results = await db.batch([...(withToken ? [{ sql: POPULATION_TOKEN_SQL }] : []), ...(withTotal ? [{ sql: POPULATION_TOTAL_SQL }] : []), ...idStatement])
    const offset = withToken ? 1 : 0
    const at = withToken ? (results[0]?.results ?? []) as Array<{ token: string }> : []
    const total = withTotal ? Number(((results[offset]?.results ?? []) as Array<{ n: number }>)[0]?.n ?? 0) : null
    const found = (results[offset + (withTotal ? 1 : 0)]?.results ?? []) as Array<{ id: number }>
    return { token: at[0]?.token, total, inList: new Set(found.map((row) => Number(row.id))) }
  }
  const cached = await peekPopulationTotal(c, token)
  if (cached !== null && !ids.length) return { total: cached, inList: new Set() }
  if (cached !== null) {
    const seen = await read(false)
    if (seen.token === token) return { total: cached, inList: seen.inList }
  }
  const fresh = await read(true)
  const total = fresh.total as number
  if (typeof fresh.token === 'string' && TOKEN_FORM.test(fresh.token)) await cachedJsonResponse(populationRequest(), c.executionCtx, `icn:${fresh.token}`, getPlanLimits(env).productListCacheSeconds, () => total, cacheIdentity(c))
  return { total, inList: fresh.inList }
}

/**
 * The summary of a branch, cached on the inventory_checks version AND the membership token (a product entering or leaving the population moves the second, whoever wrote it), so a warm open is the
 * token read (one statement, one row) and cache hits. `loaded` is the sets a caller already read (the same cached entry), so a restricted list does not read them twice.
 */
export async function readCheckSummary(c: Ctx, branchId: number, withPending: boolean, loaded?: { sets: CheckStateSets; version: string }, readToken?: string | null): Promise<CheckSummary> {
  const env = c.env
  // readToken: the token a caller already read in a batch of its own (null: it read none, so the key is unsafe); undefined: read it here.
  const [version, token] = await Promise.all([loaded ? Promise.resolve(loaded.version) : inventoryChecksVersion(env), readToken === undefined ? readPopulationToken(env) : Promise.resolve(readToken ?? unsafeVersionToken())])
  return cachedJsonResponse(new Request(`https://ic.invalid/__bos/ic-summary?branchId=${branchId}&pending=${withPending ? 1 : 0}&order=2`, { method: 'GET' }), c.executionCtx,
    `icp:${version}:${token}`, getPlanLimits(env).productListCacheSeconds, async (): Promise<CheckSummary> => {
      const { sets } = loaded ?? await readCheckStateSets(c, branchId, withPending, version)
      if (sets.tooLarge) return { tooLarge: true }
      return summaryFromSets(sets, withPending, await readPopulation(c, token, [...new Set([...sets.ok, ...sets.issue, ...sets.pending])]))
    }, cacheIdentity(c))
}

/**
 * The restriction a check state and/or a check day put on the Products cohort: the ids to keep, or the checked ids to leave out. A day keeps the products whose LATEST count was on it; with a state it
 * is the products in both (`not_checked` and a day cannot both hold: nothing).
 */
export function checkStateRestriction(state: ListCheckState | null, sets: CheckStateSets, day: string | null = null): { restrictIdsJson?: string; excludeIdsJson?: string } {
  if (sets.tooLarge) throw new InventoryCheckFilterTooLargeError()
  const onDay = day === null ? null : new Set(sets.days.find((entry) => entry.day === day)?.ids ?? [])
  if (state === null) return { restrictIdsJson: JSON.stringify(onDay ? [...onDay] : []) }
  if (state === 'not_checked') return onDay ? { restrictIdsJson: '[]' } : { excludeIdsJson: JSON.stringify([...new Set([...sets.ok, ...sets.issue])]) }
  const ids = state === 'ok' ? sets.ok : state === 'issue' ? sets.issue : sets.pending
  return { restrictIdsJson: JSON.stringify(onDay ? ids.filter((id) => onDay.has(id)) : ids) }
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
// Cost leaves the answer unless the viewer may see acquisition costs (access.fields.cost, the shared rule of lib/acquisitionCostAccess.ts): one switch for cost everywhere.
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
  if (!access.fields.cost) for (const key of COST_KEYS) delete out[key]
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
