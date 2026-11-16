#!/usr/bin/env node
'use strict'
// S1 (stock-state design 15 Nov, owner 14 Nov): GET /api/batches/tracked-product-ids counts a product only while a lot HOLDS STOCK (quantity > 0) in the scope asked for.
// The reader is lib/productBatches.ts getTrackedProductIds; its only consumer is the Transfer screen, which lists a product's batches with onlyAvailable (lots holding stock).
//
// Four proofs, each on the REAL migrated schema in node:sqlite, with the real library transpiled (no copy of the SQL lives in this file except the OLD text, kept verbatim as the oracle):
//   1. ORACLE      over random worlds (branches, positive / zero / negative lots, inactive lots, inactive products, tagged and damaged rows, held units): the new ids
//                  equal an independent JS fold of the raw rows, AND equal "the old route's ids minus the products no lot of which holds stock in that scope".
//   2. PICKER      over random worlds that obey every stock invariant (triggers kept): a product is tracked at a branch exactly when the Transfer picker's list for it is non-empty,
//                  and that list is exactly the lots holding stock there (so the list shows stocked batches only, and no stocked lot is hidden).
//   3. PLAN        the branch read seeks idx_branch_batch_stock_branch_qty on quantity > 0, the no-branch read uses the positive-only partial index; neither scans product_batches.
//   4. MUTANTS     the real source with one defect planted must turn the oracle red: `>= 0`; the branch ignored; empty active lots counted again; inactive lots ignored.
// Run: node scripts/test-tracked-ids-positive-lots-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')

const LIB = path.join(__dirname, '..', 'src', 'lib')

// The reader as it ran in production at 1ae9f2041 (before S1), verbatim.
const OLD_SQL = (branch) => branch
  ? `SELECT DISTINCT pb.variant_product_id AS productId
       FROM product_batches pb
       JOIN branch_batch_stock bbs
         ON bbs.batch_id = pb.id
        AND bbs.branch_id = @branchId
       WHERE pb.is_active = 1 OR bbs.quantity > 0`
  : `SELECT DISTINCT pb.variant_product_id AS productId
       FROM product_batches pb
       WHERE pb.is_active = 1
          OR EXISTS (SELECT 1 FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0)`

// In-memory databases: a file database fsyncs every statement of a seeding loop (minutes on Windows), memory does not.
function openCopy() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  return db
}
// A world of raw legacy states (an inactive lot holding stock, a negative quantity, stock on an inactive product): every trigger and CHECK that would refuse them is off.
function legacyDatabase() {
  const db = openCopy()
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) db.exec(`DROP TRIGGER "${name}"`)
  db.exec('PRAGMA ignore_check_constraints = ON')
  return db
}
// A world that obeys the schema's own invariants: every guard stays on, writes go through the stock permit, and the generator only writes what the guards allow.
function guardedDatabase() {
  const db = openCopy()
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  return db
}

function loadLib(fileName, transform = (s) => s, loaded = new Map()) {
  const file = path.join(LIB, fileName)
  if (loaded.has(file)) return loaded.get(file).exports
  const mod = { exports: {} }
  loaded.set(file, mod)
  const output = ts.transpileModule(transform(fs.readFileSync(file, 'utf8')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  }).outputText
  const requireLib = (request) => request.startsWith('./') ? loadLib(`${request.slice(2).replace(/\.ts$/, '')}.ts`, (s) => s, loaded) : require(request)
  new Function('require', 'module', 'exports', output)(requireLib, mod, mod.exports)
  return mod.exports
}
const d1Of = (db, seen) => ({ prepare: (sql) => ({ all: async (params) => { if (seen) seen.push(sql); return db.prepare(sql).all(params || {}) } }) })

function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = (rand, items) => items[Math.floor(rand() * items.length)]

const BRANCHES = [1, 2, 3]
const SCOPES = [null, 1, 2, 3, 99] // 99: a branch nothing was ever received at

