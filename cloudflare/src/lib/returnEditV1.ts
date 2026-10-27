// 6.0.997 slice S1 -- managers and admins edit the NON-MONEY parts of a current-format customer return: reason, notes, handling
// method and each line's stock handling (restock / damaged with a tag / none) at the quantities the return already has.
// Owner, 26-27 Oct 2026: "admin should have clear options and manual edits"; the screen says "money details", never "format".
//
// What is written
//   returns            reason, notes, return_type, updated_at.
//   return_items       stock_action, return_to_stock, batch_id -- only for lines whose handling changed.
//   return_item_batch_allocations   the lots a restock put back (deleted and re-inserted with their ids for changed lines).
//   damaged_stock_lots the held rows of damaged lines (opened, closed or re-tagged).
//   branch_stock, branch_batch_stock, products.stock_quantity   moved together, in a FIXED number of statements however many
//                      lines change (lib/returnStockDeltas.ts, shared with the grouped cancel/restore), plus one movement row
//                      per delta. A reversal draws from the lots the return recorded, never from "the newest lot".
// What is never written (asserted before and after in the same batch): every refund amount, the currency, the riel figure, the
// debt lowered, quantities, line prices, the sale link, the branch, the date and the status. Any request that would change
// them is refused with a sentence that points to the way out (money edits arrive in a later slice).
//
// Preview, then apply: POST /api/returns/:id/edit/preview reads and plans only and answers a digest; PUT /api/returns/:id
// takes that digest, writes exactly what was previewed and records one undoable history entry (undo_snapshots + action_history)
// and one audit row (entity 'return', so it shows in the return's Records). Undo/redo is a server applier that replays the
// recorded before/after exactly, refused once any return on the sale changed since.
import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { actorSnapshot } from './actorSnapshot'
import { canConvertLegacyReturns } from './returnLegacyConvert'
import { sha256Hex } from './saleRecordEvents'
import { ordinaryBusinessMaintenanceGuard } from './businessMaintenanceGuard'
import { getPlanLimits } from './planTier'
import { assertReturnCreateQueryBudget, ReturnCreateBudgetError } from './returnCreateAction'
import { executeStockTransaction } from './stockTransaction'
import { guard, stockStatements, type Statement, type StockDelta } from './returnStockDeltas'
import { pairDamagedLinesToLots } from './returnsStock'
import { productStockGuardStatement } from './productStockGuard'
import {
  BranchEffectResolver, BranchRetiredNoSuccessorError, branchEffectGuardPredicate, foldedLotSurvivors, readBranchDirectory,
  type BranchEffectGuard,
} from './branchEffect'
import { normalizeStockAction, planReturnLot, type ReturnStockAction } from './returnsStock'
import { DEFAULT_STOCK_CONDITION_TAG, parseStockConditionTag } from './stockCondition'
import { notifyReturnBulkAction } from './returnBulkAction'
import type { UndoApplierContext, UndoApplierOutcome } from './undoAppliers'

export const RETURN_EDIT_KIND = 'return.edit_v1'
export const RETURN_EDIT_V1_LINE_LIMIT = 50
const REASON_MAX = 500
const NOTES_MAX = 2000
/** Reads still to come after the write: the notification versions and one retry of each. */
const RESERVE_STATEMENTS = 8

type Status = 400 | 403 | 404 | 409 | 503
export class ReturnEditV1Error extends Error {
  constructor(message: string, readonly statusCode: Status = 409, readonly code = 'return_edit_refused',
    readonly params?: Record<string, unknown>, readonly extra?: Record<string, unknown>) { super(message) }
}
function fail(message: string, status: Status = 409, code?: string, params?: Record<string, unknown>, extra?: Record<string, unknown>): never {
  throw new ReturnEditV1Error(message, status, code, params, extra)
}

/** Full access to Returns with Edit not switched off: managers and admins (the same tier check as updating money details). */
export const canEditCurrentReturns = canConvertLegacyReturns
function authorize(user: SessionUser | null | undefined): SessionUser {
  if (!canEditCurrentReturns(user)) fail('Full access to Returns (with Edit) is required to edit a return.', 403, 'return_edit_forbidden')
  return user!
}

type Row = Record<string, unknown>
const num = (value: unknown): number => Number(value) || 0
const nullableText = (value: unknown): string | null => value == null ? null : String(value)
const roundQ = (value: number): number => Math.round(value * 1e9) / 1e9
const sameQ = (a: unknown, b: unknown): boolean => Math.abs(num(a) - num(b)) < 1e-9

// ---- the stored shapes -----------------------------------------------------------------------------------------------------
type AllocRow = { id: number; return_item_id: number; sale_item_id: number | null; batch_id: number; branch_id: number | null; quantity: number
  lot_code: string | null; expiry_date: string | null; reversed_at: string | null; created_at: string | null }
type LotRow = { id: number; product_id: number; product_name: string | null; branch_id: number | null; batch_id: number | null; return_id: number
  quantity: number; quantity_remaining: number; reason: string | null; created_by_user_id: number | null; created_by_user_name: string | null
  created_at: string | null; updated_at: string | null; condition_tag: string | null; source: string | null; unit_cost_usd: number | null }
// ra / rr: the line's stock_action and return_to_stock exactly as stored (NULL, odd case), kept on the BEFORE side only so the state guard
// compares what the row really holds and an undo writes it back byte for byte. An older snapshot without them falls back to a / r.
type LineState = { id: number; a: ReturnStockAction; r: 0 | 1; b: number | null; allocs: AllocRow[]; ra?: string | null; rr?: number | null }
const storedLine = (state: LineState) => ({ a: 'ra' in state ? state.ra : state.a, r: 'rr' in state ? state.rr : state.r, b: state.b })
type Change = { id: number; name: string | null; before: LineState; after: LineState }
type Header = { reason: string | null; notes: string | null; return_type: string | null }
type LotMove = { product_id: number; product_name: string | null; branch_id: number; batch_id: number | null; quantity: number; usd: number | null; khr: number | null }
type Retag = { id: number; line?: number; name: string | null; before: string | null; after: string | null }
type PlainGuard = { product: number; branch: number; q: number }

/** Everything an apply, an undo and a redo need; stored in undo_snapshots.payload_json. */
type Snapshot = {
  version: 1; return_id: number; return_number: string | null; sale_id: number | null; money_fp: string
  header: { before: Header; after: Header }
  changes: Change[]
  lots: { removed: LotRow[]; added: LotRow[]; retag: Retag[] }
  lot_moves: LotMove[]
  stock: StockDelta[]
  plain: PlainGuard[]
  effects: BranchEffectGuard[]
}
type Stored = Snapshot & { operation_id: string; request_digest: string; generation: number; history_id?: number; fingerprint?: string
  last_direction?: 'undo' | 'redo'; last_expected_generation?: number }

export type EditPreview = {
  digest: string; changed: boolean
  return: { id: number; return_number: string | null; status: string }
  header: Array<{ field: 'reason' | 'notes' | 'return_type'; before: string | null; after: string | null }>
  lines: Array<{ id: number; product_name: string | null; quantity: number; before: ReturnStockAction; after: ReturnStockAction; tag_before: string | null; tag_after: string | null }>
  stock: Array<{ product_id: number; product_name: string | null; branch_id: number; branch_name: string | null; batch_id: number | null; quantity: number; kind: 'sellable' | 'damaged' }>
  money: { unchanged: true; total_refund_usd: number; total_refund_khr: number; refund_currency: string | null; owed_reduction_usd: number }
  statements: { planned: number; limit: number }
}
type Plan = { preview: EditPreview; snapshot: Snapshot; requestDigest: string; plannedStatements: number; reads: number; revision: number }

export type ReturnEditBudget = { statementsUsed(): number; reserveStatements?: number }

// ---- the request -----------------------------------------------------------------------------------------------------------
type IntentLine = { key: { id?: number; saleItemId?: number; productId?: number }; quantity: number | null; action?: ReturnStockAction; tag?: string | null; remove: boolean }
type Intent = {
  expectedUpdatedAt: string; reason?: string; notes?: string | null; returnType?: string; lines?: IntentLine[]
  money: Array<{ field: 'total_refund_usd' | 'total_refund_khr' | 'refund_currency' | 'branch_id'; value: unknown }>
}
const TOP_KEYS = new Set(['client_request_id', 'expected_digest', 'expected_updated_at', 'expectedUpdatedAt', 'updated_at', 'updatedAt', 'reason', 'notes', 'return_type',
  'items', 'total_refund_usd', 'total_refund_khr', 'refund_currency', 'branch_id', 'cashier_id', 'cashier_name'])
const MONEY_KEYS = ['total_refund_usd', 'total_refund_khr', 'refund_currency', 'branch_id'] as const
const RETURN_TYPES = ['restock', 'writeoff', 'refund']

export const RETURN_EDIT_MONEY_LOCKED = "Quantities, lines, the refund and its currency can't be changed on this return yet. You can change the reason, notes and stock handling now. To correct an amount, cancel this return and record a new one."

