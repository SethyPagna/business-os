// The money half of a customer return (owner rulings 29 Sep, 5-6 Oct 2026;
// migration 0260): a return first lowers what the customer still owes on the
// sale, and only the part above that debt is cash refunded -- in the currency
// the till paid it in. total_refund_usd stays the return value (revenue);
// owed_reduction_usd is the debt part, the rest left a drawer.
//   $10 Not Paid, $3 paid, $4 back -> owes $3, cash refund $0
//   $10 Not Paid, $7 paid, $4 back -> owes $0, cash refund $1
import type { D1Compat } from './db'
import { roundMoney2, roundMoney4, subtractMoney4 } from './moneyPrecision'
import {
  recordedSaleOutstandingUsd, saleReadsNotPaid, saleStoredState, sumRefundsUsd, type RecordedSaleMoney, type SaleReturnState, type SaleStoredState,
} from './saleStatusResolution'
import { notPaidSaleSql, saleStatusWord } from './salesStatus'
import { importedReturnedQuantitySql } from './saleTransitions'

// Stable codes the till restates (both language packs).
export class ReturnMoneyError extends Error {
  readonly code = 'customer_return_owed_unreadable'
  constructor() {
    super('The sale money cannot be read, so the debt this return lowers is unknown.')
  }
}
export const RETURN_REOPENS_PAID_SALE_DEBT = 'return_reopens_paid_sale_debt'
export const RETURN_REOPENS_PAID_SALE_DEBT_ERROR = 'This return lowered what the customer owed, and the sale has been paid since. Taking it back would leave a paid sale owing money. Reopen the sale for payment first.'

// A row recorded before 0260 (refund_currency NULL) reads as 6.0.872 read it:
// its whole refund lowered the debt of a sale that reads Not Paid, and lowered
// nothing on a paid one (it was all dollar cash). Held 0238 rewrites those rows.
export function returnDebtLoweredSql(alias: string): string {
  return `(CASE WHEN ${alias}.refund_currency IS NULL THEN CASE WHEN EXISTS(SELECT 1 FROM sales debt_sale WHERE debt_sale.id=${alias}.sale_id
      AND ${notPaidSaleSql('debt_sale')}) THEN COALESCE(${alias}.total_refund_usd, 0) ELSE 0 END
    ELSE COALESCE(${alias}.owed_reduction_usd, 0) END)`
}
export type ReturnMoneyColumns = { total_refund_usd?: unknown; total_refund_khr?: unknown; owed_reduction_usd?: unknown; refund_currency?: unknown }
const finite = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0

/** JS reading of shiftReconciliation's refund drawer SQL, for one return row (alerts). */
export function refundCashOut(row: ReturnMoneyColumns): { owedReductionUsd: number; usd: number; khr: number } {
  const total = finite(row.total_refund_usd)
  const owed = finite(row.owed_reduction_usd)
  const cash = roundMoney4(total - owed)
  if (row.refund_currency !== 'KHR') return { owedReductionUsd: owed, usd: cash, khr: 0 }
  // SQLite ROUND: half away from zero; the riel figure is never negative.
  return { owedReductionUsd: owed, usd: 0, khr: total > 0 ? Math.trunc(finite(row.total_refund_khr) * (total - owed) / total + 0.5) : 0 }
}

export type SaleReturnMoneyRow = { id: number; status: string; total_refund_usd: unknown; owed_reduction_usd: unknown; refund_currency: unknown }
export type SaleReturnMoney = { sale: RecordedSaleMoney & { id: number; sale_status?: unknown; status_before_return?: unknown }; returns: SaleReturnMoneyRow[] }

/**
 * Every customer return on the sale aliased `alias`, oldest first, as one JSON
 * column (return_money_json): a select that already reads the sale carries it
 * at no extra D1 statement. saleReturnMoney() reads it back.
 */
export function saleReturnMoneySql(alias: string): string {
  return `(SELECT json_group_array(json_object('id',r.id,'status',r.status,'total_refund_usd',r.total_refund_usd,
      'owed_reduction_usd',r.owed_reduction_usd,'refund_currency',r.refund_currency))
    FROM (SELECT id,COALESCE(status,'completed') AS status,total_refund_usd,owed_reduction_usd,refund_currency FROM returns
      WHERE sale_id=${alias}.id AND COALESCE(return_scope,'customer')='customer' ORDER BY id) r) AS return_money_json`
}

/** A sale row that selected its money columns and saleReturnMoneySql. */
export function saleReturnMoney(row: Record<string, unknown>): SaleReturnMoney {
  const { return_money_json: json, ...sale } = row
  return { sale: { ...sale, id: Number(sale.id) }, returns: JSON.parse(String(json || '[]')) as SaleReturnMoneyRow[] }
}

