#!/usr/bin/env node
// Fixture proof for ops/queries/forensics-import-replace-deactivations-20261116.sql (R2-3): products a replace-all import deactivated although the
// same import named them. The query runs exactly as the ops workflow runs it (the guard's canonical text) on a fresh node:sqlite database built
// from every migration, seeded with two worlds:
//   * the bug happened: a replace-all job removed products its own apply wrote stock rows for (a file with a branch column);
//   * it did not: a healthy replace-all job, plus every near-miss a plausible wrong query would also list.
// The audit row shape is the one lib/importEngine.ts finalizeProductReplacement writes, and the movement reason is the one the apply writes; both
// are pinned to the engine source below, so a change of either writer fails here instead of leaving the query reading a shape nobody writes.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const NAME = 'forensics-import-replace-deactivations-20261116'
const PERSONAL_COLUMN = /(^|_)(name|phone|address|email|note|notes)(_|$)/

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (err) { console.error(`FAIL ${name}\n  ${err && err.stack}`); process.exitCode = 1 }
}

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'health-import-replace-'))
const TEMPLATE = path.join(SCRATCH, 'migrated.sqlite')
const opened = []
function buildTemplate() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec(`VACUUM INTO '${TEMPLATE.replace(/'/g, "''")}'`)
  db.close()
}
function migratedDatabase() {
  const file = path.join(SCRATCH, `db-${opened.length + 1}.sqlite`)
  fs.copyFileSync(TEMPLATE, file)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF;')
  // Migration 0243 fences every stock-table write behind a permit row; fixtures seed through it. No query reads it.
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  opened.push(db)
  return db
}
function insert(db, table, rows) {
  for (const row of [].concat(rows)) {
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row)
  }
}
const plain = (rows) => rows.map((row) => ({ ...row }))

// What finalizeProductReplacement writes per product it deactivates (details is the json_object it builds).
function removal(productId, jobId, cutoff, createdAt, extra = {}) {
  return {
    action: 'delete', entity: 'product', entity_id: String(productId), table_name: 'product', record_id: String(productId),
    details: JSON.stringify({ source: 'replace_all', importJobId: jobId, cutoff, productName: 'ignored', membership: 'removed', priorMembership: 'present', ...extra }),
    created_at: createdAt,
  }
}
// What the apply writes for a row that carries a branch quantity: an 'add' movement with the job in the reason.
function stockRow(productId, jobId, rowNumber, branchId = 1) {
  return { product_id: productId, product_name: 'ignored', branch_id: branchId, branch_name: 'B', movement_type: 'add', quantity: 5, reason: `Product import ${jobId}, row ${rowNumber}`, created_at: '2026-11-10 09:00:00' }
}