function parseIntent(body: Row): Intent {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('The edit is not valid.', 400, 'return_edit_invalid')
  if (Object.keys(body).some(key => !TOP_KEYS.has(key))) fail('The edit contains fields this screen cannot save.', 400, 'return_edit_invalid')
  const expectedUpdatedAt = String(body.expected_updated_at ?? body.expectedUpdatedAt ?? body.updated_at ?? body.updatedAt ?? '').trim()
  if (!expectedUpdatedAt) fail('Refresh this return before editing it.', 400, 'expected_updated_at_required')
  const intent: Intent = { expectedUpdatedAt, money: [] }
  if (body.reason !== undefined) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason || reason.length > REASON_MAX) fail('Give a reason (up to 500 characters).', 400, 'return_edit_invalid')
    intent.reason = reason
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') fail('The notes are not valid.', 400, 'return_edit_invalid')
    const notes = body.notes === null ? '' : String(body.notes).trim()
    if (notes.length > NOTES_MAX) fail('The notes are too long (up to 2000 characters).', 400, 'return_edit_invalid')
    intent.notes = notes || null
  }
  if (body.return_type !== undefined) {
    if (typeof body.return_type !== 'string' || !body.return_type.trim() || body.return_type.length > 40) fail('Choose a handling method.', 400, 'return_edit_invalid')
    intent.returnType = body.return_type
  }
  for (const field of MONEY_KEYS) if (body[field] !== undefined) intent.money.push({ field, value: body[field] })
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length < 1) fail('A return must keep at least one line. To undo the whole return, cancel it instead.', 400, 'return_edit_empty')
    if (body.items.length > RETURN_EDIT_V1_LINE_LIMIT) fail('Edit fewer lines at a time.', 400, 'return_edit_too_large')
    intent.lines = body.items.map((raw): IntentLine => {
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : fail('A line is not valid.', 400, 'return_edit_invalid')
      const id = Number(item.id), saleItemId = Number(item.sale_item_id), productId = Number(item.product_id)
      const explicit = item.stock_action !== undefined && item.stock_action !== null && item.stock_action !== ''
        ? String(item.stock_action).trim().toLowerCase()
        : item.return_to_stock !== undefined && item.return_to_stock !== null ? (item.return_to_stock ? 'restock' : 'none') : undefined
      if (explicit !== undefined && !['restock', 'damaged', 'none'].includes(explicit)) fail('Choose restock, damaged or no stock change.', 400, 'return_edit_invalid')
      const tag = item.condition_tag === undefined || item.condition_tag === null || item.condition_tag === '' ? undefined : parseStockConditionTag(item.condition_tag)
      if (tag && !tag.ok) fail(tag.error, 400, 'return_edit_invalid')
      return {
        key: { ...(Number.isSafeInteger(id) && id > 0 ? { id } : {}), ...(Number.isSafeInteger(saleItemId) && saleItemId > 0 ? { saleItemId } : {}),
          ...(Number.isSafeInteger(productId) && productId > 0 ? { productId } : {}) },
        quantity: item.quantity === undefined || item.quantity === null ? null : Number(item.quantity),
        action: explicit as ReturnStockAction | undefined,
        tag: tag && tag.ok ? tag.tag : undefined,
        remove: String(item.damaged_disposition ?? '').trim().toLowerCase() === 'remove',
      }
    })
  }
  return intent
}

// ---- reads -----------------------------------------------------------------------------------------------------------------
/** Every money figure of the return and its lines, as one JSON text. Compared before and after a write: it must never move.
 *  The alias is `mf`, never `r`: the planning query calls this as moneyFp('r.id') inside its own `returns r` scope, where an inner `r`
 *  shadows it and fingerprints the FIRST return in the table (every return but the first then failed to save). */
const moneyFp = (idExpr: string): string => `(SELECT json_array(mf.status,mf.money_precision_version,mf.total_refund_usd,mf.total_refund_khr,mf.calculated_refund_usd,
  mf.rounding_adjustment_usd,mf.owed_reduction_usd,mf.refund_currency,mf.exchange_rate,mf.branch_id,mf.sale_id,mf.created_at,mf.replacement_sale_id,
  (SELECT COALESCE(json_group_array(json_array(ri.id,ri.sale_item_id,ri.product_id,ri.quantity,ri.total_usd,ri.total_khr,ri.applied_price_usd,ri.applied_price_khr,ri.refund_snapshot_json)),'[]')
    FROM (SELECT * FROM return_items WHERE return_id=mf.id ORDER BY id) ri)) FROM returns mf WHERE mf.id=${idExpr})`

const ALLOCS_JSON = `(SELECT COALESCE(json_group_array(json_object('id',a.id,'return_item_id',a.return_item_id,'sale_item_id',a.sale_item_id,'batch_id',a.batch_id,
  'branch_id',a.branch_id,'quantity',a.quantity,'lot_code',a.lot_code,'expiry_date',a.expiry_date,'reversed_at',a.reversed_at,'created_at',a.created_at)),'[]')
  FROM (SELECT * FROM return_item_batch_allocations WHERE return_item_id=ri.id ORDER BY id) a)`

type ItemRow = Row & { id: number; allocs: AllocRow[] }
function parseAllocs(raw: unknown): AllocRow[] {
  try { return (JSON.parse(String(raw || '[]')) as Row[]).map(row => ({ id: num(row.id), return_item_id: num(row.return_item_id),
    sale_item_id: row.sale_item_id == null ? null : num(row.sale_item_id), batch_id: num(row.batch_id), branch_id: row.branch_id == null ? null : num(row.branch_id),
    quantity: num(row.quantity), lot_code: nullableText(row.lot_code), expiry_date: nullableText(row.expiry_date), reversed_at: nullableText(row.reversed_at),
    created_at: nullableText(row.created_at) })) } catch { return fail('This return has incomplete stock records. Count the stock with Set instead.', 409, 'return_edit_provenance') }
}

const lotRow = (row: Row): LotRow => ({ id: num(row.id), product_id: num(row.product_id), product_name: nullableText(row.product_name),
  branch_id: row.branch_id == null ? null : num(row.branch_id), batch_id: row.batch_id == null ? null : num(row.batch_id), return_id: num(row.return_id),
  quantity: num(row.quantity), quantity_remaining: num(row.quantity_remaining), reason: nullableText(row.reason),
  created_by_user_id: row.created_by_user_id == null ? null : num(row.created_by_user_id), created_by_user_name: nullableText(row.created_by_user_name),
  created_at: nullableText(row.created_at), updated_at: nullableText(row.updated_at), condition_tag: nullableText(row.condition_tag), source: nullableText(row.source),
  unit_cost_usd: row.unit_cost_usd == null ? null : num(row.unit_cost_usd) })

const lineAction = (item: Row): ReturnStockAction => normalizeStockAction({ stock_action: item.stock_action, return_to_stock: num(item.return_to_stock) === 1 })

