import { localTodayExpr } from './businessDateWindow'
import { cashShiftReopenWho, cashShiftVerdict, cashTakenNow, currentShiftState, type CashAmounts, type CashDirection, type CashTenderRow } from './cashShiftRule'
import { hasAnyPermission, isAdminControlUser } from './permissions'
import { parsePaymentMethodKinds, type PaymentMethodKindMap } from './paymentMethodRegistry'

/** The "current shift" row for a till: today's business date, the exact branch first, then an All (NULL-branch) shift, newest segment first. */
export function currentShiftBranchSql(column: string, branchParam: string): string {
  return `(${column} IS ${branchParam} OR (${branchParam} IS NOT NULL AND ${column} IS NULL))`
}

export const SHIFT_PROBE_KEY = '__current_shift'

/**
 * The branch whose till takes the cash: a retired branch's active successor (the POS "Switch to <successor>"), else the branch itself.
 * A retired branch with no active successor stays itself, so only an All shift can cover it.
 */
function tillBranchSql(branchExpr: string): string {
  return `COALESCE((SELECT successor.id FROM branches retired JOIN branches successor ON successor.id = retired.successor_branch_id AND successor.is_active = 1
    WHERE retired.id = ${branchExpr} AND retired.is_active = 0), ${branchExpr})`
}

/** The two probe columns a branch-directory read carries: the row's own branch and the All (no branch) till. Bound param @shiftUserId. */
export function branchCashShiftColumnsSql(): string {
  return `${currentShiftProbeValueSql('branches.id')} AS cash_shift, ${currentShiftProbeValueSql('NULL')} AS cash_shift_all`
}

/** The probe for a return's branch. No branch, or a branch the directory does not know, is judged against the All shift and the policy: never skipped. */
export function pickCashShiftProbe(rows: ReadonlyArray<{ id?: unknown; cash_shift?: unknown; cash_shift_all?: unknown }>, branchId: number | null): ShiftProbe | null {
  const own = branchId == null ? undefined : rows.find((row) => Number(row.id) === Number(branchId))
  return parseShiftProbe(own ? own.cash_shift : rows[0]?.cash_shift_all)
}

/**
 * The shift policy and the current row for the branch expression, as one JSON text (a scalar subquery; bound param @shiftUserId).
 * currentShiftProbeSql is the arm a settings read the route already makes carries: key '__current_shift', params @shiftBranchId and
 * @shiftUserId. Either way it adds no D1 call and no write.
 * `+s.scope_mode` keeps the planner on idx_shift_sessions_business_date (the readPreviousOpen pattern).
 */
export function currentShiftProbeValueSql(addressedBranchExpr: string): string {
  const branchExpr = tillBranchSql(addressedBranchExpr)
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

/**
 * The tender a sale already holds, read the way planSaleSettlement reads it: the stored payment_details rows, else (imported sales)
 * one row built from the paid totals and the single method token. Lenient: the plan has already refused unreadable data.
 */
export function recordedTenderRows(input: { paymentDetailsRaw: unknown; paidUsd: unknown; paidKhr: unknown; paymentMethodRaw: unknown }): CashTenderRow[] {
  let details: unknown = input.paymentDetailsRaw
  if (typeof details === 'string') { try { details = JSON.parse(details) } catch { details = [] } }
  if (Array.isArray(details) && details.length) return details.filter((row) => row && typeof row === 'object' && !Array.isArray(row)) as CashTenderRow[]
  const tokens = String(input.paymentMethodRaw ?? '').split('+').map((part) => part.trim()).filter(Boolean)
  const usd = Number(input.paidUsd) || 0
  const khr = Number(input.paidKhr) || 0
  return tokens.length === 1 && (usd !== 0 || khr !== 0) ? [{ method: tokens[0], amount_usd: usd, amount_khr: khr }] : []
}

/**
 * The cash a settlement or payment correction takes in. A correction replaces the whole tender, so it counts only when the tender
 * GREW (a total that grew after a reopen): relabelling money already taken records no new cash and is never refused.
 */
export function settlementCashTaken(input: {
  before: readonly CashTenderRow[]
  after: readonly CashTenderRow[]
  kinds: PaymentMethodKindMap
  correction: boolean
  paidBeforeUsd: unknown; paidBeforeKhr: unknown; paidAfterUsd: unknown; paidAfterKhr: unknown
  exchangeRate: number
}): CashAmounts {
  if (input.correction) {
    const rate = Number(input.exchangeRate) > 0 ? Number(input.exchangeRate) : 4000
    const worth = (usd: unknown, khr: unknown) => (Number(usd) || 0) + (Number(khr) || 0) / rate
    if (!(worth(input.paidAfterUsd, input.paidAfterKhr) - worth(input.paidBeforeUsd, input.paidBeforeKhr) > 0.0001)) return { usd: 0, khr: 0 }
  }
  return cashTakenNow(input.before, input.after, input.kinds)
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
    opener_name: hasAnyPermission(input.user as Parameters<typeof hasAnyPermission>[0], ['pos', 'sales']) ? probe?.shift?.user_name ?? null : null,
    can_reopen: canReopen,
    who: cashShiftReopenWho(verdict.shift_state, canReopen),
  }
}

/**
 * An exchange touches the drawer twice: cash the customer hands over (in) and cash change the customer takes back (out).
 * The refund credit is netted, so only a real change above zero moves cash out. Both need today's open shift; the first refusal wins.
 */
export function exchangeCashShiftRefusal(input: {
  probe: ShiftProbe | null
  user: Parameters<typeof isAdminControlUser>[0]
  details: readonly CashTenderRow[]
  kinds: PaymentMethodKindMap
  change: { changeUsd: number; changeKhr: number }
  branchId: number | null
}): Record<string, unknown> | null {
  const base = { probe: input.probe, user: input.user, branchId: input.branchId }
  const cashIn = cashShiftRefusal({ ...base, cash: cashTakenNow([], input.details, input.kinds) })
  if (cashIn) return cashIn
  return cashShiftRefusal({
    ...base, cash: { usd: Math.max(0, Number(input.change.changeUsd) || 0), khr: Math.max(0, Number(input.change.changeKhr) || 0) }, direction: 'out',
  })
}
