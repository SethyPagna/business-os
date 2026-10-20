// Companion for cloudflare/migrations/0261_trigger_index_plans.sql.
//
// 0261 changes only query plans: `+is_active` in the catalog-cost and
// name-grouping triggers (logic identical, the planner can no longer pick an
// (is_active, ...) index and walk every active product), and the Not-paid
// audit lookup index (query text unchanged). Checked here:
//   1. Migration text = the lib generator + the latest earlier name-trigger
//      bodies with only `+` added; LF-only; the index matches sales.ts text.
//   2. EXPLAIN pins on the full chain, with the pre-0261 chain as control.
//   3. Chain applies, a re-run changes nothing, a pre-assertion aborts.
//   4. Equivalence: 300 randomized operations on a pre-0261 and a post-0261
//      database leave identical products (cost, mirror, review key, name
//      groups), revisions and write counts; two mutants must diverge.
//   5. Local workerd D1 rows_read at 1,000 products and 3,000 sale audit rows,
//      before 0261 (control) and after.
//
// Run (from cloudflare/): node scripts/test-migration-0261-trigger-index-plans-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const root = path.resolve(__dirname, '..')
const migrationsDir = path.join(root, 'migrations')
const MIGRATION = '0261_trigger_index_plans.sql'
const migrationText = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
const salesSource = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8').replace(/\r\n/g, '\n')
const CATALOG = ['catalog_cost_on_hand_stock_insert_0195', 'catalog_cost_on_hand_stock_update_0195', 'catalog_cost_on_hand_stock_delete_0195',
  'catalog_cost_on_hand_lot_insert_0195', 'catalog_cost_on_hand_lot_delete_0195', 'catalog_cost_review_lot_update_0255']
const NAME = [['trg_products_ai_name_key', '0010_product_name_grouping.sql'], ['trg_products_au_name_active', '0010_product_name_grouping.sql'],
  ['trg_products_ad_name_key', '0165_product_same_name_merge.sql']]

function loadTs(relative, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative)
  const filename = path.join(root, 'src', relative)
  const mod = { exports: {} }
  cache.set(relative, mod.exports)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (id) => (id === './db' ? {} : id.startsWith('./') ? loadTs(`lib/${id.slice(2)}.ts`, cache) : require(id)))
  cache.set(relative, mod.exports)
  return mod.exports
}
const costs = loadTs('lib/catalogCostRecompute.ts')

const files = (filter) => fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter(filter)
const read = (f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')
const before0261 = (f) => f < MIGRATION
const chainDb = (filter) => openDb(files(filter).map(read)).db

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

const triggerStatements = (db, name) => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name).sql
  return sql.slice(sql.search(/\bBEGIN\b/) + 5, sql.lastIndexOf('END')).split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*/g, '').trim()).filter(Boolean)
}
const plan = (db, sql) => {
  const q = sql.replace(/\b(OLD|NEW)\.\w+/g, '?')
  return db.prepare('EXPLAIN QUERY PLAN ' + q).all(...Array((q.match(/\?/g) || []).length).fill(5)).map((r) => r.detail)
}
const listSubquery = () => {
  const m = /COALESCE\(\(\s*(SELECT CASE WHEN a\.action[\s\S]*?ORDER BY a\.id DESC LIMIT 1)\s*\),0\)=1/.exec(salesSource)
  assert.ok(m, 'sales list payment-correction subquery found in routes/sales.ts')
  return `SELECT s.id, (${m[1]}) AS x FROM sales s WHERE s.id = 5`
}
const settleQuery = () => {
  const m = /(SELECT action, details FROM audit_logs\s+WHERE \(entity='sale' OR table_name='sale'\)[\s\S]*?ORDER BY id DESC LIMIT 1)/.exec(salesSource)
  assert.ok(m, 'saleAllowsPaymentCorrection query found in routes/sales.ts')
  return m[1].replace('@saleId', "'5'")
}

