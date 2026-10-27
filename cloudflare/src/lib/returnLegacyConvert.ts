// 6.0.992 -- "Update money details" (internally: convert to the current money format): the way out of a locked old-format
// return for anyone with full Returns access (owner ruling 27 Oct 2026: admins AND managers).
//
// A return stored in the older money format (returns.money_precision_version = 0: no exact refund columns, no per-line
// refund snapshot) that sits on a sale stored in the current format (sales.money_precision_version = 1) is locked three
// ways: PUT /api/returns/:id refuses to re-price it (money_precision_review_needed), every NEW return on that sale fails
// its v1 quote (customer_return_legacy_refund_review_needed: the old row has no snapshot), and a cancel/restore on that
// sale fails the exact-entitlement cohort check. Owner, 26 Oct 2026: no refusal may be a dead end; 27 Oct: anyone with full
// Returns access may do it, and the screen calls it updating the return's money details (never "format").
//
// Converting writes the v1 shape the current app would have written for the SAME return -- and only when that shape keeps
// every amount the shop already recorded. The v1 quote (lib/customerReturnEntitlement.ts) is run for the return's own
// lines against the sale's captured receipt allocation; the conversion is refused, with the reason, unless:
//   - the quote's payout equals the stored total_refund_usd to the cent (the Not Paid debt and cash stay put);
//   - every line's quoted refund is within half a cent of the stored line (four-place detail only);
//   - the riel figure is unchanged, or moves by less than one 100-riel step on a refund that paid no riel cash (a restored
//     v1 return must carry total_refund_khr = total x sale rate, so it cannot simply be left; the preview shows the move);
//   - the sales report reducer gives the same totals for the sale before and after at four places (revenue, profit,
//     refund basis...): an old-format refund is valued on a different basis, so equal payouts are not enough;
//   - a cancelled return's sale lines have no amendment recorded after the return (the "no restore after reprice" rule).
// Migration 0160 deliberately did not backfill snapshots because an old unit-price refund cannot be reclassified without
// the receipt allocation evidence. A v1 sale HAS that evidence (its pricing snapshots); the equality checks above are
// what make the reclassification provably value-preserving instead of a re-pricing.
//
// Never written: total_refund_usd, owed_reduction_usd, refund_currency, exchange_rate, status, quantities, stock, the
// sale. So shift cash (shiftReconciliation reads total/owed/currency/khr), receivables (owed_reduction_usd) and stock
// cannot move. Written: the header's version/calculated/rounding (and total_refund_khr only inside the riel rule above),
// each line's total_usd (within half a cent), refund_snapshot_json, and sale_item_id when it was empty and exactly one
// line of the sale sells that product.
//
// Per return: each convertible return converts on its own, quoted against the sale's exact returns and the ones converted
// before it; one that cannot convert no longer blocks its siblings (see planLegacyReturnConversion).
// Undo/redo: one action_history row whose server applier replays the recorded before/after exactly, refused when any
// return on the sale changed since (its write revision moved), so an undo never restores a shape a later write relied on.
import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import { multiplyMoney4, roundMoney2, subtractMoney4 } from './moneyPrecision'
import { customerReturnQuotePlanFromRows, readCustomerReturnQuoteRows } from './customerReturnQuotePlan'
import { readSalesReportSnapshot, salesTotalsFromSnapshot } from './salesAnalytics'
import { sha256Hex } from './saleRecordEvents'
import { ordinaryBusinessMaintenanceGuard } from './businessMaintenanceGuard'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'
import type { UndoApplierContext, UndoApplierOutcome } from './undoAppliers'

export const RETURN_LEGACY_CONVERT_KIND = 'return.legacy_convert'
export const RETURN_LEGACY_CONVERT_LIMIT = 50
/** Four-place line detail may move by less than half a cent; the cent payout may not move at all. */
export const RETURN_LEGACY_CONVERT_LINE_TOLERANCE_USD = 0.005
/** One riel rounding step (riel cash is handed out in 100-riel notes). */
export const RETURN_LEGACY_CONVERT_RIEL_STEP_KHR = 100

export class ReturnLegacyConvertError extends Error {
  constructor(message: string, readonly statusCode: 400 | 403 | 404 | 409 | 503 = 409, readonly code = 'return_convert_refused',
    readonly params?: Record<string, unknown>) { super(message) }
}
function fail(message: string, status: 400 | 403 | 404 | 409 | 503 = 409, code?: string, params?: Record<string, unknown>): never {
  throw new ReturnLegacyConvertError(message, status, code, params)
}

/** Full access to Returns with Edit not switched off -- the same tier check as the other full-tier return actions
 * (saved reasons, routes/returns.ts). Owner ruling 27 Oct 2026: admins AND managers may update a locked return; Review
 * and View tiers, or Edit switched off, are refused. Admins always resolve to full. Mirrored by
 * frontend/src/components/returns/helpers/returnLegacyConvert.ts canConvertLegacyReturns. */
