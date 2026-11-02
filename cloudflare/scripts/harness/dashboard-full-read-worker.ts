import * as api from 'current:analytics'
import * as money from 'current:money'
import { __resetSchemaProbeCacheForTests as resetSchema } from 'current:schema'
import { resetReadSwitchMemo as resetSwitches } from 'current:switches'

const encoder = new TextEncoder(), bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength
const FLAG_SQL = "SELECT value FROM system_flags WHERE key IN ('maintenance','maintenance_mode') ORDER BY key"
const FLAG_WITNESS = "SELECT key,typeof(value) AS storage_type,length(CAST(value AS BLOB)) AS byte_length,CAST(value AS BLOB) IS CAST(? AS BLOB) AS matches FROM system_flags WHERE key IN ('maintenance','maintenance_mode') ORDER BY key"
const PERMIT_SQL = "SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'"
const POISON = '__dashboard_full_detail_poison'
// The report_atomic switch read is metered apart from the report ledger: it is one cold statement of its own.
const SWITCH_SQL = /FROM system_flags WHERE key IN \(\?1, \?2\)/
const modes = ['public-snapshot', 'atomic-full-snapshot', 'combined', 'public-totals']
const hex = (array: ArrayBuffer) => [...new Uint8Array(array)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const digest = async (text: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error('Full-reader regression harness: ' + message) }
function summary(result: any) { return { success: result.success, meta: result.meta ?? null,
  rows: Array.isArray(result.results) ? result.results.length : null,
  result_array_utf8_bytes: Array.isArray(result.results) ? bytes(result.results) : null } }
function phaseFor(sqls: string[]) {
  if (sqls.some(sql => sql.includes('report_restore_state_changed'))) return 'atomic-main'
  if (sqls.some(sql => sql.includes('report_flags_bytes'))) return sqls.length === 3 ? 'flags-prefetch' : 'flags-post'
  if (sqls.length === 1 && sqls[0] === FLAG_SQL) return 'legacy-restore'
  if (sqls.some(sql => /FROM sale_items si\b/.test(sql))) return 'legacy-items'
  if (sqls.some(sql => /FROM return_items ri\b/.test(sql))) return 'legacy-returnItems'
  if (sqls.some(sql => /FROM returns r\b/.test(sql))) return 'legacy-returns'
  if (sqls.some(sql => /FROM sales s WHERE/.test(sql))) return /s\.subtotal_usd/.test(sqls[0]) ? 'legacy-sales' : 'legacy-voidSales'
  return 'ordinary'
}
function meter(raw: D1Database, input: any) {
  const calls: any[] = [], writerCalls: any[] = [], timeline: any[] = [], switchReads: string[] = [], pending = new Set<Promise<unknown>>()
  let order = 0, writers = 0
  const event = (stage: string, detail: any = {}) => { const value = { order: ++order, stage, ...detail }; timeline.push(value); return value.order }
  const tracked = async (job: () => Promise<any>) => { const promise = job(); pending.add(promise); try { return await promise } finally { pending.delete(promise) } }
  const bindView = (value: unknown): unknown => value instanceof ArrayBuffer ? { binary_bytes: value.byteLength } : ArrayBuffer.isView(value) ? { binary_bytes: value.byteLength } : value
  const writerNative = async (stage: string, statements: Array<{ sql: string; values?: unknown[] }>) => {
    const item: any = { stage, operation: 'batch', arity: statements.length, sqls: statements.map(statement => statement.sql), bindings: [] }
    for (const statement of statements) item.bindings.push(await Promise.all((statement.values ?? []).map(async value => typeof value === 'string' ? { type: 'string', utf8_bytes: encoder.encode(value).byteLength, sha256: await digest(value) } : bindView(value))))
    item.started_order = event('writer-native-before', { writer_stage: stage, arity: item.arity }); writerCalls.push(item)
    try { const result = await raw.batch(statements.map(statement => raw.prepare(statement.sql).bind(...(statement.values ?? [])))); item.results = result.map(summary); item.completed_order = event('writer-native-after', { writer_stage: stage }); return result }
    catch (error) { item.error = String(error); item.unknown_metadata = item.arity; item.completed_order = event('writer-native-error', { writer_stage: stage }); throw error }
  }
  const writeAfterMain = async () => {
    requireValue(writers === 0, 'a second main attempt cannot silently repeat the writer'); writers++
    const before = await writerNative('witness-before', [{ sql: PERMIT_SQL }, { sql: FLAG_WITNESS, values: [''] }])
    requireValue(before.every(row => row.success === true) && before[0].results[0].n === 0, 'pre-writer permit absence')
    requireValue(before[1].results.length === 2 && before[1].results.every((row: any) => row.storage_type === 'text' && row.byte_length === 0 && row.matches === 1), 'both flags must start empty TEXT')
    writerCalls[writerCalls.length - 1].witness_rows = before.map(row => row.results)
    const core = input.postWriter === 'active' ? JSON.stringify({ mode: 'restore' }) : ''
    const value = core + ' '.repeat(1500000 - core.length)
    requireValue(encoder.encode(value).byteLength === 1500000, 'writer payload byte length')
    const changed = await writerNative('write', [
      { sql: "INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'" },
      { sql: "UPDATE system_flags SET value=? WHERE key IN ('maintenance','maintenance_mode')", values: [value] },
      { sql: "DELETE FROM system_flags WHERE key='stock_transaction_permit'" },
    ])
    requireValue(changed.every(row => row.success === true), 'separate native writer success')
    const after = await writerNative('witness-after', [{ sql: PERMIT_SQL }, { sql: FLAG_WITNESS, values: [value] }])
    requireValue(after.every(row => row.success === true) && after[0].results[0].n === 0, 'post-writer permit absence')
    requireValue(after[1].results.length === 2 && after[1].results.every((row: any) => row.storage_type === 'text' && row.byte_length === 1500000 && row.matches === 1), 'both flags must equal the exact writer payload')
    writerCalls[writerCalls.length - 1].witness_rows = after.map(row => row.results)
  }
  const statement = (inner: any, sql: string, values: unknown[] = []): any => new Proxy(inner, { get(target, key) {
    if (key === '__native') return target
    if (key === '__sql') return sql
    if (key === '__values') return values
    if (key === 'bind') return (...next: unknown[]) => statement(target.bind(...next), sql, next)
    if ((key === 'all' || key === 'run') && SWITCH_SQL.test(sql)) return (...args: unknown[]) => { switchReads.push(sql); return tracked(async () => target[key](...args)) }
    if (key === 'all' || key === 'run') return (...args: unknown[]) => tracked(async () => {
      const item: any = { sequence: calls.length + 1, operation: key, phase: phaseFor([sql]), arity: 1, sqls: [sql], bindings: [values.map(bindView)] }
      item.started_order = event('app-native-before', { sequence: item.sequence, phase: item.phase }); calls.push(item)
      try {
        const result = await target[key](...args); item.results = [summary(result)]
        if (item.phase === 'legacy-restore') item.restore_observation = { active: api.__flagsActive(result.results), rows: result.results.map((row: any) => ({ type: typeof row.value, utf8_bytes: typeof row.value === 'string' ? encoder.encode(row.value).byteLength : null })) }
        item.completed_order = event('app-native-after', { sequence: item.sequence, phase: item.phase }); return result
      } catch (error) { item.error = String(error); item.unknown_metadata = 1; item.completed_order = event('app-native-error', { sequence: item.sequence, phase: item.phase }); throw error }
    })
    if (key === 'first' || key === 'raw') return (...args: unknown[]) => tracked(async () => {
      const item: any = { sequence: calls.length + 1, operation: key, phase: phaseFor([sql]), arity: 1, sqls: [sql], bindings: [values.map(bindView)], unknown_metadata: 1 }
      item.started_order = event('app-native-before', { sequence: item.sequence, phase: item.phase }); calls.push(item)
      try { const result = await target[key](...args); item.observed_value_utf8_bytes = bytes(result); item.completed_order = event('app-native-after', { sequence: item.sequence, phase: item.phase }); return result }
      catch (error) { item.error = String(error); item.completed_order = event('app-native-error', { sequence: item.sequence, phase: item.phase }); throw error }
    })
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  const db: any = new Proxy(raw, { get(target: any, key) {
    if (key === 'prepare') return (sql: string) => statement(target.prepare(sql), sql)
    if (key === 'batch') return (supplied: any[]) => tracked(async () => {
      let items = supplied
      const phase = phaseFor(items.map(row => row.__sql)), instrumentation: any[] = []
      if (input.poison && phase === 'atomic-main') { const sql = `SELECT json_extract('[1]','$[${POISON}]') AS poisoned`; items = items.slice(); items.splice(2, 0, db.prepare(sql)); instrumentation.push({ kind: 'native-poison-follower', index: 2, sql }) }
      const item: any = { sequence: calls.length + 1, operation: 'batch', phase, arity: items.length, original_arity: supplied.length, sqls: items.map(row => row.__sql), bindings: items.map(row => row.__values.map(bindView)), instrumentation }
      item.started_order = event('app-native-before', { sequence: item.sequence, phase: item.phase }); calls.push(item)
      try {
        const results = await target.batch(items.map(row => row.__native)); item.results = results.map(summary)
        if (item.phase === 'flags-prefetch') item.restore_observation = { active: api.__flagsActive(results[1].results), rows: results[1].results.map((row: any) => ({ type: typeof row.value, utf8_bytes: typeof row.value === 'string' ? encoder.encode(row.value).byteLength : null })) }
        if (item.phase === 'atomic-main') {
          item.control_rows = results.slice(0, 2).map((row: any) => row.results)
          item.detail_groups = results.slice(2).map((row: any) => ({ rows: row.results.length, ids: row.results.map((value: any) => value.id), columns: row.results[0] ? Object.keys(row.results[0]) : [] }))
        }
        item.native_completed_order = event('app-native-completed', { sequence: item.sequence, phase: item.phase })
        if (item.phase === 'atomic-main' && input.postWriter) {
          requireValue(items.length === 7 && results.length === 7 && results.every((row: any) => row.success === true), 'original complete seven-statement main must succeed')
          requireValue(results[0].results[0]?.allowed === 1 && results[1].results[0]?.allowed === 1 && results[1].results[0]?.data_rows === 19, 'actual main fence/admission/row count')
          requireValue(results[2].results.length === 1 && results[3].results.length === 0 && results[4].results.length === 18 && results[5].results.length === 0 && results[6].results.length === 0, 'five admitted full groups')
          requireValue(typeof results[2].results[0].customer_name === 'string' && results[4].results.every((row: any) => typeof row.product_name === 'string' && encoder.encode(row.product_name).byteLength === 150000), 'actual main keeps full-only names')
          await writeAfterMain()
        }
        item.completed_order = event('app-native-return', { sequence: item.sequence, phase: item.phase }); return results
      } catch (error) { if (!item.results) { item.unknown_metadata = items.length; item.error = String(error) } else item.observer_error = String(error); item.completed_order = event(item.results ? 'observer-error-after-native-success' : 'app-native-error', { sequence: item.sequence, phase: item.phase }); throw error }
    })
    if (key === 'exec' || key === 'withSession' || key === 'dump') return () => { throw new Error('Unmeasured native operation ' + String(key)) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  return { db, calls, writerCalls, timeline, switchReads, writerCount: () => writers,
    async drain() { let stable = 0; while (stable < 2) { const jobs = [...pending]; if (jobs.length) { stable = 0; await Promise.allSettled(jobs) } else { stable++; await Promise.resolve() } } } }
}
function views(api: any, snapshot: any) {
  const totals = api.salesTotalsFromSnapshot(snapshot)
  return { totals, diagnostic: api.reportMoneyDiagnostic(totals), precision_mode: snapshot.precision_mode, row_count: snapshot.row_count,
    periodSeries: api.__fullPeriod(snapshot, 'day'), ...api.dashboardSplitsFromSnapshot(snapshot), ...api.dashboardRankingsFromSnapshot(snapshot, 20) }
}
function errorValue(error: any, money: any, calls: any[]) {
  const native = [...calls].reverse().find(call => call.error)?.error ?? null
  const marker = [POISON, 'report_totals_bytes', 'report_totals_rows', 'report_totals_receipts', 'report_totals_storage', 'report_flags_bytes', 'report_flags_rows', 'report_restore_state_changed']
    .find(value => String(error?.message).includes(value) || String(native).includes(value)) ?? null
  const mapped = error instanceof money.ReportMoneyPrecisionError ? money.reportMoneyHttpError(error) : null
  return { name: error?.name ?? typeof error, code: error?.code ?? null, message: String(error?.message ?? error), status: mapped?.status ?? 500, native_message: native, marker }
}
async function run(input: any, env: any) {
  requireValue(modes.includes(input.mode), 'valid selector')
  requireValue(input.postWriter === undefined || (['inactive', 'active'].includes(input.postWriter) && ['atomic-full-snapshot', 'combined'].includes(input.mode) && !input.poison), 'explicit post writer')
  requireValue(input.poison === undefined || (input.poison === true && input.mode === 'atomic-full-snapshot'), 'explicit poison follower')
  resetSwitches()
  if (input.reset) resetSchema()
  const measured = meter(env.DB, input), local = { ...env, DB: measured.db, PLAN_TIER: 'paid' }
  const evidence = { calls: measured.calls, writer_calls: measured.writerCalls, timeline: measured.timeline, switch_reads: measured.switchReads }
  try {
    if (input.mode === 'combined') { const value = await api.getSalesTotalsAndPeriodSeries(local, {}, 'day', 20); return { ok: true, kind: 'combined', value, diagnostic: api.reportMoneyDiagnostic(value.totals), ...evidence } }
    if (input.mode === 'public-totals') { const value = await api.readSalesReportTotals(local, {}); return { ok: true, kind: 'totals', value, diagnostic: api.reportMoneyDiagnostic(value.totals), ...evidence } }
    const snapshot = input.mode === 'atomic-full-snapshot' ? await api.__fullAtomic(local, {}, false, null, {}, 'full') : await api.readSalesReportSnapshot(local, {})
    return { ok: true, kind: 'snapshot', snapshot, views: views(api, snapshot), ...evidence }
  } catch (error) { return { ok: true, kind: 'refusal', error: errorValue(error, money, measured.calls), ...evidence } }
  finally { await measured.drain() }
}
export default { async fetch(request: Request, env: any) {
  try { return Response.json(await run(await request.json(), env)) }
  catch (error: any) { return Response.json({ ok: false, kind: 'harness-error', error: { name: error?.name, message: String(error?.message ?? error) } }, { status: 500 }) }
} }
