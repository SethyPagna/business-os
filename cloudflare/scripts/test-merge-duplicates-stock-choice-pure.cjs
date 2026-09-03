// "What happens when I keep one and the other row also has stock?"
//
// Resolving a name-twin pair used to fold the discarded row's stock onto the
// keeper unconditionally -- including for rows the operator had explicitly
// marked Remove. Merging that stock in and writing it off are BOTH defensible
// and they give opposite inventory answers, so the server must be told which,
// and must refuse to guess.
//
// This runs the REAL foldDuplicateProductInto from src/routes/products.ts
// (transpiled, its route-level dependencies stubbed) against the REAL schema
// built from the full migration chain, so a wrong table or column name -- which
// tsc cannot see, because the SQL is a string -- fails loudly here.
//
// Covered:
//   1. MERGE moves lots with their identity intact (lot code, expiry, received
//      date, branch) and SUMS a same-batch_key lot on the same branch into ONE
//      row rather than duplicating it.
//   2. WRITE-OFF zeroes the lots and leaves a BALANCED ledger: the negative
//      movements it writes exactly cancel the stock the discarded row held.
//   3. A stocked row with NO choice is refused, and nothing at all is written.
//   4. An unstocked row needs no choice and folds as before.
//   5. Every FK in MERGE_REPARENT_TABLES relinks, in both dispositions.
//   6. batch_number stays INTEGER-typed (production carries RECON lots that
//      stored TEXT there; nothing written here may add to that).
//
// Run (from cloudflare/): node scripts/test-merge-duplicates-stock-choice-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const SRC = path.join(cloudflareRoot, 'src')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`) } catch (e) { failed += 1; console.error(`  FAIL ${name}`); console.error(e) }
}

// --------------------------------------------------------------------------
// Load a real TS module with a chosen set of dependencies stubbed. Anything not
// named in `stubs` resolves to a permissive Proxy: routes/products.ts is a big
// file whose top level only builds a Hono router and some constants, and the
// fold under test touches none of that.
// --------------------------------------------------------------------------
function loadTs(relPath, stubs) {
  const abs = path.join(SRC, relPath)
  const src = fs.readFileSync(abs, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(abs),
  })
  const permissive = () => new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'default' ? permissive() : function () { return undefined }),
    apply: () => undefined,
    construct: () => ({}),
  })
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      mod.exports, require, mod, abs, path.dirname(abs),
    )
  } finally {
    Module._load = original
  }
  return mod.exports
}

// A no-op Hono so `new Hono()` + the file's ~120 app.get/app.post registrations
// run harmlessly at import time.
class FakeHono {
  get() { return this } post() { return this } put() { return this } patch() { return this }
  delete() { return this } use() { return this } on() { return this } all() { return this }
  route() { return this } onError() { return this } notFound() { return this }
}

