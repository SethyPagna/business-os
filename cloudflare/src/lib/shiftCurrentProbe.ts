import { localTodayExpr } from './businessDateWindow'
import { cashShiftReopenWho, cashShiftVerdict, cashTakenNow, currentShiftState, type CashAmounts, type CashDirection, type CashTenderRow } from './cashShiftRule'
import { isAdminControlUser } from './permissions'
import { parsePaymentMethodKinds } from './paymentMethodRegistry'

/** The "current shift" row for a till: today's business date, the exact branch first, then an All (NULL-branch) shift, newest segment first. */
export function currentShiftBranchSql(column: string, branchParam: string): string {
  return `(${column} IS ${branchParam} OR (${branchParam} IS NOT NULL AND ${column} IS NULL))`
}

export const SHIFT_PROBE_KEY = '__current_shift'

/**
 * The shift policy and the current row for the branch expression, as one JSON text (a scalar subquery; bound param @shiftUserId).
 * currentShiftProbeSql is the arm a settings read the route already makes carries: key '__current_shift', params @shiftBranchId and
 * @shiftUserId. Either way it adds no D1 call and no write.
 * `+s.scope_mode` keeps the planner on idx_shift_sessions_business_date (the readPreviousOpen pattern).
 */
export function currentShiftProbeValueSql(branchExpr: string): string {
  return `(SELECT json_object('scope_mode', p.mode, 'admin_exempt', p.exempt, 'shift', json((
      SELECT json_object('id', s.id, 'user_id', s.user_id, 'user_name', s.user_name, 'branch_id', s.branch_id,
                         'closed', s.closed_at IS NOT NULL, 'cancelled', s.cancelled_at IS NOT NULL)
      FROM shift_sessions s
      WHERE +s.scope_mode = p.mode AND (p.mode = 'shop_wide' OR s.user_id = @shiftUserId)
        AND s.business_date = ${localTodayExpr()}
        AND ${currentShiftBranchSql('s.branch_id', branchExpr)}
      ORDER BY (s.branch_id IS NULL) ASC, s.opened_at DESC, s.id DESC LIMIT 1)))
    FROM (SELECT CASE WHEN (SELECT value FROM settings WHERE key = 'shift_scope_mode') = 'shop_wide' THEN 'shop_wide' ELSE 'per_account' END AS mode,
                 CASE WHEN (SELECT value FROM settings WHERE key = 'shift_admin_exempt') = 'false' THEN 0 ELSE 1 END AS exempt) p)`
}

export function currentShiftProbeSql(): string {
  return `SELECT '${SHIFT_PROBE_KEY}' AS key, ${currentShiftProbeValueSql('@shiftBranchId')} AS value`
}

export type ShiftProbe = {
  scope_mode: 'shop_wide' | 'per_account'
  admin_exempt: boolean
  shift: { id: number; user_id: number | null; user_name: string | null; branch_id: number | null; closed: boolean; cancelled: boolean } | null
}

export function parseShiftProbe(raw: unknown): ShiftProbe | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as { scope_mode?: string; admin_exempt?: unknown; shift?: Record<string, unknown> | null }
    const shift = parsed.shift
    return {
      scope_mode: parsed.scope_mode === 'shop_wide' ? 'shop_wide' : 'per_account',
      admin_exempt: Number(parsed.admin_exempt) !== 0,
      shift: shift ? {
        id: Number(shift.id),
        user_id: shift.user_id == null ? null : Number(shift.user_id),
        user_name: shift.user_name == null ? null : String(shift.user_name),
        branch_id: shift.branch_id == null ? null : Number(shift.branch_id),
        closed: Number(shift.closed) === 1,
        cancelled: Number(shift.cancelled) === 1,
      } : null,
    }
  } catch { return null }
}

/** The cash a replacement sale's tender rows take, judged by the shop's pinned method kinds (the pos_payment_method_kinds setting text). */
export function replacementCashTaken(rows: readonly CashTenderRow[], kindsRaw: unknown): CashAmounts {
  return cashTakenNow([], rows, parsePaymentMethodKinds(kindsRaw))
}

export const CASH_IN_REFUSAL = 'Open a shift to take cash.'
export const CASH_OUT_REFUSAL = 'Open a shift to give cash back.'

/** The 409 body when this event moves cash and the till has no open shift today; null when it may proceed. Writes nothing. */
export function cashShiftRefusal(input: {
  probe: ShiftProbe | null
  user: Parameters<typeof isAdminControlUser>[0]
  cash: CashAmounts
  branchId: number | null
  direction?: CashDirection
}): Record<string, unknown> | null {
  const probe = input.probe
  const exempt = (probe ? probe.admin_exempt : true) && isAdminControlUser(input.user)
  const state = currentShiftState(probe?.shift)
  const direction = input.direction ?? 'in'
  const verdict = cashShiftVerdict({ cash: input.cash, exempt, state, direction })
  if (verdict.allowed) return null
  const userId = (input.user as { id?: unknown }).id
  const canReopen = state === 'closed' && (isAdminControlUser(input.user) || (probe?.shift?.user_id != null && probe.shift.user_id === Number(userId)))
  return {
    error: direction === 'out' ? CASH_OUT_REFUSAL : CASH_IN_REFUSAL,
    code: verdict.code,
    shift_state: verdict.shift_state,
    direction,
    branch_id: input.branchId,
    opener_name: probe?.shift?.user_name ?? null,
    can_reopen: canReopen,
    who: cashShiftReopenWho(verdict.shift_state, canReopen),
  }
}
