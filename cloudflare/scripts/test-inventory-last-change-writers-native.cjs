#!/usr/bin/env node
// INV-A S4a (Inventory replan 2.4): the Inventory overlay shows each product's "last recorded movement" from inventory_movements. That is only honest if every writer
// that moves stock records a movement, except the few that are known not to: branch cutover, merge undo, restore, reset and integrity repair. This runs every write shape
// of the read-budget world and checks the movement table against the stock tables:
//   a shape that changed branch stock or lot stock and changed NO movement row must be in ALLOWED_WITHOUT_MOVEMENT (named, with why).
// A new stock-moving writer that forgets its movement therefore fails here; an allowlisted writer that starts recording one fails too (the entry is stale).
// Positive control: the classifier is run on a fabricated shape that moves stock silently, and must name it.
'use strict'
const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')
const { writeShapes, measureWrite } = require('./read-budget/writes.cjs')
const { prepareWorld } = require('./read-budget/runner.cjs')

// Writers that move stock and leave no movement, by shape id. None of today's write shapes is one: the entries below are the known writers that have no shape
// (branch cutover x3 files, merge undo, restore, reset, integrity repair); a shape for one of them goes here with the same reason.
const ALLOWED_WITHOUT_MOVEMENT = new Map()
const WRITERS_WITHOUT_SHAPE = ['branch cutover', 'merge undo', 'restore', 'reset', 'integrity repair']

const movedStock = (changed) => changed.includes('branch_stock_qty') || changed.includes('lot_qty')
const wroteMovement = (changed) => changed.includes('inventory_movements')

/** The shape ids that moved stock with no movement and are not allowlisted, and the allowlisted ones that now do record a movement (stale entries). */
function classify(results, allowed) {
  const silent = results.filter((r) => movedStock(r.changed) && !wroteMovement(r.changed) && !allowed.has(r.id)).map((r) => r.id)
  const stale = results.filter((r) => allowed.has(r.id) && (!movedStock(r.changed) || wroteMovement(r.changed))).map((r) => r.id)
  return { silent, stale }
}

async function main() {
  const control = classify([{ id: 'fabricated-silent-writer', changed: ['branch_stock_qty', 'audit_logs'] }, { id: 'fabricated-honest-writer', changed: ['branch_stock_qty', 'inventory_movements'] }], new Map())
  assert.deepEqual(control.silent, ['fabricated-silent-writer'], 'positive control: the classifier names a silent writer and only it')
  assert.deepEqual(classify([{ id: 'x', changed: ['branch_stock_qty'] }], new Map([['x', 'reason']])), { silent: [], stale: [] }, 'positive control: an allowlisted silent writer is accepted')
  assert.deepEqual(classify([{ id: 'x', changed: ['branch_stock_qty', 'inventory_movements'] }], new Map([['x', 'reason']])), { silent: [], stale: ['x'] }, 'positive control: an allowlisted writer that now records a movement is stale')

  const world = await bootWorld({ tier: 'free', switches: { call_counting: 'on' } })
  const results = []
  try {
    await prepareWorld(world)
    for (const shape of writeShapes(world.ctx).filter((s) => s.variant === 'base')) {
      const m = await measureWrite(world, shape, { fingerprints: false })
      results.push({ id: shape.id, status: m.status, changed: m.changed })
    }
  } finally { await world.dispose() }
  const evaluated = results.filter((r) => r.status === 200 || r.status === 201)
  const movers = evaluated.filter((r) => movedStock(r.changed))
  console.log(`${results.length} write shapes, ${evaluated.length} answered, ${movers.length} moved stock, ${movers.filter((r) => wroteMovement(r.changed)).length} of them recorded a movement`)
  console.log(`not measured (no shape): ${WRITERS_WITHOUT_SHAPE.join(', ')}`)
  assert.ok(movers.length >= 10, `the run must observe stock-moving writers (saw ${movers.length}), or it proves nothing`)
  assert.ok(['w-adjust', 'w-sale-cancel-3-lines', 'w-return-3-lines', 'w-stock-session-5-lines', 'w-fast-stock-in-1-line', 'w-adjust-set-lot', 'w-inventory-check-approval-step', 'w-inventory-check-approval-step-counted', 'w-inventory-check-approval-lot-line'].every((id) => movers.some((r) => r.id === id)),
    'the main stock writers are among the observed movers')
  const { silent, stale } = classify(evaluated, ALLOWED_WITHOUT_MOVEMENT)
  assert.deepEqual(silent, [], `these write shapes moved stock and recorded no movement: ${silent.join(', ')}. Record the movement in the writer, or (if it is a known exception) allowlist it with the reason.`)
  assert.deepEqual(stale, [], `these allowlisted shapes no longer fit their entry: ${stale.join(', ')}`)
  console.log('PASS every stock-moving write shape records a movement (allowlist: none of the measured shapes needs it)')
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
