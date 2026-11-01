#!/usr/bin/env node
// 6.0.1043 rewrote part of the weekly health pack (ops/queries/health-*.sql) to read fewer rows. The rewrite must return the
// SAME rows. cloudflare/scripts/fixtures/health-pack-6.0.1042/ holds the queries as they were; this test runs old and new
//   1. on the production-sized read-budget seed, clean, and again after planted defects that make the columns non-zero
//      (an old-versus-new comparison of two all-zero rows proves nothing, so every changed file must move under the plants);
//   2. for the two queries the old text cannot run on the seed (health-movement-balance-rows 349M reads, the STK-C drain 210M),
//      on a seeded-random database small enough for the old text.
// A mutant of the new text (one dropped condition) must turn it red: see the last check.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { bootWorld } = require('./read-budget/world.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const OLD_DIR = path.join(__dirname, 'fixtures', 'health-pack-6.0.1042')
const REWRITTEN = ['health-catalog-cost', 'health-legacy-ledgers', 'health-movement-balance', 'health-product-family', 'health-r2-references',
  'health-references', 'health-sale-money', 'health-shift-coverage']
const HEAVY = ['health-movement-balance-rows', 'stk-c-lot-drain-without-movement']

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (err) { console.error(`FAIL ${name}\n  ${err && err.stack}`); process.exitCode = 1 }
}

// Defects that move a column of each rewritten file. Every statement is a plain write on the seeded copy.
const PLANTS = [
  // migration 0243 fences stock-table writes behind a permit row; the plants below write through it
  "INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'",
  // health-sale-money: a v1 header off its components, a bad rate, a negative total, a short paid sale
  "UPDATE sales SET exchange_rate = 0 WHERE id IN (SELECT id FROM sales ORDER BY id LIMIT 5)",
  "UPDATE sales SET total_usd = -1 WHERE id IN (SELECT id FROM sales ORDER BY id DESC LIMIT 3)",
  "UPDATE sales SET amount_paid_usd = 0 WHERE id IN (SELECT id FROM sales WHERE sale_status = 'completed' ORDER BY id LIMIT 30 OFFSET 100)",
  // health-legacy-ledgers: two sales that carry the composite key of receivables (one match, and a second sale for the same key)
  "INSERT INTO sales (id, legacy_receipt_number, sale_status, total_usd, exchange_rate) SELECT 900001, invoice_no || '@' || substr(invoice_date, 1, 10), 'completed', 10, 4000 FROM customer_receivables ORDER BY id LIMIT 1",
  "INSERT INTO sales (id, legacy_receipt_number, sale_status, total_usd, exchange_rate) SELECT 900002, invoice_no || '@' || substr(invoice_date, 1, 10), 'completed', 11, 4000 FROM customer_receivables ORDER BY id LIMIT 1",
  "INSERT INTO sales (id, legacy_receipt_number, sale_status, total_usd, exchange_rate) SELECT 900003, invoice_no || '@' || substr(invoice_date, 1, 10), 'completed', 12, 4000 FROM customer_receivables ORDER BY id LIMIT 1 OFFSET 1",
  // health-catalog-cost: stored costs off the lot formula
  "UPDATE products SET cost_price_usd = cost_price_usd + 1 WHERE id IN (SELECT id FROM products WHERE is_active = 1 ORDER BY id LIMIT 50 OFFSET 200)",
  "UPDATE products SET purchase_price_usd = cost_price_usd + 2 WHERE id IN (SELECT id FROM products WHERE is_active = 1 ORDER BY id LIMIT 20 OFFSET 400)",
  // health-references: orphans on several owned links
  "INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (999991, 1000, 1), (999992, 1001, 1)",
  "INSERT INTO inventory_movements (product_id, branch_id, movement_type, quantity) VALUES (999993, 1, 'add', 1)",
  // health-product-family / health-r2-references: a child under a missing parent, an upload reference
  "UPDATE products SET parent_id = 999994 WHERE id IN (SELECT id FROM products ORDER BY id LIMIT 6 OFFSET 700)",
  "UPDATE products SET is_grouped_cached = 1 - COALESCE(is_grouped_cached, 0) WHERE id IN (SELECT id FROM products ORDER BY id LIMIT 30 OFFSET 50)",
  "UPDATE products SET name = '' WHERE id IN (SELECT id FROM products WHERE is_active = 1 ORDER BY id LIMIT 4 OFFSET 900)",
  "INSERT INTO product_images (product_id, image_path) VALUES (1002, '/uploads/parity-plant.png')",
  // health-shift-coverage: an open shift from before today and a close with no count
  "INSERT INTO shift_sessions (shift_code, user_id, branch_id, business_date, opened_at) VALUES ('PARITY1', 777, 1, date('now', '-3 days'), datetime('now', '-3 days'))",
  // health-movement-balance: stock moved with no movement
  "UPDATE branch_stock SET quantity = quantity + 2 WHERE id IN (SELECT id FROM branch_stock ORDER BY id LIMIT 25 OFFSET 900)",
]

