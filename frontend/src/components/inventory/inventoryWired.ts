// Inventory Check wired to the Products data (read switch `ic_wired`; INVENTORY-REPLAN rev. 2 sections 2.1-2.5, 2.7). Inventory never re-reads or verifies stock: its rows are the Products rows for the
// scope, and it adds only the users' count entries (the overlay) for the ids on screen. The difference (counted - now) and the "Set to" figure are computed here from those two sources.
//
//   GET /api/inventory-checks/list      the Products search rows, cut to this viewer's Inventory grants (`projected`: false when nothing was cut, so the rows ARE Products' rows)
//   GET /api/inventory-checks/overlay   latest count per product at one branch, pending marks, last recorded stock change (lots=1 adds the received dates the rows lack)
//
// Both answer 404 while the switch is off; the page then keeps today's list (`not_wired`). Pure functions only, so the open sequence can be tested without a browser.
import { buildQueryString, type QueryParams } from '../../api/query.ts'
import type { InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import { patchProductFromStockAnswer, patchProductFromStockConflict, type StockConflictAnswer, type StockWriteAnswer } from './stockAnswerPatch.ts'

export type Branch = { id: number; name: string }
type Row = Record<string, unknown> & { lots_more?: boolean; id: number | string; branch_stock?: Array<{ branch_id?: number | string; branch_name?: string | null; quantity?: number | null }>; stock_quantity?: number | null; lots?: Lot[] }
export type Lot = { id: number | string; received_at?: string | null; expiry_date?: string | null; branches?: Array<{ branch_id: number | string; quantity?: number | null }> }
type Tagged = { product_id: number | string; branch_id?: number | string | null; condition_tag?: string | null; quantity?: number | null }
export type OverlayEntry = {
  product_id: number
  last_change_at: string | null
  check?: { state: 'ok' | 'issue'; counted_quantity?: number; seen_quantity?: number; note: string | null; by?: string; at: string | null; session_id: string; revision: number
    lots?: Array<{ batch_id: number; scope: 'lot' | 'branch'; counted: number; seen?: number }> }
  pending?: true
}
export type WiredSummary = { ok?: number; issue?: number; pending?: number; not_checked?: number; total?: number }
export type WiredExtras = { summary?: WiredSummary; capabilities?: { fixStock?: boolean; approveCounts?: boolean; lotCounts?: boolean; directSet?: boolean } }
export type WiredList = { items: Row[]; total: number; page: number; pageSize: number; totalPages?: number; tagged_lots?: Tagged[]; wired?: boolean; projected?: boolean; /** The most ids one overlay read may carry (the plan's limit, echoed by the server). */ overlay_ids?: number } & WiredExtras
export type OverlayAnswer = { items?: OverlayEntry[]; lots?: Array<{ product_id: number; lots?: Lot[]; lots_more?: boolean }> } & WiredExtras
/** The dates of one row; `more` is set when the plan's limit cut them. */
type RowLots = Lot[] & { more?: boolean }

/** Everything one wired screen is made of, kept raw so a by-id refresh or a write's patch can rebuild the rows without asking again. */
export type WiredRaw = { list: WiredList; overlay: Map<number, OverlayEntry>; lots: Map<number, RowLots>; branches: Branch[]; branchId: number; extras: WiredExtras }

// ---- what is on the wire ----------------------------------------------------------------------------------------------------------------------------------

/** The server accepts these and no others from the page; the older list's `sessionId` and any stray key never go to /list. */
const LIST_KEYS = ['query', 'page', 'pageSize', 'stockState', 'brand', 'category', 'checkState'] as const
const present = (value: unknown): boolean => value !== '' && value !== undefined && value !== null

/** The /list query for the page's params. A sole branch is left out of the query (every row lists every active branch), so the read is the same one Products makes. */
export function wiredListParams(params: QueryParams, options: { omitBranch?: boolean; skipSummary?: boolean } = {}): QueryParams {
  const out: QueryParams = {}
  for (const key of LIST_KEYS) if (present(params[key])) out[key] = params[key]
  if (present(params.branchId) && !options.omitBranch) out.branchId = params.branchId
  // The date of the check orders only a list of checked products, so it is sent with a check state (a stale choice never reaches the server alone).
  out.sortBy = params.sortBy === 'name' ? 'name' : params.sortBy === 'checked' && ['ok', 'issue', 'pending'].includes(String(params.checkState)) ? 'checked' : 'created'
  out.sortDirection = params.sortDirection === 'asc' ? 'asc' : 'desc'
  if (options.skipSummary) out.summary = 0
  return out
}

const PRODUCTS_STOCK_WORD: Record<string, string> = { in_stock: 'in_stock', low_stock: 'low', out_of_stock: 'out' }
/** What Products' own page sends, in its key order, so the string is the key of Products' answer in the shared store (api/productReadTransport.ts). Null when the scope is not one Products can hold. */
export function canonicalProductsQuery(wire: QueryParams): string | null {
  if (present(wire.query) || present(wire.checkState) || present(wire.ids)) return null
  return buildQueryString({
    page: wire.page, pageSize: wire.pageSize, searchMode: 'AND', category: wire.category, brand: wire.brand, branchId: wire.branchId,
    stockState: PRODUCTS_STOCK_WORD[String(wire.stockState ?? '')], sort: `${wire.sortBy}_${wire.sortDirection}`, include: 'branch_stock,images,batches,tagged_lots',
  })
}

// ---- computed on the client --------------------------------------------------------------------------------------------------------------------------------

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** counted - now, or null when either is unknown (a viewer who may not see stock has no difference to show). */
export function countDifference(counted: number | null | undefined, now: number | null | undefined): number | null {
  return finite(counted) && finite(now) ? counted - now : null
}

/** The figure a Set writes: now + (counted - seen), never below 0 (sales since the count are kept). With no seen figure it is the counted figure itself. */
export function setToAmount(counted: number | null | undefined, seen: number | null | undefined, now: number | null | undefined): number | null {
  if (!finite(counted)) return null
  if (!finite(seen)) return counted
  return finite(now) ? Math.max(0, now + counted - seen) : null
}

export function branchesOf(items: readonly Row[]): Branch[] {
  const found = new Map<number, string>()
  for (const row of items) for (const entry of Array.isArray(row.branch_stock) ? row.branch_stock : []) {
    const id = Number(entry.branch_id)
    if (Number.isSafeInteger(id) && id > 0 && !found.has(id)) found.set(id, String(entry.branch_name ?? ''))
  }
  return [...found].sort((a, b) => a[0] - b[0]).map(([id, name]) => ({ id, name }))
}

function adaptRow(row: Row, raw: Pick<WiredRaw, 'branchId' | 'overlay' | 'lots'> & { damaged: Map<string, number> }): InventoryCheckProduct {
  const id = Number(row.id)
  const { branchId } = raw
  const entry = branchId && Array.isArray(row.branch_stock) ? row.branch_stock.find(candidate => Number(candidate.branch_id) === branchId) : undefined
  const quantity = branchId ? (Array.isArray(row.branch_stock) ? (entry ? entry.quantity : 0) : undefined) : row.stock_quantity
  const lots: RowLots | undefined = raw.lots.get(id) ?? (row.lots ? Object.assign([...row.lots], row.lots_more ? { more: true } : {}) : undefined)
  const heldHere = (lot: Lot) => (lot.branches ?? []).some(candidate => (!branchId || Number(candidate.branch_id) === branchId) && Number(candidate.quantity ?? 1) > 0)
  const received = lots?.map(lot => lot.received_at).filter((value): value is string => typeof value === 'string' && value !== '').sort().pop()
  const expiry = lots?.filter(heldHere).map(lot => lot.expiry_date).filter((value): value is string => typeof value === 'string' && value !== '').sort()[0]
  const overlay = raw.overlay.get(id)
  const check = overlay?.check
  const product: InventoryCheckProduct = {
    id, name: String(row.name ?? ''), sku: row.sku as string | null | undefined, barcode: row.barcode as string | null | undefined, image_path: row.image_path as string | null | undefined,
    unit: row.unit as string | null | undefined, brand: row.brand as string | null | undefined, category: row.category as string | null | undefined,
    parent_id: row.parent_id as number | string | null | undefined, checkable: true, matches_filters: true,
    ...(quantity === undefined ? {} : { quantity: quantity ?? null }),
    ...(raw.damaged.has(`${id}:${branchId}`) || raw.damaged.has(`${id}:0`) ? { damaged_quantity: raw.damaged.get(`${id}:${branchId}`) ?? raw.damaged.get(`${id}:0`) } : {}),
    ...(received ? { latest_received_at: received } : {}), ...(expiry ? { next_expiry_date: expiry } : {}),
  }
  if (branchId) {
    product.check_status = check ? (check.state === 'issue' ? 'issue' : 'ok') : 'not_checked'
    product.check_branch_id = branchId
    if (check) {
      product.check_counted_quantity = check.counted_quantity ?? null; product.check_note = check.note; product.check_at = check.at; product.check_session_id = check.session_id
      if (check.by) product.check_by = check.by
      product.check_seen_quantity = check.seen_quantity ?? null
      product.check_difference = countDifference(check.counted_quantity, quantity)
      product.check_set_to = setToAmount(check.counted_quantity, check.seen_quantity, quantity)
      // A count typed on some received dates is measured on those dates only: counted - seen over its own lines, never against the whole branch (counting one of two dates is not a shortage).
      if (check.lots?.length) {
        product.check_lines = check.lots
        if (check.lots.every(line => finite(line.seen))) product.check_difference = check.lots.reduce((sum, line) => sum + line.counted - (line.seen as number), 0)
      }
    }
    if (overlay?.pending) product.check_pending = true
  }
  if (overlay) product.last_change_at = overlay.last_change_at
  // The received dates this branch holds, for a count typed per date (ic_lot_counts). Nothing is read for them: the rows already carry the lots.
  if (branchId && lots?.length) {
    const held = lots.flatMap(lot => {
      const at = (lot.branches ?? []).find(candidate => Number(candidate.branch_id) === branchId)
      // A date at 0 is listed too: units found on it are a count (and a Set to more than 0 goes through the writer).
      return at && Number(lot.id) > 0 ? [{ batchId: Number(lot.id), receivedAt: lot.received_at ?? null, expiry: lot.expiry_date ?? null, quantity: Number(at.quantity) }] : []
    })
    if (held.length) product.lot_rows = held
    if (lots.more) product.lots_more = true
    // Units no received date holds, read-only: the branch total minus the dates (only when every date is known).
    const unlotted = !lots.more && finite(quantity) ? quantity - held.reduce((sum, row) => sum + row.quantity, 0) : 0
    if (unlotted > 0) product.unlotted_quantity = unlotted
  }
  if (row.is_group) { product.is_group = true; product.checkable = false }
  return product
}

/** The page's own result shape (the check-status list's), built from the raw wired answers: the rest of the page reads it as it read the older list. */
export function wiredResult(raw: WiredRaw, previous?: { summary?: Record<string, number> } | null) {
  const { list } = raw
  const damaged = new Map<string, number>()
  for (const group of list.tagged_lots ?? []) {
    // Every held tag counts (broken, expired, opened, damaged ...): they all left sellable stock, as the older reader summed them.
    for (const key of [`${Number(group.product_id)}:${Number(group.branch_id)}`, `${Number(group.product_id)}:0`]) damaged.set(key, (damaged.get(key) ?? 0) + Number(group.quantity ?? 0))
  }
  // The check counts come with the answers that carry them (page 1 and a filter change); a page step or a Products-held answer keeps the last ones.
  const incoming = raw.extras.summary, last = previous?.summary
  const summary = incoming || last ? { not_checked: incoming?.not_checked ?? last?.not_checked ?? 0, in_check: 0, ok: incoming?.ok ?? last?.ok ?? 0, issue: incoming?.issue ?? last?.issue ?? 0, total: incoming?.total ?? last?.total ?? 0,
    ...(incoming?.pending !== undefined || last?.pending !== undefined ? { pending: incoming?.pending ?? last?.pending ?? 0 } : {}) } : undefined
  return {
    wired: true as const, simple: true as const, items: list.items.map(row => adaptRow(row, { ...raw, damaged })), total: list.total, page: list.page, pageSize: list.pageSize, totalPages: list.totalPages,
    branches: raw.branches, ...(summary ? { summary } : {}), ...(raw.extras.capabilities ? { capabilities: raw.extras.capabilities } : {}),
  }
}

// ---- loading -----------------------------------------------------------------------------------------------------------------------------------------------

export type WiredDeps = {
  readList: (params: QueryParams, signal?: AbortSignal) => Promise<WiredList>
  readOverlay: (params: { branchId: number; ids: number[]; lots?: boolean }, signal?: AbortSignal) => Promise<OverlayAnswer>
  /** The Products answer held in tab memory for this query string, or null. */
  peek: (query: string) => unknown
  prime: (query: string, payload: unknown, versions?: Record<string, number | string | null>) => void
  /** The device search index's ranked ids for typed text (best first), or null while the index cannot answer. */
  rank: (text: string) => { ids: number[]; total: number } | null
}
export type WiredAccess = { stock: boolean; barcode: boolean; received: boolean }
export type WiredLoadArgs = {
  params: QueryParams
  /** What the screen already learned: the branches (a sole branch is left out of the query) and extras a Products-held answer cannot carry. */
  known?: { branches?: Branch[]; extras?: WiredExtras } | null
  /** A list answer already in hand (the open request, passed through a remount): no second list request. */
  seed?: WiredList | null
  skipSummary: boolean
  /** After a write or a Refresh: ask the server (its own cache is shared and cheap) instead of reading the Products answer held in this tab. */
  bypassStore?: boolean
  access: WiredAccess
  deps: WiredDeps
  signal?: AbortSignal
}
export type WiredLoad = { raw: WiredRaw; fromStore: boolean; listRequests: number }

/** Used only until the server says how many ids an overlay read may carry (list.overlay_ids, the plan's limit). */
const OVERLAY_CHUNK_UNTIL_TOLD = 100
const isList = (value: unknown): value is WiredList => !!value && typeof value === 'object' && Array.isArray((value as WiredList).items)
export class NotWired extends Error { constructor() { super('ic_wired is off'); this.name = 'NotWired' } }

const ids = (items: readonly Row[]): number[] => items.map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0)

