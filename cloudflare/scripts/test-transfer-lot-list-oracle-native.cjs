#!/usr/bin/env node
'use strict'
// S1 round 2, item 2 (owner 14 Nov: "transfer list only batches with stock"): the LIVE Transfer screen (TransferModal multiple mode, :382) loads each checked row's lots with
// getProductBatches(product, SOURCE branch, onlyAvailable = true) = GET /api/batches?productId=&branchId=&onlyAvailable=1 = lib/productBatches.ts listBatchesForProduct, and then filters
// them again with positiveTransferLots (frontend). This proves, over random worlds on the REAL migrated schema, that the list a row gets is exactly the lots holding stock at the source:
//   1. GUARDED worlds (every trigger kept, so the schema's own invariants hold: a lot holding stock is always active, 0154):
//        list(onlyAvailable) == the lots with quantity > 0 at the source branch, in FIFO order, with their quantities. No emptied, negative or other-branch lot, and no lot that holds stock is hidden.
//        It also equals the lots the transfer SERVER can draw from (readFifoLotAvailabilityForCart), the authority for what a transfer may take.
//   2. LEGACY worlds (triggers dropped, so raw bad states exist: an inactive lot holding stock, negatives, held aggregate units, damaged rows):
//        the same list equals the fold of the raw rows over ACTIVE lots (an inactive lot is not offered, exactly as the transfer server refuses it); the count of inactive-with-stock lots is
//        asserted positive so the case is exercised. (The guarded world cannot contain that state: the DB refuses it, asserted below as a positive control.)
//   3. SIBLINGS: listBatchesForProduct WITHOUT onlyAvailable (stock Set / Add pickers, returns restock into an emptied lot) keeps every active lot at the branch including empty ones.
//   4. FRONTEND MIRROR: TransferModal's positiveTransferLots over the server list keeps exactly the active, dated lots holding stock (0.25 and 0.5 included).
//   5. MUTANTS: `>= 0`, `>= 1`, CAST(... AS INTEGER) > 0, the branch ignored, onlyAvailable ignored, the active test dropped, and, on the frontend, `>= 1` and `>= 0`, each turn it red.
// Lot quantities include 0.25 and 0.5 (REAL quantities, transferOperation.ts): `>= 1` and an integer cast must not survive.
// Run: node scripts/test-transfer-lot-list-oracle-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const MODAL = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'branches', 'TransferModal.tsx')