function dbAdapter(d1) {
  return {
    prepare(sql) {
      const st = d1.prepare(sql)
      return {
        get: (p) => st.get(p == null ? {} : p),
        all: (p) => st.all(p == null ? {} : p),
        run: (p) => {
          const r = st.run(p == null ? {} : p)
          return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (stmts) => d1.batch(stmts),
  }
}

function loadProductsRoute(d1) {
  const adapter = dbAdapter(d1)
  const realDetailRule = loadTs(path.join('lib', 'productDetailRule.ts'), {})
  const realUndoAppliers = loadTs(path.join('lib', 'undoAppliers.ts'), {
    '../index': {}, './auth': {}, './db': { getDb: () => adapter }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
  })
  const auditCalls = []
  const mod = loadTs(path.join('routes', 'products.ts'), {
    hono: { Hono: FakeHono },
    '../lib/db': { getDb: () => adapter },
    '../lib/audit': { audit: async (_env, _uid, _uname, action, entity, id, detail) => { auditCalls.push({ action, entity, id, detail }) } },
    '../lib/undoAppliers': realUndoAppliers,
    '../lib/productDetailRule': realDetailRule,
  })
  return { mod, adapter, auditCalls, MERGE_REPARENT_TABLES: realUndoAppliers.MERGE_REPARENT_TABLES }
}

// --------------------------------------------------------------------------
// Fixture. Two twins of one real item, exactly the production shape: same name,
// barcodes differing by one leading zero. The DISCARDED row (200) holds stock at
// two branches across two lots, one of which collides with a lot the keeper
// already owns, plus one linked row in every table the merge must relink.
// --------------------------------------------------------------------------
const KEEPER = 100
const DUP = 200
const SHOP = 1
const WAREHOUSE = 2

function seed() {
  const d1 = openDb(loadAll())
  const run = (sql) => d1.db.prepare(sql).run()
  run(`INSERT INTO branches (id, name) VALUES (${SHOP}, 'shop'), (${WAREHOUSE}, 'warehouse')`)
  // The twin is priced HIGHER than the keeper, which is the case that makes a
  // merge quietly raise the shelf price (resolveMergedPricing takes the max).
  run(`INSERT INTO products (id, name, barcode, cost_price_usd, selling_price_usd, special_price_usd, stock_quantity, is_active)
       VALUES (${KEEPER}, 'Anastasia Dipbrow Pomade Dark Brown', '689304051040', 8, 22, 20, 5, 1),
              (${DUP},    'Anastasia Dipbrow Pomade Dark Brown', '0689304051040', 8, 25, 20, 10, 1)`)

  // Keeper: 5 pcs at the shop, all in lot SHARED.
  run(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (${KEEPER}, ${SHOP}, 5)`)
  run(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, batch_number, expiry_date, received_at, unit_cost_usd, is_active)
       VALUES (900, ${KEEPER}, 'SHARED', 'LOT-SHARED', 1, '2027-01-31', '2026-01-05', 8, 1)`)
  run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (900, ${SHOP}, 5)`)

  // Discarded twin: 7 at the shop (4 in its OWN lot, 3 in the colliding SHARED
  // lot) and 3 at the warehouse in its own lot.
  run(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (${DUP}, ${SHOP}, 7), (${DUP}, ${WAREHOUSE}, 3)`)
  run(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, batch_number, expiry_date, received_at, unit_cost_usd, is_active)
       VALUES (901, ${DUP}, 'OWN', 'LOT-OWN-0817', 1, '2027-08-17', '2026-02-11', 9, 1),
              (902, ${DUP}, 'SHARED', 'LOT-SHARED', 2, '2027-01-31', '2026-01-05', 8, 1)`)
  run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (901, ${SHOP}, 4), (901, ${WAREHOUSE}, 3), (902, ${SHOP}, 3)`)

  // The receipts that PUT that stock on the discarded row. A write-off has to
  // cancel these for the survivor's ledger to still add up.
  run(`INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, reason)
       VALUES (${DUP}, 'twin', ${SHOP}, 'stock_in', 7, 'received'),
              (${DUP}, 'twin', ${WAREHOUSE}, 'stock_in', 3, 'received')`)

  // One linked row in every table the merge must move.
  run(`INSERT INTO sales (id, receipt_number) VALUES (500, '20260901-101010')`)
  run(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity) VALUES (600, 500, ${DUP}, 'twin', 1)`)
  run(`INSERT INTO returns (id, return_number, sale_id) VALUES (700, 'RET-1', 500)`)
  run(`INSERT INTO return_items (id, return_id, product_id, product_name, quantity) VALUES (710, 700, ${DUP}, 'twin', 1)`)
  run(`INSERT INTO return_replacement_items (id, return_id, product_id, product_name, quantity) VALUES (720, 700, ${DUP}, 'twin', 1)`)
  run(`INSERT INTO damaged_stock_lots (id, product_id, product_name, branch_id, quantity, quantity_remaining) VALUES (730, ${DUP}, 'twin', ${SHOP}, 1, 1)`)
  run(`INSERT INTO stock_transfers (id, from_branch_id, to_branch_id, product_id, quantity) VALUES (740, ${WAREHOUSE}, ${SHOP}, ${DUP}, 1)`)
  run(`INSERT INTO rfid_tags (id, epc_id, product_id, branch_id) VALUES (750, 'EPC-1', ${DUP}, ${SHOP})`)
  run(`INSERT INTO rfid_events (id, session_id, epc_id, product_id, event_type) VALUES (760, 1, 'EPC-1', ${DUP}, 'read')`)
  run(`INSERT INTO rfid_session_items (id, session_id, epc_id, product_id, status) VALUES (770, 1, 'EPC-1', ${DUP}, 'expected')`)
  run(`INSERT INTO promotions (id, title, link_product_id) VALUES (780, 'Twin promo', ${DUP})`)
  return d1
}

// better-sqlite3 hands back null-prototype rows, which deepEqual refuses to
// match against plain object literals; flatten them so the expectations below
// read as the data they are.
const plain = (row) => (row == null ? row : { ...row })
const q = (d1, sql) => d1.db.prepare(sql).all().map(plain)
const one = (d1, sql) => plain(d1.db.prepare(sql).get())
const branchNames = new Map([[SHOP, 'shop'], [WAREHOUSE, 'warehouse']])

// A whole-database row-count fingerprint, so "nothing was written" can be
// asserted as a fact rather than spot-checked.
function fingerprint(d1) {
  const tables = q(d1, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  const out = {}
  for (const t of tables) out[t.name] = Number(one(d1, `SELECT COUNT(*) AS n FROM "${t.name}"`).n)
  return JSON.stringify(out)
}

async function main() {
  console.log('-- MERGE: lots move with their identity, same-lot same-branch is summed into one row --')
  {
    const d1 = seed()
    const { mod, adapter, auditCalls } = loadProductsRoute(d1)
    const stats = await mod.foldDuplicateProductInto(
      {}, adapter, { id: 42, name: 'Reviewer' },
      { id: KEEPER, name: 'Anastasia Dipbrow Pomade Dark Brown' },
      { id: DUP, name: 'Anastasia Dipbrow Pomade Dark Brown', image_path: null },
      branchNames, 'possible-duplicates review merge', 'merge',
    )

    await check('branch stock lands on the keeper, per branch, and the discarded row keeps none', () => {
      const keeper = q(d1, `SELECT branch_id, quantity FROM branch_stock WHERE product_id = ${KEEPER} ORDER BY branch_id`)
      assert.deepEqual(keeper, [{ branch_id: SHOP, quantity: 12 }, { branch_id: WAREHOUSE, quantity: 3 }])
      assert.equal(q(d1, `SELECT * FROM branch_stock WHERE product_id = ${DUP}`).length, 0)
      assert.equal(stats.quantityMoved, 10)
      assert.equal(stats.quantityWrittenOff, 0)
    })

    await check('the non-colliding lot MOVES with lot code, expiry, received date and branch intact', () => {
      const lot = one(d1, `SELECT variant_product_id, batch_key, lot_code, expiry_date, received_at, unit_cost_usd, is_active FROM product_batches WHERE id = 901`)
      assert.equal(lot.variant_product_id, KEEPER, 'the lot must now belong to the survivor')
      assert.equal(lot.batch_key, 'OWN')
      assert.equal(lot.lot_code, 'LOT-OWN-0817', 'lot identity must survive the merge')
      assert.equal(lot.expiry_date, '2027-08-17')
      assert.equal(lot.received_at, '2026-02-11')
      assert.equal(lot.unit_cost_usd, 9, 'the lot keeps its own cost, not the keeper\'s')
      assert.equal(lot.is_active, 1)
      const stock = q(d1, `SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = 901 ORDER BY branch_id`)
      assert.deepEqual(stock, [{ branch_id: SHOP, quantity: 4 }, { branch_id: WAREHOUSE, quantity: 3 }],
        'the lot keeps its BRANCH identity -- 4 at the shop and 3 at the warehouse stay separate')
    })

    await check('the colliding lot is SUMMED into the keeper\'s existing lot, leaving ONE row', () => {
      const keeperShared = q(d1, `SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = 900 ORDER BY branch_id`)
      assert.deepEqual(keeperShared, [{ branch_id: SHOP, quantity: 8 }], '5 + 3 in one row, not two rows')
      assert.equal(q(d1, `SELECT * FROM branch_batch_stock WHERE batch_id = 902`).length, 0, 'the folded lot must hold nothing')
      assert.equal(one(d1, `SELECT is_active FROM product_batches WHERE id = 902`).is_active, 0,
        'the emptied lot row stays in place, deactivated, because allocations may still reference its id')
      assert.equal(stats.batchesMoved, 1)
      assert.equal(stats.batchesFolded, 1)
      assert.equal(stats.batchesWrittenOff, 0)
    })

    await check('batch_number stays INTEGER-typed and is renumbered in the keeper\'s own sequence', () => {
      for (const row of q(d1, `SELECT id, batch_number, typeof(batch_number) AS t FROM product_batches WHERE variant_product_id = ${KEEPER}`)) {
        assert.equal(row.t, 'integer', `batch ${row.id} wrote a ${row.t} batch_number -- production already carries TEXT RECON lots; do not add to them`)
      }
      assert.equal(one(d1, `SELECT batch_number FROM product_batches WHERE id = 901`).batch_number, 2,
        'the moved lot takes the next number in the keeper\'s sequence')
    })

    await check('every foreign key relinks onto the keeper and the discarded row owns none', () => {
      const { MERGE_REPARENT_TABLES } = loadProductsRoute(d1)
      for (const { table, column } of MERGE_REPARENT_TABLES) {
        assert.equal(Number(one(d1, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ${DUP}`).n), 0,
          `${table}.${column} still points at the discarded row -- it would be orphaned`)
        assert.ok(Number(one(d1, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ${KEEPER}`).n) > 0,
          `${table}.${column} did not land on the survivor`)
      }
      assert.equal(stats.returnsReparented, 2, 'both the return item and the replacement item must move')
    })

    await check('the audit entry names the disposition and what moved', () => {
      const entry = auditCalls.find((c) => c.action === 'merge_duplicate')
      assert.ok(entry, 'a merge must be audited')
      assert.equal(entry.detail.stockDisposition, 'merge')
      assert.equal(entry.detail.quantityMoved, 10)
      assert.equal(entry.detail.returnsReparented, 2)
    })

    await check('a merge that RAISES the keeper\'s price says so, field by field, and stays undoable', () => {
      // A merge adopts the higher of the two rows' selling/special prices, so
      // resolving a twin pair can move what the shop rings up. Defensible rule,
      // indefensible surprise: it has to be visible before AND after.
      assert.equal(one(d1, `SELECT selling_price_usd FROM products WHERE id = ${KEEPER}`).selling_price_usd, 25,
        'the higher price is adopted (existing rule)')
      const entry = auditCalls.find((c) => c.action === 'merge_duplicate')
      assert.deepEqual(entry.detail.priceChanges, [{ field: 'selling_price_usd', from: 22, to: 25 }],
        'only the price that actually moved is reported -- the unchanged special price must not be noise')
      assert.deepEqual(stats.reversal.keeperPricingBefore, {
        selling_price_usd: 22, selling_price_khr: 0, special_price_usd: 20, special_price_khr: 0,
      }, 'undo must restore the exact pre-merge prices')
    })

    await check('the reversal records the disposition and every relinked table', () => {
      assert.equal(stats.reversal.stockDisposition, 'merge')
      assert.deepEqual(stats.reversal.writtenOffBatches, [])
      const tables = stats.reversal.reparentedByTable.map((e) => e.table)
      assert.ok(tables.includes('return_items'), 'undo cannot put back what the reversal never recorded')
      assert.ok(tables.includes('sale_items'))
    })
  }

  console.log('-- WRITE-OFF: lots are zeroed and the ledger still balances --')
  {
    const d1 = seed()
    const { mod, adapter, auditCalls } = loadProductsRoute(d1)
    const stats = await mod.foldDuplicateProductInto(
      {}, adapter, { id: 42, name: 'Reviewer' },
      { id: KEEPER, name: 'Anastasia Dipbrow Pomade Dark Brown' },
      { id: DUP, name: 'Anastasia Dipbrow Pomade Dark Brown', image_path: null },
      branchNames, 'possible-duplicates review merge', 'write_off',
    )

    await check('nothing lands on the keeper\'s shelf and the discarded row keeps no stock', () => {
      const keeper = q(d1, `SELECT branch_id, quantity FROM branch_stock WHERE product_id = ${KEEPER} ORDER BY branch_id`)
      assert.deepEqual(keeper, [{ branch_id: SHOP, quantity: 5 }], 'the keeper must be untouched by a write-off')
      assert.equal(q(d1, `SELECT * FROM branch_stock WHERE product_id = ${DUP}`).length, 0)
      assert.equal(stats.quantityWrittenOff, 10)
      assert.equal(stats.quantityMoved, 0)
    })

    await check('the discarded row\'s lots are emptied and deactivated in place, never moved', () => {
      for (const id of [901, 902]) {
        const lot = one(d1, `SELECT variant_product_id, is_active FROM product_batches WHERE id = ${id}`)
        assert.equal(lot.variant_product_id, DUP, 'a written-off lot must not travel to the survivor')
        assert.equal(lot.is_active, 0)
        assert.equal(q(d1, `SELECT * FROM branch_batch_stock WHERE batch_id = ${id}`).length, 0)
      }
      assert.deepEqual(q(d1, `SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = 900`), [{ branch_id: SHOP, quantity: 5 }],
        'the keeper\'s own lot must be untouched')
      assert.equal(stats.batchesWrittenOff, 2)
      assert.equal(stats.batchesMoved, 0)
      assert.equal(stats.batchesFolded, 0)
    })

    await check('a balancing NEGATIVE movement is written per branch, naming the reason and the user', () => {
      const rows = q(d1, `SELECT branch_id, quantity, reason, user_id, user_name FROM inventory_movements
                          WHERE movement_type = 'adjustment' ORDER BY branch_id`)
      assert.equal(rows.length, 2, 'one write-off movement per branch that held stock')
      assert.deepEqual(rows.map((r) => [r.branch_id, r.quantity]), [[SHOP, -7], [WAREHOUSE, -3]])
      for (const r of rows) {
        assert.match(String(r.reason), /removed -- stock written off/, 'the ledger line must say WHY the stock left')
        assert.match(String(r.reason), new RegExp(`\\(#${DUP}\\)`), 'the ledger line must name the removed record')
        assert.equal(r.user_id, 42, 'the ledger line must name WHO')
        assert.equal(r.user_name, 'Reviewer')
      }
      const stamped = q(d1, `SELECT created_at FROM inventory_movements WHERE movement_type = 'adjustment'`)
      for (const r of stamped) assert.ok(String(r.created_at || '').length > 0, 'the ledger line must be stamped WHEN')
    })

    await check('the survivor\'s ledger nets to zero for the written-off stock -- it stays balanced', () => {
      const perBranch = q(d1, `SELECT branch_id, SUM(quantity) AS net FROM inventory_movements
                               WHERE product_id = ${KEEPER} GROUP BY branch_id ORDER BY branch_id`)
      assert.deepEqual(perBranch, [{ branch_id: SHOP, net: 0 }, { branch_id: WAREHOUSE, net: 0 }],
        'the discarded row\'s +7/+3 receipts and the -7/-3 write-off must cancel on the row that inherited both')
      assert.equal(q(d1, `SELECT * FROM inventory_movements WHERE product_id = ${DUP}`).length, 0,
        'the whole ledger, write-off line included, follows the merge onto the survivor')
    })

    await check('every foreign key still relinks when the stock is written off', () => {
      const { MERGE_REPARENT_TABLES } = loadProductsRoute(d1)
      for (const { table, column } of MERGE_REPARENT_TABLES) {
        assert.equal(Number(one(d1, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ${DUP}`).n), 0,
          `${table}.${column} was orphaned by a write-off`)
      }
    })

    await check('the write-off is auditable per lot, and its reversal is recorded', () => {
      const entry = auditCalls.find((c) => c.action === 'merge_duplicate')
      assert.equal(entry.detail.stockDisposition, 'write_off')
      assert.equal(entry.detail.quantityWrittenOff, 10)
      assert.equal(entry.detail.lotsWrittenOff.length, 3, 'each (lot, branch) that held stock must be named')
      assert.deepEqual(
        entry.detail.lotsWrittenOff.map((l) => [l.batchId, l.branchId, l.quantity]).sort(),
        [[901, SHOP, 4], [901, WAREHOUSE, 3], [902, SHOP, 3]].sort(),
      )
      assert.equal(stats.reversal.stockDisposition, 'write_off')
      assert.equal(stats.reversal.writtenOffBatches.length, 2, 'undo must be able to bring both lots back')
      assert.ok(stats.reversal.adjustmentMovementIds.length >= 2, 'undo must be able to delete the write-off ledger lines')
    })
  }

  console.log('-- NO CHOICE + stock present: refused, and nothing at all is written --')
  {
    const d1 = seed()
    const { mod, adapter } = loadProductsRoute(d1)
    const before = fingerprint(d1)

    await check('the impact read reports the real per-branch, per-lot numbers', async () => {
      const impact = await mod.readMergeStockImpact(adapter, DUP, branchNames)
      assert.equal(impact.totalQuantity, 10)
      assert.equal(impact.lotCount, 3, '2 lots at the shop + 1 at the warehouse')
      assert.deepEqual(impact.branches, [
        { branchId: SHOP, branchName: 'shop', quantity: 7, lotCount: 2 },
        { branchId: WAREHOUSE, branchName: 'warehouse', quantity: 3, lotCount: 1 },
      ])
      assert.equal(mod.mergeStockImpactNeedsChoice(impact), true)
    })

    await check('the preview also reports the price the merge would move, before anything is confirmed', async () => {
      const pricing = await mod.readMergePricingChange(adapter, KEEPER, DUP)
      assert.deepEqual(pricing.changes, [{ field: 'selling_price_usd', from: 22, to: 25 }],
        'the reviewer must see the price change in the dialog, not discover it afterwards')
      assert.equal(pricing.before.selling_price_usd, 22)
      assert.equal(pricing.after.selling_price_usd, 25)
      assert.equal(pricing.after.special_price_usd, 20, 'an unchanged field is still reported so before/after is complete')
    })

    await check('reading the impact writes nothing -- the refusal path is side-effect free', () => {
      assert.equal(fingerprint(d1), before, 'neither the stock nor the price preview may write anything')
    })

    await check('the route refuses BEFORE folding, with 400 stock_choice_required and the numbers attached', () => {
      const routeSrc = fs.readFileSync(path.join(SRC, 'routes', 'products.ts'), 'utf8')
      const at = routeSrc.indexOf("app.post('/possible-duplicates/merge'")
      assert.ok(at > 0, 'the review merge route must exist')
      const block = routeSrc.slice(at, at + 4500)
      const guardAt = block.indexOf('stock_choice_required')
      const foldAt = block.indexOf('foldDuplicateProductInto(')
      assert.ok(guardAt > 0, 'the guard must exist')
      assert.ok(foldAt > guardAt, 'the guard must run BEFORE the fold, or the refusal comes after the writes')
      assert.match(block, /\}, 400\)/, 'a missing choice is a 400, not a silent default')
      assert.match(block, /stockImpact,/, 'the refusal must carry the numbers so the caller can ask properly')
      assert.match(block, /body\.stock === 'merge' \? 'merge' : body\.stock === 'write_off' \? 'write_off' : null/,
        'anything other than the two words must count as NO answer')
    })
  }

  console.log('-- NO stock: no choice needed, the merge proceeds on the default --')
  {
    const d1 = seed()
    const { mod, adapter } = loadProductsRoute(d1)
    d1.db.prepare(`DELETE FROM branch_stock WHERE product_id = ${DUP}`).run()
    d1.db.prepare(`DELETE FROM branch_batch_stock WHERE batch_id IN (901, 902)`).run()

    await check('an unstocked row needs no answer', async () => {
      const impact = await mod.readMergeStockImpact(adapter, DUP, branchNames)
      assert.equal(impact.totalQuantity, 0)
      assert.equal(mod.mergeStockImpactNeedsChoice(impact), false)
    })

    await check('and folds with the parameter omitted entirely', async () => {
      const stats = await mod.foldDuplicateProductInto(
        {}, adapter, { id: 42, name: 'Reviewer' },
        { id: KEEPER, name: 'Twin' }, { id: DUP, name: 'Twin', image_path: null },
        branchNames, 'possible-duplicates review merge',
      )
      assert.equal(stats.quantityMoved, 0)
      assert.equal(stats.quantityWrittenOff, 0)
      assert.equal(stats.reversal.stockDisposition, 'merge')
      assert.equal(one(d1, `SELECT is_active FROM products WHERE id = ${DUP}`).is_active, 0, 'the duplicate is still retired')
      assert.equal(Number(one(d1, `SELECT COUNT(*) AS n FROM return_items WHERE product_id = ${KEEPER}`).n), 1)
    })
  }

  console.log(failed ? `\n${failed} check(s) FAILED.` : '\nAll checks passed.')
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
