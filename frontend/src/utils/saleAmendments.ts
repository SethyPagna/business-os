// Rendering a sale's amendment history (S4-30).
//
// The shop owner asked for two views of the same sale that deliberately
// disagree:
//
//   RECEIPT (customer)  the net result only, as one finalized sale. Delivery
//                       $2.00. Quantity 2. A removed line simply absent. The
//                       customer should not be able to tell it was amended.
//   SALE DETAIL (staff) the original value AND every amendment on top of it,
//                       each with what changed, by how much, who did it and
//                       when. "$1.50, then +$0.50 (Sokha, 14:22)."
//
// The receipt needs NOTHING from this file. It renders `sale_items` and the
// `sales` row, which the backend keeps at net state -- that is the whole point
// of the ledger architecture (see cloudflare/src/lib/saleAmendments.ts). This
// module is only the staff-facing half: it turns migration 0115's ledger rows
// into the lines the detail view prints.
//
// It lives in utils/ rather than inside SaleDetailModal.tsx because the shape
// of a delta -- when it is a rise, when it is a fall, when a "quantity change"
// moved no stock and why -- is exactly the logic that has to be provably right
// and is not worth re-deriving from a rendered DOM. tests/saleAmendments.test.ts
// drives it directly.

export interface SaleAmendmentRow {
  id?: number | null
  kind?: string | null
  group_id?: string | null
  sale_item_id?: number | null
  product_id?: number | null
  product_name?: string | null
  quantity_before?: number | null
  quantity_after?: number | null
  quantity_delta?: number | null
  amount_before_usd?: number | null
  amount_after_usd?: number | null
  amount_delta_usd?: number | null
  total_before_usd?: number | null
  total_after_usd?: number | null
  units_moved?: number | null
  stock_skipped?: number | null
  via?: string | null
  note?: string | null
  user_name?: string | null
  created_at?: string | null
}

/** What the detail view prints for one entry. */
export interface AmendmentDisplayRow {
  id: number
  /** Groups the two halves of a replace so they render as one act. */
  groupId: string | null
  kind: string
  /** 'quantity' entries show units; 'money' entries show dollars. */
  family: 'quantity' | 'money'
  /** The thing that changed: a product name, or "Delivery". */
  subject: string | null
  /** e.g. "1" -- what it was. */
  beforeText: string
  /** e.g. "2" -- what it is now. */
  afterText: string
  /** e.g. "+1" / "-$0.50" -- the add-on-top the owner asked to see. */
  deltaText: string
  /** True for a rise, false for a fall. Drives the colour, not the wording. */
  isIncrease: boolean
  /** The line is gone from the sale entirely -- the receipt will not show it. */
  isRemoval: boolean
  /** Units that actually left (negative) or returned to (positive) the shelf. */
  unitsMoved: number
  /**
   * A quantity moved but stock did not, and the reason is not a bug:
   * 'not_deducted' -- this sale has not taken stock yet (awaiting payment);
   * 'stock_skipped' -- the sale was completed WITHOUT moving stock, so an
   * amendment must not move any either;
   * null -- stock moved, or none was expected.
   */
  stockNote: 'not_deducted' | 'stock_skipped' | null
  /** 'amend' | 'undo' | 'redo' -- an undo appends, it never rewrites. */
  via: string
  actor: string | null
  at: string | null
  note: string | null
}

