'use strict'
// Companion for ops/queries/inventory-check-census-20261117.sql (read-only census before the count-request deploy).
//   1. The file passes the Ops read-only guard (one SELECT, nothing written, one row, at most 3 compound operators) and states its read budget.
//   2. On the full migrated chain, with a seeded world, every column counts what its header says, including the R1 victims (an offsetting dated count whose stored `lines` the older engine could
//      not see), the per-branch maxima (a product counted twice counts once; a count at 17:30 UTC is the next Cambodia business day), the row counts, the pending total and the last migration.
//   3. Discriminating controls: a decided approval is never a victim, and the same product checked on two branches counts once per branch.
// Run (from cloudflare/): node scripts/test-inventory-check-census-query-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '../..')
const migrationsDir = path.join(root, 'cloudflare/migrations')

async function main() {
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const query = guard.loadQuery('inventory-check-census-20261117')
  assert.equal(query.rules.minRows, 1); assert.equal(query.rules.maxRows, 1); assert.ok(query.maxRowsRead > 0, 'the read budget is stated')

  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  for (const file of fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  raw.exec("CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
  raw.exec("INSERT INTO d1_migrations(name) VALUES('0315_x.sql'),('0316_inventory_check_line_decisions.sql')")
  const run = () => ({ ...raw.prepare(query.sql).get() })

  const empty = run()
  assert.deepEqual(empty, { r1_pending_mismatch: 0, r1_pending_engine_zero: 0, max_checked_products_branch: 0, max_latest_days_branch: 0, sessions: 0, items: 0, events: 0, approvals_rows: 0, approvals_pending: 0,
    last_migration: '0316_inventory_check_line_decisions.sql' }, 'an empty database answers zeros, one row')

  raw.exec('PRAGMA foreign_keys=OFF')
  const session = raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at,closed_at) VALUES(?,1,?,7,'','closed','{}',?,?,?)")
  const item = raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,?,'{}',?,'{}',?,?,?,1,7,?)")
  const approval = raw.prepare("INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at) VALUES(?,1,?,'pending',?,7,?)")
  const make = (id, branch, at) => session.run(id, branch, at, at, at)
  // branch 1: product 1 checked twice (the later count is its latest), product 2 once, product 3 once; 17:30 UTC is 00:30 the next day in Cambodia.
  make('a', 1, '2026-11-10T17:30:00.000Z'); item.run('a', 1, 1, 5, 'done', 5, null, '2026-11-10T17:30:00.000Z'); item.run('a', 3, 1, 4, 'done', 4, null, '2026-11-10T17:30:00.000Z')
  make('b', 1, '2026-11-12T01:00:00.000Z'); item.run('b', 2, 1, 5, 'issue', 3, 'x', '2026-11-12T01:00:00.000Z')
  make('c', 1, '2026-11-12T05:00:00.000Z'); item.run('c', 1, 1, 5, 'done', 5, null, '2026-11-12T05:00:00.000Z')
  // branch 2: product 1 once.
  make('d', 2, '2026-11-10T10:00:00.000Z'); item.run('d', 1, 2, 7, 'done', 7, null, '2026-11-10T10:00:00.000Z')
  let seen = run()
  assert.deepEqual({ products: seen.max_checked_products_branch, days: seen.max_latest_days_branch }, { products: 3, days: 2 }, 'branch 1: three products, latest days 11 Nov (product 3, 00:30 Cambodia) and 12 Nov')

  // approvals: a healthy one (total differs, lines 1), an R1 victim (dated errors cancel: totals agree, lines 1), a partial mismatch (lines 2, one total differs), and a decided one that never counts.
  make('e', 1, '2026-11-13T01:00:00.000Z'); item.run('e', 11, 1, 5, 'issue', 3, 'x', '2026-11-13T01:00:00.000Z'); approval.run('e', 1, 1, '2026-11-13T01:00:00.000Z')
  make('f', 1, '2026-11-13T02:00:00.000Z'); item.run('f', 12, 1, 9, 'issue', 9, 'x', '2026-11-13T02:00:00.000Z'); approval.run('f', 1, 1, '2026-11-13T02:00:00.000Z')
  make('g', 1, '2026-11-13T03:00:00.000Z'); item.run('g', 13, 1, 5, 'issue', 3, 'x', '2026-11-13T03:00:00.000Z'); item.run('g', 14, 1, 2, 'issue', 2, 'x', '2026-11-13T03:00:00.000Z'); approval.run('g', 1, 2, '2026-11-13T03:00:00.000Z')
  make('h', 1, '2026-11-13T04:00:00.000Z'); item.run('h', 15, 1, 9, 'issue', 9, 'x', '2026-11-13T04:00:00.000Z'); approval.run('h', 1, 1, '2026-11-13T04:00:00.000Z')
  raw.exec("UPDATE inventory_check_approvals SET status='rejected',decided_by=9,decided_by_name='admin',decided_at='2026-11-13T05:00:00.000Z',decision_request_id='dec-12345678' WHERE session_id='h'")
  seen = run()
  assert.equal(seen.r1_pending_mismatch, 2, 'f (totals agree, lines 1) and g (lines 2, one total differs); e is healthy and h is decided'); assert.equal(seen.r1_pending_engine_zero, 1, 'only f is unreachable for the older engine')
  assert.deepEqual({ sessions: seen.sessions, items: seen.items, events: seen.events, approvals_rows: seen.approvals_rows, approvals_pending: seen.approvals_pending }, { sessions: 8, items: 10, events: 0, approvals_rows: 4, approvals_pending: 3 })
  assert.equal(seen.max_checked_products_branch, 8, 'branch 1 holds products 1, 2, 3 and 11 to 15 (product 1 counted twice is one); product 1 on branch 2 belongs to branch 2')
  console.log('PASS test-inventory-check-census-query-pure')
}
main().catch(error => { console.error(error); process.exit(1) })