/** The by-id read of a few rows (a refresh of changed ones): their Products rows and their overlay, nothing else. */
export async function readWiredRows(rowIds: number[], branchId: number, deps: WiredDeps, access: WiredAccess, signal?: AbortSignal): Promise<{ ids: number[]; items: Row[]; tagged: Tagged[]; overlay: OverlayEntry[]; lots: Array<{ product_id: number; lots?: Lot[] }> }> {
  const list = await deps.readList({ ids: rowIds.join(','), ...(branchId ? { branchId } : {}) }, signal)
  const overlay = branchId ? await deps.readOverlay({ branchId, ids: rowIds, lots: access.received && list.items.some(row => !('lots' in row)) }, signal) : {}
  return { ids: rowIds, items: list.items, tagged: list.tagged_lots ?? [], overlay: overlay.items ?? [], lots: overlay.lots ?? [] }
}

export async function loadWired(args: WiredLoadArgs): Promise<WiredLoad> {
  const { params, deps, access, signal } = args
  const sole = args.known?.branches?.length === 1 ? args.known.branches[0].id : 0
  const wire = wiredListParams(params, { omitBranch: !!sole && !present(params.checkState), skipSummary: args.skipSummary })
  const page = Number(wire.page) || 1, pageSize = Number(wire.pageSize) || 20
  const filtered = present(wire.stockState) || present(wire.brand) || present(wire.category) || present(wire.checkState)

  // Typed text goes through the device search index, as the pickers do: the ranked ids of the page are read by id. A viewer who may not see barcodes is searched by the server
  // (exact codes only, so a partial code can never be rebuilt from the index), and so is any scope with a filter or a check state.
  let ranked: { ids: number[]; total: number } | null = null
  if (present(wire.query) && access.barcode && !filtered) ranked = deps.rank(String(wire.query))

  let list: WiredList | null = args.seed ?? null
  let fromStore = false
  let listRequests = 0
  if (!list && ranked) {
    if (!ranked.total) list = { items: [], total: 0, page, pageSize, totalPages: 1 }
    else {
      const pageIds = ranked.ids.slice((page - 1) * pageSize, page * pageSize)
      const found = pageIds.length ? await deps.readList({ ids: pageIds.join(','), ...(wire.branchId ? { branchId: wire.branchId } : {}) }, signal) : { items: [] as Row[] } as WiredList
      listRequests += pageIds.length ? 1 : 0
      const order = new Map(pageIds.map((id, index) => [id, index]))
      list = { ...found, items: [...found.items].sort((a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0)), total: ranked.total, page, pageSize, totalPages: Math.max(1, Math.ceil(ranked.total / pageSize)) }
    }
  }
  const canonical = ranked ? null : canonicalProductsQuery(wire)
  // The shared store holds the Products answer for this very query: no list request. A viewer who may not see stock never reads stock from it (the server cuts it from the IC answer).
  if (!list && canonical && access.stock && !args.bypassStore) {
    const held = deps.peek(canonical)
    if (isList(held)) { list = held; fromStore = true }
  }
  if (!list) {
    try { list = await deps.readList(wire, signal) } catch (cause) {
      if ((cause as { status?: unknown } | null)?.status === 404) throw new NotWired()
      throw cause
    }
    listRequests += 1
    if (!isList(list) || list.wired !== true) throw new NotWired()
    // An answer that is exactly Products' answer goes to Products' store; a projected one stays here.
    if (canonical && list.projected === false) {
      const { wired: _wired, projected: _projected, summary: _summary, capabilities: _capabilities, ...asProducts } = list
      deps.prime(canonical, asProducts, {})
    }
  }

  const branches = branchesOf(list.items).length ? branchesOf(list.items) : args.known?.branches ?? []
  // Counts are per branch, so the overlay waits for a chosen branch. A shop with one branch gets it chosen by the page from `branches` (a remount that takes this answer along):
  // the overlay is then asked once, on that remount, and never twice.
  const branchId = present(params.branchId) ? Number(params.branchId) : 0
  const overlay = new Map<number, OverlayEntry>(), lots = new Map<number, RowLots>()
  let extras: WiredExtras = { summary: list.summary, capabilities: list.capabilities }
  if (branchId) {
    const wanted = ids(list.items)
    const needLots = access.received && list.items.some(row => !('lots' in row))
    const chunk = Number.isSafeInteger(list.overlay_ids) && (list.overlay_ids as number) > 0 ? (list.overlay_ids as number) : OVERLAY_CHUNK_UNTIL_TOLD
    for (let start = 0; start < wanted.length; start += chunk) {
      const answer = await deps.readOverlay({ branchId, ids: wanted.slice(start, start + chunk), lots: needLots }, signal)
      for (const entry of answer.items ?? []) overlay.set(Number(entry.product_id), entry)
      for (const entry of answer.lots ?? []) lots.set(Number(entry.product_id), Object.assign([...(entry.lots ?? [])], entry.lots_more ? { more: true } : {}))
      if (answer.summary || answer.capabilities) extras = { summary: answer.summary ?? extras.summary, capabilities: answer.capabilities ?? extras.capabilities }
    }
  }
  // A Products-held answer carries neither the check counts nor the capabilities: what the screen already learned stands in until an answer brings them.
  if (fromStore) extras = { summary: extras.summary, capabilities: extras.capabilities ?? args.known?.extras?.capabilities }
  return { raw: { list, overlay, lots, branches, branchId, extras }, fromStore, listRequests }
}

