'use strict'
// Shared by the read-budget native tests and by measure.cjs: budgets, the checks, and the GET / ANALYZE / write passes.
const fs = require('node:fs')
const path = require('node:path')
const { bootWorld, runShape, lastStatements, explain } = require('./world.cjs')
const { getShapes } = require('./shapes.cjs')
const { writeShapes, measureWrite } = require('./writes.cjs')

const { BUDGETS_FILE, FREE_CALL_LIMIT, loadBudgets, today, roundUp, callsLimit } = require('./budgets.cjs')

// READ_BUDGET_ONLY=<regex> narrows a local run to the shape ids it matches (diagnosis only; the gate runs them all).
const only = (id) => !process.env.READ_BUDGET_ONLY || new RegExp(process.env.READ_BUDGET_ONLY).test(id)

// A shape's file is fixed by its id, so adding a shape never moves another one.
const PARTS = 3
const part = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PARTS

async function ensureCheckId(world) {
  if (world.state?.checkId) return world.state.checkId
  const ids = (await world.all('SELECT id FROM products WHERE is_active=1 ORDER BY id LIMIT 20')).map((r) => r.id)
  const r = await world.send('POST', '/api/inventory-checks/sessions', { branchId: 1, title: 'Budget count', productIds: ids, scope: {}, requestId: 'budget-check-1' })
  world.state = { ...world.state, checkId: r.json?.item?.id || 'none' }
  return world.state.checkId
}

async function ensureStockKey(world) {
  if (world.state?.stockKey) return world.state.stockKey
  const r = await world.send('GET', '/api/products/stock-in-sessions?page=1&pageSize=5')
  const first = r.json && (r.json.items || r.json.sessions || [])[0]
  world.state = { ...world.state, stockKey: (first && (first.key || first.session_key || first.id)) || 'none' }
  return world.state.stockKey
}

// The ids the GET shapes name exist before anything is measured, so the order of shapes never changes the data.
async function prepareWorld(world) {
  await ensureCheckId(world)
  await ensureStockKey(world)
}

// Placeholders are resolved before the isolate restarts, so the measured request is the first on a fresh isolate.
async function resolveUrl(world, url) {
  let out = url
  if (out.includes('{{checkId}}')) out = out.replaceAll('{{checkId}}', await ensureCheckId(world))
  if (out.includes('{{stockKey}}')) out = out.replaceAll('{{stockKey}}', encodeURIComponent(await ensureStockKey(world)))
  return out
}

// A shape that names read switches has them set around its one measured request and cleared afterwards, so no other shape ever runs with one on.
const setSwitches = (world, names) => world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)")
  .bind(JSON.stringify({ epoch: 1, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches: Object.fromEntries(names.map((name) => [name, 'on'])) })).run()
const clearSwitches = (world) => world.db.prepare("DELETE FROM system_flags WHERE key = 'read_switches'").run()
const withSwitches = (names, url) => ({ prepare: (world) => setSwitches(world, names), run: async (world, send) => { try { return await send('GET', url) } finally { await clearSwitches(world) } } })

async function measureGet(world, shape, { cold = true, statements = false, fingerprints = false } = {}) {
  const url = await resolveUrl(world, shape.url)
  const probe = { method: 'GET', url, anon: shape.anon, ...(shape.switches ? withSwitches(shape.switches, url) : {}) }
  const out = { url }
  if (cold) out.cold = await runShape(world, probe, { cold: true })
  out.warm = await runShape(world, probe, { cold: false, fingerprints })
  if (statements) out.statements = await lastStatements(world)
  return out
}

const codeOf = (r) => r.code || (r.status >= 400 ? 'http_' + r.status : undefined)

// problems of one measured GET against its entry; [] when within budget
function getProblems(entry, m, { analyze = false, on = today() } = {}) {
  const out = []
  const warm = m.warm
  if (warm.overDeadline) return [`over budget: no answer within the deadline`]
  if (warm.status !== entry.status) out.push(`status ${warm.status}, budget has ${entry.status}`)
  if (m.cold) {
    if (m.cold.overDeadline) out.push('cold request: no answer within the deadline')
    else if (m.cold.calls > callsLimit(entry, on)) out.push(`cold calls ${m.cold.calls} > ${callsLimit(entry, on)}`)
  }
  const rowsMax = analyze ? entry.rows_max_analyze : entry.rows_max
  if (warm.rowsRead > rowsMax) out.push(`rows read ${warm.rowsRead} > ${rowsMax}${analyze ? ' (with ANALYZE)' : ''}`)
  if (!analyze && warm.rowsWritten > entry.rows_written_max) out.push(`rows written ${warm.rowsWritten} > ${entry.rows_written_max}`)
  return out
}

// A pinned statement must show its index in EXPLAIN QUERY PLAN.
async function pinProblems(world, entry, statements) {
  const out = []
  for (const pin of entry.pins || []) {
    const stmt = statements.find((s) => s.sql.includes(pin.match))
    if (!stmt) { out.push(`pinned statement not executed: ${pin.match}`); continue }
    const plan = await explain(world, stmt)
    if (!plan || !plan.some((line) => line.includes(pin.index))) out.push(`plan of "${pin.match}" no longer uses ${pin.index}: ${(plan || []).join(' | ').slice(0, 200)}`)
  }
  return out
}