export function canConvertLegacyReturns(user: SessionUser | null | undefined): boolean {
  return !!user && Number.isSafeInteger(Number(user.id)) && getActionTier(user, 'returns', 'edit') === 'full'
}
function authorize(user: SessionUser | null | undefined): SessionUser {
  if (!canConvertLegacyReturns(user)) fail("Full access to Returns (with Edit) is required to update a return's money details.", 403, 'return_convert_forbidden')
  return user!
}

// Stored values exactly as read (NULL stays NULL), so the guards compare like for like and undo restores the same bytes.
type HeaderState = { v: 0 | 1; c: number | null; a: number; k: number | null; t: number | null }
type LineState = { id: number; s: number | null; u: number | null; j: string | null }
type MemberState = { header: HeaderState; lines: LineState[] }
export type ConvertMember = { id: number; return_number: string | null; sale_id: number; before: MemberState; after: MemberState }

export type ConvertPreviewLine = { id: number; product_name: string | null; quantity: number; before_total_usd: number; after_total_usd: number | null }
export type ConvertPreviewRow = {
  id: number; return_number: string | null; sale_id: number | null; receipt_number: string | null; status: string
  outcome: 'convert' | 'already_converted' | 'refused'; code: string | null; params: Record<string, unknown> | null
  total_refund_usd: number; refund_currency: string | null; owed_reduction_usd: number
  before: { total_refund_khr: number; calculated_refund_usd: number | null; rounding_adjustment_usd: number }
  after: { total_refund_khr: number; calculated_refund_usd: number | null; rounding_adjustment_usd: number } | null
  lines: ConvertPreviewLine[]
}
export type ConvertPlan = { digest: string; rows: ConvertPreviewRow[]; members: ConvertMember[]; sales: Array<{ id: number; revision: number }> }

type Row = Record<string, unknown>
type Statement = { sql: string; params: Record<string, unknown> }
const num = (value: unknown): number => Number(value) || 0
const nullableNum = (value: unknown): number | null => value == null ? null : Number(value)
const guard = (predicate: string, params: Record<string, unknown>): Statement =>
  ({ sql: `SELECT CASE WHEN ${predicate} THEN 1 ELSE json_extract('[1]', '$[return_convert_guard]') END AS return_convert_guard`, params })
const GUARD_FAILURE = /malformed JSON|bad JSON path|JSON path error|return_convert_guard/i

export function parseConvertIds(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > RETURN_LEGACY_CONVERT_LIMIT) {
    fail(`Select between 1 and ${RETURN_LEGACY_CONVERT_LIMIT} returns to convert.`, 400, 'return_convert_invalid')
  }
  const ids = raw.map(Number)
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    fail('The return list is not valid.', 400, 'return_convert_invalid')
  }
  return [...ids].sort((a, b) => a - b)
}

function headerPreview(state: HeaderState) {
  return { total_refund_khr: state.k ?? 0, calculated_refund_usd: state.c, rounding_adjustment_usd: state.a }
}

type LegacyReturn = Row & { id: number; items: Row[] }
type Comparison = { ok: true; after: MemberState; priorRows: Row[] } | { ok: false; code: string; params: Record<string, unknown> }

