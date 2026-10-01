import type { Env } from '../index'
import { beginMaintenance, endMaintenance, updateMaintenance } from './maintenance'
import { hasPermission } from './permissions'
import { canViewAcquisitionCosts } from './acquisitionCostAccess'

export const STOCK_RECOVERY_TABLES = [
  'stock_disposition_sources', 'stock_disposition_allocations', 'stock_disposition_events',
  'stock_disposition_fees', 'stock_disposition_receipts', 'stock_funding_invoice_openings',
  'stock_funding_sources', 'stock_funding_claims', 'stock_funding_events', 'stock_funding_receipts',
  'stock_valuation_sources', 'stock_valuation_events', 'stock_valuation_segments',
  'stock_valuation_agreements', 'stock_valuation_acceptances', 'stock_valuation_receipts',
] as const

type Fence = { token: string; actorId?: number; destructive: boolean; raw: Env; unwrap: (row: D1PreparedStatement) => D1PreparedStatement }
const fences = new WeakMap<object, Fence>()
const sourceTables = new Set(['stock_disposition_sources', 'stock_funding_sources', 'stock_valuation_sources'])

function ownerGuard(token: string, actor?: { id: number; snapshot: string }) {
  const actorClause = actor ? ` AND EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id
    WHERE u.id=? AND u.is_active=1 AND u.deleted_at IS NULL
    AND json_array(u.username,u.permissions,u.role_id,r.code,r.permissions)=?)` : ''
  return {
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance'
      AND json_extract(value,'$.token')=?)${actorClause}
      THEN 1 ELSE json_extract('[1]','$[stock_recovery_owner_changed]') END`,
    params: actor ? [token, actor.id, actor.snapshot] : [token],
  }
}

export async function withStockRecoveryFence<T>(env: Env, key: string, run: (guarded: Env) => Promise<T>, options: { token?: string; actorId?: number; requiredPermission?: string; requireCostView?: boolean } = {}): Promise<T> {
  const existing = fences.get(env)
  if (existing) {
    if (options.token && options.token !== existing.token || options.actorId && options.actorId !== existing.actorId) throw new Error('Stock recovery owner changed.')
    return run(env)
  }
  const owned = !options.token
  const state = owned ? await beginMaintenance(env, { backupKey: key, startedBy: options.actorId ? String(options.actorId) : 'backup-recovery' }) : null
  const token = options.token || state!.token
  let actor: { id: number; snapshot: string } | undefined
  if (options.actorId) {
    const row = await env.DB.prepare(`SELECT json_array(u.username,u.permissions,u.role_id,r.code,r.permissions) snapshot,
      u.permissions,r.code role_code,r.permissions role_permissions
      FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.is_active=1 AND u.deleted_at IS NULL`).bind(options.actorId).first<{ snapshot: string; permissions: string; role_code: string; role_permissions: string }>()
    if (!row || options.requiredPermission && !hasPermission(row, options.requiredPermission) || options.requireCostView && !canViewAcquisitionCosts(row)) { if (owned) await endMaintenance(env, token); throw new Error('Stock recovery actor is no longer authorized.') }
    actor = { id: options.actorId, snapshot: row.snapshot }
  }
  const guard = () => { const item = ownerGuard(token, actor); return env.DB.prepare(item.sql).bind(...item.params) }
  const fence: Fence = { token, actorId: options.actorId, destructive: false, raw: env, unwrap: row => row }
  const batch = async <T = unknown>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    const result = await env.DB.batch<T>([...items, guard()])
    if (result.some(item => !(item as { success: boolean }).success)) throw new Error('Stock recovery database batch failed.')
    return result.slice(0, items.length)
  }
  function wrap(sql: string, statement: D1PreparedStatement): D1PreparedStatement {
    const execute = async () => {
      if (/^\s*(DELETE|DROP)\b/i.test(sql) && !/system_flags/i.test(sql)) fence.destructive = true
      return (await batch([statement]))[0]
    }
    return {
      bind: (...values: unknown[]) => wrap(sql, statement.bind(...values)),
      all: execute,
      run: execute,
      first: async (column?: string) => { const row = (await execute()).results?.[0] as Record<string, unknown> | undefined; return column ? row?.[column] ?? null : row ?? null },
      raw: async () => { throw new Error('Raw recovery reads are unsupported.') },
    } as D1PreparedStatement
  }
  const guarded = { ...env, DB: { ...env.DB } } as Env
  const originals = new WeakMap<object, D1PreparedStatement>()
  const queries = new WeakMap<object, string>()
  function prepared(sql: string, raw: D1PreparedStatement): D1PreparedStatement {
    const wrapped = wrap(sql, raw)
    wrapped.bind = (...values: unknown[]) => prepared(sql, raw.bind(...values))
    originals.set(wrapped, raw)
    queries.set(wrapped, sql)
    return wrapped
  }
  guarded.DB.prepare = sql => prepared(sql, env.DB.prepare(sql))
  guarded.DB.batch = async <T = unknown>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    fence.destructive ||= items.some(item => /^\s*(DELETE|DROP)\b/i.test(queries.get(item) || ''))
    return batch<T>(items.map(item => originals.get(item) || item))
  }
  fence.unwrap = row => originals.get(row) || row
  fences.set(guarded, fence)
  try {
    await batch([])
    const result = await run(guarded)
    await batch([])
    if (owned && !await endMaintenance(env, token)) throw new Error('Stock recovery maintenance could not be released.')
    return result
  } catch (error) {
    if (owned) {
      if (fence.destructive) await updateMaintenance(env, token, { phase: 'failed', error: error instanceof Error ? error.message : 'Recovery failed' })
      else await endMaintenance(env, token)
    }
    throw error
  } finally { fences.delete(guarded) }
}

export async function assertCompleteStockRecoveryGraph(env: Env, tables: ReadonlySet<string>, columns: ReadonlyMap<string, readonly string[]>) {
  if (fences.get(env)?.actorId && (tables.has('users') || tables.has('roles'))) throw new Error('Authenticated restore cannot replace its own authorization tables. Recover this complete backup into a separate compatible database with an operator-controlled recovery session. No business rows have been changed.')
  if (!['products','product_batches','inventory_movements','suppliers','supplier_invoices','users','branches','fees',...STOCK_RECOVERY_TABLES].some(table => tables.has(table))) return
  const rows = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(STOCK_RECOVERY_TABLES)).all<{ name: string }>()
  for (const { name } of rows.results || []) {
    if (!tables.has(name)) throw new Error(`Incomplete stock recovery graph: missing ${name}. No business rows have been changed.`)
    const live = await env.DB.prepare(`PRAGMA table_info("${name}")`).all<{ name: string }>()
    for (const column of live.results || []) if (!columns.get(name)?.includes(column.name)) throw new Error(`Incomplete stock recovery graph: missing ${name}.${column.name}. No business rows have been changed.`)
  }
}

export async function insertStockRecoveryRows(env: Env, table: string, rows: D1PreparedStatement[], sourceIds: string[]) {
  const fence = fences.get(env)
  if (!fence || !sourceTables.has(table)) return env.DB.batch(rows)
  const raw = fence.raw.DB
  const stored = await raw.prepare("SELECT value,updated_at FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.token')=?").bind(fence.token).first<{ value: string; updated_at: string }>()
  if (!stored) throw new Error('Stock recovery owner changed.')
  const changed = () => raw.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[1]','$[stock_recovery_ignored_write]') END")
  const statements: D1PreparedStatement[] = [raw.prepare(`INSERT INTO stock_lifecycle_recovery_context(token,table_name,source_ids,maintenance_json)
    VALUES(?,?,?,?)`).bind(fence.token, table, JSON.stringify(sourceIds), stored.value),
    changed(), raw.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='stock_lifecycle_recovery_admission' AND value=?) THEN 1 ELSE json_extract('[1]','$[stock_recovery_admission_marker_missing]') END").bind(fence.token),
    raw.prepare("DELETE FROM system_flags WHERE key='maintenance' AND value=?").bind(stored.value), changed(),
    ...rows.flatMap(row => [fence.unwrap(row), changed()]),
    raw.prepare("INSERT INTO system_flags(key,value,updated_at) VALUES('maintenance',?,?)").bind(stored.value, stored.updated_at), changed(),
    raw.prepare('DELETE FROM stock_lifecycle_recovery_context WHERE token=?').bind(fence.token), changed(),
    raw.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context) AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='stock_lifecycle_recovery_admission') THEN 1 ELSE json_extract('[1]','$[stock_recovery_context_leaked]') END")]
  // Admission's temporary flag removal is invisible outside this transaction.
  await env.DB.batch(statements)
}