// ---- the plan --------------------------------------------------------------------------------------------------------------
export async function planReturnEdit(env: Env, userInput: SessionUser | null | undefined, returnIdInput: unknown, body: Row,
  redirectTarget: number | null = null, budget?: ReturnEditBudget): Promise<Plan> {
  const user = authorize(userInput)
  const returnId = Number(returnIdInput)
  if (!Number.isSafeInteger(returnId) || returnId <= 0) fail('Return not found.', 404, 'return_edit_not_found')
  const intent = parseIntent(body)
  const db = getDb(env)
  let reads = 0
  const read = <T>(promise: Promise<T>): Promise<T> => { reads += 1; return promise }

  const ret = await read(db.prepare(`SELECT r.id,r.return_number,r.sale_id,r.status,r.return_scope,r.money_precision_version,r.branch_id,r.branch_name,r.reason,r.notes,
      r.return_type,r.updated_at,r.created_at,r.total_refund_usd,r.total_refund_khr,r.refund_currency,r.owed_reduction_usd,
      COALESCE(v.revision,0) AS revision,${moneyFp('r.id')} AS money_fp,s.sale_status,
      MAX((SELECT COALESCE(MAX(id),0) FROM damaged_stock_lots),COALESCE((SELECT seq FROM sqlite_sequence WHERE name='damaged_stock_lots'),0)) AS max_lot_id,
      MAX((SELECT COALESCE(MAX(id),0) FROM return_item_batch_allocations),COALESCE((SELECT seq FROM sqlite_sequence WHERE name='return_item_batch_allocations'),0)) AS max_alloc_id
    FROM returns r LEFT JOIN return_write_revisions v ON v.return_id=r.id LEFT JOIN sales s ON s.id=r.sale_id WHERE r.id=@id`).get<Row>({ id: returnId }))
  if (!ret) fail('This return no longer exists. Refresh the list.', 404, 'return_edit_not_found')
  if (String(ret.return_scope || 'customer') !== 'customer') fail('Supplier returns are edited from the supplier return screen.', 400, 'return_edit_supplier')
  if (Number(ret.money_precision_version) !== 1) fail('This return keeps its money details in the older form. Update its money details first.', 409, 'return_edit_needs_money_update')
  if (String(ret.status || 'completed') === 'cancelled') fail('This return is cancelled. Restore it, then edit.', 409, 'return_edit_cancelled')
  if (String(ret.updated_at ?? '') !== intent.expectedUpdatedAt) fail('This return changed. Nothing was saved. Review it again.', 409, 'return_edit_preview_stale')

  // Money echoes: a client that still sends the refund (an older screen) is accepted only when it names exactly what is stored.
  for (const echo of intent.money) {
    const stored = echo.field === 'refund_currency' ? String(ret.refund_currency ?? '') : echo.field === 'branch_id' ? num(ret.branch_id) : num(ret[echo.field])
    const sent = echo.field === 'refund_currency' ? String(echo.value ?? '') : num(echo.value)
    if (echo.field === 'refund_currency' ? stored !== sent : Math.abs(Number(stored) - Number(sent)) >= 0.0001) fail(RETURN_EDIT_MONEY_LOCKED, 409, 'return_edit_money_locked')
  }

  const items = (await read(db.prepare(`SELECT ri.id,ri.sale_item_id,ri.product_id,ri.product_name,ri.quantity,ri.branch_id,ri.batch_id,ri.return_to_stock,ri.stock_action,
      ri.cost_price_usd,ri.cost_price_khr,${ALLOCS_JSON} AS allocs FROM return_items ri WHERE ri.return_id=@id ORDER BY ri.id LIMIT 101`).all<Row>({ id: returnId })))
    .map(row => ({ ...row, id: num(row.id), allocs: parseAllocs(row.allocs) }) as ItemRow)
  if (items.length > RETURN_EDIT_V1_LINE_LIMIT) fail('Edit fewer lines at a time.', 400, 'return_edit_too_large')
  const lots = (await read(db.prepare('SELECT * FROM damaged_stock_lots WHERE return_id=@id ORDER BY id LIMIT 201').all<Row>({ id: returnId }))).map(lotRow)
  if (lots.length > 200) fail('Edit fewer lines at a time.', 400, 'return_edit_too_large')

  // ---- header ----
  const headerBefore: Header = { reason: nullableText(ret.reason), notes: nullableText(ret.notes), return_type: nullableText(ret.return_type) }
  // A handling method other than the three on offer is accepted only as the value already stored (a screen sends it back unchanged).
  if (intent.returnType !== undefined && intent.returnType !== headerBefore.return_type && !RETURN_TYPES.includes(intent.returnType)) fail('Choose a handling method.', 400, 'return_edit_invalid')
  const headerAfter: Header = { reason: intent.reason ?? headerBefore.reason, notes: intent.notes !== undefined ? intent.notes : headerBefore.notes,
    return_type: intent.returnType ?? headerBefore.return_type }

  // ---- lines: every stored line must be named exactly once, at its stored quantity ----
  const wanted = new Map<number, IntentLine>()
  if (intent.lines) {
    if (intent.lines.length !== items.length) fail(RETURN_EDIT_MONEY_LOCKED, 409, 'return_edit_money_locked')
    const taken = new Set<number>()
    for (const line of intent.lines) {
      const matches = items.filter(item => !taken.has(item.id) && (line.key.id != null ? item.id === line.key.id
        : line.key.saleItemId != null ? num(item.sale_item_id) === line.key.saleItemId : line.key.productId != null && num(item.product_id) === line.key.productId))
      if (matches.length < 1 || (line.key.id == null && line.key.saleItemId == null && matches.length !== 1)) fail(RETURN_EDIT_MONEY_LOCKED, 409, 'return_edit_money_locked')
      const item = matches[0]
      taken.add(item.id)
      if (line.quantity !== null && !sameQ(line.quantity, item.quantity)) fail(RETURN_EDIT_MONEY_LOCKED, 409, 'return_edit_money_locked')
      wanted.set(item.id, line)
    }
  }

  // The sale decides whether stock may move: a cancelled sale has taken its units back already.
  const targets = items.map(item => {
    const line = wanted.get(item.id)
    const current = lineAction(item)
    return { item, line, current, target: line?.action ?? current }
  })
  const stockMoves = targets.some(entry => entry.target !== entry.current || (entry.target === 'damaged' && entry.line?.tag != null))
  if (stockMoves && String(ret.sale_status || '').toLowerCase() === 'cancelled') {
    fail('The sale was cancelled. Un-cancel the sale in Sales to change this return\'s stock handling, or change only the reason and notes.', 409, 'return_edit_sale_cancelled')
  }

  // ---- stock handling ----
  const directory = await read(readBranchDirectory(db))
  const resolver = new BranchEffectResolver(directory, redirectTarget)
  const branchName = (id: number): string | null => (directory.find(row => Number(row.id) === id)?.name as string | undefined) ?? null
  const stamp = new Date().toISOString()
  // Both tables are AUTOINCREMENT: an id once used is never handed out again, so the next id is read from the sequence too (MAX(id) alone
  // drops back after the newest rows are deleted and would give another return's old lot id to a new row, breaking undo and sale links).
  let nextLot = num(ret.max_lot_id), nextAlloc = num(ret.max_alloc_id)
  const needSaleLines = targets.some(entry => entry.target !== entry.current && entry.target !== 'none' && entry.target !== entry.current)
  const saleLines = new Map<number, { batch_id: number | null; allocs: Array<{ batch_id: number; outstanding: number }> }>()
  if (needSaleLines) {
    const ids = [...new Set(targets.filter(entry => entry.target !== entry.current && entry.target !== 'none').map(entry => num(entry.item.sale_item_id)).filter(id => id > 0))]
    if (ids.length) {
      const rows = await read(db.prepare(`SELECT si.id,si.batch_id,(SELECT COALESCE(json_group_array(json_object('batch_id',a.batch_id,'quantity',a.quantity,'released',a.released_quantity)),'[]')
          FROM (SELECT * FROM sale_item_batch_allocations WHERE sale_item_id=si.id ORDER BY id) a) AS allocs
        FROM sale_items si WHERE si.id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids))`).all<Row>({ ids: JSON.stringify(ids) }))
      for (const row of rows) {
        const allocs = (JSON.parse(String(row.allocs || '[]')) as Row[]).map(a => ({ batch_id: num(a.batch_id), outstanding: Math.max(0, num(a.quantity) - num(a.released)) })).filter(a => a.outstanding > 0)
        saleLines.set(num(row.id), { batch_id: row.batch_id == null ? null : num(row.batch_id), allocs })
      }
    }
  }

  const changes: Change[] = []
  const foldMaps = new Map<number, Map<number, number>>()
  const stock: StockDelta[] = []
  const removedLots: LotRow[] = []
  const addedLots: LotRow[] = []
  const retag: Retag[] = []
  const lotMoves: LotMove[] = []
  // Which damaged lot belongs to which damaged line: lane 6.0.999's ONE pairing (returnsStock.pairDamagedLinesToLots). damaged_stock_lots
  // has no link to a line, so the pairing is an invariant every writer keeps: for each (return, product) the damaged lines in
  // ascending id and the return's damaged lots in ascending id are the same sequence, each pair of equal quantity. This edit keeps it
  // by writing lots in line order: a removed lot leaves both sequences one shorter at the same place; a retag rewrites a lot in place;
  // a line that becomes damaged gets a new lot, and the lots of the later damaged lines of its product that stay damaged are deleted
  // and re-created after it (same content, new ids) so the sequence still lines up. Undo restores the original rows and ids.
  const lotOfLine = new Map<number, LotRow | null>()
  {
    const paired = pairDamagedLinesToLots(targets.map(entry => ({ product_id: entry.item.product_id, quantity: entry.item.quantity, stock_action: entry.item.stock_action, return_to_stock: entry.item.return_to_stock })), lots)
    targets.forEach((entry, index) => { if (entry.current === 'damaged') lotOfLine.set(entry.item.id, paired[index]) })
  }
  const addedByLine = new Map<number, LotRow>()
  const removedByLine = new Map<number, LotRow>()
  const landingLabels = new Map<number, { effectName: string | null; label: string | null }>()
  const headerReason = headerAfter.reason

  type Landing = { branch: number; redirected: boolean }
  const landingFor = (recorded: number): Landing => {
    let effect: ReturnType<BranchEffectResolver['effect']> = null
    try { effect = resolver.effect(recorded) } catch (error) {
      if (error instanceof BranchRetiredNoSuccessorError) fail(error.message, 409, error.code, undefined, error.redirect ? { redirect: error.redirect } : undefined)
      throw error
    }
    if (effect?.redirected) {
      const ownLabel = num(ret.branch_id) === effect.addressedBranchId && typeof ret.branch_name === 'string' && ret.branch_name ? String(ret.branch_name) : null
      landingLabels.set(effect.effectBranchId, { effectName: effect.effectName, label: ownLabel ?? effect.addressedName ?? effect.effectName })
      return { branch: effect.effectBranchId, redirected: true }
    }
    return { branch: recorded, redirected: false }
  }
  const delta = (item: ItemRow, landing: Landing, batchId: number | null, quantity: number): StockDelta => ({
    productId: num(item.product_id), productName: nullableText(item.product_name), branchId: landing.branch, batchId, damagedLotId: null, quantity,
    costUsd: item.cost_price_usd == null ? null : num(item.cost_price_usd), costKhr: item.cost_price_khr == null ? null : num(item.cost_price_khr), movementType: '',
  })

  // A retired branch's lots may have been folded into a survivor lot at the landing branch (the cutover merges lots received the same
  // day). Units a restock put in an old lot now sit in the survivor, so BOTH directions address the survivor. One read per landing branch.
  {
    const wanted = new Map<number, Set<number>>()
    for (const entry of targets) {
      if (entry.current === entry.target) continue
      const recorded = num(entry.item.branch_id || ret.branch_id)
      if (!recorded || !num(entry.item.product_id) || num(entry.item.quantity) <= 0) continue
      const landing = landingFor(recorded)
      if (!landing.redirected) continue
      const ids = wanted.get(landing.branch) ?? new Set<number>()
      for (const alloc of entry.item.allocs) ids.add(alloc.batch_id)
      if (entry.item.batch_id != null) ids.add(num(entry.item.batch_id))
      const saleLine = saleLines.get(num(entry.item.sale_item_id))
      if (saleLine) { for (const alloc of saleLine.allocs) ids.add(alloc.batch_id); if (saleLine.batch_id != null) ids.add(saleLine.batch_id) }
      wanted.set(landing.branch, ids)
    }
    for (const [branch, ids] of wanted) foldMaps.set(branch, await read(foldedLotSurvivors(db, branch, [...ids])))
  }
  const surviving = (landing: { branch: number; redirected: boolean }, batchId: number | null): number | null =>
    batchId == null ? null : (landing.redirected ? foldMaps.get(landing.branch)?.get(batchId) : undefined) ?? batchId

  for (const entry of targets) {
    const { item, line, current, target } = entry
    const quantity = num(item.quantity)
    const productId = num(item.product_id)
    const recordedBranch = num(item.branch_id || ret.branch_id)
    const name = nullableText(item.product_name)
    const wantTag = line?.tag
    if (current === target && !(target === 'damaged' && wantTag != null)) continue
    if (quantity <= 0 || !productId || !recordedBranch) {
      if (current === target) continue
      fail('This line has no product or branch, so its stock handling cannot change here.', 409, 'return_edit_provenance')
    }
    const landing = landingFor(recordedBranch)
    const before: LineState = { id: item.id, a: current, r: num(item.return_to_stock) === 1 ? 1 : 0, b: item.batch_id == null ? null : num(item.batch_id), allocs: item.allocs,
      ra: item.stock_action == null ? null : String(item.stock_action), rr: item.return_to_stock == null ? null : num(item.return_to_stock) }
    const after: LineState = { id: item.id, a: current, r: before.r, b: before.b, allocs: before.allocs }

    if (current === 'damaged' && target === 'damaged') {
      // Only the tag moves. The held row stays; its units are not touched.
      const lot = lotOfLine.get(item.id)
      if (!lot) fail(`The damaged-stock record of ${name || 'this line'} cannot be matched to the line, so its tag cannot change here. You can still change the reason and notes.`, 409, 'return_edit_damaged_unmatched', { product: name })
      if ((lot.condition_tag ?? DEFAULT_STOCK_CONDITION_TAG) !== wantTag) {
        if (retag.some(entry2 => entry2.after !== (wantTag ?? DEFAULT_STOCK_CONDITION_TAG))) fail('Choose one tag for the damaged lines you change together.', 400, 'return_edit_damaged_mixed_tags')
        retag.push({ id: lot.id, line: item.id, name, before: lot.condition_tag, after: wantTag ?? DEFAULT_STOCK_CONDITION_TAG })
      }
      continue
    }

    // 1. Take back what the line did.
    if (current === 'restock') {
      const allocated = roundQ(item.allocs.reduce((sum, alloc) => sum + alloc.quantity, 0))
      if (allocated > quantity + 1e-9) fail('This return has incomplete stock records for a line. Count the stock with Set instead.', 409, 'return_edit_provenance', { product: name })
      for (const alloc of item.allocs) {
        if (alloc.branch_id != null && alloc.branch_id !== recordedBranch) fail('This return has a lot record for a different branch. Count the stock with Set instead.', 409, 'return_edit_provenance', { product: name })
        stock.push(delta(item, landing, surviving(landing, alloc.batch_id), -alloc.quantity))
      }
      const remainder = roundQ(quantity - allocated)
      if (remainder > 1e-9) {
        if (!item.allocs.length && item.batch_id != null) stock.push(delta(item, landing, surviving(landing, num(item.batch_id)), -remainder))
        else stock.push(delta(item, landing, null, -remainder))
      }
      after.allocs = []; after.r = 0; after.b = null
    } else if (current === 'damaged') {
      const lot = lotOfLine.get(item.id)
      if (!lot) fail(`The damaged-stock record of ${name || 'this line'} cannot be matched to the line, so its handling cannot change here. You can still change the reason and notes.`, 409, 'return_edit_damaged_unmatched', { product: name })
      if (!sameQ(lot.quantity_remaining, lot.quantity)) {
        fail(`Some damaged ${name || 'units'} from this return were already used or written off. Change the other lines, or record the correction with Set stock.`, 409, 'return_edit_damaged_used', { product: name })
      }
      removedLots.push(lot)
      removedByLine.set(item.id, lot)
      lotMoves.push({ product_id: productId, product_name: name, branch_id: num(lot.branch_id) || landing.branch, batch_id: lot.batch_id, quantity: -quantity, usd: lot.unit_cost_usd, khr: item.cost_price_khr == null ? null : num(item.cost_price_khr) })
    }

    // 2. Put the new handling in place.
    after.a = target
    if (target === 'restock') {
      const saleItemId = num(item.sale_item_id)
      const saleLine = saleLines.get(saleItemId)
      const plan = planReturnLot({ allocations: saleLine?.allocs ?? [], saleLineBatchId: saleLine?.batch_id ?? null, operatorBatchId: null, quantity, lotTracked: false })
      if (!saleItemId || plan.plainQuantity > 1e-9 || plan.requiresLotPick || !plan.splits.length) {
        fail(`No received date is recorded for ${name || 'this product'}, so its units can't be put back from here. Add them with Add stock, or choose "no stock change".`, 409, 'return_edit_lot_unavailable', { product: name })
      }
      const merged = new Map<number, number>()
      for (const split of plan.splits) {
        const survivor = surviving(landing, split.batchId)!
        merged.set(survivor, roundQ((merged.get(survivor) ?? 0) + split.quantity))
      }
      after.allocs = [...merged].map(([batchId, q]) => {
        stock.push(delta(item, landing, batchId, q))
        nextAlloc += 1
        return { id: nextAlloc, return_item_id: item.id, sale_item_id: saleItemId, batch_id: batchId, branch_id: landing.branch, quantity: q, lot_code: null, expiry_date: null, reversed_at: null, created_at: stamp }
      })
      after.r = 1
      after.b = after.allocs.length === 1 && sameQ(after.allocs[0].quantity, quantity) ? after.allocs[0].batch_id : null
    } else if (target === 'damaged') {
      if (line?.remove) fail('Keep it as damaged stock with a tag. Dispose of it from the product page afterwards.', 409, 'return_edit_damaged_remove', { product: name })
      const productLots = lots.filter(row => num(row.product_id) === productId)
      const productLines = targets.filter(other => other.current === 'damaged' && num(other.item.product_id) === productId)
      if (productLots.length !== productLines.length || productLines.some(other => !lotOfLine.get(other.item.id))) {
        fail(`The damaged-stock record of ${name || 'this product'} cannot be matched to its lines, so a line cannot become damaged here. You can still change the reason and notes.`, 409, 'return_edit_damaged_unmatched', { product: name })
      }
      const saleLine = saleLines.get(num(item.sale_item_id))
      nextLot += 1
      const added: LotRow = { id: nextLot, product_id: productId, product_name: name, branch_id: landing.branch, batch_id: saleLine?.batch_id ?? null, return_id: returnId,
        quantity, quantity_remaining: quantity, reason: headerReason, created_by_user_id: Number(user.id) || null, created_by_user_name: actorSnapshot(user),
        created_at: stamp, updated_at: stamp, condition_tag: wantTag ?? DEFAULT_STOCK_CONDITION_TAG, source: 'return', unit_cost_usd: item.cost_price_usd == null ? null : num(item.cost_price_usd) }
      addedLots.push(added)
      addedByLine.set(item.id, added)
      lotMoves.push({ product_id: productId, product_name: name, branch_id: landing.branch, batch_id: added.batch_id, quantity, usd: added.unit_cost_usd, khr: item.cost_price_khr == null ? null : num(item.cost_price_khr) })
      after.r = 0; after.b = null; after.allocs = []
    } else {
      after.r = 0; after.b = null; after.allocs = []
    }
    changes.push({ id: item.id, name, before, after })
  }
  // A line that was damaged and stays damaged but is re-tagged is a change of its lot only; it is listed above with no line change.

  // Keep the pairing invariant for every product that gained a damaged line: re-create, after the first new lot and in line order, the
  // lots of the later lines that stay damaged. (Whole lots only: one that was drawn or written off keeps its history and its id.)
  for (const productId of new Set([...addedByLine.keys()].map(lineId => num(items.find(item => item.id === lineId)?.product_id)))) {
    const finalLines = targets.filter(entry => num(entry.item.product_id) === productId && entry.target === 'damaged')
    const firstNew = finalLines.findIndex(entry => addedByLine.has(entry.item.id))
    const tail = finalLines.slice(firstNew)
    for (const entry of tail) {
      const fresh = addedByLine.get(entry.item.id)
      if (fresh) continue
      const old = lotOfLine.get(entry.item.id)
      if (!old) fail(`The damaged-stock record of ${entry.item.product_name || 'this product'} cannot be matched to its lines, so a line cannot become damaged here. You can still change the reason and notes.`, 409, 'return_edit_damaged_unmatched', { product: nullableText(entry.item.product_name) })
      if (!sameQ(old.quantity_remaining, old.quantity)) fail(`Some damaged ${nullableText(entry.item.product_name) || 'units'} from this return were already used or written off. Change the other lines, or record the correction with Set stock.`, 409, 'return_edit_damaged_used', { product: nullableText(entry.item.product_name) })
      const tagChange = retag.findIndex(tagged => tagged.id === old.id)
      const rebuilt: LotRow = { ...old, condition_tag: tagChange >= 0 ? retag[tagChange].after : old.condition_tag, updated_at: stamp }
      if (tagChange >= 0) retag.splice(tagChange, 1)
      removedLots.push(old)
      addedLots.push(rebuilt)
      addedByLine.set(entry.item.id, rebuilt)
    }
    for (const entry of tail) { nextLot += 1; addedByLine.get(entry.item.id)!.id = nextLot }
    addedLots.sort((a, b) => a.id - b.id)
  }

  // Landing labels (a redirected branch): the movement rows name where the stock really moved and what it was addressed to.
  for (const entry of stock) {
    const label = landingLabels.get(entry.branchId)
    if (label) { entry.branchName = label.effectName; entry.addressed = label.label ?? label.effectName ?? 'retired branch' }
  }

  // ---- friendly stock check (the batch re-checks atomically) ----
  const net = new Map<string, { product: number; branch: number; q: number; name: string | null }>()
  const netLots = new Map<string, { batch: number; branch: number; q: number; name: string | null }>()
  for (const entry of stock) {
    const key = `${entry.productId}:${entry.branchId}`
    const row = net.get(key) ?? { product: entry.productId, branch: entry.branchId, q: 0, name: entry.productName }
    row.q = roundQ(row.q + entry.quantity); net.set(key, row)
    if (entry.batchId) {
      const lotKey = `${entry.batchId}:${entry.branchId}`
      const lotRow2 = netLots.get(lotKey) ?? { batch: entry.batchId, branch: entry.branchId, q: 0, name: entry.productName }
      lotRow2.q = roundQ(lotRow2.q + entry.quantity); netLots.set(lotKey, lotRow2)
    }
  }
  const shrinking = [...net.values()].filter(row => row.q < 0)
  const shrinkingLots = [...netLots.values()].filter(row => row.q < 0)
  if (shrinking.length || shrinkingLots.length) {
    const have = await read(db.prepare(`SELECT 'branch' AS k,bs.product_id AS a,bs.branch_id AS b,bs.quantity AS q FROM branch_stock bs
        WHERE EXISTS(SELECT 1 FROM json_each(@pairs) x WHERE json_extract(x.value,'$.product')=bs.product_id AND json_extract(x.value,'$.branch')=bs.branch_id)
      UNION ALL SELECT 'lot',bbs.batch_id,bbs.branch_id,bbs.quantity FROM branch_batch_stock bbs
        WHERE EXISTS(SELECT 1 FROM json_each(@lots) x WHERE json_extract(x.value,'$.batch')=bbs.batch_id AND json_extract(x.value,'$.branch')=bbs.branch_id)`)
      .all<Row>({ pairs: JSON.stringify(shrinking), lots: JSON.stringify(shrinkingLots) }))
    for (const row of shrinking) {
      const available = num(have.find(entry => entry.k === 'branch' && num(entry.a) === row.product && num(entry.b) === row.branch)?.q)
      if (available + row.q < -1e-9) fail(`Only ${available} of ${row.name || 'this product'} are in stock at ${branchName(row.branch) || 'this branch'}, and ${-row.q} must be taken back. Count it with Set, then edit again.`,
        409, 'return_edit_stock_too_low', { product: row.name, available, needed: -row.q, branch: branchName(row.branch) })
    }
    for (const row of shrinkingLots) {
      const available = num(have.find(entry => entry.k === 'lot' && num(entry.a) === row.batch && num(entry.b) === row.branch)?.q)
      if (available + row.q < -1e-9) fail(`Only ${available} of ${row.name || 'this product'} are left in the received date this return used at ${branchName(row.branch) || 'this branch'}, and ${-row.q} must be taken back. Count it with Set, then edit again.`,
        409, 'return_edit_stock_too_low', { product: row.name, available, needed: -row.q, branch: branchName(row.branch) })
    }
  }

  // ---- assemble ----
  const plain: PlainGuard[] = stock.filter(entry => !entry.batchId).map(entry => ({ product: entry.productId, branch: entry.branchId, q: entry.quantity }))
  const headerChanged = headerBefore.reason !== headerAfter.reason || headerBefore.notes !== headerAfter.notes || headerBefore.return_type !== headerAfter.return_type
  const changed = headerChanged || changes.length > 0 || retag.length > 0
  const snapshot: Snapshot = {
    version: 1, return_id: returnId, return_number: nullableText(ret.return_number), sale_id: ret.sale_id == null ? null : num(ret.sale_id), money_fp: String(ret.money_fp),
    header: { before: headerBefore, after: headerAfter }, changes,
    lots: { removed: removedLots, added: addedLots, retag }, lot_moves: lotMoves, stock, plain, effects: resolver.guards(),
  }
  const writesStock = stock.length > 0 || removedLots.length > 0 || addedLots.length > 0 || retag.length > 0
  const plannedStatements = changed ? plannedStatementCount(snapshot) + (writesStock ? 2 : 1) : 0
  const limit = getPlanLimits(env).d1QueriesPerInvocation
  if (changed) {
    try { assertReturnCreateQueryBudget(limit, (budget ? budget.statementsUsed() : 0) + reads, plannedStatements, budget?.reserveStatements ?? RESERVE_STATEMENTS) } catch (error) {
      if (error instanceof ReturnCreateBudgetError) fail('Edit fewer lines at a time.', 400, 'return_edit_too_large', { planned: plannedStatements, limit })
      throw error
    }
  }

  const detail = (id: number) => items.find(item => item.id === id)
  const preview: EditPreview = {
    digest: '', changed,
    return: { id: returnId, return_number: snapshot.return_number, status: String(ret.status || 'completed') },
    header: ([['reason', headerBefore.reason, headerAfter.reason], ['notes', headerBefore.notes, headerAfter.notes], ['return_type', headerBefore.return_type, headerAfter.return_type]] as const)
      .filter(([, before, after]) => before !== after).map(([field, before, after]) => ({ field, before, after })),
    lines: [
      ...changes.map(change => ({ id: change.id, product_name: change.name, quantity: num(detail(change.id)?.quantity), before: change.before.a, after: change.after.a,
        tag_before: change.before.a === 'damaged' ? removedByLine.get(change.id)?.condition_tag ?? DEFAULT_STOCK_CONDITION_TAG : null,
        tag_after: change.after.a === 'damaged' ? (addedByLine.get(change.id)?.condition_tag ?? null) : null })),
      ...retag.map(entry => ({ id: -(entry.line ?? entry.id), product_name: entry.name, quantity: num(lots.find(lot => lot.id === entry.id)?.quantity), before: 'damaged' as ReturnStockAction, after: 'damaged' as ReturnStockAction,
        tag_before: entry.before, tag_after: entry.after })),
    ],
    stock: [
      ...stock.map(entry => ({ product_id: entry.productId, product_name: entry.productName, branch_id: entry.branchId, branch_name: branchName(entry.branchId), batch_id: entry.batchId,
        quantity: entry.quantity, kind: 'sellable' as const })),
      ...lotMoves.map(move => ({ product_id: move.product_id, product_name: move.product_name, branch_id: move.branch_id, branch_name: branchName(move.branch_id), batch_id: move.batch_id,
        quantity: move.quantity, kind: 'damaged' as const })),
    ],
    money: { unchanged: true, total_refund_usd: num(ret.total_refund_usd), total_refund_khr: num(ret.total_refund_khr), refund_currency: nullableText(ret.refund_currency), owed_reduction_usd: num(ret.owed_reduction_usd) },
    statements: { planned: plannedStatements, limit },
  }
  const requestDigest = await sha256Hex(JSON.stringify({ r: returnId, u: intent.expectedUpdatedAt, h: [intent.reason ?? null, intent.notes === undefined ? '~' : intent.notes, intent.returnType ?? null],
    l: (intent.lines ?? []).map(line => [line.key, line.quantity, line.action ?? null, line.tag ?? null, line.remove]).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1) }))
  // The planning time stamps the new rows; it differs between a preview and its apply, so it stays out of the digest.
  preview.digest = await sha256Hex(JSON.stringify({ revision: num(ret.revision), updated_at: ret.updated_at, snapshot }).split(stamp).join('@stamp'))
  return { preview, snapshot, requestDigest, plannedStatements, reads, revision: num(ret.revision) }
}