/** The v1 shape of one old-format return, or why it would change money. Pure apart from the quote's lineage read. */
async function compareWithQuote(db: D1Compat, saleId: number, legacy: LegacyReturn, quoteRows: Awaited<ReturnType<typeof readCustomerReturnQuoteRows>>,
  priors: Row[]): Promise<Comparison> {
  const saleLines = quoteRows.saleLines
  const requested: Array<{ sale_item_id: number; quantity: number }> = []
  const resolvedSaleItem = new Map<number, number>()
  for (const item of legacy.items) {
    let saleItemId = item.sale_item_id == null ? null : Number(item.sale_item_id)
    if (saleItemId == null) {
      // An old line may carry only the product. It can be linked only when exactly one line of the sale sells it.
      const matches = saleLines.filter(line => item.product_id != null && Number(line.product_id) === Number(item.product_id))
      if (matches.length !== 1) return { ok: false, code: 'return_convert_line_unlinked', params: { product_name: item.product_name ?? null } }
      saleItemId = Number(matches[0].id)
    }
    if (requested.some(line => line.sale_item_id === saleItemId)) return { ok: false, code: 'return_convert_line_split', params: { product_name: item.product_name ?? null } }
    resolvedSaleItem.set(Number(item.id), saleItemId)
    requested.push({ sale_item_id: saleItemId, quantity: num(item.quantity) })
  }
  if (!requested.length) return { ok: false, code: 'return_convert_no_lines', params: {} }
  let quote
  try {
    quote = (await customerReturnQuotePlanFromRows(db, saleId, requested, { ...quoteRows, previousRows: priors })).quote
  } catch (error) {
    const detail = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'unknown'
    return { ok: false, code: 'return_convert_quote_refused', params: { detail } }
  }
  const total = num(legacy.total_refund_usd)
  if (roundMoney2(total) !== total || quote.total_refund_usd !== total) {
    return { ok: false, code: 'return_convert_amount_changed', params: { before: total, after: quote.total_refund_usd } }
  }
  const quotedBySaleItem = new Map(quote.items.map(line => [line.sale_item_id, line]))
  const lines: LineState[] = []
  for (const item of legacy.items) {
    const quoted = quotedBySaleItem.get(resolvedSaleItem.get(Number(item.id))!)
    if (!quoted) return { ok: false, code: 'return_convert_quote_refused', params: { detail: 'line_missing' } }
    if (Math.abs(subtractMoney4(quoted.total_usd, num(item.total_usd))) >= RETURN_LEGACY_CONVERT_LINE_TOLERANCE_USD) {
      return { ok: false, code: 'return_convert_line_changed', params: { product_name: item.product_name ?? null, before: num(item.total_usd), after: quoted.total_usd } }
    }
    lines.push({ id: Number(item.id), s: resolvedSaleItem.get(Number(item.id))!, u: quoted.total_usd, j: quoted.refund_snapshot_json })
  }
  // Riel: a restored v1 return must satisfy total_refund_khr = total x sale rate. The recorded riel stays when it already
  // does; it may move by less than one 100-riel step only when no riel cash left the drawer for this refund.
  const storedKhr = num(legacy.total_refund_khr)
  const unknownKhr = legacy.total_refund_khr == null
  const exactKhr = multiplyMoney4(total, num(quoteRows.sale?.exchange_rate))
  const owed = num(legacy.owed_reduction_usd)
  const rielCashPaid = String(legacy.refund_currency || '') === 'KHR' && total - owed > 0
  // A NULL riel figure on a refund that paid no riel was never recorded at all; filling it moves no money.
  if (storedKhr !== exactKhr && (rielCashPaid || (!unknownKhr && Math.abs(storedKhr - exactKhr) >= RETURN_LEGACY_CONVERT_RIEL_STEP_KHR))) {
    return { ok: false, code: 'return_convert_riel_changed', params: { before: storedKhr, after: exactKhr } }
  }
  const after: MemberState = {
    header: { v: 1, c: quote.calculated_refund_usd, a: quote.rounding_adjustment_usd, k: exactKhr, t: total },
    lines,
  }
  const priorRows = lines.map((line, index) => ({
    return_id: legacy.id, money_precision_version: 1, calculated_refund_usd: after.header.c, rounding_adjustment_usd: after.header.a,
    total_refund_usd: total, return_status: 'completed', return_updated_at: legacy.updated_at, return_item_id: line.id,
    sale_item_id: line.s, quantity: num(legacy.items[index].quantity), total_usd: line.u, refund_snapshot_json: line.j,
  }))
  return { ok: true, after, priorRows }
}

function beforeState(legacy: LegacyReturn): MemberState {
  return {
    header: { v: 0, c: nullableNum(legacy.calculated_refund_usd), a: num(legacy.rounding_adjustment_usd), k: nullableNum(legacy.total_refund_khr), t: nullableNum(legacy.total_refund_usd) },
    lines: legacy.items.map(item => ({ id: Number(item.id), s: item.sale_item_id == null ? null : Number(item.sale_item_id), u: nullableNum(item.total_usd),
      j: item.refund_snapshot_json == null ? null : String(item.refund_snapshot_json) })),
  }
}

function previewRow(legacy: LegacyReturn, outcome: ConvertPreviewRow['outcome'], code: string | null, params: Record<string, unknown> | null,
  after: MemberState | null): ConvertPreviewRow {
  const before = beforeState(legacy)
  return {
    id: legacy.id, return_number: legacy.return_number == null ? null : String(legacy.return_number), sale_id: legacy.sale_id == null ? null : Number(legacy.sale_id),
    receipt_number: legacy.receipt_number == null ? null : String(legacy.receipt_number), status: String(legacy.status || 'completed'),
    outcome, code, params, total_refund_usd: num(legacy.total_refund_usd), refund_currency: legacy.refund_currency == null ? null : String(legacy.refund_currency),
    owed_reduction_usd: num(legacy.owed_reduction_usd), before: headerPreview(before.header), after: after ? headerPreview(after.header) : null,
    lines: legacy.items.map(item => ({ id: Number(item.id), product_name: item.product_name == null ? null : String(item.product_name), quantity: num(item.quantity),
      before_total_usd: num(item.total_usd), after_total_usd: after?.lines.find(line => line.id === Number(item.id))?.u ?? null })),
  }
}

const RETURN_COLUMNS = `r.id,r.return_number,r.receipt_number,r.sale_id,r.status,r.return_scope,r.money_precision_version,r.calculated_refund_usd,
  r.rounding_adjustment_usd,r.total_refund_usd,r.total_refund_khr,r.refund_currency,r.owed_reduction_usd,r.updated_at,r.created_at`

async function readItems(db: D1Compat, ids: number[]): Promise<Map<number, Row[]>> {
  const map = new Map<number, Row[]>()
  if (!ids.length) return map
  const rows = await db.prepare(`SELECT id,return_id,sale_item_id,product_id,product_name,quantity,total_usd,refund_snapshot_json
    FROM return_items WHERE return_id IN (SELECT value FROM json_each(@ids)) ORDER BY return_id,id`).all<Row>({ ids: JSON.stringify(ids) })
  for (const row of rows) map.set(Number(row.return_id), [...(map.get(Number(row.return_id)) || []), row])
  return map
}

