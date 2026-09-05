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
// Plus the stock-session guard: a merge rewrites the very rows a stock-in
// session's undo asserts on, so it waits while such a session is reversible.
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
    batch: (stmts) => d1.batch(stmts),
  }
}

function loadProductsRoute(d1) {
  const adapter = dbAdapter(d1)
  const realDetailRule = loadTs(path.join('lib', 'productDetailRule.ts'), {})
  const realSqlBinding = loadTs(path.join('lib', 'sqlBinding.ts'), {})
  const realUndoAppliers = loadTs(path.join('lib', 'undoAppliers.ts'), {
    '../index': {}, './auth': {}, './db': { getDb: () => adapter }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
  })
  const mod = loadTs(path.join('routes', 'products.ts'), {
    hono: { Hono: FakeHono },
    '../lib/db': { getDb: () => adapter },
    '../lib/audit': { audit: async () => {} },
    '../lib/undoAppliers': realUndoAppliers,
    '../lib/productDetailRule': realDetailRule,
    // The identity read compares barcodes through the shared fold and names
    // through the shared name rule. Both must be the REAL ones: a stub would
    // make "a leading zero is not a different barcode" test the stub.
    '../lib/productIdentity': loadTs(path.join('lib', 'productIdentity.ts'), {
      './db': {}, './sqlBinding': realSqlBinding, './productDetailRule': realDetailRule,
    }),
    '../lib/sqlBinding': realSqlBinding,
  })
  return { mod, adapter, MERGE_REPARENT_TABLES: realUndoAppliers.MERGE_REPARENT_TABLES }
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
  ['stock_session_members.product_id', 'provenance AND the replay driver -- see the guard, not a reparent'],
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
    assert.ok(found.size >= 10, `sweep found only ${found.size} product FKs -- the parser has stopped matching`)
  })

  await check('every product FK in the schema is reparented, folded, or excluded WITH a reason', () => {
    const unaccounted = [...found.keys()].filter(
      (key) => !reparented.has(key) && !FOLD_HANDLED.has(key) && !EXCLUDED.has(key),
    )
    assert.deepEqual(unaccounted, [], `these product FKs would be orphaned by a merge: ${unaccounted.join(', ')}`)
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

  // ---- 4. The cost refusal ------------------------------------------------
  await check('DISCRIMINATING: costs too far apart to be one cost REFUSE the merge', async () => {
    d1.db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, is_active, is_group)
                   VALUES (303, 'Zero Twin', '3614274226546', 200, 1, 0)`).run()
    d1.db.prepare('UPDATE products SET cost_price_usd = 2 WHERE id = @id').run({ id: KEEPER })
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 303)
    const refusal = mod.mergeCostRefusal(identity)
    // Pre-fix: the fold kept the dearer (200) and merely reported it, so the
    // kept row ended up costing a figure neither row had recorded and nobody
    // had agreed to.
    assert.ok(refusal, 'a $2 item and a $200 item are not one product\'s cost written twice')
    assert.equal(refusal.min, 2)
    assert.equal(refusal.max, 200)
    const message = mod.mergeCostRefusalMessage('Zero Twin', refusal)
    assert.ok(message.includes('2') && message.includes('200'), 'the refusal must name both figures')
    assert.ok(/refused/i.test(message), 'and say plainly that nothing was merged')
    d1.db.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = @id').run({ id: KEEPER })
  })

  await check('NEGATIVE CONTROL: an ordinary restock price difference is NOT refused', async () => {
    d1.db.prepare('UPDATE products SET cost_price_usd = 5 WHERE id = @id').run({ id: KEEPER })
    const identity = await mod.readMergeIdentityDiff(adapter, KEEPER, 302)
    assert.equal(mod.mergeCostRefusal(identity), null, '5 and 7.9 average to 6.45 -- exactly what the mean is for')
    d1.db.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = @id').run({ id: KEEPER })
  })

  // ---- 5. The stock-session guard ----------------------------------------
  await check('DISCRIMINATING: a merge waits while a stock-in session can still be undone', async () => {
    d1.db.prepare(`INSERT INTO action_history (id, scope, entity, entity_id, label, status)
                   VALUES (900, 'inventory', 'product', ${DUP}, 'Stock in', 'undoable')`).run()
    d1.db.prepare(`INSERT INTO stock_session_operations (id, actor_id, request_id, mode, request_json, receipt_json, history_id)
                   VALUES ('op-1', 1, 'req-1', 'stock_in', '{}', '{}', 900)`).run()
    d1.db.prepare(`INSERT INTO stock_session_members (operation_id, line_id, command_kind, product_id, branch_id, quantity)
                   VALUES ('op-1', 'line-1', 'receive', ${DUP}, 1, 3)`).run()
    const blocked = await mod.mergeBlockedByReversibleStockSession(adapter, [KEEPER, DUP])
    // Pre-fix there was no guard at all: the merge moved branch_stock and
    // reparented the movements, and the session's Undo then failed its own
    // state assertion -- silently, whenever someone next tried to use it.
    assert.ok(blocked, 'a live session naming either row must block the merge')
    assert.equal(blocked.operationId, 'op-1')
    assert.ok(mod.mergeStockSessionBlockedMessage('op-1').includes('op-1'), 'the message must name the session')
  })

  await check('a SPENT session does not block: the members row is then pure history', async () => {
    d1.db.prepare("UPDATE action_history SET status = 'recorded' WHERE id = 900").run()
    assert.equal(await mod.mergeBlockedByReversibleStockSession(adapter, [KEEPER, DUP]), null)
  })

  await check('a session naming NEITHER row does not block', async () => {
    d1.db.prepare("UPDATE action_history SET status = 'undoable' WHERE id = 900").run()
    d1.db.prepare("UPDATE stock_session_members SET product_id = 301 WHERE operation_id = 'op-1'").run()
    assert.equal(await mod.mergeBlockedByReversibleStockSession(adapter, [KEEPER, DUP]), null)
  })

  // ---- 6. Wiring: both merge doors, and the preview --------------------
  await check('GET merge-preview returns the identity object the client gates on', () => {
    const at = routeSrc.indexOf("app.get('/possible-duplicates/merge-preview'")
    assert.ok(at > 0)
    const block = routeSrc.slice(at, at + 3000)
    assert.ok(/readMergeIdentityDiff\(db, keepId, mergeId\)/.test(block), 'the preview must READ it')
    assert.ok(/\n\s*identity,/.test(block), 'and RETURN it -- reading it and dropping it is the bug')
    assert.ok(/mergeBlockedByReversibleStockSession/.test(block), 'the reviewer must learn about a blocking session before choosing')
  })

  await check('POST /possible-duplicates/merge enforces both refusals before folding', () => {
    const at = routeSrc.indexOf("app.post('/possible-duplicates/merge'")
    const foldAt = routeSrc.indexOf('foldDuplicateProductInto(', at)
    const costAt = routeSrc.indexOf("code: 'cost_outlier_review'", at)
    const sessionAt = routeSrc.indexOf("code: 'stock_session_reversible'", at)
    assert.ok(costAt > at && costAt < foldAt, 'the cost refusal must run BEFORE anything is written')
    assert.ok(sessionAt > at && sessionAt < foldAt, 'so must the stock-session guard')
    assert.ok(/stock_choice_required[\s\S]{0,600}identity,/.test(routeSrc.slice(at, foldAt)),
      'the 400 refusal must carry identity too -- the dialog it opens is otherwise blind')
  })

  await check('the whole-catalog merge applies the same cost refusal, and reports what it skipped', () => {
    const at = routeSrc.indexOf("app.post('/merge-duplicates'")
    assert.ok(at > 0)
    const block = routeSrc.slice(at, routeSrc.indexOf("app.post('/possible-duplicates", at) > at
      ? routeSrc.indexOf("app.post('/possible-duplicates", at) : at + 12000)
    assert.ok(/mergeCostRefusal\(/.test(block), 'the bulk run must refuse the same pairs the pair route refuses')
    assert.ok(/refusals\.push\(/.test(block), 'and say which pairs it left alone rather than skipping them silently')
    assert.ok(/mergeBlockedByReversibleStockSession\(db, \[canonicalId, dup\.id\]\)/.test(block),
      'the session guard applies to the bulk run too -- one rule, both doors')
    assert.ok(block.indexOf('mergeCostRefusal(') < block.indexOf('await foldDuplicateProductInto('),
      'the refusal must run BEFORE the fold -- reporting an outlier the fold already wrote is the old behaviour')
  })

  await check('the bulk PREVIEW shows the cost it would write', () => {
    const at = routeSrc.indexOf("app.get('/merge-duplicates/preview'")
    assert.ok(at > 0)
    const block = routeSrc.slice(at, routeSrc.indexOf("app.post('/merge-duplicates'", at))
    assert.ok(/costBefore/.test(block) && /costAfter/.test(block), 'a dry run that hides the cost change is not a dry run')
    assert.ok(/costRefusals: costSkips/.test(block), 'and it must name the pairs the run will refuse')
    assert.ok(/resolveMergedCostDetail\(\[running,/.test(block),
      'the preview must fold pairwise in the run order -- a mean of means is not the mean')
  })

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  if (failed) process.exitCode = 1
}

main()