function openCopy() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  return db
}
function legacyDatabase() {
  const db = openCopy()
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) db.exec(`DROP TRIGGER "${name}"`)
  db.exec('PRAGMA ignore_check_constraints = ON')
  return db
}
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
// D1-shaped wrapper: .all(params) for the library's named or positional binds.
// A mutant may drop a named parameter from the SQL: bind only the names the statement still uses.
const bindOf = (sql, params) => { if (Array.isArray(params)) return params; const used = {}; for (const [key, value] of Object.entries(params || {})) if (sql.includes('@' + key)) used[key] = value; return [used] }
const d1Of = (db) => ({ prepare: (sql) => ({ all: async (params) => db.prepare(sql).all(...bindOf(sql, params)), get: async (params) => db.prepare(sql).get(...bindOf(sql, params)) }) })
function loadModal(transform = (s) => s) {
  const source = transform(fs.readFileSync(MODAL, 'utf8').replace(/\r\n/g, '\n'))
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exportsObject = {}
  new Function('exports', 'require', out)(exportsObject, (name) => (name.includes('batchLabel') ? { batchDisplayLabel: (lot) => lot.received_at } : {}))
  return exportsObject
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = (rand, items) => items[Math.floor(rand() * items.length)]
const BRANCHES = [1, 2, 3]
const SOURCES = [1, 2, 3, 99] // 99: a branch nothing was ever received at
const FIFO = (a, b) => (a.expiry === null) - (b.expiry === null) || (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0) || (a.received < b.received ? -1 : a.received > b.received ? 1 : 0) || a.id - b.id

const cases = { inactiveWithStock: 0, fractionalLots: 0, emptyActiveAtSource: 0, otherBranchOnly: 0, negative: 0, undatedWithStock: 0, damagedRows: 0 }
let legacyDb = null, guardedDb = null
// ---- world 1: raw legacy states -----------------------------------------------------------------------------------------------------------------------------------------------
function buildLegacyWorld(seed) {
  const rand = mulberry32(seed)
  const db = legacyDb || (legacyDb = legacyDatabase())
  for (const table of ['damaged_stock_lots', 'branch_batch_stock', 'branch_stock', 'product_batches', 'products']) db.exec(`DELETE FROM ${table}`)
  const products = 5 + Math.floor(rand() * 6)
  let batchId = 0
  for (let p = 1; p <= products; p++) {
    db.prepare('INSERT INTO products(id,name,is_active,stock_quantity) VALUES(?,?,?,?)').run(p, `P${p}`, rand() < 0.85 ? 1 : 0, Math.floor(rand() * 5))
    // held / aggregate units: the branch total, which the lot list must never read
    for (const branch of BRANCHES) if (rand() < 0.5) db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(p, branch, pick(rand, [0, 3, 12, 40]))
    for (let i = 0, lots = Math.floor(rand() * 5); i < lots; i++) {
      batchId += 1
      const dated = rand() < 0.9
      db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,is_active,notes,synthetic) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(batchId, p, `K${batchId}`, rand() < 0.5 ? `LOT-${batchId}` : null, dated ? '2026-10-0' + (1 + (batchId % 8)) : null, rand() < 0.3 ? '2027-0' + (1 + (batchId % 8)) + '-01' : null, rand() < 0.8 ? 1 : 0, rand() < 0.2 ? 'tagged' : null, rand() < 0.1 ? 1 : 0)
      for (const branch of BRANCHES) {
        if (rand() < 0.4) continue
        db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run(batchId, branch, pick(rand, [0, 0, 0, 0.25, 0.5, 1, 2.5, 7, 40, -1, -3.5]))
      }
      if (rand() < 0.15) { db.prepare('INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source) VALUES(?,?,?,?,?,?,?)').run(p, pick(rand, BRANCHES), batchId, 2, pick(rand, [0, 2]), 'damaged', 'return'); cases.damagedRows += 1 }
    }
  }
  return db
}
// ---- world 2: invariant-obeying ---------------------------------------------------------------------------------------------------------------------------------------------------
function buildGuardedWorld(seed) {
  const rand = mulberry32(seed)
  const db = guardedDb || (guardedDb = guardedDatabase())
  for (const table of ['branch_batch_stock', 'product_batches', 'products']) db.exec(`DELETE FROM ${table}`)
  const products = 5 + Math.floor(rand() * 6)
  let batchId = 0
  for (let p = 1; p <= products; p++) {
    const active = rand() < 0.85 ? 1 : 0 // an inactive product holds no stock (0242)
    db.prepare('INSERT INTO products(id,name,is_active,stock_quantity) VALUES(?,?,?,0)').run(p, `G${p}`, active)
    for (let i = 0, lots = Math.floor(rand() * 5); i < lots; i++) {
      batchId += 1
      const lotActive = active && rand() < 0.8 ? 1 : 0 // a retired lot holds nothing (0154)
      db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,is_active) VALUES(?,?,?,?,?,?,?)')
        .run(batchId, p, `K${batchId}`, `LOT-${batchId}`, '2026-10-0' + (1 + (batchId % 8)), rand() < 0.3 ? '2027-0' + (1 + (batchId % 8)) + '-01' : null, lotActive)
      for (const branch of BRANCHES) {
        if (rand() < 0.4) continue
        db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run(batchId, branch, lotActive ? pick(rand, [0, 0, 0.25, 0.5, 1, 2.5, 7]) : 0)
      }
    }
  }
  return db
}

// The independent fold of the raw rows: never through the library's SQL.
function foldLots(db, productId, branch, { activeOnly }) {
  const stock = new Map(db.prepare('SELECT batch_id, quantity FROM branch_batch_stock WHERE branch_id = ?').all(branch).map((r) => [r.batch_id, r.quantity]))
  return db.prepare('SELECT id, is_active, received_at, expiry_date FROM product_batches WHERE variant_product_id = ?').all(productId)
    .filter((lot) => (!activeOnly || lot.is_active === 1) && (stock.get(lot.id) ?? 0) > 0)
    .map((lot) => ({ id: lot.id, expiry: lot.expiry_date ?? null, received: lot.received_at ?? '', quantity: stock.get(lot.id) }))
    .sort(FIFO)
}
const shape = (rows) => JSON.stringify(rows.map((r) => [Number(r.id), Number(r.quantity)]))

