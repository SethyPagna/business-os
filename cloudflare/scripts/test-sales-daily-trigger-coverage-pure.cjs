'use strict'
// Stored daily sales totals: the trigger layer is complete and stays complete. Replays EVERY migration (so a future migration that rebuilds `sales` and
// silently drops its triggers fails here) and pins:
//   1. the four mark-only triggers exist, with the SQL migration 0308 wrote, and every one carries the restore-mode guard of migration 0120;
//   2. every table the report kernel reads and stores has the insert, update and delete revision triggers of 0120 (sale_payment_events: the insert
//      trigger plus append-only update and delete), and each revision trigger carries the same guard;
//   3. every table salesAnalytics.ts reads is either covered by a revision trigger or named as read LIVE with a reason, so a table joined into the kernel
//      tomorrow cannot slip past the stored days;
//   4. nothing writes a covered table with REPLACE (INSERT OR REPLACE deletes without firing a delete trigger) in src, ops or any migration since 0120.
//
// Run (from cloudflare/): node scripts/test-sales-daily-trigger-coverage-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '..')
const REPO = path.join(ROOT, '..')
const lf = (text) => text.split('\r\n').join('\n')
const db = new DatabaseSync(':memory:')
const files = fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) db.exec(lf(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')))
const triggers = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'").all()
const GUARD = "NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')"
const norm = (text) => text.replace(/\s+/g, ' ').trim()
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

check('the four mark-only triggers exist with the SQL migration 0308 wrote, each guarded for restore mode', () => {
  const migration = lf(fs.readFileSync(path.join(ROOT, 'migrations', '0308_sales_daily_totals.sql'), 'utf8'))
  const wanted = {
    sales_daily_mark_revision_insert: 'sale_write_revisions', sales_daily_mark_revision_update: 'sale_write_revisions',
    sales_daily_mark_sale_delete: 'sales', sales_daily_mark_sale_moved: 'sales',
  }
  for (const [name, table] of Object.entries(wanted)) {
    const row = triggers.find((t) => t.name === name)
    assert.ok(row, `${name} is missing from the replayed schema (a migration dropped it?)`)
    assert.equal(row.tbl_name, table)
    const fromFile = new RegExp(`CREATE TRIGGER ${name}[\\s\\S]*?\\nEND;`).exec(migration)
    assert.ok(fromFile, `${name} not found in the migration file`)
    assert.equal(norm(row.sql) + ';', norm(fromFile[0]), `${name}: the live trigger is not the migration text`)
    assert.ok(norm(row.sql).includes(GUARD), `${name}: no restore-mode guard`)
    assert.ok(!/RAISE/i.test(row.sql), `${name}: a mark trigger must never raise (it would abort a sale)`)
  }
  assert.equal(triggers.filter((t) => t.name.startsWith('sales_daily_')).length, 4, 'exactly four')
})

const COVERED = ['sales', 'sale_items', 'sale_item_batch_allocations', 'returns', 'return_items', 'return_item_batch_allocations', 'fees', 'sale_amendments']
const event = (sql) => /\bAFTER\s+(INSERT|UPDATE|DELETE)\b/i.exec(sql)?.[1]?.toUpperCase()
const revisionTriggers = triggers.filter((t) => /INSERT INTO sale_write_revisions/i.test(t.sql))

check('every covered table has an insert, an update and a delete revision trigger, each guarded for restore mode', () => {
  for (const table of COVERED) {
    const mine = revisionTriggers.filter((t) => t.tbl_name === table)
    assert.deepEqual(mine.map((t) => event(t.sql)).sort(), ['DELETE', 'INSERT', 'UPDATE'], `${table}: revision triggers`)
    for (const t of mine) assert.ok(norm(t.sql).includes(GUARD), `${t.name}: no restore-mode guard`)
  }
})

check('sale_payment_events: the insert is revisioned and update and delete abort, so a payment event cannot change unmarked', () => {
  const insert = revisionTriggers.filter((t) => t.tbl_name === 'sale_payment_events')
  assert.deepEqual(insert.map((t) => event(t.sql)), ['INSERT'])
  assert.ok(norm(insert[0].sql).includes(GUARD))
  const abort = triggers.filter((t) => t.tbl_name === 'sale_payment_events' && /RAISE\s*\(\s*ABORT/i.test(t.sql)).map((t) => event(t.sql) || (/BEFORE\s+(UPDATE|DELETE)/i.exec(t.sql) || [])[1]?.toUpperCase()).sort()
  assert.deepEqual(abort, ['DELETE', 'UPDATE'])
})

// A table the kernel reads is covered (stored days follow it) or read live (the reader reads it fresh, never stored). A third kind must be a decision.
const LIVE = {
  customers: 'is_anonymous is read at read time: stored customer totals are per raw customer_id and folded to "general" by a live anonymous-id set (idx_customers_anonymous)',
  system_flags: 'the maintenance check and the switches, never stored',
  delivery_contacts: 'courier names for the per-courier cost reports, a later slice, read live',
  products: 'live product names are applied at read time (applyLiveProductNames); stored products carry the name history',
  categories: 'category groupings are not part of the slice-1 stored views',
  branch_stock: 'the dashboard stock overview, not sales',
}
const KERNEL_FILE = fs.readFileSync(path.join(ROOT, 'src/lib/salesAnalytics.ts'), 'utf8')
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))
const tablesRead = (source) => {
  const found = new Set()
  for (const m of source.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)) if (tables.has(m[1])) found.add(m[1])
  return [...found].sort()
}

