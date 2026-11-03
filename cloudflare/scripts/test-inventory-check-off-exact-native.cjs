#!/usr/bin/env node
// Lane 6.0.1044: with `ic_simple` OFF the Inventory Check list reads exactly what it read before the switch existed.
// Every OFF shape of /api/inventory-checks/products (the P0.1 harness's own shapes, recorded in fingerprints/api_inventory_checks_products.json
// before this lane) is run again with the switch absent and with it explicitly off; the first shape also meets shadow, a malformed document,
// an unknown token, the pre-P0.3 object shape and `ic_fix_stock` on alone. The switches are P0.3's: one statement per isolate, memoized for 15 s. So
// each run restarts the isolate with the document stored, sends a cheap Inventory Check read that makes that one statement (exactly one is counted),
// then sends the shape: its statements must be the recorded ones and nothing else (no switch read, no new table, no new column, no changed text).
// A positive control runs the first shape with the switch ON: its statements must differ from the recorded ones, so the comparison can tell the
// two paths apart.
'use strict'

// The stock-sort shapes read millions of rows; a loaded machine must not turn that into a missing answer.
process.env.READ_BUDGET_DEADLINE_MS = process.env.READ_BUDGET_DEADLINE_MS || '180000'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { bootWorld, runShape } = require('./read-budget/world.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { prepareWorld } = require('./read-budget/runner.cjs')

const STORED = JSON.parse(fs.readFileSync(path.join(__dirname, 'read-budget/fingerprints/api_inventory_checks_products.json'), 'utf8'))
const SWITCH_READ = /^SELECT key, value FROM system_flags WHERE key IN\b/
const PRIME = '/api/inventory-checks/sessions?branchId=1&page=1&pageSize=1'
// Statements the Worker runs now and then on any request, whatever the route (a throttled session touch, the scheduled-send check):
// they are not the route's own reads, so they appear or not from one run to the next.
const AMBIENT = [/^UPDATE user_sessions SET last_seen_at\b/, /^SELECT send_key FROM telegram_scheduled_sends\b/]
const ambient = ([, head]) => AMBIENT.some((pattern) => pattern.test(head))
const doc = (switches) => JSON.stringify({ epoch: 3, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches })
// Each state of the stored switch document that must leave the old path alone.
const OFF_STATES = [
  ['no row', null],
  ['ic_simple off', doc({ ic_simple: 'off' })],
  ['ic_simple shadow', doc({ ic_simple: 'shadow:0.05' })],
  ['ic_fix_stock on only', doc({ ic_fix_stock: 'on' })],
  ['the pre-P0.3 object shape', doc({ ic_simple: { state: 'on' } })],
  ['malformed', '{not json'],
  ['unknown token', doc({ ic_simple: 'enabled' })],
]

async function main() {
  const world = await bootWorld({ tier: 'free' })
  const problems = []
  let compared = 0
  try {
    await prepareWorld(world)
    const shapes = getShapes(world.ctx).filter((shape) => shape.url.startsWith('/api/inventory-checks/products') && !shape.switches)
    assert.ok(shapes.length >= 6, `the harness has the OFF inventory-check shapes (${shapes.length})`)
    const measure = async (shape, rowValue) => {
      const url = shape.url.includes('{{') ? shape.url.replaceAll('{{checkId}}', world.state.checkId) : shape.url
      const seen = { switchReads: -1 }
      const probe = { method: 'GET', url, prepare: async (w) => { if (rowValue !== null) await w.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(rowValue).run() },
        run: async (w, send) => {
          try {
            await send('GET', PRIME)
            seen.switchReads = ((await w.last()).stmts || []).filter((stmt) => SWITCH_READ.test(String(stmt.raw).replace(/\s+/g, ' ').trim())).length
            return await send('GET', url)
          } finally { await w.db.prepare("DELETE FROM system_flags WHERE key = 'read_switches'").run() }
        } }
      const run = await runShape(world, probe, { cold: true, fingerprints: true })
      return { ...run, switchReads: seen.switchReads, fingerprints: run.fingerprints ? run.fingerprints.map((print) => [print.h, print.head]) : undefined }
    }
    for (const shape of shapes) {
      const recorded = STORED[shape.id]
      if (!recorded) { problems.push(`${shape.id}: no recorded fingerprints (record them before the switch existed)`); continue }
      const own = recorded.filter((print) => !ambient(print))
      for (const [label, rowValue] of shape === shapes[0] ? OFF_STATES : OFF_STATES.slice(0, 2)) {
        const run = await measure(shape, rowValue)
        compared += 1
        if (!run.fingerprints) { problems.push(`${shape.id} [${label}]: no fingerprints captured (status ${run.status})`); continue }
        if (run.switchReads !== 1) { problems.push(`${shape.id} [${label}]: the first request of a fresh isolate should make exactly one switch read, made ${run.switchReads}`); continue }
        const extra = run.fingerprints.filter(([, head]) => SWITCH_READ.test(head))
        if (extra.length !== 0) { problems.push(`${shape.id} [${label}]: the memo should answer the second request, but it read the switches again: ${JSON.stringify(extra)}`); continue }
        const rest = run.fingerprints.filter((entry) => !ambient(entry))
        const same = rest.length === own.length && rest.every(([hash], index) => hash === own[index][0])
        if (!same) {
          const at = rest.findIndex(([hash], index) => !own[index] || hash !== own[index][0])
          problems.push(`${shape.id} [${label}]: statements differ from the recorded OFF path (recorded ${own.length}, now ${rest.length}): first difference at ${at}: ${JSON.stringify(rest[at])}`)
        }
      }
    }
    const control = await measure(shapes[0], doc({ ic_simple: 'on' }))
    const onHashes = (control.fingerprints || []).filter((print) => !SWITCH_READ.test(print[1]) && !ambient(print)).map(([hash]) => hash)
    const offHashes = (STORED[shapes[0].id] || []).filter((print) => !ambient(print)).map(([hash]) => hash)
    if (control.status !== 200 || JSON.stringify(onHashes) === JSON.stringify(offHashes)) problems.push(`positive control: the switch ON should read different statements than the recorded OFF path (status ${control.status})`)
  } finally { await world.dispose() }
  console.log(`test-inventory-check-off-exact-native: ${compared} OFF runs compared, ${problems.length} differences`)
  for (const line of problems) console.error('RED ' + line)
  process.exitCode = problems.length ? 1 : 0
}

main().catch((error) => { console.error(`test-inventory-check-off-exact-native: crashed: ${error && error.stack}`); process.exitCode = 1 })
