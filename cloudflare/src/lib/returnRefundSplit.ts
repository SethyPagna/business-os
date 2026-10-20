// The money half of a customer return (owner rulings 29 Sep, 5-6 Oct 2026;
// migration 0260): a return first lowers what the customer still owes on the
// sale, and only the part above that debt is cash refunded -- in the currency
// the till paid it in. total_refund_usd stays the return value (revenue);
// owed_reduction_usd is the debt part, the rest left a drawer.
//   $10 Not Paid, $3 paid, $4 back -> owes $3, cash refund $0
//   $10 Not Paid, $7 paid, $4 back -> owes $0, cash refund $1
import type { D1Compat } from './db'
import { roundMoney2, roundMoney4, subtractMoney4 } from './moneyPrecision'
import { NOT_PAID_STATUS, recordedSaleOutstandingUsd, saleReadsNotPaid, sumRefundsUsd, type RecordedSaleMoney } from './saleStatusResolution'
import { RETURN_STATUSES } from './salesStatus'

export class ReturnMoneyError extends Error {
  readonly code = 'customer_return_owed_unreadable'
  constructor() {
    super('The sale money cannot be read, so the debt this return lowers is unknown.')
  }
}

// A row recorded before 0260 (refund_currency NULL) reads as 6.0.872 read it:
// its whole refund lowered a Not Paid sale's debt, and its whole refund was
// dollar cash. Held 0238 rewrites those rows; until then both readings stand.
export function returnDebtLoweredSql(alias: string): string {
  return `(CASE WHEN ${alias}.refund_currency IS NULL THEN COALESCE(${alias}.total_refund_usd, 0) ELSE COALESCE(${alias}.owed_reduction_usd, 0) END)`
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

/** The payment state a sale holds beside any return ribbon. */
export function salePaymentState(sale: { sale_status?: unknown; status_before_return?: unknown }): string {
  const status = String(sale.sale_status || 'completed')
  return RETURN_STATUSES.has(status) ? String(sale.status_before_return || 'completed') : status
}

export type PlannedReturn = { id: number; active: boolean; refundUsd: unknown; owedReductionUsd: unknown; currency: unknown }
export type ReturnMoneyPlan = {
  /** The owed reduction to store on each recomputed return. */
  owedReductionUsd: Map<number, number>
  /**
   * The sale's payment state once these returns stand: Not Paid while it
   * still owes; a Not Paid sale reads paid once a return pays cash out (its
   * debt is cleared and the shop paid the excess back). A return that only
   * clears the debt moves no money, so the sale stays as it was ($0 owed)
   * until it is marked paid.
   */
  paymentState: string
}

const debtLowered = (row: PlannedReturn): number => row.currency == null ? finite(row.refundUsd) : finite(row.owedReductionUsd)

/**
 * Splits the `recompute` returns (in order; each one active and recorded in a
 * currency) into debt lowered and cash, against the sale's debt after every
 * other active return. A sale carries a debt while it reads Not Paid or once a
 * return lowered one -- a sale paid at the counter (or imported without
 * tender) never does, so its returns stay all cash and its status untouched.
 */
export function planReturnMoney(input: { sale: SaleReturnMoney['sale']; returns: readonly PlannedReturn[]; recompute: readonly number[] }): ReturnMoneyPlan {
  const owedReductionUsd = new Map<number, number>()
  const current = salePaymentState(input.sale)
  const carriesDebt = saleReadsNotPaid(input.sale) || input.returns.some(row => finite(row.owedReductionUsd) > 0)
  if (!carriesDebt) {
    for (const id of input.recompute) owedReductionUsd.set(id, 0)
    return { owedReductionUsd, paymentState: current }
  }
  const lowered = new Map(input.returns.filter(row => row.active && !input.recompute.includes(row.id)).map(row => [row.id, debtLowered(row)]))
  const owed = () => {
    try {
      return recordedSaleOutstandingUsd({ ...input.sale, refund_usd: sumRefundsUsd([...lowered.values()]) })
    } catch {
      throw new ReturnMoneyError()
    }
  }
  let paysCash = false
  for (const id of input.recompute) {
    const row = input.returns.find(candidate => candidate.id === id)
    if (!row || !row.active) continue
    const refund = roundMoney4(finite(row.refundUsd))
    const reduction = Math.max(0, Math.min(refund, roundMoney2(owed())))
    owedReductionUsd.set(id, reduction)
    lowered.set(id, reduction)
    if (refund > reduction) paysCash = true
  }
  if (owed() > 0) return { owedReductionUsd, paymentState: NOT_PAID_STATUS }
  return { owedReductionUsd, paymentState: current === NOT_PAID_STATUS && paysCash ? 'completed' : current }
}

/** Cash part of a split refund, for a refusal or a message. */
export function refundCashUsd(refundUsd: unknown, owedReductionUsd: number): number {
  return subtractMoney4(roundMoney4(finite(refundUsd)), owedReductionUsd)
}