// ---- world 1: raw legacy states -------------------------------------------------------------------------------------------------------------------------------------------------
const kinds = { activeEmptyOnly: 0, inactiveEmptyOnly: 0, negativeOnly: 0, inactivePositive: 0, otherBranchOnly: 0, positive: 0, inactiveProduct: 0 }
let legacyDb = null
const LEGACY_TABLES = ['damaged_stock_lots', 'branch_batch_stock', 'branch_stock', 'product_batches', 'products']
// One database for every world (copying and un-triggering the migrated schema per world is the slow part): the tables are emptied and the world seeded again.
function buildLegacyWorld(seed) {
  const rand = mulberry32(seed)
  const db = legacyDb || (legacyDb = legacyDatabase())
  for (const table of LEGACY_TABLES) db.exec(`DELETE FROM ${table}`)
  const products = 6 + Math.floor(rand() * 8)
  let batchId = 0
  for (let p = 1; p <= products; p++) {
    const productActive = rand() < 0.8 ? 1 : 0
    db.prepare('INSERT INTO products(id,name,is_active,stock_quantity) VALUES(?,?,?,?)').run(p, `P${p}`, productActive, Math.floor(rand() * 5))
    if (!productActive) kinds.inactiveProduct += 1
    if (rand() < 0.6) db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(p, pick(rand, BRANCHES), pick(rand, [0, 3, 12])) // held units on the aggregate
    const lots = Math.floor(rand() * 5) // 0..4 lots, none for some products
    for (let i = 0; i < lots; i++) {
      batchId += 1
      const lotActive = rand() < 0.8 ? 1 : 0
      db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,notes,synthetic) VALUES(?,?,?,?,?,?,?,?)')
        .run(batchId, p, rand() < 0.3 ? ` no-lot:${batchId}` : `K${batchId}`, rand() < 0.5 ? `LOT-${batchId}` : null, '2026-10-0' + (1 + (batchId % 8)), lotActive, rand() < 0.2 ? 'tagged' : null, rand() < 0.1 ? 1 : 0)
      for (const branch of BRANCHES) {
        if (rand() < 0.45) continue // no row for this lot at this branch
        const quantity = pick(rand, [0, 0, 0, 0.25, 0.5, 1, 2.5, 7, 40, -1, -3.5])
        db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run(batchId, branch, quantity)
      }
      if (rand() < 0.15) db.prepare("INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source) VALUES(?,?,?,?,?,?,?)").run(p, pick(rand, BRANCHES), batchId, 2, pick(rand, [0, 2]), 'damaged', 'return')
    }
  }
  return db
}
// The independent fold: the raw rows into JS, never through the reader's SQL.
function foldPositiveProducts(db, scope) {
  const lotProduct = new Map(db.prepare('SELECT id, variant_product_id AS p FROM product_batches').all().map((r) => [r.id, r.p]))
  const out = new Set()
  for (const row of db.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock').all()) {
    if ((scope === null || row.branch_id === scope) && row.quantity > 0 && lotProduct.has(row.batch_id)) out.add(lotProduct.get(row.batch_id))
  }
  return out
}
function classify(db) {
  const lots = db.prepare('SELECT pb.variant_product_id AS p, pb.is_active AS a, bbs.branch_id AS b, bbs.quantity AS q FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id').all()
  const byProduct = new Map()
  for (const lot of lots) { if (!byProduct.has(lot.p)) byProduct.set(lot.p, []); byProduct.get(lot.p).push(lot) }
  for (const [, rows] of byProduct) {
    const atOne = rows.filter((r) => r.b === 1)
    if (rows.some((r) => r.q > 0)) kinds.positive += 1
    if (rows.some((r) => r.q > 0 && r.a === 0)) kinds.inactivePositive += 1
    if (atOne.length && atOne.every((r) => r.q <= 0) && atOne.some((r) => r.a === 1 && r.q === 0)) kinds.activeEmptyOnly += 1
    if (atOne.length && atOne.every((r) => r.q <= 0 && r.a === 0)) kinds.inactiveEmptyOnly += 1
    if (atOne.length && atOne.every((r) => r.q < 0)) kinds.negativeOnly += 1
    if (!atOne.some((r) => r.q > 0) && rows.some((r) => r.b !== 1 && r.q > 0)) kinds.otherBranchOnly += 1
  }
}

