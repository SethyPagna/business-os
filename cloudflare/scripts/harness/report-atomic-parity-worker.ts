import * as api from 'current:analytics'
import * as money from 'current:money'
import { resetReadSwitchMemo } from 'current:switches'
import { setReportShadowSamplerForTests } from 'current:router'
import { __resetSchemaProbeCacheForTests as resetSchema } from 'current:schema'
import { localDateAtOrAfter, localDateAtOrBefore } from 'current:window'
import { __resetPlanTierCacheForTests as resetTier } from 'current:plan'

// One probe endpoint for the report_atomic parity test: runs a public report reader through a metered D1 and returns what it
// produced, how many physical D1 calls it took, and every Analytics Engine datapoint it wrote. Optionally runs a write on the
// raw database right after the Nth physical call completes (the concurrent-writer injection).
const SWITCH_SQL = /FROM system_flags WHERE key IN \(\?1, \?2\)/
const ATOMIC_MARKER = 'report_restore_state_changed'
const encoder = new TextEncoder()
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const digest = async (value: unknown) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value))))
function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
}

function meter(raw: D1Database, input: any) {
  const calls: Array<{ op: string; arity: number; atomic: boolean; sw: boolean }> = []
  let sequence = 0, injected = false
  const failSwitch = Boolean(input.failSwitchRead)
  const afterCall = async (number: number) => {
    if (injected || input.writeAfter == null || number !== input.writeAfter) return
    injected = true
    await raw.batch((input.write || []).map((item: any) => raw.prepare(item.sql).bind(...(item.values || []))))
  }
  const track = async <T>(op: string, sqls: string[], job: () => Promise<T>): Promise<T> => {
    const number = ++sequence
    calls.push({ op, arity: sqls.length, atomic: sqls.some(sql => sql.includes(ATOMIC_MARKER)), sw: sqls.length === 1 && SWITCH_SQL.test(sqls[0]) })
    if (failSwitch && SWITCH_SQL.test(sqls[0] || '')) throw new Error('D1_ERROR: switch row unreadable')
    const result = await job()
    await afterCall(number)
    return result
  }
  const statement = (inner: any, sql: string, values: unknown[] = []): any => new Proxy(inner, { get(target, key) {
    if (key === '__inner') return target
    if (key === '__sql') return sql
    if (key === 'bind') return (...next: unknown[]) => statement(target.bind(...next), sql, next)
    if (key === 'all' || key === 'run') return (...args: unknown[]) => track(String(key), [sql], () => target[key](...args))
    if (key === 'first' || key === 'raw') return () => { throw new Error('Unmeasured statement method ' + String(key)) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  const db: any = new Proxy(raw, { get(target: any, key) {
    if (key === 'prepare') return (sql: string) => statement(target.prepare(sql), sql)
    if (key === 'batch') return (items: any[]) => track('batch', items.map(item => item.__sql), () => target.batch(items.map(item => item.__inner)))
    if (key === 'exec' || key === 'withSession' || key === 'dump') return () => { throw new Error('Unmeasured database operation ' + String(key)) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  return { db, calls }
}

// The Sales stats route's list scope for a window, a branch (shop or item branch) and a customer-name search.
function statsScope(spec: any) {
  const where = ['1=1'], params: Record<string, unknown> = {}
  if (spec.startDate) { where.push(localDateAtOrAfter('s.created_at')); params.startDate = spec.startDate }
  if (spec.endDate) { where.push(localDateAtOrBefore('s.created_at')); params.endDate = spec.endDate }
  if (spec.branchId) { where.push('(s.branch_id = @branchId OR EXISTS (SELECT 1 FROM sale_items sif WHERE sif.sale_id = s.id AND sif.branch_id = @branchId))'); params.branchId = spec.branchId }
  if (spec.search) { where.push('s.customer_name LIKE @search'); params.search = '%' + spec.search + '%' }
  return api.salesListFilterReportScope(where, params)
}

function buildFilter(spec: any) {
  const plain = { startDate: spec.startDate, endDate: spec.endDate, createdFrom: spec.createdFrom, createdTo: spec.createdTo, branchId: spec.branchId }
  switch (spec.kind || 'plain') {
    case 'plain': return plain
    case 'inherited': { const f: any = Object.create({ startDate: spec.startDate, endDate: spec.endDate }); f.branchId = spec.branchId; return f }
    case 'null-proto': return Object.assign(Object.create(null), plain)
    case 'getter': { // a stateful filter: the second read of startDate answers differently
      let reads = 0
      return Object.defineProperty({ ...plain }, 'startDate', { enumerable: true, get() { reads += 1; return reads === 1 ? spec.startDate : spec.endDate } })
    }
    case 'symbol': { const f: any = { ...plain }; f[Symbol('extra')] = 1; return f }
    case 'extra-key': return { ...plain, status: 'cancelled' }
    case 'raw': return spec.value
    default: throw new Error('unknown filter kind')
  }
}

async function snapshotView(snapshot: any) {
  const totals = api.salesTotalsFromSnapshot(snapshot)
  return { totals, diagnostic: api.reportMoneyDiagnostic(totals), counts: { sales: snapshot.sales.length, voidSales: snapshot.voidSales.length, items: snapshot.items.length, returns: snapshot.returns.length, returnItems: snapshot.returnItems.length, deliveryFees: snapshot.deliveryFees.length },
    precision_mode: snapshot.precision_mode, row_count: snapshot.row_count, snapshot_sha256: await digest(snapshot) }
}

async function run(input: any, env: any) {
  resetSchema(); resetReadSwitchMemo(); resetTier()
  setReportShadowSamplerForTests(input.sample === undefined || input.sample === null ? null : () => input.sample)
  const ae: Array<{ indexes: string[]; blobs: string[]; doubles: number[] }> = []
  const measured = meter(env.DB, input)
  const local = { ...env, DB: measured.db, PLAN_TIER: input.tier || 'paid', Business_OS_Analytics: { writeDataPoint: (point: any) => { ae.push(point) } } }
  if (input.writeAfter === 0 && input.write) await env.DB.batch(input.write.map((item: any) => env.DB.prepare(item.sql).bind(...(item.values || []))))
  const filter = buildFilter(input.filter || {})
  const done = (value: any) => ({ ok: true, ...value, calls: measured.calls, ae })
  try {
    if (input.mode === 'combined') { const value = await api.getSalesTotalsAndPeriodSeries(local, filter, input.granularity || 'day', 20); return done({ kind: 'value', value, diagnostic: api.reportMoneyDiagnostic(value.totals) }) }
    if (input.mode === 'previous') { const value = await api.getSalesTotalsWithoutLosses(local, input.rawPrevious ? filter : api.previousPeriodFilters(filter)); return done({ kind: 'value', value, diagnostic: api.reportMoneyDiagnostic(value) }) }
    if (input.mode === 'totals') {
      const scope = input.stats ? statsScope(input.stats) : undefined
      const value = await api.readSalesReportTotals(local, filter, Boolean(input.fees), scope, input.options || {})
      return done({ kind: 'value', value, diagnostic: api.reportMoneyDiagnostic(value.totals) })
    }
    if (input.mode === 'snapshot') {
      const scope = input.stats ? statsScope(input.stats) : undefined
      return done({ kind: 'value', value: await snapshotView(await api.readSalesReportSnapshot(local, filter, Boolean(input.fees), scope, input.options || {})) })
    }
    throw new Error('unknown mode')
  } catch (error: any) {
    const mapped = error instanceof money.ReportMoneyPrecisionError ? money.reportMoneyHttpError(error) : null
    return done({ kind: 'error', error: { name: error?.name ?? typeof error, code: error?.code ?? null, message: String(error?.message ?? error), status: mapped?.status ?? 500 } })
  }
}

export default { async fetch(request: Request, env: any) {
  try { return Response.json(await run(await request.json(), env)) }
  catch (error: any) { return Response.json({ ok: false, error: { name: error?.name, message: String(error?.message ?? error) } }, { status: 500 }) }
} }
