// N2 (loophole review 2026-10-06): a sale is rung inside the cashier's OPEN
// shift for today. The POS prompt (frontend ShiftGate) lived only in the
// browser, so POST /api/sales recorded a sale with no shift at all, or after
// End Shift -- cash that no drawer reconciliation expects, because the drawer
// counts only sales inside a shift's window (lib/salesAnalytics.ts
// shiftWindowWhere).
//
// "Today's shift" is exactly the row GET /api/shifts/current answers
// (routes/shifts.ts readCurrent): the latest row for this business day in
// the policy's scope -- the cashier's own under per_account, the shop's under
// shop_wide. A shift registered without a branch also covers the sale's
// branch. That row must be neither cancelled (the till's needs_registration)
// nor closed (End Shift; the owner can reopen it from Shift history).
//
// Exempt: an administrator while Settings exempts administrators, the same
// `admin_exempt && isAdminControlUser` /current uses. The till mirrors the
// rule in frontend/src/utils/saleShiftRequirement.ts.
//
// Offline mode is retired (26 Sep 2026). The one-time manual recovery of a
// sale queued before then goes through this same route and needs the open
// shift of the cashier recovering it; with N3 that sale is recorded at the
// server's time, inside that shift.
import type { D1Compat } from './db'
import { localTodayExpr } from './businessDateWindow'

export const SALE_SHIFT_REQUIRED_CODE = 'sale_shift_required'
export const SALE_SHIFT_CLOSED_CODE = 'sale_shift_closed'
export const SALE_SHIFT_MESSAGES = {
  [SALE_SHIFT_REQUIRED_CODE]: "Register today's opening cash before recording a sale. Nothing was recorded.",
  [SALE_SHIFT_CLOSED_CODE]: 'Your shift has ended. Reopen it from Shift history before recording a sale. Nothing was recorded.',
} as const
export type SaleShiftBlockCode = keyof typeof SALE_SHIFT_MESSAGES

export type SaleShiftScope = { scopeMode: 'per_account' | 'shop_wide'; userId: number; branchId: number }

function latestTodayShiftSql(): string {
  return `SELECT closed_at, cancelled_at FROM shift_sessions
    WHERE scope_mode = @shiftScope
      AND (@shiftScope = 'shop_wide' OR user_id = @shiftUserId)
      AND business_date = ${localTodayExpr()}
      AND (branch_id IS NULL OR branch_id = @shiftBranchId)
    ORDER BY opened_at DESC, id DESC LIMIT 1`
}
function scopeParams(scope: SaleShiftScope) {
  return { shiftScope: scope.scopeMode, shiftUserId: scope.userId, shiftBranchId: scope.branchId }
}

/** Preflight: why this sale cannot be recorded now, or null when it can. */
export async function readSaleShiftBlock(db: D1Compat, scope: SaleShiftScope): Promise<SaleShiftBlockCode | null> {
  const row = await db.prepare(latestTodayShiftSql()).get<{ closed_at: string | null; cancelled_at: string | null }>(scopeParams(scope))
  if (!row || row.cancelled_at) return SALE_SHIFT_REQUIRED_CODE
  return row.closed_at ? SALE_SHIFT_CLOSED_CODE : null
}

/** The same rule inside the sale's write batch, so an End Shift that lands
 * between the preflight and the write still refuses the sale. */
export function saleShiftGuardStatement(scope: SaleShiftScope): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `SELECT CASE WHEN EXISTS (
            SELECT 1 FROM (${latestTodayShiftSql()}) latest
            WHERE latest.cancelled_at IS NULL AND latest.closed_at IS NULL
          ) THEN 1 ELSE json_extract('sale_shift_guard', '$') END`,
    params: scopeParams(scope),
  }
}