// ---- statements ------------------------------------------------------------------------------------------------------------
type Side = 'before' | 'after'
const fieldsOf = (s: Snapshot, side: Side): Row => ({ ...s.header[side] })

/** The row-state predicate of one side of an edit (before = as the shop has it now, after = as the edit leaves it). */
function statePredicate(s: Snapshot, side: Side): { sql: string; params: Row } {
  const present = side === 'before' ? s.lots.removed : s.lots.added
  const absent = side === 'before' ? s.lots.added : s.lots.removed
  const lines = s.changes.map(change => ({ id: change.id, ...storedLine(change[side]) }))
  const allocs = s.changes.flatMap(change => change[side].allocs)
  const itemIds = s.changes.map(change => change.id)
  const tags = s.lots.retag.map(entry => ({ id: entry.id, tag: side === 'before' ? entry.before : entry.after }))
  const header = s.header[side]
  const sql = `(${moneyFp('@rid')}) IS @fp
    AND EXISTS(SELECT 1 FROM returns r WHERE r.id=@rid AND COALESCE(r.status,'completed')='completed' AND r.reason IS @hReason AND r.notes IS @hNotes AND r.return_type IS @hType)
    AND NOT EXISTS(SELECT 1 FROM json_each(@lines) j WHERE NOT EXISTS(SELECT 1 FROM return_items ri WHERE ri.id=json_extract(j.value,'$.id') AND ri.return_id=@rid
      AND ri.stock_action IS json_extract(j.value,'$.a') AND ri.return_to_stock IS json_extract(j.value,'$.r') AND ri.batch_id IS json_extract(j.value,'$.b')))
    AND (SELECT COUNT(*) FROM return_item_batch_allocations WHERE return_item_id IN (SELECT value FROM json_each(@itemIds)))=@allocCount
    AND NOT EXISTS(SELECT 1 FROM json_each(@allocs) j WHERE NOT EXISTS(SELECT 1 FROM return_item_batch_allocations a WHERE a.id=json_extract(j.value,'$.id')
      AND a.return_item_id=json_extract(j.value,'$.return_item_id') AND a.batch_id=json_extract(j.value,'$.batch_id') AND a.quantity=json_extract(j.value,'$.quantity')))
    AND NOT EXISTS(SELECT 1 FROM json_each(@present) j WHERE NOT EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.id=json_extract(j.value,'$.id') AND d.return_id=@rid
      AND d.quantity=json_extract(j.value,'$.quantity') AND d.quantity_remaining=json_extract(j.value,'$.quantity_remaining') AND d.condition_tag IS json_extract(j.value,'$.condition_tag')))
    AND NOT EXISTS(SELECT 1 FROM json_each(@absent) j WHERE EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.id=json_extract(j.value,'$.id')))
    AND NOT EXISTS(SELECT 1 FROM json_each(@tags) j WHERE NOT EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.id=json_extract(j.value,'$.id') AND d.return_id=@rid AND d.condition_tag IS json_extract(j.value,'$.tag')))`
  return { sql, params: { rid: s.return_id, fp: s.money_fp, hReason: header.reason, hNotes: header.notes, hType: header.return_type, lines: JSON.stringify(lines),
    itemIds: JSON.stringify(itemIds), allocCount: allocs.length, allocs: JSON.stringify(allocs), present: JSON.stringify(present), absent: JSON.stringify(absent), tags: JSON.stringify(tags) } }
}