async function main() {
  buildTemplate()
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const query = guard.loadQuery(NAME)
  const run = (db) => plain(db.prepare(query.sql).all())

  await check('the file passes the read-only guard with its row rules and runs on the bare migrated schema', () => {
    assert.deepEqual(query.rules, { minRows: 0, maxRows: 5000, expectZero: null })
    assert.ok(query.maxRowsRead > 0)
    const db = migratedDatabase()
    assert.deepEqual(run(db), [])
    const columns = db.prepare(query.sql).columns().map((c) => c.name)
    assert.deepEqual(columns.filter((c) => PERSONAL_COLUMN.test(c)), [], 'no personal column is returned')
    assert.deepEqual(columns, ['kind', 'job_id', 'product_id', 'products_removed', 'named_and_removed', 'stock_rows', 'cutoff', 'cutoff_form', 'removed_at', 'job_status', 'job_total_rows', 'job_created_at', 'product_active_now'])
  })

  await check('the audit row and the movement reason are the shapes the engine writes (the query reads nothing nobody writes)', () => {
    const engine = fs.readFileSync(path.join(ROOT, 'cloudflare', 'src', 'lib', 'importEngine.ts'), 'utf8')
    assert.ok(engine.includes("'delete','product',p.id,"), "finalizeProductReplacement writes action 'delete', entity 'product'")
    assert.ok(engine.includes("json_object('source','replace_all','importJobId',@jobId,'cutoff',@cutoff,"), 'the details keys the query reads')
    assert.ok(engine.includes('reason: `Product import ${jobId}, row ${r.rowNumber}`'), "the apply's movement reason")
    assert.ok(engine.includes('const namedProducts = job.type'), 'the 6.0.2096 named-id membership the header cites is still the rule')
  })

  await check('WORLD A (the bug happened): the suspects are exactly the removed products the same job wrote stock rows for', () => {
    const db = migratedDatabase()
    insert(db, 'import_jobs', [{ id: 'job-a', type: 'products', status: 'completed', total_rows: 3, policy_json: '{"import_mode":"replace_all"}', created_at: '2026-11-12 08:00:00', started_at: '2026-11-12 08:00:00' }])
    insert(db, 'products', [{ id: 1, name: 'p1', is_active: 0 }, { id: 2, name: 'p2', is_active: 1 }, { id: 3, name: 'p3', is_active: 0 }, { id: 4, name: 'p4', is_active: 1 }])
    insert(db, 'audit_logs', [
      removal(1, 'job-a', '2026-11-12T08:05:00.000Z', '2026-11-12 08:05:01'),
      removal(2, 'job-a', '2026-11-12T08:05:00.000Z', '2026-11-12 08:05:01'),
      removal(3, 'job-a', '2026-11-12T08:05:00.000Z', '2026-11-12 08:05:01'),
    ])
    insert(db, 'inventory_movements', [
      stockRow(1, 'job-a', 2), stockRow(1, 'job-a', 3, 2), // two branch rows of one product: one suspect, stock_rows = 2
      stockRow(2, 'job-a', 5), // reactivated since
      // product 3 has no stock row from the job: removed without proof it was listed (legitimately omitted, or a listed row with no quantity)
      stockRow(4, 'job-a', 6), // listed and NOT removed: not in the audit set, never reported
    ])
    const rows = run(db)
    assert.deepEqual(rows.map((r) => [r.kind, r.job_id, r.product_id]), [['job', 'job-a', null], ['product', 'job-a', 1], ['product', 'job-a', 2]])
    const job = rows[0]
    assert.deepEqual([job.products_removed, job.named_and_removed, job.cutoff, job.cutoff_form, job.removed_at, job.job_status, job.job_total_rows, job.job_created_at],
      [3, 2, '2026-11-12T08:05:00.000Z', 'iso', '2026-11-12 08:05:01', 'completed', 3, '2026-11-12 08:00:00'])
    assert.deepEqual([rows[1].stock_rows, rows[1].product_active_now], [2, 0], 'product 1: two stock rows, still deactivated')
    assert.deepEqual([rows[2].stock_rows, rows[2].product_active_now], [1, 1], 'product 2: one stock row, already reactivated')
    // Counts and ids only: nothing the audit row or the movement carries as a name reaches the result.
    assert.ok(!JSON.stringify(rows).includes('ignored') && !JSON.stringify(rows).includes('p1'))
  })

  await check('WORLD B (it did not): a healthy job and every near-miss print no suspect', () => {
    const db = migratedDatabase()
    insert(db, 'import_jobs', [
      { id: 'job-b', type: 'products', status: 'completed', total_rows: 2, policy_json: '{"import_mode":"replace_all"}', created_at: '2026-11-13 08:00:00' },
    ])
    insert(db, 'products', [{ id: 10, name: 'a' }, { id: 11, name: 'b' }, { id: 12, name: 'c' }, { id: 13, name: 'd' }, { id: 14, name: 'e' }])
    insert(db, 'audit_logs', [
      removal(10, 'job-b', '2026-11-13 08:00:00', '2026-11-13 08:05:01'), // SQL-form cutoff, no stock row: healthy removal
      removal(11, 'job-b', '2026-11-13 08:00:00', '2026-11-13 08:05:01'), // only a lookalike job id below
      removal(12, 'job-b', '2026-11-13 08:00:00', '2026-11-13 08:05:01'), // a stock row of ANOTHER job
      // not replace-all removals at all: the product DELETE route, an explicit bulk delete, a row with broken JSON, and one before provenance began
      { action: 'delete', entity: 'product', entity_id: '13', table_name: 'product', record_id: '13', details: JSON.stringify({ source: 'product_delete' }), created_at: '2026-11-13 09:00:00' },
      { action: 'delete', entity: 'product', entity_id: '13', table_name: 'product', record_id: '13', details: '{not json', created_at: '2026-11-13 09:01:00' },
      { action: 'update', entity: 'product', entity_id: '13', table_name: 'product', record_id: '13', details: JSON.stringify({ source: 'replace_all', importJobId: 'job-b' }), created_at: '2026-11-13 09:02:00' },
      removal(14, 'job-b', '2026-09-01 08:00:00', '2026-09-30 23:59:59'),
    ])
    insert(db, 'inventory_movements', [
      stockRow(11, 'job-bb', 1), // prefix lookalike: job-bb is not job-b
      stockRow(12, 'job-c', 1), // a different job named this product
      stockRow(13, 'job-b', 1), stockRow(14, 'job-b', 2), // listed, but the removal evidence is not a replace-all removal / is before provenance
      { ...stockRow(10, 'job-b', 9), reason: 'Product import job-b' }, // no ", row " suffix: not the apply's reason
      { ...stockRow(10, 'job-b', 9), reason: 'Stock count job-b, row 1' },
    ])
    const rows = run(db)
    assert.deepEqual(rows.map((r) => [r.kind, r.job_id, r.products_removed, r.named_and_removed, r.cutoff_form]), [['job', 'job-b', 3, 0, 'sql']], 'one healthy job row, zero suspects')
  })

  await check('CONTROL: moving one stock row of the same job onto a removed product makes it a suspect (the query is not vacuous)', () => {
    const db = migratedDatabase()
    insert(db, 'products', [{ id: 20, name: 'x', is_active: 0 }])
    insert(db, 'audit_logs', [removal(20, 'job-z', '2026-11-13 08:00:00', '2026-11-13 08:05:01')])
    assert.deepEqual(run(db).map((r) => [r.kind, r.named_and_removed]), [['job', 0]])
    insert(db, 'inventory_movements', [stockRow(20, 'job-z', 1)])
    assert.deepEqual(run(db).map((r) => [r.kind, r.product_id]), [['job', null], ['product', 20]])
    // A pruned import_jobs row (kept about 7 days) leaves the job columns NULL, the evidence intact.
    const [job, product] = run(db)
    assert.deepEqual([job.job_status, job.job_total_rows, job.job_created_at, job.named_and_removed], [null, null, null, 1])
    assert.equal(product.product_active_now, 0, 'an inactive product reads 0')
  })

  await check('two jobs and a product removed by both are reported once per job, ordered by job then kind', () => {
    const db = migratedDatabase()
    insert(db, 'products', [{ id: 30, name: 'y', is_active: 1 }])
    insert(db, 'audit_logs', [
      removal(30, 'job-2', '2026-11-12T10:00:00.000Z', '2026-11-12 10:00:05'),
      removal(30, 'job-1', '2026-11-11 10:00:00', '2026-11-11 10:00:05'),
    ])
    insert(db, 'inventory_movements', [stockRow(30, 'job-1', 1), stockRow(30, 'job-2', 1)])
    assert.deepEqual(run(db).map((r) => [r.kind, r.job_id, r.cutoff_form]), [['job', 'job-1', 'sql'], ['product', 'job-1', 'sql'], ['job', 'job-2', 'iso'], ['product', 'job-2', 'iso']])
  })

  await check('it reads indexes, not a scan of the audit trail (the plan names the action/created index and the product movement index)', () => {
    const db = migratedDatabase()
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all().map((row) => row.detail).join('\n')
    assert.match(plan, /idx_audit_logs_action_created/, plan)
    assert.match(plan, /idx_inventory_movements_product_created_pg/, plan)
  })

  await check('the movement join is pinned: the plan seeks the product index with or without optimizer statistics (never a scan of inventory_movements)', () => {
    const db = migratedDatabase()
    const planOf = () => db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all().map((row) => row.detail).join('\n')
    assert.match(query.sql, /CROSS JOIN inventory_movements m INDEXED BY idx_inventory_movements_product_created_pg/, 'the pin is in the query text')
    const without = planOf()
    // Production runs without statistics (never ANALYZE there); a plan must not depend on that staying true. ANALYZE needs rows to flip it.
    insert(db, 'audit_logs', Array.from({ length: 40 }, (_, i) => removal(500 + i, `job-s${i % 3}`, '2026-11-12T08:00:00.000Z', '2026-11-12T08:00:01.000Z')))
    insert(db, 'inventory_movements', Array.from({ length: 400 }, (_, i) => stockRow(2000 + i, 'job-other', i)))
    db.exec('ANALYZE')
    const withStats = planOf()
    for (const [label, plan] of [['without statistics', without], ['with statistics', withStats]]) {
      assert.match(plan, /SEARCH m USING INDEX idx_inventory_movements_product_created_pg/, `${label}: ${plan}`)
      assert.doesNotMatch(plan, /SCAN m\b/, `${label}: ${plan}`)
    }
  })

  for (const db of opened) db.close()
  fs.rmSync(SCRATCH, { recursive: true, force: true })
  console.log(`\n${passed} passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