/** Put refreshed rows (by id) into the raw screen: the page keeps its order and everything else. */
export function mergeWiredRows(raw: WiredRaw, fresh: Awaited<ReturnType<typeof readWiredRows>>): WiredRaw {
  const byId = new Map(fresh.items.map(row => [Number(row.id), row]))
  const taggedIds = new Set(fresh.ids)
  const overlay = new Map(raw.overlay), lots = new Map(raw.lots)
  for (const id of fresh.ids) { overlay.delete(id); lots.delete(id) }
  for (const entry of fresh.overlay) overlay.set(Number(entry.product_id), entry)
  for (const entry of fresh.lots) lots.set(Number(entry.product_id), Object.assign([...(entry.lots ?? [])], (entry as { lots_more?: boolean }).lots_more ? { more: true } : {}))
  return { ...raw, overlay, lots, list: { ...raw.list, items: raw.list.items.map(row => byId.get(Number(row.id)) ?? row),
    tagged_lots: [...(raw.list.tagged_lots ?? []).filter(group => !taggedIds.has(Number(group.product_id))), ...fresh.tagged] } }
}

/**
 * The raw answers after a Set from the row: the row and its received dates take the writer's own figures (an answer, or the figures a stale-quantity refusal carries),
 * so the page shows them with no read at all. The same patch the Products page applies; the row is rebuilt from the patched raw, never re-asked.
 */
