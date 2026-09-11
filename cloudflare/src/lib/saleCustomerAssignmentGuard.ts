import type { D1Compat } from './db'
import { SaleBulkError } from './saleBulkStatus'
import type { StockStatement } from './saleTransitions'

export const LOYALTY_REASSIGNMENT_CODE = 'loyalty_reassignment_requires_reconciliation'
export const LOYALTY_REASSIGNMENT_MESSAGE = 'Customer reassignment would leave insufficient membership points or incompatible loyalty records. Reconcile the loyalty balances first; no sale or points were changed.'

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

export function isLoyaltyAssignmentError(error: unknown): boolean {
  return String(error).includes(LOYALTY_REASSIGNMENT_CODE) || String(error).includes(LOYALTY_REASSIGNMENT_MESSAGE)
}

const POINT_SETTINGS = ['customer_portal_points_basis', 'customer_portal_points_per_usd', 'customer_portal_points_per_khr', 'exchange_rate', 'loyalty_points_enabled']
const settingsSql = POINT_SETTINGS.map(key => `'${key}'`).join(',')
type PointsConfig = { basis: 'usd' | 'khr'; usd: number; khr: number; enabled: boolean; snapshot: string }
export type CustomerAssignmentMove = { id: number; sourceId: number | null; targetId: number | null }

async function pointsConfig(db: D1Compat): Promise<PointsConfig> {
  const rows = await db.prepare(`SELECT key,value FROM settings WHERE key IN (${settingsSql}) ORDER BY key`).all<{ key: string; value: string | null }>()
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]))
  // Exact buildPortalConfig/toNumber semantics, including explicit zero and
  // explicit KHR rate. Never derive the loyalty rate from a client's FX rate.
  const number = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback
  const usd = number(values.customer_portal_points_per_usd, 1)
  const exchange = number(values.exchange_rate, 4100)
  const khr = number(values.customer_portal_points_per_khr, usd > 0 && exchange > 0 ? usd / exchange : 0)
  return {
    basis: String(values.customer_portal_points_basis || '').toLowerCase() === 'khr' ? 'khr' : 'usd',
    usd: Math.max(0, usd), khr: Math.max(0, khr),
    enabled: values.loyalty_points_enabled == null || ['1', 'true', 'yes', 'on'].includes(String(values.loyalty_points_enabled).trim().toLowerCase()),
    snapshot: JSON.stringify(rows.map(row => [row.key, row.value])),
  }
}

// One authoritative unclamped formula shared by reassignment and checkout.
// Do not round individual ledger entries: portal rounds only its final output.
function rawPointsSql(accountSql: string): string {
  return `(COALESCE((SELECT SUM(CASE WHEN COALESCE(NULLIF(sale_status,''),'completed') NOT IN ('cancelled','awaiting_payment') THEN
    CASE WHEN COALESCE(loyalty_accrual,1)=1 THEN CASE WHEN cfg.basis='khr' THEN COALESCE(total_khr,0)*cfg.khr ELSE COALESCE(total_usd,0)*cfg.usd END ELSE 0 END
    - COALESCE(membership_points_redeemed,0) ELSE 0 END) FROM sales WHERE customer_id=${accountSql}),0)
    - COALESCE((SELECT SUM(CASE WHEN COALESCE(NULLIF(status,''),'completed')<>'cancelled' THEN CASE WHEN cfg.basis='khr' THEN COALESCE(total_refund_khr,0)*cfg.khr ELSE COALESCE(total_refund_usd,0)*cfg.usd END ELSE 0 END) FROM returns WHERE customer_id=${accountSql}),0)
    + COALESCE((SELECT SUM(reward_points) FROM customer_share_submissions WHERE customer_id=${accountSql} AND status='approved' AND reward_points_voided_at IS NULL),0)
    + COALESCE((SELECT SUM(points) FROM loyalty_point_adjustments WHERE customer_id=${accountSql} AND voided_at IS NULL),0))`
}

function configCte(): string {
  return `cfg AS (SELECT @basis AS basis,@usd AS usd,@khr AS khr),
    expected_settings AS (SELECT json_extract(value,'$[0]') AS key,json_extract(value,'$[1]') AS value FROM json_each(@settings)),
    actual_settings AS (SELECT key,value FROM settings WHERE key IN (${settingsSql}))`
}
const settingsMatch = `NOT EXISTS(SELECT key,value FROM actual_settings EXCEPT SELECT key,value FROM expected_settings)
  AND NOT EXISTS(SELECT key,value FROM expected_settings EXCEPT SELECT key,value FROM actual_settings)`