// ---- the report basis ---------------------------------------------------------------------------------------------
// The sales report values an old-format refund on the legacy basis (refund paid x net / subtotal, lib/salesAnalytics.ts)
// and a current-format refund on its net entitlement. On a sale with a receipt or membership discount, or tax, the two
// differ even when the payout is identical, so a conversion would restate a closed period's revenue. Each conversion is
// therefore also judged by the REAL report reducer (salesTotalsFromSnapshot over readSalesReportSnapshot rows) for the
// sale, before and after, and refused unless every report total is equal at four places. A cancelled return is judged
// as it would count if it were restored, so a later restore cannot restate the period either.
type ReportSnapshot = Awaited<ReturnType<typeof readSalesReportSnapshot>>
const REPORT_RETURN_COLUMNS = `r.id,r.sale_id,r.total_refund_usd,'completed' AS status,r.return_scope,r.owed_reduction_usd,r.refund_currency,
  r.money_precision_version,r.calculated_refund_usd,r.rounding_adjustment_usd`
async function readSaleReport(env: Env, saleId: number, cancelledIds: number[]): Promise<ReportSnapshot | null> {
  try {
    const snapshot = await readSalesReportSnapshot(env, {}, false, (alias) => ({ sql: `${alias}.id=@reportScope_saleId`, params: { reportScope_saleId: saleId } }))
    if (!cancelledIds.length) return snapshot
    const db = getDb(env)
    const ids = JSON.stringify(cancelledIds)
    const returns = await db.prepare(`SELECT ${REPORT_RETURN_COLUMNS} FROM returns r WHERE r.id IN (SELECT value FROM json_each(@ids)) ORDER BY r.id`).all<Row>({ ids })
    const returnItems = await db.prepare(`SELECT ri.id,ri.return_id,ri.cost_price_usd,ri.quantity,ri.stock_action,ri.return_to_stock,ri.sale_item_id,ri.total_usd,ri.refund_snapshot_json
      FROM return_items ri WHERE ri.return_id IN (SELECT value FROM json_each(@ids)) ORDER BY ri.id`).all<Row>({ ids })
    return { ...snapshot, returns: [...snapshot.returns, ...returns] as ReportSnapshot['returns'], returnItems: [...snapshot.returnItems, ...returnItems] as ReportSnapshot['returnItems'] }
  } catch { return null }
}
/** The snapshot with these returns in their converted shape. */
function withConverted(snapshot: ReportSnapshot, converted: Array<{ id: number; after: MemberState }>): ReportSnapshot {
  const headers = new Map(converted.map(member => [member.id, member.after.header]))
  const lines = new Map(converted.flatMap(member => member.after.lines.map(line => [line.id, line] as const)))
  return {
    ...snapshot,
    returns: snapshot.returns.map(row => {
      const header = headers.get(Number(row.id))
      return header ? { ...row, money_precision_version: header.v, calculated_refund_usd: header.c, rounding_adjustment_usd: header.a } : row
    }),
    returnItems: snapshot.returnItems.map(row => {
      const line = lines.get(Number(row.id))
      return line ? { ...row, sale_item_id: line.s, total_usd: line.u, refund_snapshot_json: line.j } : row
    }),
  }
}
function reportTotals(snapshot: ReportSnapshot): Record<string, unknown> | null {
  try { return { ...salesTotalsFromSnapshot(snapshot, 4) } } catch { return null }
}
function sameReport(left: Record<string, unknown> | null, right: Record<string, unknown> | null): boolean {
  return !!left && !!right && JSON.stringify(left) === JSON.stringify(right)
}

// ---- the amendment ledger (finding G, "no restore after reprice") ---------------------------------------------------
// A cancelled old-format return is judged at restore by the sale amendment ledger (a quantity or price change recorded for
// its line after the return was entered refuses the restore). Converting writes a snapshot from today's pricing, which
// would let that restore through, so such a return is not converted. Read straight from the ledger, the same kinds the
// restore rule reads, so this holds whichever lane merges first.
const LEDGER_LINE_KINDS = ['line_quantity_increased', 'line_quantity_decreased', 'line_updated']
const stampMs = (value: unknown): number => Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(String(value)) ? String(value).replace(' ', 'T') : `${String(value).replace(' ', 'T')}Z`)
async function amendedAfter(db: D1Compat, legacy: LegacyReturn, saleItemIds: number[]): Promise<boolean> {
  if (!saleItemIds.length) return false
  const returnedAt = stampMs(legacy.created_at)
  const ledger = await db.prepare(`SELECT created_at FROM sale_amendments WHERE sale_item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids))
    AND kind IN (${LEDGER_LINE_KINDS.map(kind => `'${kind}'`).join(',')}) LIMIT 1001`).all<{ created_at: string | null }>({ ids: JSON.stringify(saleItemIds) })
  // An unreadable return time is treated as "before every amendment": refuse rather than guess.
  return ledger.some(entry => !Number.isFinite(returnedAt) || stampMs(entry.created_at) > returnedAt)
}