async function main() {
  await check('migration text: generator triggers, name triggers with only + added, exact index expression, LF-only', async () => {
    assert.ok(!migrationText.includes('\r'), 'LF-only (wrangler splits trigger bodies on /\\sEND[;\\s]$/)')
    const drops = (names) => names.map((n) => `DROP TRIGGER IF EXISTS ${n};\n`).join('')
    assert.ok(migrationText.includes(drops(CATALOG) + costs.catalogCostReviewTriggersSql()), 'catalog triggers are catalogCostReviewTriggersSql()')
    assert.ok(costs.catalogCostReviewTriggersSql().includes('+is_active') && !/WHERE is_active/.test(costs.catalogCostReviewTriggersSql()))
    assert.ok(read('0256_validated_catalog_cost.sql').endsWith(costs.catalogCostReviewTriggersSql({ primaryKeyPlan: false })), 'recovery: primaryKeyPlan:false is 0256 text')
    assert.ok(migrationText.includes(drops(NAME.map(([n]) => n))))
    const body = (text, prefix, name) => { const i = text.indexOf(`${prefix} ${name}\n`); assert.ok(i >= 0, name); return text.slice(i + prefix.length + 1, text.indexOf('\nEND;', i) + 5) }
    for (const [name, file] of NAME) {
      const next = body(migrationText, 'CREATE TRIGGER', name)
      assert.ok(next.includes('+is_active = 1'), `${name} uses +is_active`)
      assert.equal(next.replace(/\+((?:p2\.)?is_active = 1)/g, '$1'), body(read(file), 'CREATE TRIGGER IF NOT EXISTS', name), `${name}: only + differs from ${file}`)
    }
    const index = /CREATE INDEX IF NOT EXISTS idx_audit_logs_sale_ref ON audit_logs\((CAST\(COALESCE\(entity_id, record_id\) AS TEXT\))\)\s+WHERE (entity = 'sale' OR table_name = 'sale');/.exec(migrationText)
    assert.ok(index, 'index statement')
    const squash = (s) => s.replace(/\ba\./g, '').replace(/\s+/g, '')
    for (const reader of [listSubquery(), settleQuery()]) {
      assert.ok(squash(reader).includes(squash(index[1])), 'reader carries the indexed expression')
      assert.ok(squash(reader).includes(squash(`(${index[2]})`).replace(/\s/g, '')), 'reader carries the partial-index filter')
    }
    assert.ok(!/^\s*(INSERT|UPDATE|DELETE)\b/im.test(migrationText.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, '').replace(/--[^\n]*/g, '')), 'no row writes outside trigger bodies')
  })

  await check('EXPLAIN: products primary key, name_key index and the sale-ref index after 0261; control before', async () => {
    const after = chainDb(() => true)
    const control = chainDb(before0261)
    const activeIndex = /idx_products_active/
    for (const name of CATALOG) {
      for (const stmt of triggerStatements(after, name)) {
        const p = plan(after, stmt)
        assert.ok(p.some((d) => /^SEARCH products USING INTEGER PRIMARY KEY/.test(d)), `${name}: ${p.join(' | ')}`)
        assert.ok(!p.some((d) => activeIndex.test(d)), `${name}: ${p.join(' | ')}`)
      }
    }
    for (const [name] of NAME) {
      for (const stmt of triggerStatements(after, name).filter((s) => /is_active = 1/.test(s))) {
        const p = plan(after, stmt)
        assert.ok(p.filter((d) => /USING INDEX idx_products_name_key_pg/.test(d)).length === 2, `${name}: ${p.join(' | ')}`)
        assert.ok(!p.some((d) => activeIndex.test(d)), `${name}: ${p.join(' | ')}`)
      }
    }
    for (const name of [...CATALOG.slice(0, 3), ...NAME.map(([n]) => n)]) {
      assert.ok(triggerStatements(control, name).some((s) => plan(control, s).some((d) => activeIndex.test(d))), `control: ${name} walked an is_active index before 0261`)
    }
    for (const q of [listSubquery(), settleQuery()]) {
      assert.ok(plan(after, q).some((d) => /USING INDEX idx_audit_logs_sale_ref/.test(d)), plan(after, q).join(' | '))
      assert.ok(!plan(control, q).some((d) => /idx_audit_logs_sale_ref/.test(d)), 'control')
    }
    after.close(); control.close()
  })

  await check('chain: full chain applies, a re-run changes nothing, a missing trigger aborts the file', async () => {
    const db = chainDb(() => true)
    const schema = () => JSON.stringify(db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all())
    const first = schema()
    db.exec(migrationText)
    assert.equal(schema(), first, 'idempotent re-run')
    db.exec('DROP TRIGGER trg_products_ad_name_key')
    assert.throws(() => db.exec(migrationText), /trigger_plans_0261_pre_triggers_missing/)
    db.close()
  })

  await check('equivalence: 300 randomized operations, old vs new triggers, identical products, groups, review keys, revisions and writes', async () => {
    const run = (mutate) => equivalence(mutate)
    const result = run(null)
    assert.equal(result.divergence, null, result.divergence)
    const kinds = result.ok
    for (const kind of ['stockIn', 'sale', 'restock', 'transfer', 'lotCost', 'manualCost', 'deactivate', 'reactivate', 'rename', 'insert', 'flag', 'lotMove', 'setZero']) {
      assert.ok((kinds[kind] || 0) >= 3, `coverage: ${kind} succeeded ${kinds[kind] || 0} times`)
    }
    assert.ok(result.costMoves >= 20, `cost moved ${result.costMoves} times`)
    assert.ok(result.groupFlips >= 10, `group flag flipped ${result.groupFlips} times`)
    assert.ok(result.reviewClears >= 3, `review key cleared ${result.reviewClears} times`)
    console.log('  equivalence stats', JSON.stringify(result))
    const groupMutant = run((db) => recreate(db, 'trg_products_au_name_active', (s) => s.replaceAll(' AND +p2.is_active = 1', '')))
    assert.ok(groupMutant.divergence, 'control: a name trigger that counts inactive rows diverges')
    const costMutant = run((db) => recreate(db, 'catalog_cost_on_hand_stock_update_0195', (s) => s.replaceAll('+is_active = 1', '+is_active = 0')))
    assert.ok(costMutant.divergence, 'control: a stock trigger that skips active rows diverges')
    console.log('  controls diverge:', groupMutant.divergence, '/', costMutant.divergence)
  })

  await check('rows_read at 1,000 products and 3,000 sale audit rows (local workerd D1): before 0261 control, after', rowsRead)
  console.log(`${checks} checks passed`)
}

