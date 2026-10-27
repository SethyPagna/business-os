// Products -> Conflicts: the gaps no merge can settle, only an edit or a decision (lane 6.0.988).
//
// Owner rulings 14-15 Oct 2026 (memory owner-answers-14-oct.md, "Cost Q1-Q4"):
//   unknown_cost        Every unknown-cost item is listed. A product is listed when ANY of these holds:
//                         - its catalog cost is NULL (never recorded);
//                         - an active received date with units on hand has a NULL unit cost;
//                         - a held damaged lot with units left has a NULL unit cost;
//                         - its catalog cost is an UNPROVEN $0 (Q1): $0 on a product that existed when migration 0273 was
//                           applied (id <= the cost_zero_watermark flag) with no proof it is real. Proof is a "Confirm $0"
//                           mark, a latest cost entry that is a $0, or an active $0 received date WITH units on hand (owner Q2: a
//                           sold-out lot carries no weight). A $0 on a newer product can
//                           only be one a person typed, so it is a recorded $0 and is not listed.
//   empty_barcode       NULL, empty or blank barcode (blank = what the app's JavaScript trim() strips, see below).
//   placeholder_barcode a barcode made only of the character 0 ("0", "000"), the old system's placeholder (Q3).
//   An admin may mark a product "no barcode" (Q3), reversibly; that removes it from both barcode lists.
//
// The flag is per products row (a name group's child row), not per name group: a row carries its own cost and barcode, the barcode is
// what makes it a distinct row, and a fix or a decision is made on one row. The legacy group parent (is_group=1 AND parent_id=0)
// holds no cost, barcode or stock and is never listed; inactive rows are not listed (nothing to fix on a product out of the catalog).
//
// The outer products term of the unknown-cost queries is `+p.is_active` on purpose (the coreDataInvariants.ts GATE_FLAG_SQL trick): the
// unary plus keeps it out of index selection, so the planner seeks products by primary key for each id the partial indexes produced
// instead of walking every active product through idx_products_active_grouped_pg.
//
// Read cost (D1 bills rows read): production has no sqlite_stat1, so the planner would otherwise pick the wide
// idx_products_active_grouped_pg and walk every active product. Migration 0273 adds partial indexes led by is_active, and every
// WHERE term below repeats an index term VERBATIM (SQLite uses a partial index only when the query implies it). A page reads the
// matching index entries after the cursor plus at most `limit` product rows by primary key; the counts read index entries only.
// scripts/test-product-data-gaps-native.cjs pins the plans on a schema without stats.
import type { getDb } from './db'
import { buildAuditStatement } from './audit'
import { ordinaryBusinessMaintenanceGuard } from './businessMaintenanceGuard'

type Db = ReturnType<typeof getDb>
type Statement = { sql: string; params?: Record<string, unknown> }

export const PRODUCT_DATA_GAP_KINDS = ['unknown_cost', 'empty_barcode', 'placeholder_barcode'] as const
export type ProductDataGapKind = typeof PRODUCT_DATA_GAP_KINDS[number]

export const PRODUCT_DATA_GAP_PAGE_SIZE = 50
export const PRODUCT_DATA_GAP_MAX_PAGE_SIZE = 100
export const PRODUCT_CONFLICT_APPLIER = 'product.conflict_mark'
export const PRODUCT_CONFLICT_MARKS = ['zero_cost_confirmed', 'no_barcode'] as const
export type ProductConflictMark = typeof PRODUCT_CONFLICT_MARKS[number]

// Everything JavaScript's String.prototype.trim() strips: tab, line feed, vertical tab, form feed, carriage return, space, no-break
// space, ogham space, the en/em/thin/hair spaces, line and paragraph separators, narrow no-break space, medium mathematical space,
// ideographic space and the byte-order mark. Migration 0273 writes the same list into its barcode indexes (a test pins the match).
export const JS_TRIM_CODE_POINTS = [9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279] as const
export const BLANK_CHARS_SQL = `char(${JS_TRIM_CODE_POINTS.join(',')})`

export function parseProductDataGapKind(value: unknown): ProductDataGapKind | null {
  return PRODUCT_DATA_GAP_KINDS.find((kind) => kind === value) ?? null
}