/** Read-only. What converting `ids` would write, per return, and why any return cannot be converted. */
export async function planLegacyReturnConversion(env: Env, rawIds: unknown): Promise<ConvertPlan> {
  const db = getDb(env)
  const ids = parseConvertIds(rawIds)
  const selected = await db.prepare(`SELECT ${RETURN_COLUMNS},s.money_precision_version AS sale_money_precision_version
    FROM returns r LEFT JOIN sales s ON s.id=r.sale_id WHERE r.id IN (SELECT value FROM json_each(@ids)) ORDER BY r.id`).all<Row>({ ids: JSON.stringify(ids) })
  if (selected.length !== ids.length) fail('A selected return no longer exists.', 404, 'return_convert_not_found')
  const rows: ConvertPreviewRow[] = []
  const members: ConvertMember[] = []
  const sales: Array<{ id: number; revision: number }> = []
  const lockedSales = new Set<number>()
  const plainItems = await readItems(db, selected.map(row => Number(row.id)))
  for (const row of selected) {
    const legacy = { ...row, id: Number(row.id), items: plainItems.get(Number(row.id)) || [] } as LegacyReturn
    if (String(row.return_scope || 'customer') !== 'customer') rows.push(previewRow(legacy, 'refused', 'return_convert_supplier', null, null))
    else if (Number(row.money_precision_version) === 1) rows.push(previewRow(legacy, 'already_converted', null, null, null))
    else if (row.sale_id == null || Number(row.sale_money_precision_version) !== 1) rows.push(previewRow(legacy, 'refused', 'return_convert_not_locked', null, null))
    else lockedSales.add(Number(row.sale_id))
  }
  for (const saleId of [...lockedSales].sort((a, b) => a - b)) {
    const revision = await db.prepare('SELECT COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0) AS revision')
      .get<{ revision: number }>({ saleId })
    sales.push({ id: saleId, revision: num(revision?.revision) })
    const quoteRows = await readCustomerReturnQuoteRows(db, saleId, null).catch(() => null)
    const legacyRows = await db.prepare(`SELECT ${RETURN_COLUMNS} FROM returns r WHERE r.sale_id=@saleId
      AND COALESCE(r.return_scope,'customer')='customer' AND COALESCE(r.money_precision_version,0)<>1 ORDER BY r.id`).all<Row>({ saleId })
    const items = await readItems(db, legacyRows.map(row => Number(row.id)))
    const legacies = legacyRows.map(row => ({ ...row, id: Number(row.id), items: items.get(Number(row.id)) || [] }) as LegacyReturn)
    const isCancelled = (legacy: LegacyReturn) => String(legacy.status || 'completed') === 'cancelled'
    const report = quoteRows ? await readSaleReport(env, saleId, legacies.filter(isCancelled).map(legacy => legacy.id)) : null
    const reportBefore = report ? reportTotals(report) : null
    if (!quoteRows || !report || !reportBefore) {
      const detail = quoteRows ? 'report_unreadable' : 'customer_return_sale_invalid'
      for (const legacy of legacies) rows.push(previewRow(legacy, 'refused', 'return_convert_quote_refused', { detail }, null))
      continue
    }
    // Per return, not all-or-nothing. The v1 cohort is a SET (customerReturnEntitlement.ts): each conversion is quoted with
    // the sale's exact returns plus the ones already converted here as its priors, so every converted member satisfies the
    // cohort caps (per-line entitlement plus residue, cent payout) together with every exact member that exists after it.
    // That is the invariant the earlier all-or-nothing rule protected; the priors chain keeps it. An old-format return that
    // cannot convert stays old-format (it keeps the sale closed to new returns) but no longer blocks its siblings, and it
    // can be cancelled: returnBulkAction.ts judges a cancel by the exact members it leaves.
    const priors = quoteRows.previousRows.filter(row => Number(row.money_precision_version) === 1)
    const accepted: Array<{ id: number; after: MemberState }> = []
    for (const legacy of [...legacies.filter(row => !isCancelled(row)), ...legacies.filter(isCancelled)]) {
      const cancelled = isCancelled(legacy)
      const saleItemIds = [...new Set(legacy.items.map(item => Number(item.sale_item_id)).filter(id => Number.isSafeInteger(id) && id > 0))]
      if (cancelled && await amendedAfter(db, legacy, saleItemIds)) {
        rows.push(previewRow(legacy, 'refused', 'return_convert_sale_amended', null, null)); continue
      }
      const result = await compareWithQuote(db, saleId, legacy, quoteRows, priors)
      if (!result.ok) { rows.push(previewRow(legacy, 'refused', result.code, result.params, null)); continue }
      const beforeTotals = accepted.length ? reportTotals(withConverted(report, accepted)) : reportBefore
      const afterTotals = reportTotals(withConverted(report, [...accepted, { id: legacy.id, after: result.after }]))
      if (!sameReport(beforeTotals, afterTotals)) {
        rows.push(previewRow(legacy, 'refused', 'return_convert_report_changed', {
          before: beforeTotals?.revenue_usd ?? null, after: afterTotals?.revenue_usd ?? null }, null))
        continue
      }
      accepted.push({ id: legacy.id, after: result.after })
      // Only an active return joins the priors: a cancelled one is outside the cohort until it is restored.
      if (!cancelled) priors.push(...result.priorRows)
      rows.push(previewRow(legacy, 'convert', null, null, result.after))
      members.push({ id: legacy.id, return_number: legacy.return_number == null ? null : String(legacy.return_number), sale_id: saleId, before: beforeState(legacy), after: result.after })
    }
  }
  rows.sort((a, b) => a.id - b.id)
  members.sort((a, b) => a.id - b.id)
  const digest = await sha256Hex(JSON.stringify({ sales, members: members.map(member => ({ id: member.id, before: member.before, after: member.after })) }))
  return { digest, rows, members, sales }
}

