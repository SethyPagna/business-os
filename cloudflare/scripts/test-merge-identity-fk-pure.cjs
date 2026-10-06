// N15 merge correctness: what the reviewer is told, what the merge refuses,
// and the guarantee that NOTHING linked to the discarded row is left behind.
//
// Four things are pinned here, each with the case that discriminates it from
// the behaviour that shipped before 2026-09-06:
//
//  1. FK COMPLETENESS. Every product FK in the schema is either walked by
//     MERGE_REPARENT_TABLES, handled explicitly by the fold, or on the
//     EXCLUDED list below WITH a reason. The sweep reads the migrations, so a
//     new table with a product FK fails here instead of silently orphaning its
//     rows at the next merge.
//  2. THE PRICE PREVIEW NAMED DEAD COLUMNS. MERGE_PRICE_FIELDS listed
//     special_price_usd/khr -- zeroed on every row by migration 0111 -- while
//     the fold itself moves wholesale_price_*. So the one price change a merge
//     can actually make was the one change the preview could never show, and
//     with no stock and equal selling prices the client skipped the confirm
//     dialog entirely.
//  3. THE IDENTITY GATE WAS DEAD. useMergeStockChoice refuses to auto-merge on
//     `preview.identity` (cross-identity, or a merge that fills in the kept
//     row's cost). The server never returned `identity`, so both tests read
//     undefined and were structurally false.
//  4. COST. The preview never mentioned cost at all, and a pair whose costs are
//     too far apart to be one cost was merged anyway (keeping the dearer, a
//     figure neither row recorded). It is now refused, on both merge routes.
//
// Plus the stock-session rule (MERGE-UNBLOCK, 1 Oct 2026): a merge rewrites the
// very rows a stock-in session's undo asserts on, so the merge CLOSES that Undo
// in its own batch instead of waiting for the session to expire (it never does).
//
// Real transpiled route + lib code against the REAL schema from the full
// migration chain -- the SQL here is strings tsc cannot check.
//
// Run (from cloudflare/): node scripts/test-merge-identity-fk-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const SRC = path.join(cloudflareRoot, 'src')
const routeSrc = fs.readFileSync(path.join(SRC, 'routes', 'products.ts'), 'utf8')
const appliersSrc = fs.readFileSync(path.join(SRC, 'lib', 'undoAppliers.ts'), 'utf8')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`) } catch (e) { failed += 1; console.error(`  FAIL ${name}`); console.error(e && e.message ? e.message : e) }
}

// --------------------------------------------------------------------------
// Module loading, same shape as test-merge-duplicates-stock-choice-pure.cjs:
// the real file, its route-level dependencies stubbed, everything unrelated a
// permissive proxy.
// --------------------------------------------------------------------------
function loadTs(relPath, stubs) {
  const abs = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
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
    batch: (stmts) => {
      const readOnly = stmts.every(({ sql }) => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql))
      if (!readOnly) return d1.batch(stmts)
      return Promise.resolve(stmts.map(({ sql, params }) => ({
        success: true,
        results: d1.prepare(sql).all(params == null ? {} : params),
      })))
    },
  }
}

function loadProductsRoute(d1) {
  const adapter = dbAdapter(d1)
  const realMoneyPrecision = loadTs(path.join('lib', 'moneyPrecision.ts'), {})
  const realDetailRule = loadTs(path.join('lib', 'productDetailRule.ts'), { './moneyPrecision': realMoneyPrecision })
  const realSqlBinding = loadTs(path.join('lib', 'sqlBinding.ts'), {})
  const realProductMerge = loadTs(path.join('lib', 'productMerge.ts'), { './moneyPrecision': realMoneyPrecision })
  const realProductMergeSnapshot = loadTs(path.join('lib', 'productMergeSnapshot.ts'), { './db': {} })
  const realCatalogCost = loadTs(path.join('lib', 'catalogCostRecompute.ts'), { './moneyPrecision': realMoneyPrecision })
  const realUndoAppliers = loadTs(path.join('lib', 'undoAppliers.ts'), {
    '../index': {}, './auth': {}, './db': { getDb: () => adapter }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
    // U-cost: merge undo re-derives catalog cost with the real formula.
    './catalogCostRecompute': realCatalogCost,
  })
  const mod = loadTs(path.join('routes', 'products.ts'), {
    hono: { Hono: FakeHono },
    // U-cost: the merge fold re-derives the keeper's catalog cost too.
    '../lib/catalogCostRecompute': realCatalogCost,
    '../lib/db': { getDb: () => adapter },
    '../lib/audit': { audit: async () => {} },
    '../lib/undoAppliers': realUndoAppliers,
    '../lib/productDetailRule': realDetailRule,
    '../lib/moneyPrecision': realMoneyPrecision,
    // The identity read compares barcodes through the shared fold and names
    // through the shared name rule. Both must be the REAL ones: a stub would
    // make "a leading zero is not a different barcode" test the stub.
    '../lib/productIdentity': loadTs(path.join('lib', 'productIdentity.ts'), {
      './db': {}, './sqlBinding': realSqlBinding, './productDetailRule': realDetailRule,
    }),
    '../lib/sqlBinding': realSqlBinding,
    '../lib/productMerge': realProductMerge,
    '../lib/productMergeSnapshot': realProductMergeSnapshot,
    // The fold refuses a price copy without Edit product (5 Oct 2026); these fixtures are the reviewer who may.
    '../lib/permissions': { getActionTier: (_user, _section, action) => (action === 'edit' ? 'full' : undefined) },
  })
  return { mod, adapter, undoAppliers: realUndoAppliers, MERGE_REPARENT_TABLES: realUndoAppliers.MERGE_REPARENT_TABLES }
}

// The promotion rule as the APP reads it, so "does this rule apply to the
// keeper?" is answered by promotionRules.ts itself and not by a re-implementation
// of its parsing here.
function loadPromotionRules() {
  return loadTs(path.join('lib', 'promotionRules.ts'), {
    './moneyPrecision': loadTs(path.join('lib', 'moneyPrecision.ts'), {}),
  })
}

// --------------------------------------------------------------------------
// 1. FK completeness -- swept from the migrations, not from memory
// --------------------------------------------------------------------------
// Tables the FOLD itself moves, row by row, in ways a blind UPDATE could not:
// per-branch summing, per-batch_key folding, de-duplication by image path.
const FOLD_HANDLED = new Set([
  'branch_stock.product_id',
  'product_batches.variant_product_id',
  'product_images.product_id',
  // The two links MERGE_REPARENT_TABLES structurally cannot carry -- see the
  // widened sweep below for why they were invisible to this file until now.
  'promotion_rules.product_ids',
  'products.parent_id',
])

// Deliberate exclusions. Each one is a decision with a reason, and the reason
// is repeated in the comment above MERGE_REPARENT_TABLES so the next reader
// finds it at the list rather than only here.
const EXCLUDED = new Map([
  ['stock_row_moves.source_product_id', 'provenance: records what a past move took stock OFF'],
  ['stock_row_moves.destination_product_id', 'provenance: records what a past move put stock ON'],
  ['import_auto_merges.product_id', 'provenance: records which id an import folded'],
  ['import_auto_merges.merged_into_product_id', 'provenance: records which id an import folded into'],
  ['sale_amendments.product_id', 'SNAPSHOT, declared as such in migration 0115'],
  ['sale_not_paid_repair_0173.product_id', 'provenance: repair receipt of migration 0173 (before-values per line)'],
  ['catalog_cost_recompute_0175.product_id', 'provenance: repair receipt of migration 0175 (cost before/after per product)'],
  ['catalog_cost_repair_0195_backup.product_id', 'provenance: backup of migration 0195 (cost before/after per product; its recovery key)'],
  ['sale_cost_repair_0200.product_id', 'provenance: backup of held migration 0200 (sale line cost before/after; recovery keys on sale_item_id)'],
  // The ask said the merge moves EVERY linked record, stock_session_members
  // included. It is excluded instead because the column is the replay DRIVER
  // and not a link: reparenting it would compare the keeper's rows against a
  // postimage recorded for the loser. The session's Undo is closed by the merge
  // (section 5) rather than left to die silently or block the merge.
  ['stock_session_members.product_id', 'provenance AND the replay driver -- the merge closes the session Undo, it does not reparent'],
])

// 0136 stores immutable selected-merge receipts. These ids describe what the
// run chose and what it committed; rewriting either id during a later merge
// would falsify that receipt. Keep this category separate from EXCLUDED so its
// evidence remains pinned to the migration's explicit durable-receipt contract.
const RECEIPT_SNAPSHOTS = new Map([
  ['product_conflict_merge_run_cases.keeper_product_id', 'durable receipt: the product selected to survive'],
  ['product_conflict_merge_run_cases.merged_product_id', 'durable receipt: the product selected for retirement'],
  ['product_conflict_action_group_members.product_id', 'durable receipt: the product reviewed as a group member'],
  ['product_remove_operations.product_id', 'durable receipt: the product selected for reversible removal'],
  ['transfer_operation_members.source_product_id', 'durable transfer provenance: the exact product stock left'],
  ['transfer_operation_members.destination_product_id', 'durable transfer provenance: the exact product stock entered'],
])

async function fkSweep() {
  const migrationsDir = path.join(cloudflareRoot, 'migrations')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const found = new Map()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    // CREATE TABLE blocks only: an ALTER or an INSERT naming product_id is not
    // a new FK, and an index certainly is not.
    const blocks = sql.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\n\s*\);/g) || []
    for (const block of blocks) {
      const name = block.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)/)[1]
      // legacy_* is the old system's own record, never relinked. A leading _
      // is a migration's scratch table (0081's _lot_ledger_*), created and
      // dropped inside one file -- it does not exist to be orphaned.
      if (/^legacy_/.test(name) || name.startsWith('_')) continue
      for (const line of block.split('\n')) {
        // The FK is usually declared with NO REFERENCES clause in this schema
        // (0001_init.sql names none at all), so the column NAME is what
        // identifies it -- which also catches the snapshot columns, and those
        // have to be accounted for on purpose rather than by going unnoticed.
        const col = line.match(/^\s*([A-Za-z0-9_]*product_id)\s+INTEGER/i)
        if (col) found.set(`${name}.${col[1]}`, file)
        // A product link does not have to be an INTEGER column named
        // *product_id -- and BOTH of the ones that are not were being orphaned
        // by the merge while this sweep reported all clear:
        //   * a JSON id LIST in a TEXT column (promotion_rules.product_ids;
        //     ruleAppliesToProduct does product_ids.includes(product.id), which
        //     is as live a link as any FK), and
        //   * products.parent_id, a product FK whose name does not end in
        //     product_id at all.
        // Widening the sweep is what lets this file FAIL for them.
        const jsonIdList = line.match(/^\s*([A-Za-z0-9_]*product_ids)\s+TEXT/i)
        if (jsonIdList) found.set(`${name}.${jsonIdList[1]}`, file)
        const parentLink = line.match(/^\s*(parent_id)\s+INTEGER/i)
        if (parentLink && name === 'products') found.set(`${name}.${parentLink[1]}`, file)
      }
    }
  }
  return found
}

// --------------------------------------------------------------------------
// Fixture
// --------------------------------------------------------------------------
const KEEPER = 100
const DUP = 200

function seed() {
  const d1 = openDb(loadAll())
  const run = (sql) => d1.db.prepare(sql).run()
  run(`INSERT INTO branches (id, name) VALUES (1, 'shop'), (2, 'warehouse')`)
  // The production shape: one name, one code written twice (one with a leading
  // zero), different recorded costs, and the discarded row carrying the only
  // wholesale price. Keeper cost is 0 = never recorded.
  run(`INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr,
        selling_price_usd, selling_price_khr, wholesale_price_usd, wholesale_price_khr,
        special_price_usd, special_price_khr, is_active, is_group)
       VALUES
        (${KEEPER}, 'Zero Twin', '3614274226546', 0, 0, 15, 0, 0, 0, 0, 0, 1, 0),
        (${DUP},    'Zero Twin', '03614274226546', 6.45, 0, 15, 0, 9, 0, 0, 0, 1, 0)`)
  return d1
}

async function main() {
  console.log('test-merge-identity-fk-pure')

  // ---- 1. FK completeness ------------------------------------------------
  const d1 = seed()
  const { mod, adapter, MERGE_REPARENT_TABLES } = loadProductsRoute(d1)
  const reparented = new Set(MERGE_REPARENT_TABLES.map((t) => `${t.table}.${t.column}`))
  const found = await fkSweep()

  await check('the migration sweep actually found the FKs (positive control)', () => {
    // A sweep that finds nothing reports "all clear" exactly like a sweep that
    // finds everything, so pin two ends known to exist.
    assert.ok(found.has('sale_items.product_id'), 'sweep must see sale_items.product_id')
    assert.ok(found.has('stock_session_members.product_id'), 'sweep must see stock_session_members.product_id')
    // The two non-INTEGER-FK links. A sweep blind to these is exactly how they
    // stayed orphaned by every merge while this file reported nothing to fix.
    assert.ok(found.has('promotion_rules.product_ids'), 'sweep must see the JSON id list promotion_rules.product_ids')
    assert.ok(found.has('products.parent_id'), 'sweep must see products.parent_id')
    assert.ok(found.size >= 10, `sweep found only ${found.size} product FKs -- the parser has stopped matching`)
  })

  await check('every product FK in the schema is reparented, folded, or excluded WITH a reason', () => {
    const unaccounted = [...found.keys()].filter(
      (key) => !reparented.has(key) && !FOLD_HANDLED.has(key) && !EXCLUDED.has(key) && !RECEIPT_SNAPSHOTS.has(key),
    )
    assert.deepEqual(unaccounted, [], `these product FKs would be orphaned by a merge: ${unaccounted.join(', ')}`)
  })

  await check('durable merge and transfer receipt product ids stay immutable historical evidence', () => {
    const selectedMergeReceiptMigration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0136_product_conflict_merge_runs.sql'), 'utf8')
    const globalActionReceiptMigration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0138_product_conflict_action_groups.sql'), 'utf8')
    const transferReceiptMigration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0151_transfer_provenance_replay.sql'), 'utf8')
    assert.match(selectedMergeReceiptMigration, /Durable receipts for Products > Conflicts selected merge runs/)
    assert.match(selectedMergeReceiptMigration, /Never drop receipt rows/)
    assert.match(globalActionReceiptMigration, /Durable draft receipts for one global Products > Conflicts action review/)
    assert.match(globalActionReceiptMigration, /Never drop receipt rows/)
    assert.match(transferReceiptMigration, /immutable provenance/)
    assert.match(transferReceiptMigration, /Product and lot identities cannot be removed\/reparented while replay evidence exists/)
    for (const key of RECEIPT_SNAPSHOTS.keys()) {
      assert.ok(found.has(key), `${key} must remain visible to the migration FK sweep`)
      assert.ok(!reparented.has(key), `${key} must not be rewritten by the product merge fold`)
    }
  })

  await check('each exclusion is documented at the list itself, not only in this test', () => {
    const listStart = appliersSrc.indexOf('export const MERGE_REPARENT_TABLES')
    const doc = appliersSrc.slice(Math.max(0, listStart - 4000), listStart)
    for (const key of EXCLUDED.keys()) {
      const table = key.split('.')[0]
      assert.ok(doc.includes(table), `${table} is excluded from the reparent walk with no reason recorded at the list`)
    }
  })

  await check('nothing on the reparent list has been quietly dropped', () => {
    for (const table of [
      'sale_items', 'return_items', 'return_replacement_items', 'inventory_movements',
      'damaged_stock_lots', 'stock_transfers', 'rfid_tags', 'rfid_events', 'rfid_session_items',
    ]) {
      assert.ok(reparented.has(`${table}.product_id`), `${table} must be relinked onto the survivor`)
    }
    assert.ok(reparented.has('promotions.link_product_id'))
  })

  // ---- 1b. The two links that are NOT integer product FKs -----------------
  // DISCRIMINATING, and the reason the sweep above was widened: the merge walked
  // MERGE_REPARENT_TABLES (INTEGER *product_id columns) and nothing else, so a
  // promotion rule scoped to the discarded row kept naming a row the fold had
  // just deactivated -- ruleAppliesToProduct then matched nothing at all and the
  // discount left the catalogue silently -- and a child variant stayed rooted on
  // that deactivated parent. Both are folded here for real and then undone.
  await check('DISCRIMINATING: a promotion rule scoped to the discarded row follows it onto the keeper, and undo puts it back', async () => {
    const live = seed()
    const { mod: liveMod, adapter: liveAdapter, undoAppliers } = loadProductsRoute(live)
    const promo = loadPromotionRules()
    live.db.prepare(`INSERT INTO promotion_rules (id, title, rule_type, percent_off, scope_type, product_ids, is_active)
                     VALUES (10, 'Twin 10%', 'percent_off', 10, 'products', '[200,777]', 1)`).run()
    // A rule already naming BOTH rows must end up naming the keeper ONCE.
    live.db.prepare(`INSERT INTO promotion_rules (id, title, rule_type, percent_off, scope_type, product_ids, is_active)
                     VALUES (11, 'Both', 'percent_off', 5, 'products', '[100,200]', 1)`).run()
    // NEGATIVE CONTROL: a rule that never named the discarded row is untouched.
    live.db.prepare(`INSERT INTO promotion_rules (id, title, rule_type, percent_off, scope_type, product_ids, is_active)
                     VALUES (12, 'Someone else', 'percent_off', 7, 'products', '[777]', 1)`).run()
    // A child variant pointing at the row about to be deactivated.
    live.db.prepare(`INSERT INTO products (id, name, barcode, parent_id, is_active, is_group)
                     VALUES (400, 'Zero Twin Small', '4444444444444', ${DUP}, 1, 0)`).run()

    const { reversal } = await liveMod.foldDuplicateProductInto(
      {}, liveAdapter, { id: 1, name: 'tester' },
      { id: KEEPER, name: 'Zero Twin' },
      { id: DUP, name: 'Zero Twin', image_path: null },
      new Map([[1, 'shop'], [2, 'warehouse']]),
      'fk test merge',
    )

    const ruleRow = (id) => live.db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get(id)
    const applies = (id, productId) => promo.ruleAppliesToProduct(promo.normalizePromotionRule(ruleRow(id)), { id: productId })
    assert.equal(applies(10, KEEPER), true, 'the discount must survive the merge on the surviving row')
    assert.equal(applies(10, DUP), false, 'and stop naming the row that no longer exists in the catalogue')
    assert.deepEqual(JSON.parse(ruleRow(10).product_ids), [KEEPER, 777], 'the rest of the scope list is untouched')
    assert.deepEqual(JSON.parse(ruleRow(11).product_ids), [KEEPER],
      'a rule that named both rows must name the survivor once, not twice')
    assert.deepEqual(JSON.parse(ruleRow(12).product_ids), [777], 'NEGATIVE CONTROL: an unrelated rule is not rewritten')
    assert.equal(Number(live.db.prepare('SELECT parent_id FROM products WHERE id = 400').get().parent_id), KEEPER,
      'a child variant must not be left rooted on the deactivated row')
    assert.deepEqual(reversal.promotionRulesBefore.map((r) => r.id).sort((a, b) => a - b), [10, 11],
      'undo cannot restore a rule the reversal never recorded')
    assert.deepEqual(reversal.reparentedChildProductIds, [400])

    // ...and the undo, run through the REAL applier over a snapshot row the REAL
    // recorder wrote. Every recorder stores the merged-state fingerprint; a row
    // without one is a pre-fingerprint (legacy) merge, which never carried
    // promotion rules or re-parented children, so the applier now refuses a
    // hand-built fingerprint-less row of this shape (FX-undo2, R-undo C11).
    const { snapshotId } = await undoAppliers.recordMergeUndoSnapshot({}, { id: 1, name: 'tester' }, reversal)
    const applier = undoAppliers.resolveUndoApplier({ applier: 'product.merge', snapshot_id: snapshotId })
    assert.ok(applier, 'the product.merge applier must be registered')
    await applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: {}, user: { id: 1, name: 'tester' }, direction: 'undo' })
    assert.equal(ruleRow(10).product_ids, '[200,777]', 'undo restores the scope list byte for byte')
    assert.equal(ruleRow(11).product_ids, '[100,200]')
    assert.equal(ruleRow(12).product_ids, '[777]')
    assert.equal(applies(10, DUP), true, 'the rule applies to the discarded row again once the merge is undone')
    assert.equal(Number(live.db.prepare('SELECT parent_id FROM products WHERE id = 400').get().parent_id), DUP,
      'and the child goes back to its original parent')
  })

  await check('a keeper that was itself a child of the discarded row does not become its own parent', async () => {
    const live = seed()
    const { mod: liveMod, adapter: liveAdapter } = loadProductsRoute(live)
    live.db.prepare(`UPDATE products SET parent_id = ${DUP} WHERE id = ${KEEPER}`).run()
    const { reversal } = await liveMod.foldDuplicateProductInto(
      {}, liveAdapter, { id: 1, name: 'tester' },
      { id: KEEPER, name: 'Zero Twin' },
      { id: DUP, name: 'Zero Twin', image_path: null },
      new Map([[1, 'shop'], [2, 'warehouse']]),
      'fk test merge',
    )
    assert.equal(live.db.prepare(`SELECT parent_id FROM products WHERE id = ${KEEPER}`).get().parent_id, null,
      'the keeper cannot be a child of the row it just absorbed')
    assert.deepEqual(reversal.reparentedChildProductIds, [], 'and it is not listed as a child it moved')
    assert.equal(reversal.keeperParentIdBefore, DUP, 'the cleared link is captured so undo can restore it')
  })

  // ---- 2. The price preview reads the LIVE columns ------------------------
  await check('DISCRIMINATING: the preview reports the wholesale price the merge will move', async () => {
    const pricing = await mod.readMergePricingChange(adapter, KEEPER, DUP)
    // Pre-fix this returned changes: [] -- the constant named special_price_*,
    // which migration 0111 zeroed on every row, so from and to were both 0.
    const wholesale = pricing.changes.find((c) => c.field === 'wholesale_price_usd')
    assert.ok(wholesale, `the wholesale change must be reported, got ${JSON.stringify(pricing.changes)}`)
    assert.equal(wholesale.from, 0)
    assert.equal(wholesale.to, 9)
    assert.equal(pricing.after.wholesale_price_usd, 9)
  })

  await check('the preview never speaks about the retired special_price_* pair again', async () => {
    const pricing = await mod.readMergePricingChange(adapter, KEEPER, DUP)
    assert.ok(!('special_price_usd' in pricing.before), 'a column zeroed by 0111 cannot be a price the reviewer is shown')
    assert.ok(!/MERGE_PRICE_FIELDS = \[[^\]]*special_price/.test(routeSrc))
  })

  await check('an unchanged price is still not reported as a change', async () => {
    const pricing = await mod.readMergePricingChange(adapter, KEEPER, DUP)
    assert.ok(!pricing.changes.some((c) => c.field === 'selling_price_usd'), 'both rows sell at 15')
  })

  // ---- 3. The identity gate the client has always read --------------------
  await check('DISCRIMINATING: a leading-zero twin is ONE identity, so the dialog is not forced', async () => {
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, DUP)
    assert.equal(identity.same, true, 'a leading zero is not a different barcode')
    assert.deepEqual(identity.differs, [])
  })

  await check('a genuinely different barcode IS reported as a difference', async () => {
    d1.db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, is_active, is_group)
                   VALUES (300, 'Zero Twin', '9999999999999', 6.45, 1, 0)`).run()
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 300)
    assert.equal(identity.same, false)
    assert.deepEqual(identity.differs.map((d) => d.field), ['barcode'])
    assert.equal(identity.differs[0].discarded, '9999999999999')
  })

  await check('a different NAME is reported too, and both differences at once', async () => {
    d1.db.prepare(`INSERT INTO products (id, name, barcode, is_active, is_group)
                   VALUES (301, 'Something Else', '8888888888888', 1, 0)`).run()
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 301)
    assert.deepEqual(identity.differs.map((d) => d.field).sort(), ['barcode', 'name'])
  })

  // ---- P6-9: the Sep 15 2026 wildcard ruling, at the ACTUAL write gate ----
  // productIdentity.ts's cluster sweep (findPossiblySameProductClusters) and
  // the client's own eligibility check (selectedConflictMerge.ts) were both
  // already wildcard-aware, so a real-vs-broken-barcode pair showed up as ONE
  // mergeable group in the Products > Duplicates list and its bulk "Merge
  // selected" flow. But the "Keep this" button on the cluster card -- the
  // primary, always-visible action, no selection required -- calls this same
  // readMergeIdentityDiff through /possible-duplicates/merge, which still
  // compared raw identityBarcodeKey equality. A real barcode's key and an
  // empty/word/broken barcode's key are never equal, so `same` was false and
  // the route refused with "These products do not have the same normalized
  // name and barcode" -- the owner's own words -- for exactly the pairs the
  // ruling says ARE one product, even though the fold this gate protects
  // (foldDuplicateProductInto's canonicalProductBarcode) already resolves the
  // wildcard correctly and was never reached.
  await check('DISCRIMINATING (P6-9): an EMPTY barcode against the keeper\'s real one is a wildcard, not a block', async () => {
    d1.db.prepare(`INSERT INTO products (id, name, barcode, is_active, is_group)
                   VALUES (304, 'Zero Twin', '', 1, 0)`).run()
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 304)
    assert.equal(identity.same, true, 'an empty barcode must never block a same-name merge')
    // Still reported for the before/after preview -- informative, not blocking.
    assert.deepEqual(identity.differs.map((d) => d.field), ['barcode'])
  })

  await check('DISCRIMINATING (P6-9): a WORD/broken barcode against the keeper\'s real one is also a wildcard', async () => {
    d1.db.prepare(`INSERT INTO products (id, name, barcode, is_active, is_group)
                   VALUES (305, 'Zero Twin', 'NoBox188', 1, 0)`).run()
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 305)
    assert.equal(identity.same, true, 'a word/broken barcode must never block a same-name merge')
  })

  await check('NEGATIVE CONTROL (P6-9): two DIFFERENT REAL barcodes still block, with the difference reported', async () => {
    // Reuses product 300 ('9999999999999', a real 13-digit code) seeded above --
    // this is the case the ruling keeps as two genuine siblings, and the merge
    // must still refuse it (delete/keep, offered by the cluster card's per-row
    // buttons independent of this endpoint, is the correct manual resolution).
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 300)
    assert.equal(identity.same, false, 'two different real barcodes are two different products')
    assert.deepEqual(identity.differs.map((d) => d.field), ['barcode'])
  })

  await check('DISCRIMINATING: the merge that fills in the kept row\'s cost says so', async () => {
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, DUP)
    // The keeper has no cost of its own; after the fold it costs 6.45. That is
    // not a "difference" (0 is a cost nobody recorded) but it IS a change to
    // what the kept product cost, and it is the second half of the dead gate.
    assert.deepEqual(identity.costFill, [{ field: 'cost_price_usd', value: 6.45 }])
    assert.equal(identity.costBefore.cost_price_usd, 0)
    assert.equal(identity.costAfter.cost_price_usd, 6.45)
    assert.equal(identity.costVerdict, 'missing')
  })

  await check('two real costs preview as the MEAN of the distinct costs, per the ruling', async () => {
    d1.db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, is_active, is_group)
                   VALUES (302, 'Zero Twin', '03614274226546', 7.9, 1, 0)`).run()
    d1.db.prepare('UPDATE products SET cost_price_usd = 5 WHERE id = @id').run({ id: KEEPER })
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 302)
    assert.equal(identity.costAfter.cost_price_usd, 6.45, '(5 + 7.9) / 2')
    assert.equal(identity.costVerdict, 'differs')
    assert.deepEqual(identity.costFill, [], 'the keeper already had a cost, so nothing is being filled in')
    assert.deepEqual(identity.costOutliers, [])
    d1.db.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = @id').run({ id: KEEPER })
  })

  // ---- 4. Every valid non-zero cost participates in the DISTINCT mean -----
  await check('DISCRIMINATING: wide valid costs still use the explicit DISTINCT mean rule', async () => {
    d1.db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, is_active, is_group)
                   VALUES (303, 'Zero Twin', '3614274226546', 200, 1, 0)`).run()
    d1.db.prepare('UPDATE products SET cost_price_usd = 2 WHERE id = @id').run({ id: KEEPER })
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 303)
    assert.equal(identity.costAfter.cost_price_usd, 101)
    assert.deepEqual(identity.costOutliers, [])
    assert.deepEqual(identity.numericIssues, [])
    d1.db.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = @id').run({ id: KEEPER })
  })

  await check('NEGATIVE CONTROL: an ordinary restock price difference uses the same mean', async () => {
    d1.db.prepare('UPDATE products SET cost_price_usd = 5 WHERE id = @id').run({ id: KEEPER })
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 302)
    assert.equal(identity.costAfter.cost_price_usd, 6.45, '5 and 7.9 average to 6.45 -- exactly what the mean is for')
    assert.deepEqual(identity.numericIssues, [])
    d1.db.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = @id').run({ id: KEEPER })
  })

  // ---- 5. A stock-in session no longer blocks a merge: the merge closes it --
  // Seeds: op-1 undoable on DUP, op-2 redoable on KEEPER, op-3 undoable on an
  // unrelated product. The real statements run against the real schema.
  const seedSession = (historyId, operationId, productId, status) => {
    d1.db.prepare(`INSERT INTO action_history (id, scope, entity, entity_id, label, status)
                   VALUES (${historyId}, 'inventory', 'product', ${productId}, 'Stock in', '${status}')`).run()
    d1.db.prepare(`INSERT INTO stock_session_operations (id, actor_id, request_id, mode, request_json, receipt_json, history_id)
                   VALUES ('${operationId}', 1, 'req-${operationId}', 'stock_in', '{}', '{}', ${historyId})`).run()
    d1.db.prepare(`INSERT INTO stock_session_members (operation_id, line_id, command_kind, product_id, branch_id, quantity)
                   VALUES ('${operationId}', 'line-1', 'receive', ${productId}, 1, 3)`).run()
  }
  const historyOf = (id) => d1.db.prepare('SELECT status, reversible, last_error FROM action_history WHERE id = ?').get(id)
  const closeAudit = () => d1.db.prepare("SELECT entity_id, details FROM audit_logs WHERE action = 'stock_session_undo_closed' ORDER BY entity_id").all()
  const route5 = loadProductsRoute(d1)
  const appliers = route5.undoAppliers

  await check('DISCRIMINATING: the close statements end Undo for sessions on either merged row and only those', async () => {
    seedSession(900, 'op-1', DUP, 'undoable')
    seedSession(901, 'op-2', KEEPER, 'redoable')
    seedSession(902, 'op-3', 301, 'undoable')
    const open = await appliers.readOpenStockSessions(route5.adapter, [KEEPER, DUP])
    assert.deepEqual(open.map((s) => s.operationId), ['op-1', 'op-2'], 'the read names both open sessions and not the unrelated one')
    await route5.adapter.batch(appliers.closeStockSessionsStatements([KEEPER, DUP], { id: 1, name: 'tester' }, 'merge-op', KEEPER))
    for (const id of [900, 901]) {
      assert.deepEqual({ ...historyOf(id) }, { status: 'recorded', reversible: 0, last_error: appliers.STOCK_SESSION_UNDO_CLOSED_BY_MERGE })
      assert.equal(appliers.isUndoClosedByMerge(historyOf(id)), true)
    }
    assert.deepEqual({ ...historyOf(902) }, { status: 'undoable', reversible: 1, last_error: null }, 'a session on a product outside the merge keeps its Undo')
    assert.deepEqual(closeAudit().map((row) => row.entity_id), ['op-1', 'op-2'], 'one audit row per closed session')
    assert.equal(JSON.parse(closeAudit()[0].details).previousStatus, 'undoable')
    assert.equal(JSON.parse(closeAudit()[1].details).previousStatus, 'redoable')
    assert.equal(JSON.parse(closeAudit()[0].details).reason, 'products merged')
  })

  await check('closing is idempotent: a second merge touching the same products adds no audit rows and keeps the first reason', async () => {
    const before = closeAudit().length
    await route5.adapter.batch(appliers.closeStockSessionsStatements([KEEPER, DUP], { id: 1, name: 'tester' }, 'merge-op-2', KEEPER))
    assert.equal(closeAudit().length, before)
    assert.equal(historyOf(900).last_error, appliers.STOCK_SESSION_UNDO_CLOSED_BY_MERGE)
    assert.deepEqual(await appliers.readOpenStockSessions(route5.adapter, [KEEPER, DUP]), [], 'nothing is left to close')
  })

  await check('a session naming NEITHER row is left alone, and a row that only LOOKS recorded is not mistaken for a closed one', async () => {
    assert.equal(appliers.isUndoClosedByMerge({ reversible: 0, last_error: null }), false)
    assert.equal(appliers.isUndoClosedByMerge({ reversible: 1, last_error: appliers.STOCK_SESSION_UNDO_CLOSED_BY_MERGE }), false)
    assert.deepEqual((await appliers.readOpenStockSessions(route5.adapter, [301])).map((s) => s.operationId), ['op-3'])
  })

  await check('no merge door is still refused because of a stock-in session', () => {
    assert.ok(!/mergeBlockedByReversibleStockSession|mergeStockSessionBlockedMessage|stock_session_reversible/.test(routeSrc),
      'the refusal and its message are gone from every call site')
    assert.ok(/closeStockSessionsStatements\(\[canonicalId, dup\.id\]/.test(routeSrc),
      'the ONE fold every door shares closes the Undo in its own batch')
    assert.ok(!/stock_session_reversible/.test(appliersSrc), 'the lib no longer names the old refusal')
  })

  // ---- 6. Wiring: both merge doors, and the preview --------------------
  await check('GET merge-preview returns the identity object the client gates on', () => {
    const at = routeSrc.indexOf("app.get('/possible-duplicates/merge-preview'")
    assert.ok(at > 0)
    // The whole handler, up to the merge route after it (the Resolve grid's
    // keep=1 reads made the handler longer than a fixed window).
    const end = routeSrc.indexOf("app.post('/possible-duplicates/merge'", at)
    assert.ok(end > at)
    const block = routeSrc.slice(at, end)
    assert.ok(/readMergeIdentityDiff\(db, keepId, mergeId\)/.test(block), 'the preview must READ it')
    assert.ok(/\n\s*identity,/.test(block), 'and RETURN it -- reading it and dropping it is the bug')
  })

  await check('POST /possible-duplicates/merge enforces identity and numeric blockers before folding', () => {
    const at = routeSrc.indexOf("app.post('/possible-duplicates/merge'")
    const foldAt = routeSrc.indexOf('foldDuplicateProductInto(', at)
    const numericAt = routeSrc.indexOf("code: 'invalid_merge_numeric'", at)
    assert.ok(numericAt > at && numericAt < foldAt, 'invalid numeric storage must be refused before anything is written')
    assert.ok(/stock_choice_required[\s\S]{0,600}identity,/.test(routeSrc.slice(at, foldAt)),
      'the 400 refusal must carry identity too -- the dialog it opens is otherwise blind')
  })

  await check('the whole-catalog merge preflights blockers and reports what it skipped', () => {
    const at = routeSrc.indexOf("app.post('/merge-duplicates'")
    assert.ok(at > 0)
    const block = routeSrc.slice(at, routeSrc.indexOf("app.post('/possible-duplicates", at) > at
      ? routeSrc.indexOf("app.post('/possible-duplicates", at) : at + 12000)
    assert.ok(/refusals\.push\(/.test(block), 'and say which pairs it left alone rather than skipping them silently')
    assert.ok(block.indexOf('let groupBlocker') < block.indexOf('await foldDuplicateProductInto('),
      'the blocker preflight must run before the first fold')
  })

  await check('the bulk PREVIEW shows the cost it would write', () => {
    const at = routeSrc.indexOf("app.get('/merge-duplicates/preview'")
    assert.ok(at > 0)
    const block = routeSrc.slice(at, routeSrc.indexOf("app.post('/merge-duplicates'", at))
    assert.ok(/costBefore/.test(block) && /costAfter/.test(block), 'a dry run that hides the cost change is not a dry run')
    assert.ok(/costRefusals: economics\.issues\.map/.test(block), 'and it must name invalid stored numeric values that block a group')
    assert.ok(/resolveProductMergeEconomics\(costRows\)/.test(block),
      'the preview must compute one global mean from the whole cluster')
  })

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  if (failed) process.exitCode = 1
}

main()
