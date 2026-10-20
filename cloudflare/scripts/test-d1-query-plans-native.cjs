// D1 read cost of the hot paths, measured as meta.rows_read / statement count
// through the REAL Worker modules on Miniflare D1 with every migration applied
// (the request-metrics hook in lib/db.ts reports each round trip).
//
//   1. Lot reads (FIFO list, cart list, known-positive sum) are driven from the
//      product's own lots, so they read a handful of rows however many lots
//      the branch holds. Same rows, same FIFO order.
//   2. Product search with 600 matches joins the FTS rank once instead of
//      scanning the materialised rank table per candidate row.
//   3. Schema capability probes read sqlite_master once per isolate and only
//      remember a TRUE answer.
//   4. The expenses list takes its total from the GROUP BY summary.
//
// Run (from cloudflare/): node scripts/test-d1-query-plans-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')
const MATCHES = 600
const OTHERS = 200

const entry = `
import { Hono } from 'hono'
import { getDb, getImportFencedDb } from './src/lib/db.ts'
import fees from './src/routes/fees.ts'
import sales from './src/routes/sales.ts'
import batches from './src/routes/batches.ts'
import { readFifoLotAvailability, readFifoLotAvailabilityForCart } from './src/lib/productBatches.ts'
import { buildProductSearchQuery, buildFamilyRelevanceOrderSql } from './src/lib/productSearchQuery.ts'
import { paginateProductFamilies } from './src/lib/familyPagination.ts'

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const outer = new Hono()
outer.use('*', async (c, next) => { c.set('user', ADMIN); await next() })
outer.route('/fees', fees)
outer.route('/sales', sales)
outer.route('/batches', batches)

let rows = 0, statements = 0
globalThis[Symbol.for('business-os.request-metrics.v1')] = {
  d1Start() {},
  d1Call(_wall, metas) { for (const meta of metas || []) { statements += 1; rows += Number(meta?.rows_read) || 0 } },
}
async function measured(fn) {
  rows = 0; statements = 0
  const result = await fn()
  return { result, rows, statements }
}

export default { async fetch(request, env) {
  const { op, args = {} } = await request.json()
  const db = getDb(env)
  if (op === 'lots') return Response.json({
    single: await measured(() => readFifoLotAvailability(db, args.productId, args.branchId)),
    cart: await measured(async () => [...(await readFifoLotAvailabilityForCart(db, [{ productId: args.productId, branchId: args.branchId }])).entries()]),
    // The picker route: the active-lot list plus the known-positive sum.
    known: await measured(async () => {
      const res = await outer.fetch(new Request('http://x/batches/picker-lots?productId=' + args.productId + '&branchId=' + args.branchId), env)
      return (await res.json()).known_positive_quantity
    }),
  })
  if (op === 'explain') {
    const plans = []
    for (const { sql, params } of args.items) plans.push((await db.prepare('EXPLAIN QUERY PLAN ' + sql).all(params)).map((r) => r.detail))
    return Response.json({ plans })
  }
  if (op === 'lotPlans') {
    const seen = []
    const spy = Object.create(db)
    spy.prepare = (sql) => {
      const st = db.prepare(sql)
      return { get: (p) => { seen.push({ sql, p }); return st.get(p) }, all: (p) => { seen.push({ sql, p }); return st.all(p) } }
    }
    await readFifoLotAvailability(spy, args.productId, args.branchId)
    await readFifoLotAvailabilityForCart(spy, [{ productId: args.productId, branchId: args.branchId }])
    const plans = []
    for (const { sql, p } of seen) plans.push((await db.prepare('EXPLAIN QUERY PLAN ' + sql).all(p)).map((r) => r.detail))
    return Response.json({ plans })
  }
  if (op === 'plan') {
    const params = {}
    const q = buildProductSearchQuery(args.term, params)
    const captured = []
    const spy = Object.create(db)
    spy.batch = async (list) => { captured.push(...list); return db.batch(list) }
    await paginateProductFamilies({
      db: spy, selectColumns: 'p.id, p.name', joinSql: '', whereSql: 'WHERE p.is_active = 1 AND ' + q.whereClause, params, page: 1, pageSize: 15,
      familyOrderSql: buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: Boolean(q.matchTierSql), hasRank: Boolean(q.matchRankSql) }),
      intraFamilyOrderSql: 'lower(name) ASC, id ASC',
      matchRankSql: q.matchRankSql, rankCteSql: q.rankCteSql, matchTierSql: q.matchTierSql,
    })
    const plans = []
    for (const stmt of captured) plans.push((await db.prepare('EXPLAIN QUERY PLAN ' + stmt.sql).all(stmt.params)).map((r) => r.detail))
    return Response.json({ plans, sql: captured[1].sql })
  }
  if (op === 'search') return Response.json(await measured(async () => {
    const params = {}
    const q = buildProductSearchQuery(args.term, params)
    const page = await paginateProductFamilies({
      db, selectColumns: 'p.id, p.name', joinSql: '', whereSql: 'WHERE p.is_active = 1 AND ' + q.whereClause, params, page: 1, pageSize: 15,
      familyOrderSql: buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: Boolean(q.matchTierSql), hasRank: Boolean(q.matchRankSql) }),
      intraFamilyOrderSql: 'lower(name) ASC, id ASC',
      matchRankSql: q.matchRankSql, rankCteSql: q.rankCteSql, matchTierSql: q.matchTierSql,
    })
    return { ids: page.items.map((r) => r.id), total: page.total }
  }))
  if (op === 'fees') return Response.json(await measured(async () => {
    const res = await outer.fetch(new Request('http://x/fees?' + args.query), env)
    return { status: res.status, body: await res.json() }
  }))
  if (op === 'capabilities') {
    const out = {}
    out.fence1 = await measured(async () => (await getImportFencedDb(env)).importWriteFenceStatements)
    out.fence2 = await measured(async () => (await getImportFencedDb(env)).importWriteFenceStatements)
    const cap = () => outer.fetch(new Request('http://x/sales/money-precision-capability'), env).then((r) => r.json())
    out.cap1 = await measured(cap)
    out.cap2 = await measured(cap)
    // fees POST with a valid request id and an unreadable amount: it passes the
    // operationWritesReady gate and is refused afterwards, writing nothing.
    const feePost = () => measured(async () => {
      const res = await outer.fetch(new Request('http://x/fees', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_request_id: 'fee-memo-probe-0001', fee_type: 'expense', amount_usd: 'abc' }) }), env)
      return res.status
    })
    const trigger = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='transfer_receipts_require_provenance_insert'").first('sql')
    await env.DB.prepare('DROP TRIGGER transfer_receipts_require_provenance_insert').run()
    out.notReady1 = await feePost()
    out.notReady2 = await feePost()
    await env.DB.prepare(trigger).run()
    out.ready1 = await feePost()
    out.ready2 = await feePost()
    return Response.json(out)
  }
  return new Response('unknown op', { status: 400 })
} }
`

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: entry }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const dir = path.join(root, 'migrations')
    const stmts = []
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        stmts.push(sql)
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100).map((s) => db.prepare(s)))
    const run = (sql, ...b) => db.prepare(sql).bind(...b).run()
    await run("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)")
    await run("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Warehouse',0,1)")

    // Fixture: MATCHES "Glow" products + OTHERS others, each with one positive lot at branch 1
    // (so the branch holds ~800 positive lots), plus one product with a mix of lots.
    await run("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')")
    const total = MATCHES + OTHERS
    for (let i = 0; i < total; i += 200) {
      const batch = []
      for (let j = i; j < Math.min(total, i + 200); j++) {
        const id = 1000 + j
        const name = j < MATCHES ? `Glow Serum ${j}` : `Plain Cream ${j}`
        batch.push(db.prepare('INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,cost_price_usd,is_active) VALUES(?,?,?,?,5,3,1,1)').bind(id, name, '885' + String(id).padStart(10, '0'), 'SKU-' + id))
        batch.push(db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').bind(id))
        batch.push(db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,expiry_date) VALUES(?,?,?,?,'2026-09-01',1,1,'2027-06-01')").bind(id + 500000, id, 'b-' + id, 'L-' + id))
        batch.push(db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,5)').bind(id + 500000))
      }
      await db.batch(batch)
    }
    const T = 9000
    const lot = (id, key, code, received, number) => db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(?,?,?,?,?,1,?)').bind(id, T, key, code, received, number)
    const stock = (id, branch, qty) => db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(id, branch, qty)
    await db.batch([
      db.prepare('INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,cost_price_usd,is_active) VALUES(?,?,?,?,14,3,1,1)').bind(T, 'Lot Mix Product', '8859999999999', 'SKU-MIX'),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,14)').bind(T),
      // undated, newer, older, same date as older but later number, inactive, zero stock, other branch only
      lot(9001, 'm1', 'NODATE', null, 1), lot(9002, 'm2', 'NEWER', '2026-09-20', 2), lot(9003, 'm3', 'OLDER', '2026-08-01', 3),
      lot(9004, 'm4', 'OLDER-B', '2026-08-01', 4), lot(9005, 'm5', 'INACTIVE', '2026-07-01', 5), lot(9006, 'm6', 'ZERO', '2026-07-02', 6),
      lot(9007, 'm7', 'OTHERBRANCH', '2026-07-03', 7),
      stock(9001, 1, 2), stock(9002, 1, 3), stock(9003, 1, 4), stock(9004, 1, 5), stock(9005, 1, 0), stock(9006, 1, 0), stock(9007, 2, 6),
    ])
    await run('UPDATE product_batches SET is_active = 0 WHERE id = 9005')
    await run("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    for (let j = 0; j < 12; j++) await run("INSERT INTO fees(fee_type,amount_usd,amount_khr,fee_date,label) VALUES(?,?,0,'2026-09-15',?)", ['tax', 'delivery', 'other'][j % 3], 1 + j, 'fee ' + j)

    const feeCount = await db.prepare('SELECT COUNT(*) AS n FROM fees').first('n')
    const call = async (op, args) => {
      const res = await mf.dispatchFetch('http://localhost/', { method: 'POST', body: JSON.stringify({ op, args }) })
      assert.equal(res.status, 200, await res.clone().text())
      return res.json()
    }
    let failed = 0
    const check = async (name, fn) => { try { await fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.log('FAIL ' + name + '\n' + (error && error.stack || error)) } }
    const report = (name, m) => console.log(`     ${name}: ${m.rows} rows, ${m.statements} statements`)


    await check('lot reads: FIFO order and sums unchanged, a handful of rows on a branch with ~800 lots', async () => {
      const one = await call('lots', { productId: 1000, branchId: 1 })
      for (const key of ['single', 'cart', 'known']) {
        report('one-lot ' + key, one[key])
        assert.equal(one[key].statements, key === 'known' ? 2 : 1, 'the picker route is the lot list plus the known sum')
        assert.ok(one[key].rows < 10, `${key} read ${one[key].rows} rows for a product with one lot`)
      }
      assert.equal(one.known.result, 5)
      const r = await call('lots', { productId: 9000, branchId: 1 })
      assert.deepEqual(r.single.result.map((l) => l.lotCode), ['OLDER', 'OLDER-B', 'NEWER', 'NODATE'])
      assert.deepEqual(r.single.result.map((l) => l.available), [4, 5, 3, 2])
      assert.deepEqual(r.cart.result, [['9000:1', r.single.result]])
      assert.equal(r.known.result, 14, 'zero-stock and other-branch lots add nothing')
      for (const key of ['single', 'cart', 'known']) {
        report(key, r[key])
        assert.ok(r[key].rows < 40, `${key} read ${r[key].rows} rows for 7 lots`)
      }
    })

    await check('lot read plans: product_batches by its variant index first, branch_batch_stock by its unique key', async () => {
      const { plans } = await call('lotPlans', { productId: 9000, branchId: 1 })
      // The two route-level statements are lifted from the source so a reordered join there is caught too.
      const lift = (file, from) => {
        const src = fs.readFileSync(path.join(root, 'src', file), 'utf8')
        const start = src.indexOf('`', src.lastIndexOf('db.prepare(', src.indexOf(from)))
        return src.slice(start + 1, src.indexOf('`', start + 1)).replace(/\$\{[^}]*\}/g, '?')
      }
      const batchesSql = lift('routes/batches.ts', 'pb.variant_product_id = ? AND bbs.branch_id = ?')
      const salesSql = lift('routes/sales.ts', 'SUM(bbs.quantity) AS quantity')
      const routePlans = (await call('explain', { items: [{ sql: batchesSql, params: [9000, 1] }, { sql: salesSql, params: [1, 9000] }] })).plans
      const all = [...plans, ...routePlans]
      assert.equal(all.length, 4)
      for (const plan of all) {
        const text = plan.join(' | ')
        assert.ok(/SEARCH pb USING (COVERING )?INDEX idx_product_batches_variant_(number|expiry|key_unique)/.test(text), text)
        assert.ok(/SEARCH bbs USING (COVERING )?INDEX idx_branch_batch_stock_batch_branch_unique \(batch_id=\? AND branch_id=\?\)/.test(text), text)
        assert.ok(!/SCAN bbs|idx_branch_batch_stock_branch_qty/.test(text), text)
      }
    })

    await check(`search with ${MATCHES} matches reads under 15,000 rows in 2 statements`, async () => {
      const r = await call('search', { term: 'glow' })
      report('search', r)
      assert.equal(r.result.total, MATCHES)
      assert.equal(r.result.ids.length, 15)
      assert.equal(r.statements, 2)
      assert.ok(r.rows < 15000, `search read ${r.rows} rows`)
    })

    await check('expenses list: total comes from the summary, two statements', async () => {
      const r = await call('fees', { query: 'limit=5' })
      report('fees', r)
      assert.equal(r.result.status, 200, JSON.stringify(r.result.body))
      assert.equal(r.result.body.total, feeCount)
      assert.equal(r.result.body.fees.length, 5)
      assert.equal(r.result.body.summary.reduce((sum, x) => sum + x.count, 0), feeCount)
      assert.equal(r.statements, 2)
      const filtered = await call('fees', { query: 'fee_type=tax' })
      assert.equal(filtered.result.body.total, (await db.prepare("SELECT COUNT(*) AS n FROM fees WHERE fee_type = 'tax'").first('n')))
    })

    await check('schema capabilities: one probe per isolate, false is never cached', async () => {
      const r = await call('capabilities')
      for (const key of ['fence1', 'fence2', 'cap1', 'cap2', 'notReady1', 'notReady2', 'ready1', 'ready2']) report(key, r[key])
      assert.equal(r.fence1.statements, 1)
      assert.equal(r.fence2.statements, 0, 'import fence capability is remembered')
      assert.ok(r.cap1.statements > 0)
      assert.equal(r.cap2.statements, 0, 'money-precision capability is remembered')
      assert.equal(r.notReady1.result, 503); assert.equal(r.notReady2.result, 503)
      assert.equal(r.notReady1.statements, 1)
      assert.equal(r.notReady2.statements, 1, 'a missing schema is probed again, never cached as false')
      assert.notEqual(r.ready1.result, 503, 'the probe sees the schema once it exists')
      assert.equal(r.ready1.result, r.ready2.result)
      assert.equal(r.ready1.statements - r.ready2.statements, 1, 'the positive answer is remembered')
    })

    await check('every other positive-only probe keeps its memo and never stores a false', async () => {
      const read = (file) => fs.readFileSync(path.join(root, 'src', file), 'utf8')
      for (const file of ['routes/fees.ts', 'routes/branches.ts', 'routes/inventory.ts']) {
        const src = read(file)
        assert.ok(src.includes('if (operationWritesAvailable) return true'), file)
        assert.ok(src.includes('operationWritesAvailable = row?.ready === 2'), file)
        assert.ok(!/^\s+operationWritesAvailable = (true|false)/m.test(src), file + ': assigned only from the probe result')
      }
      const contacts = read('routes/contacts.ts')
      assert.ok(contacts.includes('if (tablesPresent.has(name)) return true') && contacts.includes('if (row) tablesPresent.add(name)'))
      assert.ok(!contacts.includes("name='customer_receivables' LIMIT 1"), 'the ledger check goes through hasTable')
      assert.ok(read('lib/stockSession.ts').includes('if (!lotEditTableAvailable) lotEditTableAvailable = Boolean('))
    })

    if (failed) process.exit(1)
    await Promise.race([mf.dispose(), new Promise((resolve) => setTimeout(resolve, 5000))])
    process.exit(0)
  } finally {
    await mf.dispose()
  }
}
main().catch((error) => { console.error(error); process.exit(1) })