// ---- writes -------------------------------------------------------------------------------------------------------

type Side = 'before' | 'after'
function headerRows(members: ConvertMember[], side: Side) { return JSON.stringify(members.map(member => ({ id: member.id, ...member[side].header }))) }
function lineRows(members: ConvertMember[], side: Side) { return JSON.stringify(members.flatMap(member => member[side].lines)) }
function stateGuard(members: ConvertMember[], side: Side): Statement {
  return guard(`NOT EXISTS(SELECT 1 FROM json_each(@headers) j WHERE NOT EXISTS(SELECT 1 FROM returns r WHERE r.id=json_extract(j.value,'$.id')
      AND r.money_precision_version IS json_extract(j.value,'$.v') AND r.calculated_refund_usd IS json_extract(j.value,'$.c')
      AND r.rounding_adjustment_usd IS json_extract(j.value,'$.a') AND r.total_refund_khr IS json_extract(j.value,'$.k')
      AND r.total_refund_usd IS json_extract(j.value,'$.t')))
    AND NOT EXISTS(SELECT 1 FROM json_each(@lines) j WHERE NOT EXISTS(SELECT 1 FROM return_items ri WHERE ri.id=json_extract(j.value,'$.id')
      AND ri.sale_item_id IS json_extract(j.value,'$.s') AND ri.total_usd IS json_extract(j.value,'$.u')
      AND ri.refund_snapshot_json IS json_extract(j.value,'$.j')))`, { headers: headerRows(members, side), lines: lineRows(members, side) })
}
function writeStatements(members: ConvertMember[], side: Side, stamp: string): Statement[] {
  const pick = (path: string) => `(SELECT json_extract(j.value,'$.${path}') FROM json_each(@headers) j WHERE json_extract(j.value,'$.id')=returns.id)`
  const pickLine = (path: string) => `(SELECT json_extract(j.value,'$.${path}') FROM json_each(@lines) j WHERE json_extract(j.value,'$.id')=return_items.id)`
  return [
    { sql: `UPDATE returns SET money_precision_version=${pick('v')},calculated_refund_usd=${pick('c')},rounding_adjustment_usd=${pick('a')},
        total_refund_khr=${pick('k')},updated_at=@stamp WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@headers))`,
      params: { headers: headerRows(members, side), stamp } },
    { sql: `UPDATE return_items SET sale_item_id=${pickLine('s')},total_usd=${pickLine('u')},refund_snapshot_json=${pickLine('j')}
        WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@lines))`, params: { lines: lineRows(members, side) } },
  ]
}
/** Every return on the converted sales with its write revision: an undo/redo is refused once any of them moved. */
const FINGERPRINT_SQL = `(SELECT group_concat(k, ',') FROM (SELECT r.id || ':' || COALESCE(v.revision,0) AS k FROM returns r
  LEFT JOIN return_write_revisions v ON v.return_id=r.id WHERE r.sale_id IN (SELECT value FROM json_each(@saleIds)) ORDER BY r.id))`