export function parseProductConflictMark(value: unknown): ProductConflictMark | null {
  return PRODUCT_CONFLICT_MARKS.find((mark) => mark === value) ?? null
}

const EMPTY_BARCODE_SQL = `p.is_active = 1 AND (p.barcode IS NULL OR trim(p.barcode, ${BLANK_CHARS_SQL}) = '')`
const PLACEHOLDER_BARCODE_SQL = `p.is_active = 1 AND p.barcode IS NOT NULL AND trim(p.barcode, ${BLANK_CHARS_SQL}) <> '' AND trim(p.barcode, ${BLANK_CHARS_SQL}) NOT GLOB '*[^0]*'`
const NOT_GROUP_PARENT = 'NOT (COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)'
const HAS_MARK = (mark: ProductConflictMark, alias: string): string => `EXISTS (SELECT 1 FROM product_conflict_marks m WHERE m.product_id = ${alias}.id AND m.mark = '${mark}')`
const NOT_MARKED_NO_BARCODE = `NOT ${HAS_MARK('no_barcode', 'p')}`
const WATERMARK = `CAST((SELECT value FROM system_flags WHERE key = 'cost_zero_watermark') AS INTEGER)`

// $0 on an old product with no proof that it is real (Q1). Without the watermark flag nothing is unproven.
const unprovenZero = (alias: string): string => `${alias}.cost_price_usd = 0 AND ${alias}.is_active = 1 AND ${alias}.id <= ${WATERMARK}
      AND NOT ${HAS_MARK('zero_cost_confirmed', alias)}
      AND NOT EXISTS (SELECT 1 FROM product_cost_entries e WHERE e.product_id = ${alias}.id AND e.cost_usd = 0
        AND e.id = (SELECT MAX(id) FROM product_cost_entries WHERE product_id = ${alias}.id))
      AND NOT EXISTS (SELECT 1 FROM product_batches zb WHERE zb.variant_product_id = ${alias}.id AND zb.is_active = 1 AND zb.unit_cost_usd = 0
        AND EXISTS (SELECT 1 FROM branch_batch_stock zs WHERE zs.batch_id = zb.id AND zs.quantity > 0))`

// Product ids with any unknown-cost reason, each branch served by its own partial index.
function unknownCostIdsSql(bounded: boolean): string {
  const after = (column: string): string => (bounded ? ` AND ${column} > @after` : '')
  return `SELECT z.id AS pid FROM products z WHERE z.cost_price_usd IS NULL AND z.is_active = 1${after('z.id')}
    UNION SELECT pb.variant_product_id FROM product_batches pb WHERE pb.unit_cost_usd IS NULL AND pb.is_active = 1${after('pb.variant_product_id')}
      AND EXISTS (SELECT 1 FROM branch_batch_stock s WHERE s.batch_id = pb.id AND s.quantity > 0)
    UNION SELECT d.product_id FROM damaged_stock_lots d WHERE d.unit_cost_usd IS NULL AND d.quantity_remaining > 0${after('d.product_id')}
    UNION SELECT z.id FROM products z WHERE z.cost_price_usd = 0 AND z.is_active = 1${after('z.id')}
      AND ${unprovenZero('z')}`
}

const UNKNOWN_COST_COUNT_SQL = `SELECT COUNT(*) FROM products p WHERE +p.is_active = 1 AND ${NOT_GROUP_PARENT} AND p.id IN (${unknownCostIdsSql(false)})`
const EMPTY_BARCODE_COUNT_SQL = `SELECT COUNT(*) FROM products p WHERE ${EMPTY_BARCODE_SQL} AND ${NOT_GROUP_PARENT} AND ${NOT_MARKED_NO_BARCODE}`
const PLACEHOLDER_BARCODE_COUNT_SQL = `SELECT COUNT(*) FROM products p WHERE ${PLACEHOLDER_BARCODE_SQL} AND ${NOT_GROUP_PARENT} AND ${NOT_MARKED_NO_BARCODE}`

