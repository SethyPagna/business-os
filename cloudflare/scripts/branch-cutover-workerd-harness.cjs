// Branch cutover on local workerd D1 (Miniflare, in-memory, random port; never 8787, never .wrangler/state).
// Loads every migration and the production-scale fixture, then drives the real parent and certified child
// exactly as the Worker would, one invocation per request, and records every D1 statement's own timing
// (meta.duration, measured by D1 around SQLite) and rows_read. Not a test: the scale test and the bench use it.
'use strict'
const fs = require('fs')
const path = require('path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const fixture = require('./branch-cutover-scale-fixture.cjs')
const root = path.resolve(__dirname, '..')

const ACTOR = { id: 7, username: 'operator', name: 'Operator', organization_id: 1, role_id: null, permissions: '{"branches":true,"backup_restore":true}', is_active: 1 }
const PARENT_BUDGET = { tier: 'paid', alreadyUsed: 0, remainingReads: 0, retryQueries: 0, completionQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
const CHILD_BUDGET = { ...PARENT_BUDGET, tier: 'paid' }
const IDS = { sourceBranchId: fixture.SHOP, targetBranchId: fixture.WAREHOUSE }
const NAMES = { retiredName: 'Old Shop', successorName: 'LC Store' }
const INCARNATION = '00000000-0000-4000-8000-000000000099'

const WORKER = `
  import { inspectBranchCutover, beginBranchCutover, continueBranchCutover } from './src/lib/branchCutoverParent.ts';
  import { executePlannedBranchCutoverChild } from './src/lib/branchCutoverChild.ts';
  import { D1Compat } from './src/lib/db.ts';
  const texts = new Map();
  function textId(sql, fresh) { let id = texts.get(sql); if (id === undefined) { id = texts.size; texts.set(sql, id); fresh[id] = sql } return id }
  export default { async fetch(request, env) {
    const input = await request.json();
    if (input.op === 'exec') {
      for (const s of input.statements) {
        try { await env.DB.prepare(s.sql).bind(...(s.params || [])).run() } catch (e) { return Response.json({ ok: false, error: String(e && e.message), sql: s.sql.slice(0, 300) }) }
      }
      return Response.json({ ok: true });
    }
    if (input.op === 'query') {
      try {
        const r = await env.DB.prepare(input.sql).bind(...(input.params || [])).all();
        return Response.json({ rows: r.results, meta: r.meta });
      } catch (e) { return Response.json({ error: String(e && e.message) }) }
    }
    const log = [], fresh = {};
    const record = (sql, values, meta, batch) => log.push({ t: textId(sql, fresh), d: meta?.duration ?? null, r: meta?.rows_read ?? null, w: meta?.rows_written ?? null, b: batch,
      v: (meta?.duration ?? 0) >= input.keepValuesAboveMs ? values : undefined });
    const fail = input.fail || null;
    let reads = 0, batches = 0;
    const injected = () => new Error('D1_ERROR: D1 DB exceeded its CPU time limit and was reset. [code: 7429]');
    function wrap(sql, statement, values) {
      return {
        bind(...v) { return wrap(sql, statement.bind(...v), v) },
        async all() { if (fail && fail.on === 'read' && reads++ === fail.at) throw injected(); let r; try { r = await statement.all() } catch (e) { log.push({ t: textId(sql, fresh), error: String(e && e.message) }); throw e } record(sql, values, r.meta, false); return r },
        async run() { const r = await statement.run(); record(sql, values, r.meta, false); return r },
        async first(c) { const r = await statement.all(); record(sql, values, r.meta, false); return c ? r.results[0]?.[c] ?? null : r.results[0] ?? null },
        inner: statement, sql, values,
      };
    }
    const raw = { prepare: (sql) => wrap(sql, env.DB.prepare(sql), []),
      async batch(items) {
        if (fail && fail.on === 'batch' && batches++ === fail.at) throw injected();
        let r; try { r = await env.DB.batch(items.map(i => i.inner)) } catch (e) { log.push({ t: textId(items.map(i => i.sql).join(' ; '), fresh), error: String(e && e.message) }); throw e }
        r.forEach((x, k) => record(items[k].sql, items[k].values, x.meta, true));
        return r;
      } };
    const db = new D1Compat(raw);
    const started = Date.now();
    let result = null, error = null;
    try {
      const a = input.args;
      if (input.kind === 'inspect') result = await inspectBranchCutover(db, a.actor, 1, a.ids, a.budget);
      else if (input.kind === 'begin') result = await beginBranchCutover(db, a.actor, 1, a.input, a.budget);
      else if (input.kind === 'continue') result = await continueBranchCutover(db, a.actor, 1, a.input, a.budget);
      else if (input.kind === 'child') result = await executePlannedBranchCutoverChild(db, a.actor, a.ownership, a.expected, a.budget, 1);
      else throw new Error('unknown kind');
    } catch (e) { error = { message: String(e && e.message), code: e && e.code, capability: e && e.capability, cause: e && e.cause ? String(e.cause.message || e.cause) : null } }
    return Response.json({ result: input.kind === 'inspect' ? result : result && (result.row ? { phase: result.row.phase } : true), error, log, fresh, wallMs: Date.now() - started });
  } };
`

async function start() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: WORKER }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', port: 0, d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  const call = async (body) => { const response = await mf.dispatchFetch('http://cutover.local/', { method: 'POST', body: JSON.stringify(body) }); return response.json() }
  return { mf, call }
}