/** Count of statements editStatements builds for this snapshot (budget admission); the guard test pins it to the real list. */
function plannedStatementCount(s: Snapshot): number {
  return editStatements(s, 1, { id: 0 } as SessionUser, '', { apply: true, operationId: 'x', requestDigest: 'x', expectedRevision: 0, action: 'update' }).length
}

type StatementContext = { apply: boolean; operationId: string; requestDigest: string; expectedRevision: number; snapshotId?: number; action: string; stored?: Stored }

function editStatements(s: Snapshot, dir: 1 | -1, user: SessionUser, stamp: string, ctx: StatementContext): Statement[] {
  const from: Side = dir > 0 ? 'before' : 'after'
  const to: Side = dir > 0 ? 'after' : 'before'
  const out: Statement[] = []
  const start = statePredicate(s, from)
  // Stock that cannot be taken out of "unlotted" units: the plain reversals must fit what branch stock holds beyond the lots.
  const plain = s.plain.map(entry => ({ ...entry, q: roundQ(entry.q * dir) })).filter(entry => entry.q < 0)
  const startParts = [
    "NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')",
    start.sql,
    `NOT EXISTS(SELECT 1 FROM json_each(@plain) x WHERE COALESCE((SELECT quantity FROM branch_stock WHERE product_id=json_extract(x.value,'$.product') AND branch_id=json_extract(x.value,'$.branch')),0)
      - COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=json_extract(x.value,'$.product') AND bbs.branch_id=json_extract(x.value,'$.branch')),0) < -json_extract(x.value,'$.q'))`,
  ]
  const startParams: Row = { ...start.params, plain: JSON.stringify(plain) }
  if (ctx.apply) {
    startParts.push('COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@rid),0)=@revision',
      `NOT EXISTS(SELECT 1 FROM undo_snapshots WHERE kind=@kind AND json_extract(payload_json,'$.operation_id')=@operation)`)
    startParams.revision = ctx.expectedRevision; startParams.kind = RETURN_EDIT_KIND; startParams.operation = ctx.operationId
    if (s.effects.length) { startParts.push(branchEffectGuardPredicate('@effects')); startParams.effects = JSON.stringify(s.effects) }
  }
  out.push(guard(startParts.map(part => `(${part})`).join(' AND '), startParams))

  const stored: Stored = ctx.stored ?? { ...s, operation_id: ctx.operationId, request_digest: ctx.requestDigest, generation: 0 }
  const lookup = 'SELECT id FROM undo_snapshots WHERE kind=@kind AND json_extract(payload_json,\'$.operation_id\')=@operation'
  const actor = { user: user.id ?? null, name: actorSnapshot(user) }
  if (ctx.apply) {
    out.push({ sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name) VALUES(@kind,'applied',@payload,@user,@name)`,
      params: { kind: RETURN_EDIT_KIND, payload: JSON.stringify(stored), ...actor } })
  }

  // Stock: both ledgers and the products total, then the held rows.
  const touchesStock = s.stock.length > 0
  if (touchesStock) out.push(...stockStatements([{ id: s.return_id, scope: 'customer', stock: s.stock }], dir, user, stamp, `Return ${s.return_number || '#' + s.return_id} stock handling ${dir > 0 ? 'edited' : 'edit undone'}`))
  const lotsRemove = dir > 0 ? s.lots.removed : s.lots.added
  const lotsAdd = dir > 0 ? s.lots.added : s.lots.removed
  if (lotsAdd.length) out.push(productStockGuardStatement([...new Set(lotsAdd.map(lot => lot.product_id))], 'active'))
  if (lotsRemove.length) out.push({ sql: 'DELETE FROM damaged_stock_lots WHERE return_id=@rid AND id IN (SELECT json_extract(value,\'$.id\') FROM json_each(@ids))', params: { rid: s.return_id, ids: JSON.stringify(lotsRemove) } })
  if (lotsAdd.length) {
    const col = (name: string) => `json_extract(x.value,'$.${name}')`
    out.push({ sql: `INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,reason,created_by_user_id,created_by_user_name,created_at,updated_at,condition_tag,source,unit_cost_usd)
        SELECT ${['id', 'product_id', 'product_name', 'branch_id', 'batch_id', 'return_id', 'quantity', 'quantity_remaining', 'reason', 'created_by_user_id', 'created_by_user_name', 'created_at', 'updated_at', 'condition_tag', 'source', 'unit_cost_usd'].map(col).join(',')}
        FROM json_each(@rows) x ORDER BY CAST(x.key AS INTEGER)`, params: { rows: JSON.stringify(lotsAdd) } })
  }
  if (s.lots.retag.length) {
    const tags = s.lots.retag.map(entry => ({ id: entry.id, tag: dir > 0 ? entry.after : entry.before }))
    out.push({ sql: `UPDATE damaged_stock_lots SET condition_tag=(SELECT json_extract(j.value,'$.tag') FROM json_each(@tags) j WHERE json_extract(j.value,'$.id')=damaged_stock_lots.id),updated_at=@stamp
        WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@tags))`, params: { tags: JSON.stringify(tags), stamp } })
  }
  if (s.lot_moves.length) {
    const moves = s.lot_moves.map(move => ({ ...move, quantity: roundQ(move.quantity * dir) }))
    const col = (name: string) => `json_extract(m.value,'$.${name}')`
    out.push({ sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
        SELECT ${col('product_id')},${col('product_name')},${col('branch_id')},CASE WHEN ${col('quantity')}>0 THEN 'damage_in' ELSE 'damage_reversal' END,${col('quantity')},${col('usd')},${col('khr')},
          ROUND(${col('usd')}*ABS(${col('quantity')}),4),ROUND(${col('khr')}*ABS(${col('quantity')}),4),@reason,@rid,@user,@name,${col('batch_id')}
        FROM json_each(@moves) m ORDER BY CAST(m.key AS INTEGER)`,
      params: { moves: JSON.stringify(moves), reason: `Return ${s.return_number || '#' + s.return_id} stock handling ${dir > 0 ? 'edited' : 'edit undone'}`, rid: s.return_id, ...actor } })
  }

  // The lines and the lots they put back.
  if (s.changes.length) {
    const lines = s.changes.map(change => ({ id: change.id, ...storedLine(change[to]) }))
    const pick = (path: string) => `(SELECT json_extract(j.value,'$.${path}') FROM json_each(@lines) j WHERE json_extract(j.value,'$.id')=return_items.id)`
    out.push({ sql: `UPDATE return_items SET stock_action=${pick('a')},return_to_stock=${pick('r')},batch_id=${pick('b')} WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@lines))`,
      params: { lines: JSON.stringify(lines) } })
    out.push({ sql: 'DELETE FROM return_item_batch_allocations WHERE return_item_id IN (SELECT value FROM json_each(@ids))', params: { ids: JSON.stringify(s.changes.map(change => change.id)) } })
    const allocs = s.changes.flatMap(change => change[to].allocs)
    if (allocs.length) {
      const col = (name: string) => `json_extract(x.value,'$.${name}')`
      out.push({ sql: `INSERT INTO return_item_batch_allocations(id,return_item_id,sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date,reversed_at,created_at)
          SELECT ${['id', 'return_item_id', 'sale_item_id', 'batch_id', 'branch_id', 'quantity', 'lot_code', 'expiry_date', 'reversed_at', 'created_at'].map(col).join(',')}
          FROM json_each(@rows) x ORDER BY CAST(x.key AS INTEGER)`, params: { rows: JSON.stringify(allocs) } })
    }
  }
  out.push({ sql: 'UPDATE returns SET reason=@reason,notes=@notes,return_type=@type,updated_at=@stamp WHERE id=@rid',
    params: { reason: s.header[to].reason, notes: s.header[to].notes, type: s.header[to].return_type, stamp, rid: s.return_id } })

  // History: one entry, linked back into the snapshot with the fingerprint every later undo/redo must still find.
  const fingerprint = `(SELECT group_concat(k, ',') FROM (SELECT r.id || ':' || COALESCE(v.revision,0) AS k FROM returns r LEFT JOIN return_write_revisions v ON v.return_id=r.id
      WHERE r.id=@rid OR (r.sale_id IS NOT NULL AND r.sale_id=(SELECT sale_id FROM returns WHERE id=@rid)) ORDER BY r.id))`
  if (ctx.apply) {
    const label = `Edit return ${s.return_number || s.return_id}`
    out.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
        SELECT 'returns','return',@entityId,@label,'Undo return edit','Redo return edit',1,'undoable',
          json_object('applier',@kind,'operation_id',@operation,'snapshot_id',id,'generation',0,'return_number',@number),json_object('applier',@kind,'operation_id',@operation,'snapshot_id',id,'generation',0,'return_number',@number),@user,@name
        FROM undo_snapshots WHERE id=(${lookup})`, params: { kind: RETURN_EDIT_KIND, operation: ctx.operationId, label, entityId: String(s.return_id), number: s.return_number, ...actor } })
    out.push({ sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.history_id',
        (SELECT id FROM action_history WHERE json_extract(undo_payload,'$.applier')=@kind AND json_extract(undo_payload,'$.operation_id')=@operation),'$.fingerprint',${fingerprint})
        WHERE id=(${lookup})`, params: { kind: RETURN_EDIT_KIND, operation: ctx.operationId, rid: s.return_id } })
  } else {
    const next = ctx.stored!
    out.push({ sql: `UPDATE undo_snapshots SET status=@status,payload_json=json_set(@payload,'$.fingerprint',${fingerprint}),updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
      params: { status: dir < 0 ? 'reversed' : 'applied', payload: JSON.stringify(next), id: ctx.snapshotId, rid: s.return_id } })
    out.push({ sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
        undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id`,
      params: { status: dir < 0 ? 'redoable' : 'undoable', id: next.history_id, generation: next.generation } })
  }
  // Audit, in the same batch: what changed, before -> after, who and when (the return's Records read this row).
  const oldFields: Row = {}, newFields: Row = {}
  const fromFields = fieldsOf(s, from), toFields = fieldsOf(s, to)
  for (const key of Object.keys(toFields)) if (fromFields[key] !== toFields[key]) { oldFields[key] = fromFields[key]; newFields[key] = toFields[key] }
  const labelFor = new Map<number, string>()
  const nameOf = (id: number, name: string | null): string => {
    if (!labelFor.has(id)) {
      const base = name || `#${id}`
      labelFor.set(id, [...labelFor.values()].includes(base) ? `${base} #${id}` : base)
    }
    return labelFor.get(id)!
  }
  for (const change of s.changes) {
    const key = `stock_handling.${nameOf(change.id, change.name)}`
    oldFields[key] = change[from].a; newFields[key] = change[to].a
  }
  for (const entry of s.lots.retag) {
    const key = `damaged_tag.${nameOf(entry.line ?? -entry.id, entry.name)}`
    oldFields[key] = (dir > 0 ? entry.before : entry.after) ?? DEFAULT_STOCK_CONDITION_TAG; newFields[key] = (dir > 0 ? entry.after : entry.before) ?? DEFAULT_STOCK_CONDITION_TAG
  }
  out.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
      VALUES(@user,@name,@action,'return',@rid,@details,'returns',@rid,@old,@new)`,
    params: { ...actor, action: ctx.action, rid: String(s.return_id), old: JSON.stringify(oldFields), new: JSON.stringify(newFields),
      details: JSON.stringify({ via: RETURN_EDIT_KIND, operation_id: stored.operation_id, direction: dir > 0 ? (ctx.apply ? 'apply' : 'redo') : 'undo' }) } })
  const end = statePredicate(s, to)
  out.push(guard([`(${end.sql})`, "NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')"].join(' AND '), end.params))
  out.push({ sql: ordinaryBusinessMaintenanceGuard.sql, params: {} })
  return out
}

async function execute(db: D1Compat, s: Snapshot, statements: Statement[]): Promise<void> {
  const stockWrites = s.stock.length > 0 || s.lots.removed.length > 0 || s.lots.added.length > 0 || s.lots.retag.length > 0
  if (stockWrites) await executeStockTransaction(db, statements, 'retry')
  else await db.batch(statements)
}

// ---- apply -----------------------------------------------------------------------------------------------------------------
type SnapshotRow = { id: number; status: string; payload_json: string; created_by_id: number }
async function findOperation(db: D1Compat, operationId: string): Promise<SnapshotRow | undefined> {
  const rows = await db.prepare(`SELECT id,status,payload_json,created_by_id FROM undo_snapshots
    WHERE kind=@kind AND json_extract(payload_json,'$.operation_id')=@operation LIMIT 2`).all<SnapshotRow>({ kind: RETURN_EDIT_KIND, operation: operationId })
  if (rows.length > 1) fail('This edit was recorded twice. Ask an administrator to review it.', 409, 'return_edit_duplicate')
  return rows[0]
}
function readStored(row: SnapshotRow): Stored {
  try {
    const stored = JSON.parse(row.payload_json) as Stored
    if (stored.version !== 1 || !Array.isArray(stored.changes) || !Number.isSafeInteger(stored.generation)) throw new Error('shape')
    return stored
  } catch { return fail('The edit record cannot be read.', 409, 'return_edit_unreadable') }
}
function receipt(stored: Stored, row: SnapshotRow, replayed: boolean, updatedAt: string | null) {
  return { success: true, replayed, changed: true, id: stored.return_id, updated_at: updatedAt, operation_id: stored.operation_id, history_id: stored.history_id ?? null,
    status: row.status === 'reversed' ? 'reversed' as const : 'applied' as const }
}

export async function previewReturnEdit(env: Env, user: SessionUser | null | undefined, returnId: unknown, body: Row, redirectTarget: number | null = null, budget?: ReturnEditBudget): Promise<EditPreview> {
  return (await planReturnEdit(env, user, returnId, body, redirectTarget, budget)).preview
}

export async function applyReturnEdit(env: Env, userInput: SessionUser | null | undefined, returnIdInput: unknown, body: Row, redirectTarget: number | null = null,
  budget?: ReturnEditBudget) {
  const user = authorize(userInput)
  const db = getDb(env)
  const requestId = String(body?.client_request_id ?? '').trim().slice(0, 120)
  if (!requestId) fail('Review the change again before saving it.', 400, 'client_request_id_required')
  const operationId = `${user.id}:${requestId}`
  const returnId = Number(returnIdInput)
  const currentUpdatedAt = async () => nullableText((await db.prepare('SELECT updated_at FROM returns WHERE id=@id').get<Row>({ id: returnId }))?.updated_at)
  const existing = await findOperation(db, operationId)
  if (existing) {
    // Same id: the same edit replays what was saved; a different edit under the same id is a conflict, never a second write.
    if (Number(existing.created_by_id) !== Number(user.id)) fail('Edit not found.', 404, 'return_edit_not_found')
    const stored = readStored(existing)
    const intent = parseIntent(body)
    const probe = await sha256Hex(JSON.stringify({ r: returnId, u: intent.expectedUpdatedAt, h: [intent.reason ?? null, intent.notes === undefined ? '~' : intent.notes, intent.returnType ?? null],
      l: (intent.lines ?? []).map(line => [line.key, line.quantity, line.action ?? null, line.tag ?? null, line.remove]).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1) }))
    if (stored.return_id !== returnId || stored.request_digest !== probe) fail('That request id was already used for a different edit.', 409, 'idempotency_conflict')
    return receipt(stored, existing, true, await currentUpdatedAt())
  }
  const plan = await planReturnEdit(env, user, returnId, body, redirectTarget, budget)
  if (typeof body.expected_digest !== 'string' || body.expected_digest !== plan.preview.digest) fail('This return changed. Nothing was saved. Review it again.', 409, 'return_edit_preview_stale')
  if (!plan.preview.changed) return { success: true, replayed: false, changed: false, id: returnId, updated_at: await currentUpdatedAt(), operation_id: null, history_id: null, status: 'applied' as const }
  const stamp = new Date().toISOString()
  const revision = plan.revision
  const stored: Stored = { ...plan.snapshot, operation_id: operationId, request_digest: plan.requestDigest, generation: 0 }
  const statements = editStatements(plan.snapshot, 1, user, stamp, { apply: true, operationId, requestDigest: plan.requestDigest, expectedRevision: revision, action: 'update', stored })
  try { await execute(db, plan.snapshot, statements) } catch (error) {
    const committed = await findOperation(db, operationId)
    if (committed) {
      // Someone saved under this request id first. Only the very same edit is a replay; a different one lost the race and is refused.
      const winner = readStored(committed)
      if (winner.return_id !== returnId || winner.request_digest !== plan.requestDigest) fail('That request id was already used for a different edit.', 409, 'idempotency_conflict')
      return receipt(winner, committed, true, await currentUpdatedAt())
    }
    if (/ordinary_business_maintenance/i.test(String(error))) fail('Saving is paused for maintenance. Nothing was saved.', 503, 'maintenance_active')
    if (/guard_value|CHECK constraint failed|UNIQUE constraint failed|money_precision_invalid_returns/i.test(String(error))) fail('This return or its stock changed while saving. Nothing was saved. Review it again.', 409, 'return_edit_changed')
    throw error
  }
  const committed = await findOperation(db, operationId)
  if (!committed) fail('The result is not confirmed. Check the return before trying again.', 503, 'return_edit_uncertain')
  return receipt(readStored(committed), committed, false, stamp)
}

export async function notifyReturnEdit(env: Env): Promise<void> { await notifyReturnBulkAction(env) }

// ---- undo / redo -----------------------------------------------------------------------------------------------------------
/** Undo/redo applier (lib/undoAppliers.ts registry). Replays the recorded before/after exactly, by generation, idempotently. */
export async function replayReturnEdit(payload: Record<string, unknown>, ctx: UndoApplierContext): Promise<UndoApplierOutcome> {
  const user = authorize(ctx.user)
  const db = getDb(ctx.env)
  const snapshot = await findOperation(db, String(payload.operation_id || ''))
  if (!snapshot || snapshot.id !== Number(payload.snapshot_id)) fail('Edit record not found.', 404, 'return_edit_not_found')
  const stored = readStored(snapshot)
  if (stored.history_id !== ctx.historyId) fail('This history entry does not own the edit.', 409, 'undo_history_unusable')
  const expectedGeneration = Number(ctx.generation)
  if (typeof ctx.generation !== 'number' || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) fail('An expected generation is required.', 400, 'return_edit_invalid')
  const complete = (generation: number): UndoApplierOutcome => ({ complete: true, continuation_required: false, processed_children: stored.changes.length, pending_children: 0, generation })
  if (stored.generation === expectedGeneration + 1 && stored.last_direction === ctx.direction && stored.last_expected_generation === expectedGeneration) return complete(stored.generation)
  const fromStatus = ctx.direction === 'undo' ? 'applied' : 'reversed'
  if (stored.generation !== expectedGeneration || snapshot.status !== fromStatus) fail('This edit changed. Refresh the history.', 409, 'undo_history_stale')
  const movesStock = stored.stock.length > 0 || stored.lots.removed.length > 0 || stored.lots.added.length > 0 || stored.lots.retag.length > 0
  if (movesStock) {
    const sale = await db.prepare('SELECT s.sale_status FROM returns r LEFT JOIN sales s ON s.id=r.sale_id WHERE r.id=@id').get<Row>({ id: stored.return_id })
    if (String(sale?.sale_status || '').toLowerCase() === 'cancelled') {
      fail('The sale was cancelled. Un-cancel the sale in Sales to change this return\'s stock handling, or change only the reason and notes.', 409, 'return_edit_sale_cancelled')
    }
  }
  const next: Stored = { ...stored, generation: expectedGeneration + 1, last_direction: ctx.direction, last_expected_generation: expectedGeneration }
  const dir: 1 | -1 = ctx.direction === 'undo' ? -1 : 1
  const statements = editStatements(stored, dir, user, new Date().toISOString(), { apply: false, operationId: stored.operation_id, requestDigest: stored.request_digest,
    expectedRevision: 0, snapshotId: snapshot.id, action: dir < 0 ? 'action_undo' : 'action_redo', stored: next })
  // Any write to any return on this sale since the last step (a new return, a cancel, another edit) refuses the replay.
  statements.splice(1, 0, guard(`(SELECT group_concat(k, ',') FROM (SELECT r.id || ':' || COALESCE(v.revision,0) AS k FROM returns r LEFT JOIN return_write_revisions v ON v.return_id=r.id
      WHERE r.id=@rid OR (r.sale_id IS NOT NULL AND r.sale_id=(SELECT sale_id FROM returns WHERE id=@rid)) ORDER BY r.id)) IS @fingerprint
    AND EXISTS(SELECT 1 FROM undo_snapshots s JOIN action_history h ON h.id=@history WHERE s.id=@snapshot AND s.kind=@kind AND s.payload_json=@old AND s.status=@status
      AND h.status=@historyStatus AND h.reversible=1 AND json_extract(h.undo_payload,'$.snapshot_id')=s.id)`,
  { rid: stored.return_id, fingerprint: stored.fingerprint ?? null, history: stored.history_id, snapshot: snapshot.id, kind: RETURN_EDIT_KIND, old: snapshot.payload_json,
    status: snapshot.status, historyStatus: ctx.direction === 'undo' ? 'undoable' : 'redoable' }))
  try { await execute(db, stored, statements) } catch (error) {
    const current = await findOperation(db, stored.operation_id)
    if (current) {
      const observed = readStored(current)
      if (observed.generation === next.generation && observed.last_direction === ctx.direction && observed.last_expected_generation === expectedGeneration) return complete(observed.generation)
    }
    if (/ordinary_business_maintenance/i.test(String(error))) fail('Saving is paused for maintenance. Nothing was changed.', 503, 'maintenance_active')
    if (/guard_value|CHECK constraint failed|UNIQUE constraint failed|money_precision_invalid_returns/i.test(String(error))) {
      fail('A return on this sale, or its stock, changed after this edit, so it cannot be replayed. Nothing was changed.', 409, 'undo_record_changed')
    }
    throw error
  }
  return complete(next.generation)
}