export type ProductDataGapRow = {
  id: number
  name: string | null
  barcode: string | null
  sku: string | null
  brand: string | null
  category: string | null
  stock_quantity: number
  image_path: string | null
  /** unknown_cost only: why the product is listed. */
  reasons?: Array<'catalog_unknown' | 'lots_unknown' | 'held_unknown' | 'zero_unconfirmed'>
  unknown_lot_count?: number
  unknown_units?: number
  held_unknown_count?: number
  held_unknown_units?: number
}

export type ProductDataGapPage = {
  kind: ProductDataGapKind
  items: ProductDataGapRow[]
  has_more: boolean
  /** Pass back as `after` for the next page; null on the last page. */
  next_after: number | null
}

export type ProductDataGapCounts = { unknown_cost?: number; empty_barcode: number; placeholder_barcode: number }

type PageRow = ProductDataGapRow & {
  catalog_unknown?: number
  zero_unconfirmed?: number
}

const PAGE_COLUMNS = `p.id, p.name, p.barcode, p.sku, p.brand, p.category, COALESCE(p.stock_quantity, 0) AS stock_quantity, p.image_path`

/** The page query of a kind (exported so the plan tests run the exact text). Binds @after and @limit. */
export function productDataGapPageSql(kind: ProductDataGapKind): string {
  if (kind !== 'unknown_cost') {
    return `SELECT ${PAGE_COLUMNS}
        FROM products p
        WHERE ${kind === 'empty_barcode' ? EMPTY_BARCODE_SQL : PLACEHOLDER_BARCODE_SQL} AND ${NOT_GROUP_PARENT} AND ${NOT_MARKED_NO_BARCODE} AND p.id > @after
        ORDER BY p.id ASC
        LIMIT @limit`
  }
  return `SELECT ${PAGE_COLUMNS},
               CASE WHEN p.cost_price_usd IS NULL THEN 1 ELSE 0 END AS catalog_unknown,
               CASE WHEN ${unprovenZero('p')} THEN 1 ELSE 0 END AS zero_unconfirmed,
               (SELECT COUNT(*) FROM product_batches pb WHERE pb.variant_product_id = p.id AND pb.unit_cost_usd IS NULL AND pb.is_active = 1
                  AND EXISTS (SELECT 1 FROM branch_batch_stock s WHERE s.batch_id = pb.id AND s.quantity > 0)) AS unknown_lot_count,
               (SELECT COALESCE(SUM(s.quantity), 0) FROM product_batches pb JOIN branch_batch_stock s ON s.batch_id = pb.id AND s.quantity > 0
                  WHERE pb.variant_product_id = p.id AND pb.unit_cost_usd IS NULL AND pb.is_active = 1) AS unknown_units,
               (SELECT COUNT(*) FROM damaged_stock_lots d WHERE d.product_id = p.id AND d.unit_cost_usd IS NULL AND d.quantity_remaining > 0) AS held_unknown_count,
               (SELECT COALESCE(SUM(d.quantity_remaining), 0) FROM damaged_stock_lots d WHERE d.product_id = p.id AND d.unit_cost_usd IS NULL AND d.quantity_remaining > 0) AS held_unknown_units
        FROM products p
        WHERE +p.is_active = 1 AND ${NOT_GROUP_PARENT} AND p.id > @after AND p.id IN (${unknownCostIdsSql(true)})
        ORDER BY p.id ASC
        LIMIT @limit`
}

/** The three counts in one statement (exported for the plan tests). */
export function productDataGapCountSql(includeCost: boolean): string {
  return `SELECT ${includeCost ? `(${UNKNOWN_COST_COUNT_SQL}) AS unknown_cost,` : ''}
    (${EMPTY_BARCODE_COUNT_SQL}) AS empty_barcode, (${PLACEHOLDER_BARCODE_COUNT_SQL}) AS placeholder_barcode`
}

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
  const rows = await db.prepare(productDataGapPageSql(kind)).all<PageRow>({ after, limit: limit + 1 })
  const hasMore = rows.length > limit
  const items = (hasMore ? rows.slice(0, limit) : rows).map((row): ProductDataGapRow => {
    if (kind !== 'unknown_cost') return row
    const { catalog_unknown, zero_unconfirmed, ...rest } = row
    const unknownLotCount = Number(rest.unknown_lot_count || 0)
    const heldCount = Number(rest.held_unknown_count || 0)
    const reasons: NonNullable<ProductDataGapRow['reasons']> = []
    if (catalog_unknown) reasons.push('catalog_unknown')
    if (unknownLotCount > 0) reasons.push('lots_unknown')
    if (heldCount > 0) reasons.push('held_unknown')
    if (zero_unconfirmed) reasons.push('zero_unconfirmed')
    return { ...rest, reasons, unknown_lot_count: unknownLotCount, unknown_units: Number(rest.unknown_units || 0), held_unknown_count: heldCount, held_unknown_units: Number(rest.held_unknown_units || 0) }
  })
  return { kind, items, has_more: hasMore, next_after: hasMore ? items[items.length - 1].id : null }
}

