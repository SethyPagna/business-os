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

// A shape that lists "switches" is measured with those read switches stored (lib/readSwitches.ts reads them from system_flags), because that is the
// state the Free plan runs in; every other shape is measured with no switch row. READ_BUDGET_SWITCHES=off measures every shape with none (the old
// paths), for a before/after comparison. A change of state restarts the isolate, so a memoised switch from the previous shape cannot leak.
async function ensureSwitches(world, switches) {
  const wanted = process.env.READ_BUDGET_SWITCHES === 'off' || !switches || !Object.keys(switches).length ? null : JSON.stringify({ epoch: 1, switches })
  if ((world.switchRow || null) === wanted) return
  if (wanted) await world.db.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)").bind(wanted).run()
  else await world.db.prepare("DELETE FROM system_flags WHERE key='read_switches'").run()
  world.switchRow = wanted
  await world.restart()
  await world.login()
}

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

async function measureGet(world, shape, { cold = true, statements = false, fingerprints = false } = {}) {
  const url = await resolveUrl(world, shape.url)
  const probe = { method: 'GET', url, anon: shape.anon }
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

async function runGetPass({ partIndex, analyze = false, label }) {
  const budgets = loadBudgets()
  const byId = new Map(budgets.shapes.map((e) => [e.id, e]))
  const world = await bootWorld({ tier: 'free' })
  const reds = []
  let n = 0
  try {
    await prepareWorld(world)
    if (analyze) { await world.analyze(); await world.restart(); await world.login() }
    const shapes = getShapes(world.ctx).filter((s) => (partIndex === undefined || part(s.id) === partIndex) && only(s.id))
    for (const shape of shapes) {
      const entry = byId.get(shape.id)
      if (!entry) { reds.push(`${shape.id}: no budget in budgets.json`); continue }
      let m
      try { await ensureSwitches(world, entry.switches); m = await measureGet(world, shape, { cold: !analyze, statements: Boolean(entry.pins) }) } catch (e) { reds.push(`${shape.id}: threw ${String(e.message).slice(0, 160)}`); continue }
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

module.exports = { ensureSwitches, prepareWorld, writeProblems, runWritePass, loadBudgets, today, roundUp, callsLimit, part, measureGet, getProblems, pinProblems, runGetPass, ensureCheckId, resolveUrl, codeOf, BUDGETS_FILE, FREE_CALL_LIMIT }
