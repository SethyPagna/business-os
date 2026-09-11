import type { D1Compat } from './db'
import { SaleBulkError } from './saleBulkStatus'
import type { StockStatement } from './saleTransitions'

export const LOYALTY_REASSIGNMENT_CODE = 'loyalty_reassignment_requires_reconciliation'
export const LOYALTY_REASSIGNMENT_MESSAGE = 'This sale affects membership points. Customer reassignment requires loyalty reconciliation; no sale or points were changed.'

// Points are derived from the current sale/return customer, not a transfer
// ledger. Even a cancelled/pending sale may activate its stored points later.
// Fail closed independently of mutable programme rates rather than inventing
// an award, discarding a redemption, or relying on a clamped balance.
export function loyaltyAffectingSaleSql(alias = 's'): string {
  return `(COALESCE(${alias}.membership_points_redeemed,0)<>0
    OR (COALESCE(${alias}.loyalty_accrual,1)=1 AND (COALESCE(${alias}.total_usd,0)<>0 OR COALESCE(${alias}.total_khr,0)<>0))
    OR EXISTS(SELECT 1 FROM returns loyalty_return WHERE loyalty_return.sale_id=${alias}.id
      AND (COALESCE(loyalty_return.total_refund_usd,0)<>0 OR COALESCE(loyalty_return.total_refund_khr,0)<>0)))`
}

export function customerAssignmentGuard(saleId: number, targetId: number | null): StockStatement {
  return {
    sql: `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=@id
      AND s.customer_id IS NOT @target AND ${loyaltyAffectingSaleSql()})
      THEN 1 ELSE json_extract('${LOYALTY_REASSIGNMENT_CODE}', '$') END`,
    params: { id: saleId, target: targetId },
  }
}

export async function assertCustomerAssignmentSafe(db: D1Compat, saleId: number, targetId: number | null): Promise<void> {
  const blocked = await db.prepare(`SELECT 1 AS blocked FROM sales s WHERE s.id=@id
    AND s.customer_id IS NOT @target AND ${loyaltyAffectingSaleSql()}`).get({ id: saleId, target: targetId })
  if (blocked) throw new SaleBulkError(LOYALTY_REASSIGNMENT_MESSAGE, 409)
}

export function isLoyaltyAssignmentError(error: unknown): boolean {
  return String(error).includes(LOYALTY_REASSIGNMENT_CODE) || String(error).includes(LOYALTY_REASSIGNMENT_MESSAGE)
}
