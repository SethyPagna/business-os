import { isCashPaymentMethod, type PaymentMethodKindMap } from './paymentMethodRegistry'

export type CashTenderRow = { method?: unknown; amount_usd?: unknown; amount_khr?: unknown; refund_credit?: unknown }
export type CashAmounts = { usd: number; khr: number }
export type CashShiftState = 'open' | 'closed' | 'cancelled' | 'none'
export type CashDirection = 'in' | 'out'
export type CashShiftRowFacts = { closed?: unknown; cancelled?: unknown } | null | undefined
export type CashShiftReopenWho = 'open' | 'reopen' | 'ask_reopen'
export type CashShiftVerdict =
  | { allowed: true }
  | { allowed: false; code: 'shift_required_for_cash'; shift_state: Exclude<CashShiftState, 'open'>; direction: CashDirection }

const CASH_SHIFT_REFUSAL_CODE = 'shift_required_for_cash'

function cashSums(rows: readonly CashTenderRow[], kinds: PaymentMethodKindMap): CashAmounts {
  let usd = 0
  let khr = 0
  for (const row of rows) {
    if (row.refund_credit === true || !isCashPaymentMethod(row.method, kinds)) continue
    const rowUsd = Number(row.amount_usd)
    const rowKhr = Number(row.amount_khr)
    if (Number.isFinite(rowUsd) && rowUsd > 0) usd += rowUsd
    if (Number.isFinite(rowKhr) && rowKhr > 0) khr += rowKhr
  }
  return { usd, khr }
}

/** Cash that goes into the drawer by this event: cash rows after the event minus the cash rows it already held, per currency. */
export function cashTakenNow(beforeRows: readonly CashTenderRow[], afterRows: readonly CashTenderRow[], kinds: PaymentMethodKindMap = {}): CashAmounts {
  const before = cashSums(beforeRows, kinds)
  const after = cashSums(afterRows, kinds)
  return {
    usd: Math.max(0, Math.round((after.usd - before.usd) * 10000) / 10000),
    khr: Math.max(0, Math.round(after.khr - before.khr)),
  }
}

export function hasCashAmount(cash: CashAmounts): boolean {
  return cash.usd > 0 || cash.khr > 0
}

export function currentShiftState(row: CashShiftRowFacts): CashShiftState {
  if (!row) return 'none'
  if (row.cancelled) return 'cancelled'
  if (row.closed) return 'closed'
  return 'open'
}

export function cashShiftVerdict(input: { cash: CashAmounts; exempt: boolean; state: CashShiftState; direction?: CashDirection }): CashShiftVerdict {
  if (!hasCashAmount(input.cash) || input.exempt || input.state === 'open') return { allowed: true }
  return { allowed: false, code: CASH_SHIFT_REFUSAL_CODE, shift_state: input.state, direction: input.direction ?? 'in' }
}

/** What the till offers when cash is refused: open a shift, reopen today's closed one, or ask the opener or an administrator (owner, 27 Nov 2026). */
export function cashShiftReopenWho(state: CashShiftState, canReopen: boolean): CashShiftReopenWho | null {
  if (state === 'open') return null
  if (state === 'closed') return canReopen ? 'reopen' : 'ask_reopen'
  return 'open'
}