/** `includeCost` false drops unknown_cost: a count of unknown costs is cost data (product_cost_view). */
export async function countProductDataGaps(db: Db, includeCost: boolean): Promise<ProductDataGapCounts> {
  const row = await db.prepare(productDataGapCountSql(includeCost)).get<Record<string, number>>({})
  return {
    ...(includeCost ? { unknown_cost: Number(row?.unknown_cost || 0) } : {}),
    empty_barcode: Number(row?.empty_barcode || 0),
    placeholder_barcode: Number(row?.placeholder_barcode || 0),
  }
}

// --- decisions: "Confirm $0" and "no barcode" -------------------------------------------------------------------------------------
// A mark is one row in product_conflict_marks. It changes no cost, stock, lot or sale. Each change writes, in ONE batch: the mark, an
// action_history row (the undo/redo record) and an audit row, behind a guard that aborts the batch if the product moved on meanwhile.

export class ProductConflictMarkError extends Error {
  readonly statusCode: 400 | 404 | 409
  readonly code: string
  constructor(statusCode: 400 | 404 | 409, code: string, message: string) {
    super(message)
    this.name = 'ProductConflictMarkError'
    this.statusCode = statusCode
    this.code = code
  }
}

export type ProductConflictMarkInput = { product_id: number; mark: ProductConflictMark; set: boolean }
export type ConflictActor = { id: number | null; name: string | null }

export function parseProductConflictMarkInput(body: unknown): ProductConflictMarkInput {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  if (!record) throw new ProductConflictMarkError(400, 'invalid_body', 'A JSON body is required')
  const idText = typeof record.product_id === 'number' || typeof record.product_id === 'string' ? String(record.product_id).trim() : ''
  const productId = /^\d+$/.test(idText) ? Number(idText) : 0
  if (!productId) throw new ProductConflictMarkError(400, 'product_id_required', 'product_id is required')
  const mark = parseProductConflictMark(record.mark)
  if (!mark) throw new ProductConflictMarkError(400, 'mark_invalid', 'mark must be zero_cost_confirmed or no_barcode')
  if (typeof record.set !== 'boolean') throw new ProductConflictMarkError(400, 'set_required', 'set must be true or false')
  return { product_id: productId, mark, set: record.set }
}

const CHANGED_TOKEN = 'product_conflict_mark_changed'
const guardSql = (condition: string): string => `SELECT CASE WHEN ${condition} THEN 1 ELSE json_extract('[1]', '$[${CHANGED_TOKEN}]') END AS product_conflict_mark_guard`
const isChangedError = (error: unknown): boolean => new RegExp(`JSON path error|${CHANGED_TOKEN}`, 'i').test(String((error as Error)?.message ?? error))

/** Whether a mark may be set on a product right now: the product is active and the gap the mark answers still exists. */
const markableSql = (mark: ProductConflictMark): string => (mark === 'zero_cost_confirmed'
  ? `EXISTS (SELECT 1 FROM products p WHERE p.id = @pid AND ${unprovenZero('p')})`
  : `EXISTS (SELECT 1 FROM products p WHERE p.id = @pid AND ((${EMPTY_BARCODE_SQL}) OR (${PLACEHOLDER_BARCODE_SQL})))`)

const markedSql = (mark: ProductConflictMark): string => `EXISTS (SELECT 1 FROM product_conflict_marks WHERE product_id = @pid AND mark = '${mark}')`