// Violations of the Transfer-list rule for one library build, over a set of worlds.
async function transferViolations(lib, seeds, { guarded, onWorld = () => {} }) {
  const bad = []
  for (const seed of seeds) {
    const db = guarded ? buildGuardedWorld(seed) : buildLegacyWorld(seed)
    onWorld(db)
    const d1 = d1Of(db)
    for (const { id: productId } of db.prepare('SELECT id FROM products').all()) {
      for (const branch of SOURCES) {
        const got = await lib.listBatchesForProduct(d1, productId, branch, { onlyAvailable: true })
        // guarded: "every lot holding stock at the source" (no activity test in the oracle: under the invariants the two coincide); legacy: active lots holding stock.
        const want = foldLots(db, productId, branch, { activeOnly: !guarded })
        if (shape(got) !== shape(want)) bad.push(`${guarded ? 'guarded' : 'legacy'} seed ${seed} product ${productId} branch ${branch}: list ${shape(got)} fold ${shape(want)}`)
      }
    }
  }
  return bad
}

async function main() {
  const productBatches = loadLib('productBatches.ts')
  const modal = loadModal()
  const GUARDED = Array.from({ length: 40 }, (_, i) => 201 + i)
  const LEGACY = Array.from({ length: 40 }, (_, i) => 1 + i)

  // 0. positive control: the schema itself refuses a lot that is inactive and holds stock, so the guarded world's "all lots holding stock" is the same set as "active lots holding stock".
  {
    const db = guardedDatabase()
    db.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'X',1,0)")
    db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active) VALUES(1,1,'K','L','2026-10-01',0)")
    assert.throws(() => db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,2)'), /requires an active received lot/, 'the DB refuses positive stock on an inactive lot (0154)')
  }

  // 1. GUARDED worlds: Transfer list == lots holding stock at the source == what the transfer server can draw from
  let listed = 0, pairs = 0, fractional = 0, emptyAtSource = 0
  const guardedBad = await transferViolations(productBatches, GUARDED, {
    guarded: true,
    onWorld: (db) => {
      const rows = db.prepare('SELECT bbs.quantity q, bbs.branch_id b, pb.is_active a FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id').all()
      fractional += rows.filter((r) => r.q > 0 && r.q < 1).length
      emptyAtSource += rows.filter((r) => r.q === 0 && r.a === 1).length
    },
  })
  assert.deepEqual(guardedBad, [], 'guarded worlds: the Transfer list equals the lots holding stock at the source')
  assert.ok(fractional > 20 && emptyAtSource > 20, `the guarded worlds hold fractional (${fractional}) and emptied active (${emptyAtSource}) lots`)
  for (const seed of GUARDED.slice(0, 20)) {
    const db = buildGuardedWorld(seed)
    const d1 = d1Of(db)
    for (const branch of BRANCHES) {
      const ids = db.prepare('SELECT id FROM products').all().map((r) => r.id)
      const authority = await productBatches.readFifoLotAvailabilityForCart(d1, ids.map((productId) => ({ productId, branchId: branch })))
      for (const productId of ids) {
        const got = await productBatches.listBatchesForProduct(d1, productId, branch, { onlyAvailable: true })
        const server = (authority.get(`${productId}:${branch}`) || []).map((lot) => [lot.batchId, lot.available]).sort((a, b) => a[0] - b[0])
        assert.deepEqual(got.map((lot) => [Number(lot.id), Number(lot.quantity)]).sort((a, b) => a[0] - b[0]), server, `seed ${seed} product ${productId} branch ${branch}: list == the lots the transfer server can allocate from`)
        listed += got.length; pairs += 1
      }
    }
  }
  assert.ok(listed > 40, 'the guarded worlds list stocked lots')

  // 2. LEGACY worlds: active lots holding stock; an inactive lot holding stock is not offered (the transfer server refuses it); held aggregate units, damaged rows and other branches never count
  const legacyBad = await transferViolations(productBatches, LEGACY, {
    guarded: false,
    onWorld: (db) => {
      const lots = db.prepare('SELECT pb.is_active a, pb.received_at r, bbs.quantity q, bbs.branch_id b, pb.variant_product_id p FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id').all()
      cases.inactiveWithStock += lots.filter((r) => r.a === 0 && r.q > 0).length
      cases.fractionalLots += lots.filter((r) => r.q > 0 && r.q < 1).length
      cases.emptyActiveAtSource += lots.filter((r) => r.a === 1 && r.q === 0 && r.b === 1).length
      cases.negative += lots.filter((r) => r.q < 0).length
      cases.undatedWithStock += lots.filter((r) => r.r === null && r.q > 0 && r.a === 1).length
      cases.otherBranchOnly += lots.filter((r) => r.b !== 1 && r.q > 0 && !lots.some((o) => o.p === r.p && o.b === 1 && o.q > 0)).length
    },
  })
  assert.deepEqual(legacyBad, [], 'legacy worlds: the Transfer list equals the active lots holding stock at the source')
  for (const [kind, count] of Object.entries(cases)) assert.ok(count > 0, `the legacy worlds must contain "${kind}" (positive control), got ${count}`)
  // The transfer server refuses an inactive lot too: the legacy list and the server's availability agree on every world.
  for (const seed of LEGACY.slice(0, 15)) {
    const db = buildLegacyWorld(seed)
    const d1 = d1Of(db)
    const ids = db.prepare('SELECT id FROM products').all().map((r) => r.id)
    for (const branch of BRANCHES) {
      const authority = await productBatches.readFifoLotAvailabilityForCart(d1, ids.map((productId) => ({ productId, branchId: branch })))
      for (const productId of ids) {
        const got = (await productBatches.listBatchesForProduct(d1, productId, branch, { onlyAvailable: true })).map((lot) => Number(lot.id)).sort((a, b) => a - b)
        assert.deepEqual(got, (authority.get(`${productId}:${branch}`) || []).map((lot) => lot.batchId).sort((a, b) => a - b), `legacy seed ${seed} product ${productId} branch ${branch}: list == transfer server availability`)
      }
    }
  }

  // 3. SIBLINGS: without onlyAvailable (Set / Add pickers, returns restock into an emptied lot) every ACTIVE lot at the branch stays, empty ones included
  let siblingEmpty = 0
  for (const seed of GUARDED.slice(0, 25)) {
    const db = buildGuardedWorld(seed)
    const d1 = d1Of(db)
    for (const { id: productId } of db.prepare('SELECT id FROM products').all()) {
      for (const branch of BRANCHES) {
        const got = await productBatches.listBatchesForProduct(d1, productId, branch)
        const wantIds = db.prepare('SELECT id FROM product_batches WHERE variant_product_id = ? AND is_active = 1 ORDER BY id').all(productId).map((r) => r.id)
        assert.deepEqual(got.map((lot) => Number(lot.id)).sort((a, b) => a - b), wantIds, `seed ${seed} product ${productId} branch ${branch}: the sibling list keeps every active lot`)
        siblingEmpty += got.filter((lot) => Number(lot.quantity) === 0).length
      }
    }
  }
  assert.ok(siblingEmpty > 20, 'the sibling list does show emptied lots (so a returns restock can pick one)')

  // 4. FRONTEND MIRROR: positiveTransferLots over the server list keeps the active, dated lots holding stock
  let mirrored = 0
  const mirrorBad = (mod) => {
    const bad = []
    for (const seed of LEGACY) {
      const db = buildLegacyWorld(seed)
      for (const { id: productId } of db.prepare('SELECT id FROM products').all()) {
        for (const branch of BRANCHES) {
          const server = db.prepare('SELECT pb.id id, pb.is_active is_active, pb.received_at received_at, bbs.quantity quantity FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = ? WHERE pb.variant_product_id = ?').all(branch, productId)
          const rows = server.map((r) => ({ ...r, quantity: r.quantity ?? 0 }))
          const want = rows.filter((r) => r.is_active === 1 && r.received_at && r.quantity > 0).map((r) => r.id).sort((a, b) => a - b)
          const got = mod.positiveTransferLots(rows).map((r) => r.id).sort((a, b) => a - b)
          if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`seed ${seed} product ${productId} branch ${branch}: frontend ${got} want ${want}`)
          mirrored += 1
        }
      }
    }
    return bad
  }
  assert.deepEqual(mirrorBad(modal), [], 'positiveTransferLots keeps exactly the active, dated lots holding stock, fractional ones included')
  assert.equal(modal.positiveTransferLots([{ id: 1, quantity: 0.25, received_at: '2026-10-01', is_active: 1 }, { id: 2, quantity: 0.5, received_at: '2026-10-01', is_active: 1 }]).length, 2, 'a lot holding 0.25 or 0.5 is offered')

  // 5. MUTANTS
  const source = fs.readFileSync(path.join(LIB, 'productBatches.ts'), 'utf8')
  const AVAILABLE = "${options.onlyAvailable ? 'AND COALESCE(bbs.quantity, 0) > 0' : ''}"
  const libMutants = [
    ['>= 0 instead of > 0', (s) => s.replace(AVAILABLE, "${options.onlyAvailable ? 'AND COALESCE(bbs.quantity, 0) >= 0' : ''}")],
    ['>= 1 instead of > 0 (drops 0.25 and 0.5)', (s) => s.replace(AVAILABLE, "${options.onlyAvailable ? 'AND COALESCE(bbs.quantity, 0) >= 1' : ''}")],
    ['CAST(quantity AS INTEGER) > 0 (drops 0.25 and 0.5)', (s) => s.replace(AVAILABLE, "${options.onlyAvailable ? 'AND CAST(COALESCE(bbs.quantity, 0) AS INTEGER) > 0' : ''}")],
    ['onlyAvailable ignored', (s) => s.replace(AVAILABLE, '')],
    ['the branch is ignored in the lot join', (s) => s.replace('LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = @branchId\n    WHERE pb.variant_product_id = @productId', 'LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id IS NOT NULL\n    WHERE pb.variant_product_id = @productId')],
    ['the active test is dropped (inactive lots that hold stock are listed)', (s) => s.replace('WHERE pb.variant_product_id = @productId AND pb.is_active = 1\n    ${options.onlyAvailable', 'WHERE pb.variant_product_id = @productId\n    ${options.onlyAvailable')],
    ['a lot at another branch counts (the join takes any branch with stock)', (s) => s.replace('AND bbs.branch_id = @branchId\n    WHERE pb.variant_product_id = @productId', 'AND bbs.branch_id <> @branchId\n    WHERE pb.variant_product_id = @productId')],
  ]
  for (const [name, mutate] of libMutants) {
    const mutated = mutate(source.replace(/\r\n/g, '\n'))
    assert.notEqual(mutated, source.replace(/\r\n/g, '\n'), `mutant "${name}" must change the source (anchor present)`)
    const lib = loadLib('productBatches.ts', (s) => mutate(s.replace(/\r\n/g, '\n')))
    const guardedRed = (await transferViolations(lib, GUARDED, { guarded: true })).length
    const legacyRed = (await transferViolations(lib, LEGACY, { guarded: false })).length
    assert.ok(guardedRed + legacyRed > 0, `mutant "${name}" survived: the oracle did not turn red`)
  }
  const modalMutants = [
    ['frontend >= 1 instead of > 0', (s) => s.replace('Number(batch.quantity) > 0', 'Number(batch.quantity) >= 1')],
    ['frontend >= 0 instead of > 0', (s) => s.replace('Number(batch.quantity) > 0', 'Number(batch.quantity) >= 0')],
    ['frontend integer cast', (s) => s.replace('Number(batch.quantity) > 0', 'Math.trunc(Number(batch.quantity)) > 0')],
    ['frontend drops the active test', (s) => s.replace('Number(batch.is_active) === 1 && ', '')],
  ]
  for (const [name, mutate] of modalMutants) {
    assert.notEqual(mutate(fs.readFileSync(MODAL, 'utf8').replace(/\r\n/g, '\n')), fs.readFileSync(MODAL, 'utf8').replace(/\r\n/g, '\n'), `mutant "${name}" must change the source (anchor present)`)
    assert.ok(mirrorBad(loadModal(mutate)).length > 0, `mutant "${name}" survived: the mirror did not turn red`)
  }
  console.log(`PASS transfer list: ${GUARDED.length} guarded + ${LEGACY.length} legacy worlds; ${pairs} guarded (product, branch) pairs, ${listed} stocked lots listed == server availability; ${fractional} fractional lots; ${siblingEmpty} emptied lots kept by the sibling list; ${mirrored} frontend mirror pairs; cases ${JSON.stringify(cases)}`)
  console.log(`PASS mutants: ${libMutants.length} server + ${modalMutants.length} frontend planted defects, each turned the oracle red`)
}
main().catch((error) => { console.error(error); process.exit(1) })