function auditStatement(user: SessionUser, members: ConvertMember[], from: Side, to: Side, action: string, operationId: string): Statement {
  const fields = (state: MemberState) => ({ money_precision_version: state.header.v, calculated_refund_usd: state.header.c,
    rounding_adjustment_usd: state.header.a, total_refund_khr: state.header.k,
    lines: state.lines.map(line => ({ id: line.id, sale_item_id: line.s, total_usd: line.u, refund_snapshot: line.j == null ? null : 'v1' })) })
  return { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
      SELECT @user,@name,@action,'return',CAST(json_extract(j.value,'$.id') AS TEXT),@details,'returns',CAST(json_extract(j.value,'$.id') AS TEXT),
        json_extract(j.value,'$.old'),json_extract(j.value,'$.new') FROM json_each(@rows) j`,
    params: { user: user.id, name: actorSnapshot(user), action, details: JSON.stringify({ via: RETURN_LEGACY_CONVERT_KIND, operation_id: operationId,
      return_ids: members.map(member => member.id) }),
      rows: JSON.stringify(members.map(member => ({ id: member.id, old: JSON.stringify(fields(member[from])), new: JSON.stringify(fields(member[to])) }))) } }
}

type Stored = { version: 1; operation_id: string; sale_ids: number[]; members: ConvertMember[]; generation: number
  history_id?: number; fingerprint?: string; last_direction?: 'undo' | 'redo'; last_expected_generation?: number }
type SnapshotRow = { id: number; status: string; payload_json: string; created_by_id: number }
async function findOperation(db: D1Compat, operationId: string): Promise<SnapshotRow | undefined> {
  const rows = await db.prepare(`SELECT id,status,payload_json,created_by_id FROM undo_snapshots
    WHERE kind=@kind AND json_extract(payload_json,'$.operation_id')=@operation LIMIT 2`).all<SnapshotRow>({ kind: RETURN_LEGACY_CONVERT_KIND, operation: operationId })
  if (rows.length > 1) fail('This conversion was recorded twice. Ask an administrator to review it.', 409, 'return_convert_duplicate')
  return rows[0]
}
function readStored(row: SnapshotRow): Stored {
  try {
    const stored = JSON.parse(row.payload_json) as Stored
    if (stored.version !== 1 || !Array.isArray(stored.members) || !Number.isSafeInteger(stored.generation)) throw new Error('shape')
    return stored
  } catch { return fail('The conversion record cannot be read.', 409, 'return_convert_unreadable') }
}
function receipt(stored: Stored, row: SnapshotRow, replayed: boolean) {
  return { success: true, replayed, operation_id: stored.operation_id, history_id: stored.history_id ?? null,
    status: row.status === 'reversed' ? 'reversed' as const : 'applied' as const, converted: stored.members.map(member => member.id) }
}

export async function applyLegacyReturnConversion(env: Env, userInput: SessionUser | null | undefined, body: Record<string, unknown>) {
  const user = authorize(userInput)
  const db = getDb(env)
  const requestId = String(body.client_request_id ?? '').trim().slice(0, 120)
  if (!requestId) fail('Preview the conversion again before confirming it.', 400, 'client_request_id_required')
  const operationId = `${user.id}:${requestId}`
  const existing = await findOperation(db, operationId)
  if (existing) {
    if (Number(existing.created_by_id) !== Number(user.id)) fail('Conversion not found.', 404, 'return_convert_not_found')
    return { ...receipt(readStored(existing), existing, true), rows: [] as ConvertPreviewRow[] }
  }
  const plan = await planLegacyReturnConversion(env, body.return_ids)
  if (typeof body.expected_digest !== 'string' || body.expected_digest !== plan.digest) {
    fail('These returns changed since the preview. Nothing was converted. Open the preview again.', 409, 'return_convert_preview_stale')
  }
  // Idempotent: nothing left to convert (every selected return already is) is a success that writes nothing.
  if (!plan.members.length) return { success: true, replayed: false, operation_id: null, history_id: null, status: 'applied' as const, converted: [] as number[], rows: plan.rows }
  const stamp = new Date().toISOString()
  const saleIds = JSON.stringify(plan.sales.map(sale => sale.id))
  const stored: Stored = { version: 1, operation_id: operationId, sale_ids: plan.sales.map(sale => sale.id), members: plan.members, generation: 0 }
  const lookup = `SELECT id FROM undo_snapshots WHERE kind=@kind AND json_extract(payload_json,'$.operation_id')=@operation`
  const params = { kind: RETURN_LEGACY_CONVERT_KIND, operation: operationId, user: user.id, name: actorSnapshot(user) }
  const label = plan.members.length === 1
    ? `Update money details of return ${plan.members[0].return_number || plan.members[0].id}`
    : `Update money details of ${plan.members.length} returns`
  const statements: Statement[] = [
    guard(`NOT EXISTS(${lookup})`, params),
    guard(`NOT EXISTS(SELECT 1 FROM json_each(@sales) j WHERE COALESCE((SELECT revision FROM sale_write_revisions
      WHERE sale_id=json_extract(j.value,'$.id')),0)<>json_extract(j.value,'$.revision'))`, { sales: JSON.stringify(plan.sales) }),
    stateGuard(plan.members, 'before'),
    { sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name) VALUES(@kind,'applied',@payload,@user,@name)`,
      params: { ...params, payload: JSON.stringify(stored) } },
    ...writeStatements(plan.members, 'after', stamp),
    { sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
      SELECT 'returns','return',@entityId,@label,'Undo return format conversion','Redo return format conversion',1,'undoable',
        json_object('applier',@kind,'operation_id',@operation,'snapshot_id',id,'generation',0),json_object('applier',@kind,'operation_id',@operation,'snapshot_id',id,'generation',0),@user,@name
      FROM undo_snapshots WHERE id=(${lookup})`, params: { ...params, label, entityId: String(plan.members[0].id) } },
    { sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.history_id',
        (SELECT id FROM action_history WHERE json_extract(undo_payload,'$.applier')=@kind AND json_extract(undo_payload,'$.operation_id')=@operation),
        '$.fingerprint',${FINGERPRINT_SQL}) WHERE id=(${lookup})`, params: { ...params, saleIds } },
    auditStatement(user, plan.members, 'before', 'after', 'return_money_convert', operationId),
    stateGuard(plan.members, 'after'),
    { sql: ordinaryBusinessMaintenanceGuard.sql, params: {} },
  ]
  try { await db.batch(statements) } catch (error) {
    const committed = await findOperation(db, operationId)
    if (committed) return { ...receipt(readStored(committed), committed, true), rows: plan.rows }
    if (/ordinary_business_maintenance/i.test(String(error))) fail('Saving is paused for maintenance. Nothing was converted.', 503, 'maintenance_active')
    if (GUARD_FAILURE.test(String(error)) || /money_precision_invalid_returns/.test(String(error))) {
      fail('A return on this sale changed while converting. Nothing was converted. Open the preview again.', 409, 'return_convert_changed')
    }
    throw error
  }
  const committed = await findOperation(db, operationId)
  if (!committed) fail('The conversion result is uncertain. Check the return before trying again.', 503, 'return_convert_uncertain')
  return { ...receipt(readStored(committed), committed, false), rows: plan.rows }
}