check('every table the report kernel reads is covered by revision triggers or named as read live (a new join fails until decided)', () => {
  const read = tablesRead(KERNEL_FILE)
  const unknown = read.filter((t) => !COVERED.includes(t) && !(t in LIVE) && t !== 'sale_payment_events')
  assert.deepEqual(unknown, [], `salesAnalytics.ts now reads a table the stored days do not follow: ${unknown.join(', ')}. Cover it with a revision trigger or add it to LIVE with the reason.`)
  for (const t of ['sales', 'sale_items', 'returns', 'return_items', 'fees']) assert.ok(read.includes(t), `the scan no longer sees ${t}: the scanner is blind, not the kernel clean`)
  for (const t of Object.keys(LIVE)) assert.ok(tables.has(t), `LIVE names a table that does not exist: ${t}`)
})

check('control: the scanner flags a table joined into the kernel that no trigger covers', () => {
  const sample = `${KERNEL_FILE}\nconst x = 'SELECT 1 FROM sales s JOIN loyalty_point_adjustments l ON l.sale_id = s.id'`
  const extra = tablesRead(sample).filter((t) => !COVERED.includes(t) && !(t in LIVE) && t !== 'sale_payment_events')
  assert.deepEqual(extra, ['loyalty_point_adjustments'])
})

check('nothing writes a covered table with REPLACE in src, ops or any migration since 0120 (INSERT OR REPLACE fires no delete trigger)', () => {
  const T = [...COVERED, 'sale_payment_events'].join('|')
  const pattern = new RegExp(`\\b(?:INSERT\\s+OR\\s+REPLACE\\s+INTO|REPLACE\\s+INTO)\\s+(?:${T})\\b`, 'i')
  const hits = []
  const scan = (dir, exts, filter = () => true) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') scan(full, exts, filter); continue }
      if (exts.some((e) => full.endsWith(e)) && filter(full) && pattern.test(lf(fs.readFileSync(full, 'utf8')))) hits.push(path.relative(REPO, full))
    }
  }
  scan(path.join(ROOT, 'src'), ['.ts'])
  scan(path.join(REPO, 'ops'), ['.mjs', '.cjs', '.js', '.sql'])
  scan(path.join(ROOT, 'migrations'), ['.sql'], (f) => path.basename(f) >= '0120')
  assert.deepEqual(hits, [], 'REPLACE on a covered table')
  assert.ok(pattern.test('INSERT OR REPLACE INTO sale_items (a) VALUES (1)') && pattern.test('replace into returns(x)'), 'control: the pattern sees the forms it bans')
})

check('the revision table is the one every mark trigger hangs off: it keeps its rowid and its sale_id key', () => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sale_write_revisions'").get().sql
  assert.ok(/sale_id INTEGER PRIMARY KEY/i.test(sql) && !/WITHOUT\s+ROWID/i.test(sql))
})

console.log(`\n${passed} checks passed`)