// The Worker keeps the read switches it last read for READ_SWITCH_MEMO_MS (15 s) per isolate, and the ANALYZE pass measures every shape warm on ONE isolate. A shape that names switches
// (the ic_simple ones: the switch row is set around their request only) would otherwise run on the switch state of the shape before it: right after a switch-OFF shape it was measured on
// the OFF path (218M rows read under ANALYZE instead of ~0.3M) and a green run proved nothing about the ON path. So whenever the switch state a shape needs differs from the one the
// isolate last read, a fresh isolate (and a fresh login) is started first; consecutive shapes with the same switches share an isolate as before.
function switchFence() {
  let read = ''
  return async (world, shape) => {
    const wanted = (shape.switches || []).join(',')
    if (wanted === read) return
    await world.restart(); await world.login()
    read = wanted
  }
}

// `analyzeDb: false` runs the warm-only (analyze) measurement without the ANALYZE statistics: the switch memo test needs the shapes to be fast. `observe(shape, measurement)` sees every measured shape.
async function runGetPass({ partIndex, analyze = false, analyzeDb = analyze, label, observe }) {
  const budgets = loadBudgets()
  const byId = new Map(budgets.shapes.map((e) => [e.id, e]))
  const world = await bootWorld({ tier: 'free' })
  const reds = []
  const fence = switchFence()
  let n = 0
  try {
    await prepareWorld(world)
    if (analyzeDb) await world.analyze()
    if (analyze) { await world.restart(); await world.login() }
    const shapes = getShapes(world.ctx).filter((s) => (partIndex === undefined || part(s.id) === partIndex) && only(s.id))
    for (const shape of shapes) {
      const entry = byId.get(shape.id)
      if (!entry) { reds.push(`${shape.id}: no budget in budgets.json`); continue }
      let m
      try {
        if (analyze) await fence(world, shape)
        m = await measureGet(world, shape, { cold: !analyze, statements: Boolean(entry.pins) })
      } catch (e) { reds.push(`${shape.id}: threw ${String(e.message).slice(0, 160)}`); continue }
      if (observe) observe(shape, m)
      const problems = [...getProblems(entry, m, { analyze }), ...(m.warm.overDeadline || !entry.pins ? [] : await pinProblems(world, entry, m.statements))]
      n += 1
      if (problems.length) reds.push(`${shape.id} (${entry.route}): ${problems.join('; ')}`)
    }
  } finally { await world.dispose() }
  console.log(`${label}: ${n} shapes measured, ${reds.length} over budget`)
  for (const line of reds) console.error('RED ' + line)
  if (reds.length) process.exitCode = 1
  return reds
}

// A write shape: the same ceilings, plus a refused shape must refuse before it writes anything.
function writeProblems(entry, m) {
  if (m.overDeadline) return ['over budget: no answer within the deadline']
  const out = []
  if (m.status !== entry.status) out.push(`status ${m.status} ${m.code || ''}, budget has ${entry.status}`)
  if (entry.expect && entry.expect.refused) {
    if (codeOf(m) !== entry.expect.refused) out.push(`refusal code ${codeOf(m)}, budget has ${entry.expect.refused}`)
    if (m.changed.length) out.push(`a refused request wrote: ${m.changed.join(', ')}`)
  }
  if (m.calls > callsLimit(entry)) out.push(`cold calls ${m.calls} > ${callsLimit(entry)}`)
  if (m.rowsRead > entry.rows_max) out.push(`rows read ${m.rowsRead} > ${entry.rows_max}`)
  if (m.rowsWritten > entry.rows_written_max) out.push(`rows written ${m.rowsWritten} > ${entry.rows_written_max}`)
  return out
}

async function runWritePass({ label }) {
  const byId = new Map(loadBudgets().shapes.map((e) => [e.id, e]))
  const world = await bootWorld({ tier: 'free' })
  const reds = []
  let n = 0
  try {
    for (const shape of writeShapes(world.ctx).filter((s) => s.variant === 'base' && only(s.id))) {
      const entry = byId.get(shape.id)
      if (!entry) { reds.push(`${shape.id}: no budget in budgets.json`); continue }
      let m
      try { m = await measureWrite(world, shape) } catch (e) { reds.push(`${shape.id}: threw ${String(e.message).slice(0, 200)}`); continue }
      const problems = writeProblems(entry, m)
      n += 1
      if (problems.length) reds.push(`${shape.id} (${entry.route}): ${problems.join('; ')}`)
    }
  } finally { await world.dispose() }
  console.log(`${label}: ${n} write shapes measured, ${reds.length} over budget`)
  for (const line of reds) console.error('RED ' + line)
  if (reds.length) process.exitCode = 1
  return reds
}

module.exports = { setSwitches, clearSwitches, prepareWorld, writeProblems, runWritePass, loadBudgets, today, roundUp, callsLimit, part, measureGet, getProblems, pinProblems, runGetPass, switchFence, ensureCheckId, resolveUrl, codeOf, BUDGETS_FILE, FREE_CALL_LIMIT }