const MONEY_KINDS = new Set(['delivery_fee_changed'])

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** "2", "1.5" -- trailing zeros dropped, because a shop counts in whole units. */
export function formatUnits(value: number): string {
  const rounded = Math.round(num(value) * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

/** "+1" / "-2" -- always signed, because the sign IS the information. */
export function formatSignedUnits(value: number): string {
  const rounded = Math.round(num(value) * 100) / 100
  if (rounded > 0) return `+${formatUnits(rounded)}`
  return formatUnits(rounded)
}

/**
 * Shape one ledger row for display.
 *
 * `fmtUSD` is the caller's money formatter, so an amendment prints money the
 * same way every other number on the page does rather than growing a second
 * convention.
 */
export function toAmendmentDisplayRow(
  row: SaleAmendmentRow,
  fmtUSD: (value: number) => string,
  deliveryLabel = 'Delivery',
): AmendmentDisplayRow {
  const kind = String(row.kind || '')
  const family: 'quantity' | 'money' = MONEY_KINDS.has(kind) ? 'money' : 'quantity'
  const isRemoval = kind === 'line_removed'

  const before = family === 'money' ? num(row.amount_before_usd) : num(row.quantity_before)
  const after = family === 'money' ? num(row.amount_after_usd) : num(row.quantity_after)
  // The delta is read from the stored column when it is there -- the database
  // derived it at write time and it is the authority -- and only computed as a
  // fallback for a row that predates it.
  const storedDelta = family === 'money' ? row.amount_delta_usd : row.quantity_delta
  const delta = storedDelta === null || storedDelta === undefined ? after - before : num(storedDelta)

  const unitsMoved = num(row.units_moved)
  // Why a quantity changed while stock did not. Order matters: the sticky
  // stock_skipped flag is the more specific answer, so it wins over the
  // general "this sale has not taken stock yet".
  let stockNote: AmendmentDisplayRow['stockNote'] = null
  if (family === 'quantity' && delta !== 0 && unitsMoved === 0) {
    stockNote = row.stock_skipped ? 'stock_skipped' : 'not_deducted'
  }

  return {
    id: num(row.id),
    groupId: row.group_id ?? null,
    kind,
    family,
    subject: family === 'money' ? deliveryLabel : (row.product_name || null),
    beforeText: family === 'money' ? fmtUSD(before) : formatUnits(before),
    afterText: family === 'money' ? fmtUSD(after) : formatUnits(after),
    deltaText: family === 'money'
      ? `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${fmtUSD(Math.abs(delta))}`
      : formatSignedUnits(delta),
    isIncrease: delta > 0,
    isRemoval,
    unitsMoved,
    stockNote,
    via: String(row.via || 'amend'),
    actor: row.user_name || null,
    at: row.created_at || null,
    note: row.note || null,
  }
}

/**
 * Shape a whole ledger for display, oldest first.
 *
 * Rows arrive in insertion order from the API (the (sale_id, id) index), and
 * that order is preserved rather than re-sorted: the history is a story, and
 * re-sorting it by timestamp would reorder two entries written in the same
 * second into the wrong sequence.
 */
export function toAmendmentDisplayRows(
  rows: SaleAmendmentRow[] | null | undefined,
  fmtUSD: (value: number) => string,
  deliveryLabel = 'Delivery',
): AmendmentDisplayRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => toAmendmentDisplayRow(row, fmtUSD, deliveryLabel))
}

/**
 * The two halves of a "replace" share a group_id. Pair them so the detail view
 * can print the single act the cashier performed ("Serum -> Tonic") instead of
 * two entries the reader has to reassemble.
 *
 * Only a removal PAIRED WITH an addition is a replace. A group holding one
 * entry, or two removals, is left as separate rows rather than guessed at.
 */
export function pairReplacements(rows: AmendmentDisplayRow[]): Array<
  | { type: 'single'; row: AmendmentDisplayRow }
  | { type: 'replacement'; removed: AmendmentDisplayRow; added: AmendmentDisplayRow }
> {
  const byGroup = new Map<string, AmendmentDisplayRow[]>()
  for (const row of rows) {
    if (!row.groupId) continue
    if (!byGroup.has(row.groupId)) byGroup.set(row.groupId, [])
    byGroup.get(row.groupId)!.push(row)
  }

  const consumed = new Set<number>()
  const out: ReturnType<typeof pairReplacements> = []
  for (const row of rows) {
    if (consumed.has(row.id)) continue
    const group = row.groupId ? byGroup.get(row.groupId) || [] : []
    const removed = group.find((entry) => entry.kind === 'line_removed')
    const added = group.find((entry) => entry.kind === 'line_added')
    if (group.length === 2 && removed && added) {
      consumed.add(removed.id)
      consumed.add(added.id)
      out.push({ type: 'replacement', removed, added })
      continue
    }
    out.push({ type: 'single', row })
  }
  return out
}

/**
 * Whether a sale's line may be amended from the UI at all.
 *
 * A deliberately conservative CLIENT-SIDE mirror of the server's guard: the
 * Worker is the authority and re-checks every one of these (plus the edit
 * window and the recorded-returns evidence, neither of which the client can
 * prove). This exists so the buttons are not offered where they would be
 * refused, never as the enforcement.
 */
export const SALE_STATUSES_ACCEPTING_AMENDMENTS = ['completed', 'awaiting_delivery', 'awaiting_payment']

export function saleLooksAmendable(sale: {
  sale_status?: string | null
  return_count?: number | null
} | null | undefined): boolean {
  if (!sale) return false
  if (num(sale.return_count) > 0) return false
  return SALE_STATUSES_ACCEPTING_AMENDMENTS.includes(String(sale.sale_status || 'completed'))
}