async function seedParity(guard) {
  const world = await bootWorld({ tier: 'free' })
  try {
    // checked_at_utc is the wall clock of the run, not data
    const read = async (dir, name) => (await world.db.prepare(guard.guardSql(fs.readFileSync(path.join(dir, `${name}.sql`), 'utf8')).sql).all()).results
      .map((row) => { const { checked_at_utc: _clock, ...data } = row; return data })
    const NEW_DIR = path.join(ROOT, 'ops', 'queries')
    const cleanOld = {}
    await check('clean seed: every rewritten file returns the rows it returned before', async () => {
      for (const name of REWRITTEN) {
        cleanOld[name] = await read(OLD_DIR, name)
        const fresh = await read(NEW_DIR, name)
        if (JSON.stringify(fresh) !== JSON.stringify(cleanOld[name])) console.log(name, JSON.stringify(cleanOld[name]).slice(0, 700), JSON.stringify(fresh).slice(0, 700))
        assert.deepEqual(fresh, cleanOld[name], `${name} differs from its old text on the clean seed`)
      }
    })
    await check('planted defects: old and new agree, and every rewritten file moved (the comparison is not two zero rows)', async () => {
      const refused = []
      for (const sql of PLANTS) {
        try { await world.db.prepare(sql).run() } catch (error) { refused.push(`${sql.slice(0, 70)}: ${String(error.message).slice(0, 80)}`) }
      }
      console.log(`plants refused by the schema: ${refused.length}`); for (const r of refused) console.log(`  ${r}`)
      assert.ok(refused.length <= 4, `the schema refused too many plants: ${refused.join(' | ')}`)
      const unmoved = []
      for (const name of REWRITTEN) {
        const before = await read(OLD_DIR, name)
        assert.deepEqual(await read(NEW_DIR, name), before, `${name} differs from its old text after the plants`)
        if (JSON.stringify(before) === JSON.stringify(cleanOld[name])) unmoved.push(name)
      }
      // movement-balance carries a time column; a plant that changes nothing for a file is only tolerated for the file that has no seed analogue
      assert.deepEqual(unmoved.filter((n) => n !== 'health-r2-references'), [], `plants did not move: ${unmoved.join(', ')}`)
    })
    await check('the rewritten movement-balance-rows reads a few hundred thousand rows on the seed, not hundreds of millions', async () => {
      const q = guard.loadQuery('health-movement-balance-rows')
      const result = await world.db.prepare(q.sql).all()
      assert.ok(result.meta.rows_read < 400000, `rows read ${result.meta.rows_read}`)
      assert.ok(result.results.length > 0, 'the seed has unbalanced pairs, so the drill-down has rows')
    })
  } finally { await world.dispose() }
}

// ---------------------------------------------------------------- small random database for the two heavy queries