function recreate(db, name, edit) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name).sql
  const next = edit(sql)
  assert.notEqual(next, sql, 'mutant applied')
  db.exec(`DROP TRIGGER ${name}`); db.exec(next)
}

function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function equivalence(mutate) {
  const oldDb = chainDb(before0261)
  const newDb = chainDb(() => true)
  if (mutate) mutate(newDb)
  const dbs = [oldDb, newDb]
  const NAMES = ['Rose Serum', 'rose serum ', ' ROSE SERUM', 'Lip Balm', 'lip balm', 'Night Cream', '', 'Toner', 'toner', 'Mask 01', 'Mask 02']
  const COSTS = [null, 0, 1.5, 2.25, 3.3333, 7, 12.5, 0.0001, 'bad']
  const rnd = mulberry32(885)
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
  const reviewGuard = oldDb.prepare("SELECT sql FROM sqlite_master WHERE name='product_cost_review_update_guard_0255'").get().sql
  assert.equal(newDb.prepare("SELECT sql FROM sqlite_master WHERE name='product_cost_review_update_guard_0255'").get().sql, reviewGuard)
  // Fixture-only: raise a review flag (the app does it through a merge review); identical in both databases.
  const flagSql = (id) => `DROP TRIGGER product_cost_review_update_guard_0255; UPDATE products SET cost_review_key='${createHash('md5').update(String(seq)).digest('hex')}' WHERE id=${id}; ${reviewGuard};`
  for (const db of dbs) {
    seedStockFixture(db, () => {
      db.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Warehouse',0,1)")
      for (let i = 0; i < 16; i++) db.prepare('INSERT INTO products(id,name,cost_price_usd,purchase_price_usd,cost_price_khr,is_active) VALUES(?,?,?,?,0,1)').run(100 + i, NAMES[i % NAMES.length], 5, 5)
    })
  }
  const snapshot = (db) => JSON.stringify([
    db.prepare('SELECT * FROM products ORDER BY id').all().map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/_at$/.test(k)))),
    db.prepare('SELECT id, typeof(cost_price_usd) a, typeof(purchase_price_usd) b FROM products ORDER BY id').all(),
    db.prepare("SELECT entity_type, entity_key, revision FROM stock_session_revisions ORDER BY entity_type, entity_key").all(),
  ])
  const writes = (db) => Number(db.prepare('SELECT total_changes() n').get().n)
  const stats = { ok: {}, failed: {}, costMoves: 0, groupFlips: 0, reviewClears: 0, divergence: null }
  let seq = 0
  for (let step = 0; step < 300 && !stats.divergence; step++) {
    const products = oldDb.prepare('SELECT id, is_active FROM products ORDER BY id').all()
    const lots = oldDb.prepare('SELECT b.batch_id, b.branch_id, b.quantity FROM branch_batch_stock b ORDER BY b.batch_id, b.branch_id').all()
    const batches = oldDb.prepare('SELECT id, variant_product_id FROM product_batches ORDER BY id').all()
    const positive = lots.filter((l) => l.quantity > 0)
    const pid = () => pick(products).id
    const kind = pick(['stockIn', 'stockIn', 'stockIn', 'sale', 'sale', 'restock', 'transfer', 'lotCost', 'manualCost', 'deactivate', 'reactivate', 'rename', 'rename', 'insert', 'flag', 'lotMove', 'setZero', 'deleteStock', 'deleteLot', 'deleteProduct', 'repoint', 'lotToggle'])
    let statements
    const lot = positive.length ? pick(positive) : null
    const batch = batches.length ? pick(batches) : null
    seq++
    switch (kind) {
      case 'stockIn': { const p = pid(), b = 10000 + seq
        statements = [[`INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(${b},${p},'k${b}',1,?,?)`, [pick(COSTS), `2026-0${int(1, 9)}-1${int(0, 9)}`]],
          [`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${b},${int(1, 2)},${int(1, 9)})`, []]]; break }
      case 'sale': if (!lot) continue
        statements = [[`UPDATE branch_batch_stock SET quantity = MAX(0, quantity - ${int(1, 4)}) WHERE batch_id=${lot.batch_id} AND branch_id=${lot.branch_id}`, []]]; break
      case 'restock': if (!lot) continue
        statements = [[`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${lot.batch_id},${lot.branch_id},${int(1, 3)}) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity`, []]]; break
      case 'transfer': { if (!lot) continue
        const q = int(1, lot.quantity), to = lot.branch_id === 1 ? 2 : 1
        statements = [[`UPDATE branch_batch_stock SET quantity=quantity-${q} WHERE batch_id=${lot.batch_id} AND branch_id=${lot.branch_id}`, []],
          [`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${lot.batch_id},${to},${q}) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity`, []]]; break }
      case 'lotCost': if (!batch) continue
        statements = [[`UPDATE product_batches SET unit_cost_usd=? WHERE id=${batch.id}`, [pick(COSTS)]]]; break
      case 'manualCost': { const p = pid(), plan = costs.catalogCostRecomputeIfChangedStatement(p)
        statements = [[`INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(${p},?,'manual',(SELECT COALESCE(MAX(id),0) FROM product_batches WHERE variant_product_id=${p}))`, [pick(COSTS)]],
          [plan.sql, plan.params]]; break }
      case 'deactivate': { const active = products.filter((p) => p.is_active === 1); if (!active.length) continue
        statements = [[`UPDATE products SET is_active=0 WHERE id=${pick(active).id}`, []]]; break }
      case 'reactivate': { const inactive = products.filter((p) => p.is_active !== 1); if (!inactive.length) continue
        statements = [[`UPDATE products SET is_active=1 WHERE id=${pick(inactive).id}`, []]]; break }
      case 'rename': statements = [['UPDATE products SET name=? WHERE id=?', [pick(NAMES), pid()]]]; break
      case 'insert': statements = [['INSERT INTO products(name,cost_price_usd,purchase_price_usd,cost_price_khr,is_active) VALUES(?,?,?,0,?)', [pick(NAMES), 4, 4, rnd() < 0.8 ? 1 : 0]]]; break
      case 'flag': statements = [[flagSql(pid()), null]]; break
      case 'lotMove': if (!batch) continue
        statements = [[`UPDATE product_batches SET variant_product_id=${pid()} WHERE id=${batch.id}`, []]]; break
      case 'setZero': if (!lot) continue
        statements = [[`UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=${lot.batch_id} AND branch_id=${lot.branch_id}`, []]]; break
      case 'deleteStock': { if (!lots.length) continue; const l = pick(lots)
        statements = [[`DELETE FROM branch_batch_stock WHERE batch_id=${l.batch_id} AND branch_id=${l.branch_id}`, []]]; break }
      case 'deleteLot': if (!batch) continue
        statements = [[`DELETE FROM product_batches WHERE id=${batch.id}`, []]]; break
      case 'deleteProduct': statements = [[`DELETE FROM products WHERE id=${pid()}`, []]]; break
      case 'repoint': { if (!lot || batches.length < 2) continue
        statements = [[`UPDATE branch_batch_stock SET batch_id=${pick(batches).id} WHERE batch_id=${lot.batch_id} AND branch_id=${lot.branch_id}`, []]]; break }
      case 'lotToggle': if (!batch) continue
        statements = [[`UPDATE product_batches SET is_active=1-COALESCE(is_active,1) WHERE id=${batch.id}`, []]]; break
    }
    const prior = oldDb.prepare('SELECT id, cost_price_usd c, is_grouped_cached g, cost_review_key k FROM products ORDER BY id').all()
    const outcomes = dbs.map((db) => {
      const w = writes(db)
      try {
        seedStockFixture(db, () => { for (const [sql, params] of statements) params === null ? db.exec(sql) : db.prepare(sql).run(...(Array.isArray(params) ? params : [params])) })
        return { ok: true, writes: writes(db) - w }
      } catch (error) { return { ok: false, error: String(error.message).replace(/\d+/g, 'N') } }
    })
    const [a, b] = outcomes
    if (JSON.stringify(a) !== JSON.stringify(b)) { stats.divergence = `step ${step} ${kind}: outcome ${JSON.stringify(a)} vs ${JSON.stringify(b)}`; break }
    if (snapshot(oldDb) !== snapshot(newDb)) { stats.divergence = `step ${step} ${kind}: products/revisions differ`; break }
    const bucket = a.ok ? stats.ok : stats.failed
    bucket[kind] = (bucket[kind] || 0) + 1
    const after = new Map(oldDb.prepare('SELECT id, cost_price_usd c, is_grouped_cached g, cost_review_key k FROM products').all().map((r) => [r.id, r]))
    for (const p of prior) {
      const q = after.get(p.id); if (!q) continue
      if (q.c !== p.c) stats.costMoves++
      if (q.g !== p.g) stats.groupFlips++
      if (p.k != null && q.k == null) stats.reviewClears++
    }
  }
  oldDb.close(); newDb.close()
  return stats
}