/** One statement: each sale's money and every customer return on it. */
export async function readSalesReturnMoney(db: Pick<D1Compat, 'prepare'>, saleIds: readonly number[]): Promise<Map<number, SaleReturnMoney>> {
  const out = new Map<number, SaleReturnMoney>()
  if (!saleIds.length) return out
  const rows = await db.prepare(`SELECT s.id,s.sale_status,s.status_before_return,s.total_usd,s.amount_paid_usd,s.amount_paid_khr,
      s.exchange_rate,s.money_precision_version,s.calculated_total_usd,${saleReturnMoneySql('s')}
    FROM sales s WHERE s.id IN (SELECT CAST(value AS INTEGER) FROM json_each(@saleIds))`)
    .all<Record<string, unknown>>({ saleIds: JSON.stringify(saleIds) })
  for (const row of rows) out.set(Number(row.id), saleReturnMoney(row))
  return out
}

export type PlannedReturn = { id: number; active: boolean; refundUsd: unknown; owedReductionUsd: unknown; currency: unknown }
export type ReturnMoneyPlan = {
  /** The owed reduction to store on each recomputed return. */
  owedReductionUsd: Map<number, number>
  /**
   * A return never changes the payment state (owner, 20 Oct 2026). True when
   * these returns would leave a sale that reads paid owing money again -- a
   * debt-lowering return taken back after the sale was settled; the caller
   * refuses (RETURN_REOPENS_PAID_SALE_DEBT) rather than hide that debt.
   */
  reopensPaidSaleDebt: boolean
  /** The sale reads Not Paid (saleReadsNotPaid): a replacement on it is Not Paid too. */
  saleReadsNotPaid: boolean
}

/**
 * The sale money as the coverage formula takes it. With no riel paid the rate
 * multiplies nothing, so a sale booked without one (NULL or 0) still reads;
 * riel paid at an unreadable rate stays unreadable.
 */
function owedMoney(sale: SaleReturnMoney['sale']): RecordedSaleMoney {
  const rielPaid = sale.amount_paid_khr != null && Number(sale.amount_paid_khr) !== 0
  const rate = sale.exchange_rate == null || sale.exchange_rate === '' ? NaN : Number(sale.exchange_rate)
  return rielPaid || rate > 0 ? sale : { ...sale, exchange_rate: 1 }
}

/**
 * Splits the `recompute` returns (in order; each one active and recorded in a
 * currency) into debt lowered and cash, against the sale's debt after every
 * other active return. A sale carries a debt while it reads Not Paid or once a
 * return lowered one -- a sale paid at the counter (or imported without
 * tender) never does, so its returns stay all cash.
 */
export function planReturnMoney(input: { sale: SaleReturnMoney['sale']; returns: readonly PlannedReturn[]; recompute: readonly number[] }): ReturnMoneyPlan {
  const owedReductionUsd = new Map<number, number>()
  const notPaid = saleReadsNotPaid(input.sale)
  const carriesDebt = notPaid || input.returns.some(row => finite(row.owedReductionUsd) > 0)
  if (!carriesDebt) {
    for (const id of input.recompute) owedReductionUsd.set(id, 0)
    return { owedReductionUsd, reopensPaidSaleDebt: false, saleReadsNotPaid: false }
  }
  // returnDebtLoweredSql's JS twin: a pre-0260 row lowered a debt only on a sale that reads Not Paid.
  const debtLowered = (row: PlannedReturn): number => row.currency == null ? (notPaid ? finite(row.refundUsd) : 0) : finite(row.owedReductionUsd)
  const lowered = new Map(input.returns.filter(row => row.active && !input.recompute.includes(row.id)).map(row => [row.id, debtLowered(row)]))
  const money = owedMoney(input.sale)
  const owed = () => {
    try {
      return recordedSaleOutstandingUsd({ ...money, refund_usd: sumRefundsUsd([...lowered.values()]) })
    } catch {
      throw new ReturnMoneyError()
    }
  }
  for (const id of input.recompute) {
    const row = input.returns.find(candidate => candidate.id === id)
    if (!row || !row.active) continue
    const refund = roundMoney4(finite(row.refundUsd))
    const reduction = Math.max(0, Math.min(refund, roundMoney2(owed())))
    owedReductionUsd.set(id, reduction)
    lowered.set(id, reduction)
  }
  return { owedReductionUsd, reopensPaidSaleDebt: !notPaid && owed() > 0, saleReadsNotPaid: notPaid }
}

/** Cash part of a split refund, for a refusal or a message. */
export function refundCashUsd(refundUsd: unknown, owedReductionUsd: number): number {
  return subtractMoney4(roundMoney4(finite(refundUsd)), owedReductionUsd)
}

// ---- The return tag (owner, 20 Oct 2026; migration 0263) --------------------
// A return never changes sale_status; it sets sales.return_state:
//   NULL       no live customer return and no unit an import recorded as returned
//   'full'     every sale line has as many units returned as it sold -- live
//              customer return lines (matched by sale_item_id, else product_id)
//              plus the line's imported returned_quantity
//   'partial'  otherwise
// Its readings: lib/returnCreateAction.ts projectedReturnStateForReturnCreate(V1)
// (exact decimals, for a create or edit that knows its lines) and
// saleReturnStateSql below (in-batch, for cancel/restore and their Undo/Redo).
// Its one write: saleReturnTagStatement. It lives beside the money half
// because every returns writer already loads this file.

