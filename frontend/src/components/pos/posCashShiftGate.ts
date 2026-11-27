import { cashShiftRefusalText, type CashShiftRefusalOptions } from '../../api/saleSubmitErrors.ts'
import { cashTakenNow, currentShiftState, hasCashAmount, type CashDirection, type CashShiftState, type CashTenderRow } from '../../utils/cashShiftRule.ts'
import type { PaymentMethodKindMap } from '../../utils/paymentMethodKind.ts'

/** What the till already knows about today's shift: the GET /api/shifts/current answer, trimmed to what the pre-check reads. */
export type PosShiftFacts = {
  exempt?: boolean
  is_open?: boolean
  needs_registration?: boolean
  branch_inactive?: unknown
  shift?: {
    branch_id?: number | null
    user_name?: string | null
    closed_at?: string | null
    cancelled_at?: string | null
    capabilities?: { can_reopen?: boolean }
  } | null
}

export type CashShiftReopenAction = 'open' | 'reopen' | 'ask_reopen'

export type PosCashShiftGate =
  | { kind: 'pass' }
  | { kind: 'ask_worker' }
  | { kind: 'block'; shiftState: Exclude<CashShiftState, 'open'>; action: CashShiftReopenAction; openerName: string | null }

/**
 * Pass, block or ask the Worker: may this tender take cash now? The Worker is the judge (it reads the same row); this only lets the
 * cashier see the reason before Complete. It blocks only when it can prove the refusal: the till's shift row is on the sale's own
 * branch and is not open. An unread shift, the All branch filter, a mixed-branch cart or a retired branch are left to the Worker.
 */
export function posCashShiftGate(
  state: PosShiftFacts | null | undefined,
  gateBranchId: number | null,
  saleBranchId: number | null,
  rows: readonly CashTenderRow[],
  kinds: PaymentMethodKindMap,
): PosCashShiftGate {
  if (!hasCashAmount(cashTakenNow([], rows, kinds))) return { kind: 'pass' }
  if (!state) return { kind: 'ask_worker' }
  if (state.exempt === true) return { kind: 'pass' }
  if (state.branch_inactive) return { kind: 'ask_worker' }
  const row = state.shift ?? null
  const shiftState = currentShiftState(row ? { closed: !!row.closed_at, cancelled: !!row.cancelled_at } : null)
  if (shiftState === 'open') {
    if (row?.branch_id == null || (saleBranchId != null && Number(row.branch_id) === saleBranchId)) return { kind: 'pass' }
    return { kind: 'ask_worker' }
  }
  if (gateBranchId == null || saleBranchId == null || gateBranchId !== saleBranchId) return { kind: 'ask_worker' }
  const action: CashShiftReopenAction = shiftState === 'closed' ? (row?.capabilities?.can_reopen === true ? 'reopen' : 'ask_reopen') : 'open'
  return { kind: 'block', shiftState, action, openerName: row?.user_name ?? null }
}

/** The pack sentence beside a blocked cash action: what is missing, then who may reopen a closed shift. */
export function cashShiftNoteText(gate: Extract<PosCashShiftGate, { kind: 'block' }>, direction: CashDirection, t: (key: string) => string | undefined, options: CashShiftRefusalOptions = {}): string {
  return cashShiftRefusalText({ shift_state: gate.shiftState, direction, who: gate.action, opener_name: gate.openerName }, t, options) ?? ''
}