function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function randomDatabase(seed) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  const rnd = mulberry32(seed)
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const run = (sql, ...values) => db.prepare(sql).run(...values)
  const stamps = ['2026-10-20 09:00:00', '2026-10-20 09:00:01', '2026-10-21 14:30:00', '2026-10-22T08:15:00.000Z', '2026-10-23 11:00:00']
  const types = ['add', 'sale', 'remove', 'adjustment', 'transfer_in', 'transfer_out', 'damage_in', 'damage_out', 'return', 'set']
  const notes = [null, null, null, 'Received via product import', 'Stock reconciled from product import snapshot']
  let batchId = 0
  for (let pid = 1; pid <= 70; pid += 1) {
    run('INSERT INTO products (id, name, is_active) VALUES (?, ?, 1)', pid, `Parity ${pid}`)
    for (const bid of [1, 2]) run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, ?)', pid, bid, Math.floor(rnd() * 6))
    for (let l = 0; l < 1 + Math.floor(rnd() * 4); l += 1) {
      batchId += 1
      run('INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, notes) VALUES (?, ?, ?, 1, ?)', batchId, pid, `k${batchId}`, pick(notes))
      for (const bid of [1, 2]) {
        if (rnd() < 0.8) run('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)', batchId, bid, rnd() < 0.6 ? 0 : 1 + Math.floor(rnd() * 3), pick(stamps))
      }
    }
    for (let m = 0; m < Math.floor(rnd() * 6); m += 1) {
      const type = pick(types)
      const reason = type === 'adjustment' && rnd() < 0.5 ? 'Merged duplicate product "Old" (#9) into this product' : null
      run('INSERT INTO inventory_movements (product_id, branch_id, movement_type, quantity, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        pid, pick([1, 2, null]), type, 1 + Math.floor(rnd() * 3), reason, rnd() < 0.2 ? `${pid}` : null, pick(stamps.map((s) => (rnd() < 0.5 ? s : s.replace(/\d{2}$/, '30')))))
    }
    if (rnd() < 0.3) run('INSERT INTO damaged_stock_lots (product_id, branch_id, quantity, quantity_remaining) VALUES (?, ?, 2, ?)', pid, pick([1, 2, null]), Math.floor(rnd() * 3))
  }
  for (let r = 0; r < 12; r += 1) {
    run("INSERT INTO stock_mutation_receipts (actor_id, request_id, kind, request_json, written, response_status, created_at) VALUES (1, ?, 'adjust', ?, 1, ?, ?)",
      `req${r}`, JSON.stringify([['productId', 1 + r], ['branchId', 1], ['type', 'remove'], ['quantity', 2]]), rnd() < 0.5 ? 400 : 200, pick(stamps))
  }
  return db
}

function heavyParity(guard) {
  for (const name of HEAVY) {
    const oldSql = guard.guardSql(fs.readFileSync(path.join(OLD_DIR, `${name}.sql`), 'utf8')).sql
    const newSql = guard.loadQuery(name).sql
    assert.notEqual(oldSql, newSql, `${name}: the fixture is the old text`)
    let rows = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const db = randomDatabase(seed)
      const before = db.prepare(oldSql).all().map((r) => ({ ...r }))
      const after = db.prepare(newSql).all().map((r) => ({ ...r }))
      assert.deepEqual(after, before, `${name}: rows differ on random database ${seed}`)
      rows += before.length
      db.close()
    }
    assert.ok(rows >= 20, `${name}: ${rows} rows over six databases is too few for a parity check to mean anything`)
  }
}

async function main() {
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  await check('the frozen old texts exist for every rewritten query and differ from the new ones', () => {
    for (const name of [...REWRITTEN, ...HEAVY]) {
      const oldSql = guard.guardSql(fs.readFileSync(path.join(OLD_DIR, `${name}.sql`), 'utf8')).sql
      assert.notEqual(oldSql, guard.loadQuery(name).sql, `${name} was not rewritten`)
    }
  })
  await check('the two heavy queries return the same rows as their old text on six seeded-random databases', () => heavyParity(guard))
  await check('MUTANT: a new movement-balance-rows that drops the import lot join is caught', () => {
    const name = 'health-movement-balance-rows'
    const mutant = guard.loadQuery(name).sql.replace(/LEFT JOIN imp i ON i\.pid = b\.pid AND i\.bid = b\.bid/, 'LEFT JOIN imp i ON 0')
    assert.notEqual(mutant, guard.loadQuery(name).sql, 'the mutation changed nothing')
    const oldSql = guard.guardSql(fs.readFileSync(path.join(OLD_DIR, `${name}.sql`), 'utf8')).sql
    const diverged = [1, 2, 3, 4, 5, 6].some((seed) => {
      const db = randomDatabase(seed)
      const same = JSON.stringify(db.prepare(oldSql).all()) === JSON.stringify(db.prepare(mutant).all())
      db.close()
      return !same
    })
    assert.ok(diverged, 'no random database distinguishes the mutant from the old text')
  })
  await seedParity(guard)
  console.log(`test-health-pack-parity-native: ${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