type TagStatement = { sql: string; params: Record<string, unknown> }

/**
 * The return tag of sale `saleId` (an SQL expression or parameter), read in
 * the batch that just moved its returns. `live` decides which return rows
 * count (alias r); by default every one that is not cancelled.
 */
export function saleReturnStateSql(saleId: string, live = "COALESCE(r.status,'completed')!='cancelled'"): string {
  const customer = `r.sale_id=${saleId} AND ${live} AND COALESCE(r.return_scope,'customer')='customer'`
  return `CASE
    WHEN NOT EXISTS(SELECT 1 FROM returns r WHERE ${customer})
      AND NOT EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id=${saleId} AND ${importedReturnedQuantitySql('si')} > 0) THEN NULL
    WHEN NOT EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id=${saleId} AND COALESCE((
        SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id=ri.return_id
        WHERE ${customer} AND (ri.sale_item_id=si.id OR (ri.sale_item_id IS NULL AND ri.product_id=si.product_id))
      ),0) + ${importedReturnedQuantitySql('si')} < si.quantity) THEN 'full'
    ELSE 'partial' END`
}

// The tag a row carries before the write, as saleStoredState reads it: a retired label outranks the column.
const STORED_RETURN_STATE_SQL = "CASE sale_status WHEN 'returned' THEN 'full' WHEN 'partial_return' THEN 'partial' ELSE return_state END"

/** A row whose sale_status is still a retired return word (written before 0263); its tag needs that word gone. */
export function carriesRetiredReturnLabel(row: { sale_status?: unknown }): boolean {
  return row.sale_status === 'returned' || row.sale_status === 'partial_return'
}

/**
 * The one sales write of every returns writer: return_state <- `tag`, never
 * sale_status. The review flag (owner, 20 Oct 2026) follows the move:
 *   into 'full'   -> 'pending', unless a review is already recorded (an Undo
 *                    of a cancel then gives back exactly what it took)
 *   out of 'full' -> a 'pending' flag clears; a 'confirmed' one is history and stays
 *   no move       -> unchanged, so a sale fully returned before 0263 stays unflagged.
 * `retired` is the row's state when it still carries a retired return word:
 * that word outranks the column, so it is rewritten to the payment state it
 * stood for (saleStoredState) -- the only time a return writes sale_status.
 */
export function saleReturnTagStatement(input: {
  saleId: number; stamp: string; tag: SaleReturnState | null | { sql: string }; retired?: SaleStoredState | null
}): TagStatement {
  const tagSql = input.tag !== null && typeof input.tag === 'object' ? input.tag.sql : '@tag'
  const relabel = input.retired ? ',sale_status=@retiredStatus,delivery_pending=MAX(delivery_pending,@retiredDelivery)' : ''
  return {
    sql: `UPDATE sales SET return_state=t.tag,
        return_review_state=CASE
          WHEN t.tag='full' AND COALESCE(${STORED_RETURN_STATE_SQL},'')<>'full' THEN COALESCE(return_review_state,'pending')
          WHEN COALESCE(t.tag,'')<>'full' AND ${STORED_RETURN_STATE_SQL}='full' AND return_review_state='pending' THEN NULL
          ELSE return_review_state END${relabel},updated_at=@stamp
      FROM (SELECT ${tagSql} AS tag) t WHERE sales.id=@saleId`,
    params: {
      saleId: input.saleId, stamp: input.stamp,
      ...(tagSql === '@tag' ? { tag: input.tag } : {}),
      ...(input.retired ? { retiredStatus: input.retired.saleStatus, retiredDelivery: input.retired.deliveryPending ? 1 : 0 } : {}),
    },
  }
}

/** The word a sale's Records "status" line shows for a state: the return tag when it has one, else the payment state. */
export function saleReturnRecordWord(state: SaleStoredState): string {
  return state.returnState === 'full' ? 'returned' : state.returnState === 'partial' ? 'partial_return' : saleStatusWord(state)
}

type StoredSaleRow = { sale_status?: unknown; status_before_return?: unknown; return_state?: unknown; delivery_pending?: unknown }

/**
 * A create or edit that projected `tag` for a stored sale: null when the tag
 * does not move (nothing is written, no Records line); else the write, the
 * Records words on each side, and the sale_status the row holds afterwards
 * (unchanged unless a retired word was rewritten) for the postcondition.
 */
export function saleReturnTagWrite(sale: StoredSaleRow, tag: SaleReturnState | null, saleId: number, stamp: string): {
  statement: TagStatement; before: string; after: string; saleStatusAfter: string
} | null {
  const stored = saleStoredState(sale)
  if (tag === stored.returnState) return null
  const retired = carriesRetiredReturnLabel(sale)
  return {
    statement: saleReturnTagStatement({ saleId, stamp, tag, retired: retired ? stored : null }),
    before: saleReturnRecordWord(stored),
    after: saleReturnRecordWord({ ...stored, returnState: tag }),
    saleStatusAfter: retired ? stored.saleStatus : String(sale.sale_status || 'completed'),
  }
}
