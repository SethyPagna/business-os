#!/usr/bin/env node
// P1.1 parity: the Free config with call_counting ON must write exactly what the Paid config writes for the same requests.
// Two real-Worker worlds start from ONE seed (Paid shares the Free seed through seedTier), run the same shapes in the same order
// with the same request ids, and the touched tables are compared row for row after every shape. Only clock values and random
// ids are normalised; every quantity, cost, price, status, reason and payload must be identical.
//
// Why Paid is the oracle: Paid never consults the switch and counts nothing against 50, so its writes are the pre-switch behaviour.
// A shape that Paid carries and Free(ON) also carries must leave the same stock, money and movement rows; a difference means
// admission changed what is written, not only what is allowed.
'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { bootWorld } = require('./read-budget/world.cjs')
const { writeShapes, measureWrite, resetSequence, lots } = require('./read-budget/writes.cjs')

// A 2-line fast stock-in: the Free call-counted cap is 2 (lib/planTier.ts), so both lines are carried on Free(ON) and on Paid. A 3-line request
// differs BY DESIGN (Free saves 2 and defers 1, Paid saves 3), so it is measured in test-call-counting-free-native.cjs, not compared here.
const fastStockIn = (n, offset) => ({ id: `x-fast-stock-in-${n}-lines`, method: 'POST', url: '/api/inventory/fast-stock-in/commit',
  prepare: async (world) => lots(world, n, offset),
  run: async (world, send, rows) => send('POST', '/api/inventory/fast-stock-in/commit', { lines: rows.map((r, i) => ({ key: `k${i}`, wire: 'adjust',
    body: { productId: r.pid, branchId: 1, quantity: 2, type: 'add', reason: 'Stock in', unitCostUsd: 2, supplierName: 'Supplier 3', client_request_id: `rb-par-fsi-${n}-${i}` } })) }) })

const SHAPES = [
  'w-stock-session-1-lines', 'w-stock-session-5-lines', 'w-stock-session-20-lines', 'w-stock-session-25-lines',
  'w-return-1-lines', 'w-return-3-lines', 'w-return-10-lines',
  'w-adjust', 'w-fast-stock-in-1-line', fastStockIn(2, 1300),
]
const TABLES = ['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'stock_session_operations', 'stock_session_members',
  'returns', 'return_items', 'sales', 'sale_items', 'sale_payment_events', 'sale_record_events', 'audit_logs', 'action_history', 'customers']
const idOf = (s) => (typeof s === 'string' ? s : s.id)

const ISO = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
// Receipt and return numbers carry the second they were made in (20261102-035908, RET-20261102-035916).
// A second sale made inside the same second takes a "-2" suffix, whichever world gets there second.
const STAMPED = /\d{8}-\d{6}(?:-\d+)?/g
// A SHA-256 over a snapshot that holds a random pool_key; the digest differs between two worlds whatever they wrote.
const DIGEST = /\b[0-9a-f]{64}\b/g
// Derived from fields that are compared on their own (receipt number, customer, branch, method), and it spells the stamp with spaces.
const DERIVED_COLUMNS = new Set(['search_normalized'])
const normalise = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.replace(ISO, '<ts>').replace(UUID, '<uuid>').replace(STAMPED, '<stamp>').replace(DIGEST, '<sha256>')
  if (typeof value === 'number' && value > 1.7e12 && value < 1.9e12) return '<epoch-ms>'
  return value
}
const hashRow = (row) => crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 10)

// What a shape changed: for every table, the rows that are new or differ from the previous snapshot of the same world (rows are
// compared by position in rowid order, so an insert appends and an update keeps its place). Only these rows are kept, so memory stays small.
async function snapshotDelta(world, previous) {
  const delta = {}
  for (const table of TABLES) {
    let rows
    try { rows = await world.all(`SELECT * FROM ${table} ORDER BY rowid`) } catch { continue }
    const normalised = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !DERIVED_COLUMNS.has(k)).map(([k, v]) => [k, normalise(v)])))
    const hashes = normalised.map(hashRow)
    const before = previous[table] || []
    const changed = []
    for (let i = 0; i < hashes.length; i++) if (hashes[i] !== before[i]) changed.push({ i, row: normalised[i] })
    previous[table] = hashes
    delta[table] = { count: hashes.length, removed: Math.max(0, before.length - hashes.length), changed }
  }
  return delta
}