/** Migrations then the fixture (D1 batches of statements; returns load timings). */
async function seed(call, { scale = 1, tables } = {}) {
  const t0 = Date.now()
  const migrations = []
  for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
    for (const sql of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
      migrations.push({ sql })
    }
  }
  for (let i = 0; i < migrations.length; i += 50) {
    const r = await call({ op: 'exec', statements: migrations.slice(i, i + 50) })
    if (!r.ok) throw new Error('migration failed: ' + r.error + ' ' + r.sql)
  }
  const t1 = Date.now()
  const data = tables || fixture.rows({ scale })
  const statements = fixture.statements(data, 60000, 250)
  for (let i = 0; i < statements.length; i += 10) {
    const r = await call({ op: 'exec', statements: statements.slice(i, i + 10) })
    if (!r.ok) throw new Error('seed failed: ' + r.error + ' ' + r.sql)
  }
  return { migrationsMs: t1 - t0, seedMs: Date.now() - t1, statements: statements.length }
}

const labelOf = (row) => {
  if (!row) return 'begin'
  if (row.phase === 'moving') return row.planned_child_json ? 'child' : 'seal'
  if (row.phase === 'verifying') { const c = JSON.parse(row.verification_cursor_json); return c.stage || 'fold' }
  return { capturing: 'capture', snapshots: 'snapshot', ready: 'finalize', completed: 'completed' }[row.phase]
}
const ownership = (row) => ({ operationId: row.operation_id, actorId: row.actor_id, organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token })

/**
 * Drives one cutover to completion. stats[label] keeps the invocation count, wall time, and the slowest statement
 * (D1 meta.duration) with its rows_read and SQL; faults: { '<label>#<n>': { on: 'read'|'batch', at } } inject a 7429.
 */
async function drive(call, { pageSize = 256, faults = {}, keepValuesAboveMs = 20, maxTurns = 100000, onTurn } = {}) {
  const texts = {}, stats = {}, seen = {}, fired = [], perText = {}, faultErrors = []
  const status = async () => (await call({ op: 'query', sql: "SELECT * FROM branch_cutovers WHERE phase<>'aborted' ORDER BY created_at DESC LIMIT 1" })).rows[0]
  const absorb = (label, response) => {
    Object.assign(texts, response.fresh)
    const s = stats[label] ||= { invocations: 0, wallMs: 0, statements: 0, rowsRead: 0, maxRowsRead: 0, worst: null }
    s.invocations++; s.wallMs += response.wallMs
    for (const entry of response.log) {
      s.statements++; s.rowsRead += entry.r || 0; s.maxRowsRead = Math.max(s.maxRowsRead, entry.r || 0)
      if (!s.worst || (entry.d ?? 0) > s.worst.d) s.worst = { ...entry, sql: texts[entry.t] }
      const p = perText[entry.t] ||= { label, count: 0, maxMs: 0, secondMs: 0, maxRows: 0, totalRows: 0, values: undefined }
      p.count++; p.totalRows += entry.r || 0
      if ((entry.r || 0) >= p.maxRows) { p.maxRows = entry.r || 0; if (entry.v) p.values = entry.v }
      if ((entry.d || 0) > p.maxMs) { p.secondMs = p.maxMs; p.maxMs = entry.d || 0; if (entry.v) p.values = entry.v } else p.secondMs = Math.max(p.secondMs, entry.d || 0)
    }
  }
  const step = async (label, kind, args, fault) => {
    const response = await call({ op: 'step', kind, args, keepValuesAboveMs, fail: fault || null })
    absorb(label, response)
    if (response.error) response.failedSql = response.log.filter(e => e.error).map(e => texts[e.t].slice(0, 600) + ' :: ' + e.error)
    return response
  }
  const plan = await step('inspect', 'inspect', { actor: ACTOR, ids: IDS, budget: PARENT_BUDGET })
  if (plan.error) throw new Error('inspect: ' + JSON.stringify(plan.error) + ' ' + JSON.stringify(plan.failedSql))
  for (let turn = 0; turn < maxTurns; turn++) {
    const row = await status()
    if (row && row.phase === 'completed') return { row, stats, texts, fired, perText, faultErrors, inspect: plan.result }
    const label = labelOf(row)
    seen[label] = (seen[label] || 0) + 1
    const fault = faults[label + '#' + seen[label]]
    if (fault) fired.push(label + '#' + seen[label])
    let response
    if (!row) {
      response = await step(label, 'begin', { actor: ACTOR, budget: PARENT_BUDGET, input: { ...IDS, ...NAMES, requestId: 'cutover_scale_night', controlIncarnation: INCARNATION,
        expectedSourceJson: plan.result.sourcePreimageJson, expectedTargetJson: plan.result.targetPreimageJson, expectedSchemaDigest: plan.result.schemaDigest } }, fault)
    } else if (label === 'child') {
      response = await step(label, 'child', { actor: ACTOR, ownership: ownership(row), expected: { sequence: row.next_sequence, childJson: row.planned_child_json }, budget: CHILD_BUDGET }, fault)
    } else {
      response = await step(label, 'continue', { actor: ACTOR, budget: PARENT_BUDGET, input: { operationId: row.operation_id, expectedRevision: row.revision, pageSize } }, fault)
    }
    if (response.error && fault) faultErrors.push({ label, error: response.error })
    if (response.error && !fault) throw new Error(label + ': ' + JSON.stringify(response.error) + ' ' + JSON.stringify(response.failedSql))
    if (onTurn) await onTurn(label, response)
  }
  throw new Error('did not converge')
}

module.exports = { start, seed, drive, labelOf, ACTOR, PARENT_BUDGET, CHILD_BUDGET, IDS, NAMES, INCARNATION }