const MARK_TEXT: Record<ProductConflictMark, { set: [string, string, string]; unset: [string, string, string] }> = {
  zero_cost_confirmed: {
    set: ['Confirmed a $0 cost', 'Undo the $0 cost confirmation', 'Redo the $0 cost confirmation'],
    unset: ['Removed a $0 cost confirmation', 'Undo removing the $0 cost confirmation', 'Redo removing the $0 cost confirmation'],
  },
  no_barcode: {
    set: ['Marked a product as having no barcode', 'Undo the no-barcode mark', 'Redo the no-barcode mark'],
    unset: ['Removed the no-barcode mark', 'Undo removing the no-barcode mark', 'Redo removing the no-barcode mark'],
  },
}

async function productState(db: Db, input: ProductConflictMarkInput): Promise<{ active: number; markable: number; marked: number }> {
  const row = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM products WHERE id = @pid AND is_active = 1) AS active,
    (SELECT ${markableSql(input.mark)}) AS markable,
    (SELECT ${markedSql(input.mark)}) AS marked`).get<{ active: number; markable: number; marked: number }>({ pid: input.product_id })
  return { active: Number(row?.active || 0), markable: Number(row?.markable || 0), marked: Number(row?.marked || 0) }
}

// The value a "confirmed correct" decision stands on: the catalog cost for a $0 confirmation, the barcode text for "no barcode".
// A review-tier request records it when it is made; the approval refuses unless the product still holds exactly that value (owner, 27 Oct 2026).
export type ConfirmedValue = { cost_price_usd: number | null; cost_price_khr: number | null } | { barcode: string | null }

export async function readConfirmedValue(db: Db, input: Pick<ProductConflictMarkInput, 'product_id' | 'mark'>): Promise<ConfirmedValue | null> {
  const row = await db.prepare('SELECT cost_price_usd, cost_price_khr, barcode FROM products WHERE id = @pid AND is_active = 1')
    .get<{ cost_price_usd: number | null; cost_price_khr: number | null; barcode: string | null }>({ pid: input.product_id })
  if (!row) return null
  return input.mark === 'zero_cost_confirmed'
    ? { cost_price_usd: row.cost_price_usd ?? null, cost_price_khr: row.cost_price_khr ?? null }
    : { barcode: row.barcode ?? null }
}

/** Reads a stored ConfirmedValue back for the given mark; null when it is missing or the wrong shape. */
export function parseConfirmedValue(mark: ProductConflictMark, raw: unknown): ConfirmedValue | null {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  if (!record) return null
  const num = (value: unknown): number | null | undefined => (value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  if (mark === 'zero_cost_confirmed') {
    const usd = num(record.cost_price_usd)
    const khr = num(record.cost_price_khr)
    return usd === undefined || khr === undefined ? null : { cost_price_usd: usd, cost_price_khr: khr }
  }
  return record.barcode === null || typeof record.barcode === 'string' ? { barcode: record.barcode as string | null } : null
}

const confirmedSql = (mark: ProductConflictMark): string => (mark === 'zero_cost_confirmed'
  ? 'EXISTS (SELECT 1 FROM products p WHERE p.id = @pid AND p.cost_price_usd IS @exp_usd AND p.cost_price_khr IS @exp_khr)'
  : 'EXISTS (SELECT 1 FROM products p WHERE p.id = @pid AND p.barcode IS @exp_barcode)')

const confirmedParams = (expected: ConfirmedValue): Record<string, unknown> => ('barcode' in expected
  ? { exp_barcode: expected.barcode }
  : { exp_usd: expected.cost_price_usd, exp_khr: expected.cost_price_khr })

const valueChanged = (mark: ProductConflictMark): ProductConflictMarkError => (mark === 'zero_cost_confirmed'
  ? new ProductConflictMarkError(409, 'confirmed_value_changed', 'The cost changed after this was requested, so the $0 confirmation was not applied. Reject the request and check the product again.')
  : new ProductConflictMarkError(409, 'confirmed_value_changed', 'The barcode changed after this was requested, so the "no barcode" mark was not applied. Reject the request and check the product again.'))

/**
 * The checks every mark change starts with. Returns 'noop' when the product is already in the asked state, throws the refusal
 * otherwise. A review-tier request runs it before queueing so a request that could never apply is not queued.
 */
export async function preflightProductConflictMark(db: Db, input: ProductConflictMarkInput): Promise<'noop' | 'ok'> {
  const state = await productState(db, input)
  if (!state.active) throw new ProductConflictMarkError(404, 'product_not_found', 'Product not found')
  if (Boolean(state.marked) === input.set) return 'noop'
  if (input.set && !state.markable) {
    throw input.mark === 'zero_cost_confirmed'
      ? new ProductConflictMarkError(409, 'zero_not_unconfirmed', 'This cost is no longer an unconfirmed $0. Refresh and check it.')
      : new ProductConflictMarkError(409, 'barcode_present', 'This product has a barcode, so it cannot be marked as having none.')
  }
  return 'ok'
}

/** The open request of this account for the same product, mark and direction, so a repeated tap or retry reuses it (null when none). */
export async function findOpenConflictMarkRequest(db: Db, requestedBy: number | null, input: ProductConflictMarkInput): Promise<number | null> {
  const rows = await db.prepare(`SELECT id, payload_json FROM pending_actions
    WHERE status = 'open' AND section = 'products' AND action_type = 'conflict_mark' AND entity_type = 'product'
      AND entity_id = @pid AND requested_by IS @uid ORDER BY id`).all<{ id: number; payload_json: string }>({ pid: input.product_id, uid: requestedBy })
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
      if (payload.mark === input.mark && payload.set === input.set) return Number(row.id)
    } catch { /* an unreadable request is never a match */ }
  }
  return null
}

export type ProductConflictMarkOptions = {
  /** Set only: the value the decision stands on; the write is refused unless the product still holds it. */
  expected?: ConfirmedValue
  /** Where the change came from, for the audit row. */
  via?: 'conflicts' | 'review'
  /** The review-tier account that asked, named on the audit row when a reviewer applies the change. */
  requestedBy?: ConflictActor
}

export async function setProductConflictMark(
  db: Db,
  actor: ConflictActor,
  input: ProductConflictMarkInput,
  options: ProductConflictMarkOptions = {},
): Promise<{ product_id: number; mark: ProductConflictMark; set: boolean; changed: boolean; action_history_id: number }> {
  if (await preflightProductConflictMark(db, input) === 'noop') {
    return { product_id: input.product_id, mark: input.mark, set: input.set, changed: false, action_history_id: 0 }
  }
  const expected = input.set ? options.expected : undefined
  if (expected) {
    const now = await readConfirmedValue(db, input)
    if (JSON.stringify(now) !== JSON.stringify(expected)) throw valueChanged(input.mark)
  }
  const [label, undoLabel, redoLabel] = MARK_TEXT[input.mark][input.set ? 'set' : 'unset']
  const payload = JSON.stringify({ applier: PRODUCT_CONFLICT_APPLIER, product_id: input.product_id, mark: input.mark, set: input.set })
  const statements: Statement[] = [
    { sql: guardSql(`${input.set ? `NOT ${markedSql(input.mark)} AND ${markableSql(input.mark)}${expected ? ` AND ${confirmedSql(input.mark)}` : ''}` : markedSql(input.mark)}`),
      params: { pid: input.product_id, ...(expected ? confirmedParams(expected) : {}) } },
    input.set
      ? { sql: 'INSERT INTO product_conflict_marks (product_id, mark, marked_by_id, marked_by_name) VALUES (@pid, @mark, @uid, @uname)', params: { pid: input.product_id, mark: input.mark, uid: actor.id, uname: actor.name } }
      : { sql: 'DELETE FROM product_conflict_marks WHERE product_id = @pid AND mark = @mark', params: { pid: input.product_id, mark: input.mark } },
    { sql: `INSERT INTO action_history (scope, entity, entity_id, label, undo_label, redo_label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
      VALUES ('products', 'product', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable', @payload, @payload, @uid, @uname)`,
    params: { entityId: String(input.product_id), label, undoLabel, redoLabel, payload, uid: actor.id, uname: actor.name } },
    buildAuditStatement(actor.id, actor.name, input.set ? 'conflict_mark' : 'conflict_unmark', 'product', String(input.product_id),
      { via: options.via ?? 'conflicts', mark: input.mark, ...(options.requestedBy ? { requested_by_id: options.requestedBy.id, requested_by_name: options.requestedBy.name } : {}) }),
    ordinaryBusinessMaintenanceGuard,
  ]
  let results
  try {
    results = await db.batch(statements)
  } catch (error) {
    // The guard fired: someone changed the product between the check and the write. Say which refusal now applies.
    if (isChangedError(error)) {
      const now = await productState(db, input)
      if (Boolean(now.marked) === input.set) return { product_id: input.product_id, mark: input.mark, set: input.set, changed: false, action_history_id: 0 }
      if (expected && JSON.stringify(await readConfirmedValue(db, input)) !== JSON.stringify(expected)) throw valueChanged(input.mark)
      throw new ProductConflictMarkError(409, 'product_changed', 'This product changed after you opened it. Refresh and try again.')
    }
    throw error
  }
  return { product_id: input.product_id, mark: input.mark, set: input.set, changed: true, action_history_id: Number(results[2]?.meta?.last_row_id ?? 0) }
}

