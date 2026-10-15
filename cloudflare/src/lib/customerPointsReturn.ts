export const LOYALTY_POINTS_RESET_KEY = 'loyalty_points_reset'

type LoyaltyLedger = 'sales' | 'returns' | 'submissions' | 'adjustments'

export function loyaltyAfterResetSql(ledger: LoyaltyLedger, idSql = 'id'): string {
  const reset = `(SELECT value FROM system_flags WHERE key = '${LOYALTY_POINTS_RESET_KEY}')`
  return `${idSql} > COALESCE(json_extract(${reset}, '$.${ledger}'), 0)`
}

export const loyaltySaleSinceSql = loyaltyAfterResetSql('sales')
export const loyaltySubmissionSinceSql = `(${loyaltyAfterResetSql('submissions')} AND loyalty_eligible = 1)`
export const loyaltyAdjustmentSinceSql = loyaltyAfterResetSql('adjustments')

// Refunding a sale whose earnings were cleared must not deduct newly earned points.
export const customerPointsReturnSql = `(COALESCE(return_scope,'customer') <> 'supplier'
  AND ${loyaltyAfterResetSql('returns', 'returns.id')}
  AND NOT EXISTS (SELECT 1 FROM sales points_sale WHERE points_sale.id = returns.sale_id
    AND (COALESCE(points_sale.loyalty_accrual,1) = 0 OR NOT (${loyaltyAfterResetSql('sales', 'points_sale.id')}))))`