function configParams(config: PointsConfig) {
  return { basis: config.basis, usd: config.usd, khr: config.khr, settings: config.snapshot }
}

export async function readCustomerPointsRaw(db: D1Compat, customerId: number): Promise<number> {
  const config = await pointsConfig(db)
  const row = await db.prepare(`WITH ${configCte()} SELECT ${rawPointsSql('@customer')} AS raw FROM cfg`)
    .get<{ raw: number }>({ ...configParams(config), customer: customerId })
  return Number(row?.raw ?? 0)
}
function asserting(sql: string, params: Record<string, unknown>): StockStatement {
  return { sql: `SELECT CASE WHEN (${sql}) THEN 1 ELSE json_extract('${LOYALTY_REASSIGNMENT_CODE}','$') END`, params }
}

export async function prepareCustomerAssignments(db: D1Compat, input: CustomerAssignmentMove[]) {
  const moves = input.filter(move => move.sourceId !== move.targetId)
  if (!moves.length) return null
  if (moves.length > 25 || new Set(moves.map(move => move.id)).size !== moves.length) throw new SaleBulkError('Select fewer unique sales for customer reassignment.', 400)
  const config = await pointsConfig(db)
  const accounts = [...new Set(moves.flatMap(move => [move.sourceId, move.targetId]).filter((id): id is number => id !== null))]
  const cte = `WITH ${configCte()},
    moves AS (SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.sourceId') AS source_id,json_extract(value,'$.targetId') AS target_id FROM json_each(@moves)),
    accounts AS (SELECT value AS id FROM json_each(@accounts)),
    balances AS (SELECT accounts.id,${rawPointsSql('accounts.id')} AS raw FROM accounts CROSS JOIN cfg)`
  const params = { ...configParams(config), moves: JSON.stringify(moves), accounts: JSON.stringify(accounts) }
  const nonnegative = `NOT EXISTS(SELECT 1 FROM balances WHERE raw IS NULL OR raw < -0.0000001)`
  const predicate = `${settingsMatch} AND ${nonnegative}
    AND NOT EXISTS(SELECT 1 FROM accounts a LEFT JOIN customers c ON c.id=a.id WHERE c.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM moves m LEFT JOIN sales s ON s.id=m.id WHERE s.id IS NULL OR s.customer_id IS NOT m.source_id
      OR (COALESCE(s.membership_points_redeemed,0)<>0 AND (m.source_id IS NULL OR m.target_id IS NULL
        OR EXISTS(SELECT 1 FROM customers c WHERE c.id IN (m.source_id,m.target_id) AND COALESCE(c.is_anonymous,0)<>0))))
    AND NOT EXISTS(SELECT 1 FROM moves m JOIN returns r ON r.sale_id=m.id WHERE r.customer_id IS NOT m.source_id)
    AND NOT EXISTS(SELECT 1 FROM moves m JOIN sales s ON s.id=m.id GROUP BY m.target_id
      HAVING SUM(COALESCE(s.membership_points_redeemed,0)) > COALESCE((SELECT raw FROM balances WHERE id=m.target_id),0)+0.0000001)`
  const preQuery = `${cte} SELECT CASE WHEN ${predicate} THEN 1 ELSE 0 END AS ok`
  if (!(await db.prepare(preQuery).get<{ ok: number }>(params))?.ok) throw new SaleBulkError(LOYALTY_REASSIGNMENT_MESSAGE, 409)
  // After the actual writes, re-read these SAME accounts. This catches earned
  // points already spent without approximating a grouped transfer delta.
  return {
    pre: asserting(preQuery, params),
    post: asserting(`${cte} SELECT CASE WHEN ${settingsMatch} AND ${nonnegative} THEN 1 ELSE 0 END`, params),
  }
}

export async function preparePointsRedemption(db: D1Compat, customerId: number, points: number) {
  const config = await pointsConfig(db)
  const params = { ...configParams(config), customer: customerId, points, enabled: config.enabled ? 1 : 0 }
  const query = `WITH ${configCte()}, balance AS (SELECT ${rawPointsSql('@customer')} AS raw FROM cfg)
    SELECT CASE WHEN ${settingsMatch} AND @enabled=1
      AND EXISTS(SELECT 1 FROM customers WHERE id=@customer AND COALESCE(is_anonymous,0)=0)
      AND (SELECT raw FROM balance)>=@points-0.0000001 THEN 1 ELSE 0 END AS ok`
  if (!(await db.prepare(query).get<{ ok: number }>(params))?.ok) throw new SaleBulkError('Insufficient membership points or loyalty settings changed. No sale was recorded.', 409)
  return asserting(query, params)
}