function firstDifference(a, b) {
  if (a.count !== b.count) return `row count ${a.count} vs ${b.count}`
  if (a.changed.length !== b.changed.length) return `${a.changed.length} changed rows vs ${b.changed.length}`
  for (let i = 0; i < a.changed.length; i++) {
    if (a.changed[i].i !== b.changed[i].i) return `changed row positions ${a.changed[i].i} vs ${b.changed[i].i}`
    const keys = new Set([...Object.keys(a.changed[i].row), ...Object.keys(b.changed[i].row)])
    for (const key of keys) {
      const left = JSON.stringify(a.changed[i].row[key]) ?? '', right = JSON.stringify(b.changed[i].row[key]) ?? ''
      if (left === right) continue
      let at = 0
      while (at < left.length && left[at] === right[at]) at += 1
      const from = Math.max(0, at - 60)
      return `row ${a.changed[i].i} column ${key} at char ${at}: ...${left.slice(from, at + 60)} vs ...${right.slice(from, at + 60)}`
    }
  }
  return 'none'
}

async function runAll(world) {
  resetSequence()
  const results = {}
  const shapes = writeShapes(world.ctx)
  const previous = {}
  await snapshotDelta(world, previous)
  for (const spec of SHAPES) {
    const id = idOf(spec)
    const shape = typeof spec === 'string' ? shapes.find((s) => s.id === id) : spec
    assert.ok(shape, `unknown shape ${id}`)
    const m = await measureWrite(world, shape)
    results[id] = { status: m.status, code: m.code, calls: m.calls, bgError: m.bgError, tables: await snapshotDelta(world, previous), changed: m.changed,
      switchReads: ((await world.last()).stmts || []).filter((s) => /system_flags/i.test(s.raw) && JSON.stringify(s.values || []).includes('read_switches')).length }
  }
  return results
}

async function main() {
  // Positive control: the comparison must see a one-unit stock difference, or a green run proves nothing.
  const row = (quantity) => ({ count: 1, removed: 0, changed: [{ i: 0, row: { product_id: 1, quantity } }] })
  assert.notEqual(firstDifference(row(5), row(6)), 'none', 'a one-unit stock difference must be reported')
  assert.equal(firstDifference(row(5), row(5)), 'none')
  const free = await bootWorld({ tier: 'free', switches: { call_counting: 'on' }, enforceCalls: true })
  let onResults
  try { onResults = await runAll(free) } finally { await free.dispose() }
  const paid = await bootWorld({ tier: 'paid', seedTier: 'free' })
  let paidResults
  try { paidResults = await runAll(paid) } finally { await paid.dispose() }

  const problems = []
  let compared = 0
  for (const id of SHAPES.map(idOf)) {
    const a = onResults[id], b = paidResults[id]
    if (b.switchReads !== 0) problems.push(`${id}: Paid read the call_counting switch ${b.switchReads} times`)
    if (a.status !== b.status || a.code !== b.code) { problems.push(`${id}: Free(ON) answered ${a.status} ${a.code || ''}, Paid ${b.status} ${b.code || ''}`); continue }
    if (a.bgError) problems.push(`${id}: Free(ON) background error ${a.bgError}`)
    if (a.calls > 50) problems.push(`${id}: Free(ON) made ${a.calls} calls`)
    if (JSON.stringify(a.changed) !== JSON.stringify(b.changed)) problems.push(`${id}: changed tables differ: ${a.changed} vs ${b.changed}`)
    for (const table of TABLES) {
      if (!a.tables[table] || !b.tables[table]) continue
      compared += 1
      const d = firstDifference(a.tables[table], b.tables[table])
      if (d !== 'none') problems.push(`${id}: ${table} differs: ${d}`)
    }
  }
  console.log(`call-counting parity: ${SHAPES.length} shapes, ${compared} table comparisons, ${problems.length} differences`)
  for (const id of SHAPES.map(idOf)) console.log(`  ${id}: Free(ON) ${onResults[id].status} in ${onResults[id].calls} calls, Paid ${paidResults[id].status} in ${paidResults[id].calls} calls`)
  for (const line of problems) console.error('RED ' + line)
  if (problems.length) process.exitCode = 1
}

main().catch((e) => { console.error(`test-call-counting-parity-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