// --- undo / redo ----------------------------------------------------------------------------------------------------------------
// The payload is the mark itself, so replay is the compensating write: undo applies the opposite of `set`, redo applies `set` again.
// It writes no second action_history row (the route that runs the replay moves the original row between undoable and redoable) but it
// does write an audit row. A mark that is already in the target state is refused with undo_already_done, a mark whose gap has gone
// (a barcode was typed meanwhile) cannot be re-set and is refused with undo_record_changed.

export class ProductConflictReplayError extends Error {
  readonly statusCode = 409
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'ProductConflictReplayError'
    this.code = code
  }
}

export async function replayProductConflictMark(
  db: Db,
  actor: ConflictActor,
  canEditCosts: boolean,
  direction: 'undo' | 'redo',
  payload: Record<string, unknown>,
): Promise<number> {
  const productId = Number(payload.product_id)
  const mark = parseProductConflictMark(payload.mark)
  if (!Number.isInteger(productId) || productId <= 0 || !mark || typeof payload.set !== 'boolean') {
    throw new ProductConflictReplayError('The saved details for this action are unreadable, so it cannot be replayed.', 'undo_history_unusable')
  }
  if (mark === 'zero_cost_confirmed' && !canEditCosts) {
    throw new ProductConflictReplayError('Confirming or reversing a $0 cost needs the cost-entry permission.', 'undo_refused')
  }
  const target = direction === 'undo' ? !payload.set : payload.set
  const input: ProductConflictMarkInput = { product_id: productId, mark, set: target }
  const state = await productState(db, input)
  if (Boolean(state.marked) === target) throw new ProductConflictReplayError('This mark is already in that state; there is nothing to change.', 'undo_already_done')
  const changed = (): ProductConflictReplayError => new ProductConflictReplayError(
    `The product changed after this action, so it can no longer be ${direction === 'undo' ? 'undone' : 'redone'}. Nothing was changed.`, 'undo_record_changed')
  if (target && !state.markable) throw changed()
  try {
    await db.batch([
      { sql: guardSql(target ? `NOT ${markedSql(mark)} AND ${markableSql(mark)}` : markedSql(mark)), params: { pid: productId } },
      target
        ? { sql: 'INSERT INTO product_conflict_marks (product_id, mark, marked_by_id, marked_by_name) VALUES (@pid, @mark, @uid, @uname)', params: { pid: productId, mark, uid: actor.id, uname: actor.name } }
        : { sql: 'DELETE FROM product_conflict_marks WHERE product_id = @pid AND mark = @mark', params: { pid: productId, mark } },
      buildAuditStatement(actor.id, actor.name, target ? 'conflict_mark' : 'conflict_unmark', 'product', String(productId), { via: 'undo_applier', direction, mark }),
      ordinaryBusinessMaintenanceGuard,
    ])
  } catch (error) {
    if (isChangedError(error)) throw changed()
    throw error
  }
  return productId
}
