export const LOYALTY_DISABLED_CODE = 'loyalty_points_disabled'

export function loyaltyPointsEnabled(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

export const loyaltyEnabledSql = `(lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on'))`

export function loyaltyAccrualSql(requested = '1'): string {
  return `CASE WHEN ${loyaltyEnabledSql} AND (${requested}) = 1 THEN 1 ELSE 0 END`
}
