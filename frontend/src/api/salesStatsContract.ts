export interface SalesStatsResult extends Record<string, unknown> {
  total_count: number
  revenue_count: number
  revenue_usd: number
  pending_revenue_usd: number
  revenue_without_not_paid_usd?: number | null
  not_paid_owed_usd?: number
  truncated_in_list: boolean
}

export function requireSalesStatsResult(value: unknown): SalesStatsResult {
  const fail = (): never => {
    throw Object.assign(new Error('Invalid sales statistics response'), { code: 'invalid_sales_stats_response' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const row = value as Record<string, unknown>
  if (row.success === false) return fail()
  for (const key of ['total_count', 'revenue_count']) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return fail()
  }
  for (const key of ['revenue_usd', 'pending_revenue_usd']) {
    if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) return fail()
  }
  if (typeof row.truncated_in_list !== 'boolean') return fail()
  const paidOnly = row.revenue_without_not_paid_usd
  if (paidOnly !== undefined && paidOnly !== null && (typeof paidOnly !== 'number' || !Number.isFinite(paidOnly))) return fail()
  const owed = row.not_paid_owed_usd
  if (owed !== undefined && (typeof owed !== 'number' || !Number.isFinite(owed))) return fail()
  return value as SalesStatsResult
}