// Returns a list of human-readable violations ([] when the library agrees with the oracle everywhere).
async function oracleViolations(lib, seeds, onWorld = () => {}) {
  const bad = []
  for (const seed of seeds) {
    const db = buildLegacyWorld(seed)
    onWorld(db)
    const d1 = d1Of(db)
    for (const scope of SCOPES) {
      const got = (await lib.getTrackedProductIds(d1, scope)).sort((a, b) => a - b)
      const fold = [...foldPositiveProducts(db, scope)].sort((a, b) => a - b)
      if (JSON.stringify(got) !== JSON.stringify(fold)) bad.push(`seed ${seed} scope ${scope}: got [${got}] fold [${fold}]`)
      // "the old route's ids minus the products with no lot holding stock in that scope" is the same set, taken from the OLD statement.
      const old = db.prepare(OLD_SQL(scope !== null)).all(scope !== null ? { branchId: scope } : {}).map((r) => r.productId)
      const holdsStock = foldPositiveProducts(db, scope)
      const oldMinusEmpty = old.filter((id) => holdsStock.has(id)).sort((a, b) => a - b)
      if (JSON.stringify(got) !== JSON.stringify(oldMinusEmpty)) bad.push(`seed ${seed} scope ${scope}: got [${got}] old-minus-empty [${oldMinusEmpty}]`)
      if (!got.every((id) => old.includes(id))) bad.push(`seed ${seed} scope ${scope}: the new set is not a subset of the old one`)
    }
  }
  return bad
}

// ---- world 2: invariant-obeying, for the Transfer picker -----------------------------------------------------------------------------------------------------------------------
let guardedDb = null
function buildGuardedWorld(seed) {
  const rand = mulberry32(seed)
  const db = guardedDb || (guardedDb = guardedDatabase())
  for (const table of ['branch_batch_stock', 'product_batches', 'products']) db.exec(`DELETE FROM ${table}`) // lots first: a product with a lot holding stock cannot be deleted (0242)
  const products = 5 + Math.floor(rand() * 6)
  let batchId = 0
  for (let p = 1; p <= products; p++) {
    const active = rand() < 0.85 ? 1 : 0 // an inactive product can hold no stock at all (0242)
    db.prepare('INSERT INTO products(id,name,is_active,stock_quantity) VALUES(?,?,?,0)').run(p, `G${p}`, active)
    for (let i = 0, lots = Math.floor(rand() * 5); i < lots; i++) {
      batchId += 1
      const lotActive = active && rand() < 0.8 ? 1 : 0 // a retired lot holds nothing (0154)
      db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active) VALUES(?,?,?,?,?,?)').run(batchId, p, `K${batchId}`, `LOT-${batchId}`, '2026-10-0' + (1 + (batchId % 8)), lotActive)
      for (const branch of BRANCHES) {
        if (rand() < 0.4) continue
        const quantity = lotActive ? pick(rand, [0, 0, 0.25, 0.5, 1, 2.5, 7]) : 0
        db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run(batchId, branch, quantity)
      }
    }
  }
  return db
}