/** Undo/redo applier (lib/undoAppliers.ts registry). Replays the recorded before/after exactly, by generation, idempotently. */
export async function replayLegacyReturnConversion(payload: Record<string, unknown>, ctx: UndoApplierContext): Promise<UndoApplierOutcome> {
  const user = authorize(ctx.user)
  const db = getDb(ctx.env)
  const snapshot = await findOperation(db, String(payload.operation_id || ''))
  if (!snapshot || snapshot.id !== Number(payload.snapshot_id)) fail('Conversion record not found.', 404, 'return_convert_not_found')
  const stored = readStored(snapshot)
  if (stored.history_id !== ctx.historyId) fail('This history entry does not own the conversion.', 409, 'undo_history_unusable')
  const expectedGeneration = Number(ctx.generation)
  if (typeof ctx.generation !== 'number' || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) fail('An expected generation is required.', 400, 'return_convert_invalid')
  const complete = (generation: number): UndoApplierOutcome => ({ complete: true, continuation_required: false, processed_children: stored.members.length, pending_children: 0, generation })
  if (stored.generation === expectedGeneration + 1 && stored.last_direction === ctx.direction && stored.last_expected_generation === expectedGeneration) return complete(stored.generation)
  const fromStatus = ctx.direction === 'undo' ? 'applied' : 'reversed'
  if (stored.generation !== expectedGeneration || snapshot.status !== fromStatus) fail('This conversion changed. Refresh the history.', 409, 'undo_history_stale')
  const from: Side = ctx.direction === 'undo' ? 'after' : 'before'
  const to: Side = ctx.direction === 'undo' ? 'before' : 'after'
  const next: Stored = { ...stored, generation: expectedGeneration + 1, last_direction: ctx.direction, last_expected_generation: expectedGeneration }
  const saleIds = JSON.stringify(stored.sale_ids)
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM undo_snapshots s JOIN action_history h ON h.id=@history WHERE s.id=@snapshot AND s.kind=@kind AND s.payload_json=@old
      AND s.status=@status AND h.status=@historyStatus AND h.reversible=1 AND json_extract(h.undo_payload,'$.snapshot_id')=s.id)`,
      { history: stored.history_id, snapshot: snapshot.id, kind: RETURN_LEGACY_CONVERT_KIND, old: snapshot.payload_json, status: snapshot.status,
        historyStatus: ctx.direction === 'undo' ? 'undoable' : 'redoable' }),
    // Any write to any return on these sales since the last step (a new return, a cancel, an edit) refuses the replay.
    guard(`${FINGERPRINT_SQL} IS @fingerprint`, { saleIds, fingerprint: stored.fingerprint ?? null }),
    stateGuard(stored.members, from),
    ...writeStatements(stored.members, to, new Date().toISOString()),
    { sql: `UPDATE undo_snapshots SET status=@status,payload_json=json_set(@payload,'$.fingerprint',${FINGERPRINT_SQL}),updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
      params: { status: ctx.direction === 'undo' ? 'reversed' : 'applied', payload: JSON.stringify(next), id: snapshot.id, saleIds } },
    { sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
        undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id`,
      params: { status: ctx.direction === 'undo' ? 'redoable' : 'undoable', id: stored.history_id, generation: next.generation } },
    auditStatement(user, stored.members, from, to, ctx.direction === 'undo' ? 'action_undo' : 'action_redo', stored.operation_id),
    stateGuard(stored.members, to),
    { sql: ordinaryBusinessMaintenanceGuard.sql, params: {} },
  ]
  try { await db.batch(statements) } catch (error) {
    const current = await findOperation(db, stored.operation_id)
    if (current) {
      const observed = readStored(current)
      if (observed.generation === next.generation && observed.last_direction === ctx.direction && observed.last_expected_generation === expectedGeneration) return complete(observed.generation)
    }
    if (/ordinary_business_maintenance/i.test(String(error))) fail('Saving is paused for maintenance. Nothing was changed.', 503, 'maintenance_active')
    if (GUARD_FAILURE.test(String(error)) || /money_precision_invalid_returns/.test(String(error))) {
      fail('A return on this sale changed after the conversion, so it cannot be replayed. Nothing was changed.', 409, 'undo_record_changed')
    }
    throw error
  }
  return complete(next.generation)
}

export async function notifyLegacyReturnConversion(env: Env): Promise<void> {
  await Promise.allSettled([bumpVersion(env, 'returns'), bumpVersion(env, 'sales'),
    broadcast(env, 'returns', { action: 'update' }), broadcast(env, 'sales', { action: 'update' })])
}