export function patchWiredRaw(raw: WiredRaw, answer: StockWriteAnswer | StockConflictAnswer): WiredRaw {
  const apply = <T extends Parameters<typeof patchProductFromStockAnswer>[0]>(row: T): T => 'after' in answer ? patchProductFromStockAnswer(row, answer) : patchProductFromStockConflict(row, answer)
  const lots = new Map(raw.lots)
  const held = lots.get(answer.productId)
  if (held) lots.set(answer.productId, Object.assign([...(apply({ id: answer.productId, lots: held }).lots ?? held)], held.more ? { more: true } : {}) as RowLots)
  return { ...raw, lots, list: { ...raw.list, items: raw.list.items.map(row => Number(row.id) === answer.productId ? apply(row) : row) } }
}

// ---- which server this is ----------------------------------------------------------------------------------------------------------------------------------

export type WiredMode = 'unknown' | 'wired' | 'old'
const MODE_TTL_MS = 5 * 60_000
let mode: WiredMode = 'unknown'
let modeAt = 0
/** What this tab last learned about the server (a 404 from /list means the switch is off). It expires, so a switch turned on is found without a reload. */
export const wiredMode = (now: number = Date.now()): WiredMode => (now - modeAt > MODE_TTL_MS ? 'unknown' : mode)
export function rememberWiredMode(next: WiredMode, now: number = Date.now()): void { mode = next; modeAt = now }
