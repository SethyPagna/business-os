'use strict'
// lotLinesAvailable (migration 0294 present?): a positive answer is remembered for the isolate; a MISSING table is remembered for the window the routes pass (the plan's read-switch memo), so
// a deployment without 0294 stops probing on every list, overlay and lots read; any other failure is never remembered; and a migration applied later is seen once the window lapses.
//
// Run: node scripts/test-inventory-check-lot-lines-probe-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(id), module, module.exports)
  return module.exports
}
const sessions = load(path.join(__dirname, '../src/lib/inventoryCheckSessions.ts'))
const { getPlanLimits } = load(path.join(__dirname, '../src/lib/planTier.ts'))
const { readSwitchMemoMs } = load(path.join(__dirname, '../src/lib/readSwitches.ts'))
const source = fs.readFileSync(path.join(__dirname, '../src/routes/inventoryChecks.ts'), 'utf8')

// A database whose probe answers by script; `probes` counts the calls that reached it.
function database(script) {
  const state = { probes: 0, answer: script }
  return { state, prepare(sql) { assert.match(sql, /FROM inventory_check_lot_lines LIMIT 0/); return { all: async () => { state.probes++; if (state.answer) throw new Error(state.answer); return [] } } } }
}
const MISSING = 'D1_ERROR: no such table: inventory_check_lot_lines: SQLITE_ERROR'
const WINDOW = 15000

async function main() {
  // 1. Table missing: one probe per window, not one per request.
  sessions.resetLotLinesProbeForTests()
  let db = database(MISSING)
  for (let i = 0; i < 25; i++) assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 1000 + i * 10), false)
  assert.equal(db.state.probes, 1, '25 requests inside one window cost one probe')
  assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 1000 + WINDOW - 1), false); assert.equal(db.state.probes, 1, 'still inside the window')
  assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 1000 + WINDOW), false); assert.equal(db.state.probes, 2, 'the window lapsed: probed again')

  // 2. Control: with no window (the default) every call probes, as it always did.
  sessions.resetLotLinesProbeForTests(); db = database(MISSING)
  for (let i = 0; i < 5; i++) await sessions.lotLinesAvailable(db)
  assert.equal(db.state.probes, 5, 'no window, no memory of a miss')

  // 3. The migration is applied while the isolate lives: seen as soon as the window lapses, then remembered for good.
  sessions.resetLotLinesProbeForTests(); db = database(MISSING)
  assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 5000), false)
  db.state.answer = null
  assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 5000 + WINDOW - 1), false, 'inside the window the earlier miss stands')
  assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 5000 + WINDOW), true, 'after it the table is found')
  const probes = db.state.probes
  for (let i = 0; i < 10; i++) assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 90000 + i), true)
  assert.equal(db.state.probes, probes, 'a positive answer is remembered for the isolate')

  // 4. A transient failure (not a missing table) is never remembered: the next call probes again.
  sessions.resetLotLinesProbeForTests(); db = database('D1_ERROR: network connection lost')
  assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 1000), false); assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 1001), false)
  assert.equal(db.state.probes, 2, 'a blip is not mistaken for a missing migration')
  db.state.answer = null
  assert.equal(await sessions.lotLinesAvailable(db, WINDOW, 1002), true, 'and the next call recovers at once')

  // 5. The window is the plan's, not a literal, and the routes pass it at every call site.
  assert.equal(readSwitchMemoMs({ PLAN_TIER: 'free' }), getPlanLimits({ PLAN_TIER: 'free' }).readSwitchMemoSeconds * 1000)
  const calls = source.match(/lotLinesAvailable\(getDb\(c\.env\)[^)]*\)\)?/g) ?? []
  assert.equal(calls.length, 3, 'three route call sites')
  assert.ok(calls.every(call => call.includes('readSwitchMemoMs(c.env)')), `every route call passes the plan window: ${calls.join(' | ')}`)
  console.log('test-inventory-check-lot-lines-probe-pure: 5 groups passed')
}
main().catch(error => { console.error(error); process.exit(1) })