async function rowsRead() {
  const { build } = require('esbuild')
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const bundle = await build({ entryPoints: [path.join(root, 'src/index.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'], durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: 'http://localhost', BUSINESS_OS_ADMIN_URL: 'http://localhost', BUSINESS_OS_ORGANIZATION_SLUG: 'leang', BUSINESS_OS_ADMIN_PASSWORD: 'Admin-Password-123' },
    outboundService: () => new Response('refused', { status: 503 }), log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const apply = async (names) => {
      const stmts = []
      for (const name of names) for (const s of split(read(name)).filter((s) => s.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(s.trim())) continue
        stmts.push(s)
      }
      for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100).map((s) => db.prepare(s)))
    }
    await apply(files(before0261))
    const run = (sql, ...b) => db.prepare(sql).bind(...b).run()
    const PERMIT = "INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')"
    await run("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Warehouse',0,1)")
    await run(PERMIT)
    const P = 1000
    for (let i = 0; i < P; i += 200) {
      const batch = []
      for (let j = i; j < Math.min(P, i + 200); j++) {
        const id = 1000 + j
        batch.push(db.prepare("INSERT INTO products(id,name,barcode,stock_quantity,selling_price_usd,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,100,5,1.25,5000,1)").bind(id, `Product ${j}`, `885${String(id).padStart(10, '0')}`))
        batch.push(db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,100)').bind(id))
        batch.push(db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,batch_number,unit_cost_usd,received_at) VALUES(?,?,?,1,1,1.25,'2026-09-01')").bind(id + 500000, id, `b-${id}`))
        batch.push(db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,100)').bind(id + 500000))
      }
      await db.batch(batch)
    }
    const audit = []
    for (let i = 0; i < 3000; i++) audit.push(db.prepare("INSERT INTO audit_logs(action,entity,entity_id,table_name,record_id,details,created_at) VALUES(?,'sale',?,'sale',?,?,datetime('now'))")
      .bind(i % 3 === 0 ? 'sale_settlement' : 'update', String(100000 + i), String(100000 + i), JSON.stringify({ newStatus: 'completed', oldStatus: 'awaiting_payment' })))
    for (let i = 0; i < audit.length; i += 500) await db.batch(audit.slice(i, i + 500))
    for (let k = 1; k <= 20; k++) await run("INSERT INTO sales(id,receipt_number,total_usd,total_khr,sale_status,branch_id,payment_method,created_at) VALUES(?,?,5,20000,'awaiting_payment',1,'Cash',datetime('now'))", k, `R-${k}`)
    // Rows that do match: a correction-opened sale and a settled one (the flag must read 1 and 0 the same way after).
    await run("INSERT INTO audit_logs(action,entity,entity_id,details,created_at) VALUES('sale_payment_correction_opened','sale','3','{}',datetime('now'))")
    await run("INSERT INTO audit_logs(action,table_name,record_id,details,created_at) VALUES('update','sale','4',?,datetime('now'))", JSON.stringify({ newStatus: 'awaiting_payment', oldStatus: 'completed' }))
    await run("INSERT INTO audit_logs(action,entity,entity_id,details,created_at) VALUES('sale_settlement','sale','5','{}',datetime('now'))")
    await run("DELETE FROM system_flags WHERE key='stock_transaction_permit'")

    await mf.dispatchFetch('http://localhost/api/settings')
    const admin = (await db.prepare("SELECT id FROM users WHERE username='admin'").all()).results[0]
    const token = 'tok-0261-rows'
    await run("INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, expires_at, last_seen_at) VALUES (?, ?, 'Test', 'Asia/Phnom_Penh', '2099-01-01T00:00:00.000Z', datetime('now'))", admin.id, createHash('sha256').update(token).digest('hex'))
    try { await run('UPDATE users SET must_change_password=0 WHERE id=?', admin.id) } catch {}
    let probe = 0
    const notPaid = async () => {
      const r = await mf.dispatchFetch(`http://localhost/api/sales?status=awaiting_payment&limit=20&probe=${++probe}`, { headers: { cookie: 'bos_session=' + token, 'sec-fetch-site': 'same-origin', origin: 'http://localhost' } })
      const text = await r.text()
      assert.equal(r.status, 200, text.slice(0, 300))
      const timing = r.headers.get('server-timing') || ''
      const m = /rr=(\d+)/.exec(timing)
      assert.ok(m, `Server-Timing rows_read present: ${timing}`)
      assert.match(timing, /cache;desc="miss"/)
      const rows = JSON.parse(text)
      const list = Array.isArray(rows) ? rows : rows.sales || rows.data || rows.items
      assert.equal(list.length, 20, 'twenty Not-paid rows')
      return { rr: Number(m[1]), flags: list.map((s) => [s.id, s.payment_correction_allowed]).sort((x, y) => x[0] - y[0]) }
    }
    let n = 0
    const writes = async () => {
      const id = 900000 + ++n
      await run(PERMIT)
      const out = {}
      const meta = async (label, sql) => { out[label] = (await db.prepare(sql).run()).meta.rows_read }
      await meta('lotQtyUpdate', 'UPDATE branch_batch_stock SET quantity = quantity - 1 WHERE batch_id=501005 AND branch_id=1')
      await meta('productInsert', `INSERT INTO products(id,name,barcode,stock_quantity,selling_price_usd,cost_price_usd,cost_price_khr,is_active) VALUES(${id},'Lab ${id}','99${id}',0,5,1,4000,1)`)
      await meta('productRename', `UPDATE products SET name='Lab renamed ${id}' WHERE id=${id}`)
      await run("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
      return out
    }
    const before = { ...(await writes()), notPaid: await notPaid() }
    await apply([MIGRATION])
    const after = { ...(await writes()), notPaid: await notPaid() }
    console.log('  rows_read before 0261', JSON.stringify({ ...before, notPaid: before.notPaid.rr }))
    console.log('  rows_read after 0261 ', JSON.stringify({ ...after, notPaid: after.notPaid.rr }))
    assert.ok(before.lotQtyUpdate >= 1000 && before.productInsert >= 1000 && before.productRename >= 1000 && before.notPaid.rr >= 5000, 'control: the pre-0261 plans walk the catalog / audit log')
    assert.ok(after.lotQtyUpdate < 100, `lot quantity update read ${after.lotQtyUpdate} rows`)
    assert.ok(after.productInsert < 50, `product insert read ${after.productInsert} rows`)
    assert.ok(after.productRename < 50, `product rename read ${after.productRename} rows`)
    assert.ok(after.notPaid.rr < 500, `Not-paid list read ${after.notPaid.rr} rows`)
    assert.deepEqual(after.notPaid.flags, before.notPaid.flags, 'identical rows and payment_correction_allowed')
    const allowed = Object.fromEntries(after.notPaid.flags)
    assert.deepEqual([allowed[3], allowed[4], allowed[5], allowed[6]], [1, 1, 0, 0], 'the fixture exercises both answers')
  } finally { await mf.dispose() }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