async function main() {
  const productBatches = loadLib('productBatches.ts')

  // 1. ORACLE
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
  const violations = await oracleViolations(productBatches, SEEDS, classify)
  for (const [kind, count] of Object.entries(kinds)) assert.ok(count > 0, `the worlds must contain the case "${kind}" (positive control), got ${count}`)
  assert.deepEqual(violations, [], 'the reader equals the oracle in every world and scope')
  // The oracle must also be able to see a product the OLD route returned and the new one must not (the change itself), at the branch and without it.
  let dropped = 0
  for (const seed of SEEDS) {
    const db = buildLegacyWorld(seed)
    for (const scope of [1, null]) {
      const got = new Set(await productBatches.getTrackedProductIds(d1Of(db), scope))
      dropped += db.prepare(OLD_SQL(scope !== null)).all(scope !== null ? { branchId: scope } : {}).filter((r) => !got.has(r.productId)).length
    }
  }
  assert.ok(dropped > 0, 'some product the old route listed is gone from the new one (otherwise this test proves nothing about the change)')
  console.log(`PASS oracle: ${SEEDS.length} worlds x ${SCOPES.length} scopes; ${dropped} empty-lot products dropped; cases ${JSON.stringify(kinds)}`)

  // 2. PICKER
  let pickerProducts = 0, pickerLots = 0, trackedPairs = 0
  for (let seed = 101; seed <= 130; seed++) {
    const db = buildGuardedWorld(seed)
    const d1 = d1Of(db)
    for (const branch of BRANCHES) {
      const tracked = new Set(await productBatches.getTrackedProductIds(d1, branch))
      for (const { id } of db.prepare('SELECT id FROM products').all()) {
        const list = await productBatches.listBatchesForProduct(d1, id, branch, { onlyAvailable: true })
        const stocked = db.prepare('SELECT pb.id FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id WHERE pb.variant_product_id = ? AND bbs.branch_id = ? AND bbs.quantity > 0 ORDER BY pb.id').all(id, branch).map((r) => r.id)
        assert.deepEqual(list.map((lot) => lot.id).sort((a, b) => a - b), stocked, `seed ${seed} branch ${branch} product ${id}: the picker lists exactly the stocked lots`)
        assert.ok(list.every((lot) => lot.quantity > 0), 'and every listed lot holds stock')
        assert.equal(tracked.has(id), list.length > 0, `seed ${seed} branch ${branch} product ${id}: tracked exactly when the picker has something to list`)
        pickerProducts += 1; pickerLots += list.length; trackedPairs += tracked.has(id) ? 1 : 0
      }
    }
  }
  assert.ok(trackedPairs > 20 && pickerLots > 20 && pickerProducts > trackedPairs, 'the picker worlds hold stocked and unstocked products')
  console.log(`PASS transfer picker: ${pickerProducts} (product, branch) pairs, ${trackedPairs} tracked, ${pickerLots} stocked lots listed, tracked == picker non-empty`)

  // 3. PLAN
  {
    const db = guardedDatabase()
    const seen = []
    const d1 = d1Of(db, seen)
    await productBatches.getTrackedProductIds(d1, 2)
    await productBatches.getTrackedProductIds(d1, null)
    const [branchSql, allSql] = seen
    const plan = (sql, params) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params).map((r) => r.detail).join(' | ')
    const branchPlan = plan(branchSql, { branchId: 2 })
    const allPlan = plan(allSql, {})
    assert.match(branchPlan, /SEARCH bbs USING (COVERING )?INDEX idx_branch_batch_stock_branch_qty \(branch_id=\? AND quantity>\?\)/, branchPlan)
    assert.match(allPlan, /idx_branch_batch_stock_positive_batch_0155/, allPlan)
    for (const text of [branchPlan, allPlan]) assert.doesNotMatch(text, /SCAN pb|SCAN product_batches/, text)
    console.log(`PASS plan: branch "${branchPlan}"; all "${allPlan}"`)
  }

  // 4. MUTANTS
  const source = fs.readFileSync(path.join(LIB, 'productBatches.ts'), 'utf8')
  const mutants = [
    ['>= 0 instead of > 0', (s) => s.replace('bbs.quantity > 0`', 'bbs.quantity >= 0`')],
    ['the branch is ignored', (s) => s.replace("branchId ? 'bbs.branch_id = @branchId AND ' : ''", "branchId ? '@branchId IS NOT NULL AND ' : ''")],
    ['empty active lots are counted again', (s) => s.replace('bbs.quantity > 0`', '(bbs.quantity > 0 OR pb.is_active = 1)`')],
    ['inactive lots are ignored', (s) => s.replace('bbs.quantity > 0`', 'bbs.quantity > 0 AND pb.is_active = 1`')],
    ['a negative lot counts', (s) => s.replace('bbs.quantity > 0`', 'bbs.quantity <> 0`')],
    // F2: quantities are REAL, so a lot holding 0.25 or 0.5 holds stock; these two drop it and only a world with a lot between 0 and 1 can tell.
    ['>= 1 instead of > 0 (drops a lot holding 0.25 or 0.5)', (s) => s.replace('bbs.quantity > 0`', 'bbs.quantity >= 1`')],
    ['CAST(quantity AS INTEGER) > 0 (drops a lot holding 0.25 or 0.5)', (s) => s.replace('bbs.quantity > 0`', 'CAST(bbs.quantity AS INTEGER) > 0`')],
    ['another branch counts when the branch is set', (s) => s.replace("'bbs.branch_id = @branchId AND '", "'bbs.branch_id <> @branchId AND '")],
  ]
  for (const [name, mutate] of mutants) {
    assert.notEqual(mutate(source), source, `mutant "${name}" must change the source (anchor present)`)
    const lib = loadLib('productBatches.ts', mutate)
    const bad = await oracleViolations(lib, SEEDS)
    assert.ok(bad.length > 0, `mutant "${name}" survived: the oracle did not turn red`)
  }
  console.log(`PASS mutants: ${mutants.length} planted defects, each turned the oracle red`)
}
main().catch((error) => { console.error(error); process.exit(1) })
