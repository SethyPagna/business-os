// Native workerd/Miniflare D1 boundary for the rule "a return against a sale
// refunds what THAT SALE recorded, never what the client posts".
//
// The defect (hunt H-money, 2026-09-27): on a legacy (money_precision_version
// 0) sale, a return line that named a real sale_id + product_id but omitted
// sale_item_id was refunded at the posted applied_price_usd. The quantity cap
// already matched such a line to the sale by product_id; the price did not.
// A crafted POST of 999.99 against a 10.01 line was paid 999.99 per unit, and
// PATCH /:id restated an existing return the same way.
//
// Locks, in order:
//   1. positive control -- a normal linked line (sale_item_id) still pays the
//      recorded price, exactly as before;
//   2. the exploit -- no sale_item_id, posted 999.99 -> recorded 10.01;
//   3. a lower posted price (goodwill) on a product-matched line is kept;
//   4. a product sold on two lines at DIFFERENT prices is refused with
//      return_refund_price_ambiguous and writes nothing;
//   5. a product sold on two lines at the SAME price prices fine;
//   6. a return with no sale at all still takes the posted price (unchanged);
//   7. PATCH /:id on a linked return caps a product-matched line the same way;
//   8. PATCH /:id refuses a linked line naming neither sale item nor product;
//   9. PATCH /:id on an unlinked return keeps the posted price (unchanged).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns';
      const app=new Hono(); app.route('/api/returns',returns); export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{ name: 'return-refund-price-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',permissions:raw});return next()}`,
        audit: 'export const audit=async()=>{};export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};export const sendPendingStockAlerts=async()=>0;
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
        path: args.path.split('/').pop(), namespace: 'return-fixture',
      }))
      b.onLoad({ filter: /.*/, namespace: 'return-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
    } }],
  })
}

async function kernel() {
  const bundle = await build({ stdin: { contents: "export * from './src/lib/returnsStock'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

function kernelChecks(k) {
  const lines = [
    { id: 1, product_id: 3, applied_price_usd: 10.01, applied_price_khr: 40040 },
    { id: 2, product_id: 4, applied_price_usd: 30.03, applied_price_khr: 120120 },
    { id: 3, product_id: 4, applied_price_usd: 30.03, applied_price_khr: 120120 },
    { id: 4, product_id: 5, applied_price_usd: 10, applied_price_khr: 40000 },
    { id: 5, product_id: 5, applied_price_usd: 8, applied_price_khr: 32000 },
  ]
  assert.deepEqual(k.matchRefundSaleLine(lines, { sale_item_id: 2, product_id: 3 }), { line: lines[1], matchedBy: 'sale_item' },
    'sale_item_id wins over product_id')
  assert.deepEqual(k.matchRefundSaleLine(lines, { product_id: 3 }), { line: lines[0], matchedBy: 'product' })
  assert.deepEqual(k.matchRefundSaleLine(lines, { product_id: 4 }), { line: lines[1], matchedBy: 'product' },
    'duplicate lines at one price are not ambiguous')
  assert.throws(() => k.matchRefundSaleLine(lines, { product_id: 5 }), error => error.code === 'return_refund_price_ambiguous')
  assert.equal(k.matchRefundSaleLine(lines, { product_id: 99 }), null)
  assert.equal(k.matchRefundSaleLine(lines, { sale_item_id: 99 }), null)
  assert.equal(k.matchRefundSaleLine(lines, {}), null)
  // Exact match: recorded price, posted ignored (unchanged behaviour).
  assert.deepEqual(k.resolveRefundUnitPrice({ saleLine: lines[0], postedUsd: 1, postedKhr: 1 }),
    { unitUsd: 10.01, unitKhr: 40040, fromSaleLine: true })
  // Product match: capped, lower kept, omitted -> recorded, negative -> 0.
  assert.deepEqual(k.resolveRefundUnitPrice({ saleLine: lines[0], matchedBy: 'product', postedUsd: 999.99, postedKhr: 3999960 }),
    { unitUsd: 10.01, unitKhr: 40040, fromSaleLine: true })
  assert.deepEqual(k.resolveRefundUnitPrice({ saleLine: lines[0], matchedBy: 'product', postedUsd: 5, postedKhr: 20000 }),
    { unitUsd: 5, unitKhr: 20000, fromSaleLine: true })
  assert.deepEqual(k.resolveRefundUnitPrice({ saleLine: lines[0], matchedBy: 'product', postedUsd: null, postedKhr: undefined }),
    { unitUsd: 10.01, unitKhr: 40040, fromSaleLine: true })
  assert.deepEqual(k.resolveRefundUnitPrice({ saleLine: lines[0], matchedBy: 'product', postedUsd: -4, postedKhr: 0 }),
    { unitUsd: 0, unitKhr: 0, fromSaleLine: true })
  // No sale line: posted price (the manual-return contract).
  assert.deepEqual(k.resolveRefundUnitPrice({ saleLine: null, postedUsd: 999.99, postedKhr: 0 }),
    { unitUsd: 999.99, unitKhr: 0, fromSaleLine: false })
}

async function main() {
  kernelChecks(await kernel())
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    await db.batch([
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare(`INSERT INTO products(id,name,is_active,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr)
        VALUES(3,'Legacy A',1,0,10.01,40040,1,4000),(4,'Legacy B',1,0,30.03,120120,1,4000)`),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(3,1,0),(4,1,0)'),
    ])
    const seedSale = async (saleId, lines) => {
      await db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,
        membership_discount_usd,tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status)
        VALUES(?,?,1,'Shop',4000,0,0,0,0,NULL,0,0,0,'completed')`).bind(saleId, `V0-SALE-${saleId}`).run()
      for (const line of lines) {
        await db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,
          total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr)
          VALUES(?,?,?,?,?,1,?,?,?,?,?,?,1,4000)`).bind(line.id, saleId, line.product, `Product ${line.product}`, line.quantity,
          Number((line.usd * line.quantity).toFixed(2)), line.khr * line.quantity, line.usd, line.khr, line.usd, line.khr).run()
      }
    }
    await seedSale(10, [{ id: 101, product: 3, quantity: 3, usd: 10.01, khr: 40040 }, { id: 102, product: 4, quantity: 1, usd: 30.03, khr: 120120 }])
    await seedSale(20, [{ id: 201, product: 3, quantity: 1, usd: 10.01, khr: 40040 }, { id: 202, product: 3, quantity: 1, usd: 8, khr: 32000 }])
    await seedSale(30, [{ id: 301, product: 4, quantity: 1, usd: 30.03, khr: 120120 }, { id: 302, product: 4, quantity: 1, usd: 30.03, khr: 120120 }])

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }
    const create = (key, saleId, items) => send('POST', '/api/returns', {
      client_request_id: key, ...(saleId ? { sale_id: saleId } : {}), reason: 'Refund price', return_type: 'restock',
      branch_id: 1, exchange_rate: 4000, replacement_items: [],
      items: items.map(item => ({ product_name: 'Line', stock_action: 'none', branch_id: 1, ...item })),
    })
    const edit = async (id, key, items) => {
      const row = await db.prepare('SELECT updated_at FROM returns WHERE id=?').bind(id).first()
      return send('PATCH', `/api/returns/${id}`, { client_request_id: key, expected_updated_at: row.updated_at,
        reason: 'Refund price edit', items: items.map(item => ({ product_name: 'Line', stock_action: 'none', branch_id: 1, ...item })) })
    }
    const money = async id => {
      const row = await db.prepare('SELECT total_refund_usd,total_refund_khr FROM returns WHERE id=?').bind(id).first()
      const items = (await db.prepare('SELECT applied_price_usd,applied_price_khr,total_usd FROM return_items WHERE return_id=? ORDER BY id')
        .bind(id).all()).results
      return { usd: Number(row.total_refund_usd), khr: Number(row.total_refund_khr),
        lines: items.map(item => [Number(item.applied_price_usd), Number(item.applied_price_khr), Number(item.total_usd)]) }
    }
    const counts = async () => JSON.stringify(await db.prepare(`SELECT (SELECT COUNT(*) FROM returns) r,
      (SELECT COUNT(*) FROM return_items) i, (SELECT COUNT(*) FROM return_create_receipts) c`).first())

    // 1. Positive control: a normal linked line is unchanged.
    const linked = await create('linked', 10, [{ sale_item_id: 101, product_id: 3, quantity: 1, applied_price_usd: 10.01, applied_price_khr: 40040 }])
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    assert.deepEqual(await money(linked.body.id), { usd: 10.01, khr: 40040, lines: [[10.01, 40040, 10.01]] },
      'a linked return still refunds the recorded line price')

    // 2. The exploit: sale on file, sale_item_id omitted, 999.99 posted.
    const spoof = await create('spoof', 10, [{ product_id: 3, quantity: 2, applied_price_usd: 999.99, applied_price_khr: 3999960 }])
    assert.equal(spoof.status, 200, JSON.stringify(spoof.body))
    assert.deepEqual(await money(spoof.body.id), { usd: 20.02, khr: 80080, lines: [[10.01, 40040, 20.02]] },
      'a product-matched line on a sale refunds at most the recorded price, never the posted 999.99')

    // 3. A lower posted price on a product-matched line is kept.
    const goodwill = await create('goodwill', 10, [{ product_id: 4, quantity: 1, applied_price_usd: 5, applied_price_khr: 20000 }])
    assert.equal(goodwill.status, 200, JSON.stringify(goodwill.body))
    assert.deepEqual(await money(goodwill.body.id), { usd: 5, khr: 20000, lines: [[5, 20000, 5]] })

    // 4. Ambiguous: product 3 sold on two lines of sale 20 at 10.01 and 8.00.
    const before = await counts()
    const ambiguous = await create('ambiguous', 20, [{ product_id: 3, quantity: 1, applied_price_usd: 10.01, applied_price_khr: 40040 }])
    assert.equal(ambiguous.status, 400, JSON.stringify(ambiguous.body))
    assert.equal(ambiguous.body.code, 'return_refund_price_ambiguous', JSON.stringify(ambiguous.body))
    assert.equal(await counts(), before, 'a refused ambiguous line writes nothing')
    // ...while naming the exact line on the same sale still works.
    const exactOnAmbiguous = await create('exact-on-ambiguous', 20, [{ sale_item_id: 202, product_id: 3, quantity: 1, applied_price_usd: 99, applied_price_khr: 0 }])
    assert.equal(exactOnAmbiguous.status, 200, JSON.stringify(exactOnAmbiguous.body))
    assert.deepEqual(await money(exactOnAmbiguous.body.id), { usd: 8, khr: 32000, lines: [[8, 32000, 8]] })

    // 5. Two lines of one product at one price are not ambiguous.
    const samePrice = await create('same-price', 30, [{ product_id: 4, quantity: 2, applied_price_usd: 999, applied_price_khr: 0 }])
    assert.equal(samePrice.status, 200, JSON.stringify(samePrice.body))
    assert.deepEqual(await money(samePrice.body.id), { usd: 60.06, khr: 0, lines: [[30.03, 0, 60.06]] },
      'posted khr 0 is below the recorded khr, so it stays 0 (cap, not replace)')

    // 6. No sale at all: the posted price is the only number (unchanged).
    const manual = await create('manual', null, [{ product_id: 3, quantity: 1, applied_price_usd: 999.99, applied_price_khr: 3999960 }])
    assert.equal(manual.status, 200, JSON.stringify(manual.body))
    assert.deepEqual(await money(manual.body.id), { usd: 999.99, khr: 3999960, lines: [[999.99, 3999960, 999.99]] })

    // 7. PATCH on a linked return caps a product-matched line.
    const edited = await edit(linked.body.id, 'edit-spoof', [{ product_id: 3, quantity: 1, applied_price_usd: 999.99, applied_price_khr: 3999960 }])
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.deepEqual(await money(linked.body.id), { usd: 10.01, khr: 40040, lines: [[10.01, 40040, 10.01]] },
      'an edit cannot restate a linked return at a posted price above the sale')

    // 8. PATCH refuses a linked line with neither sale item nor product.
    const beforeAnonymous = JSON.stringify(await money(linked.body.id))
    const anonymous = await edit(linked.body.id, 'edit-anonymous', [{ quantity: 1, applied_price_usd: 999.99, applied_price_khr: 0 }])
    assert.equal(anonymous.status, 400, JSON.stringify(anonymous.body))
    assert.equal(anonymous.body.code, 'return_refund_sale_line_required', JSON.stringify(anonymous.body))
    assert.equal(JSON.stringify(await money(linked.body.id)), beforeAnonymous, 'the refused edit rewrote no money')

    // 9. PATCH on an unlinked return keeps the posted price (unchanged).
    const manualEdit = await edit(manual.body.id, 'edit-manual', [{ product_id: 3, quantity: 1, applied_price_usd: 500, applied_price_khr: 2000000 }])
    assert.equal(manualEdit.status, 200, JSON.stringify(manualEdit.body))
    assert.deepEqual(await money(manual.body.id), { usd: 500, khr: 2000000, lines: [[500, 2000000, 500]] })

    console.log('PASS native return refund price: a return against a sale refunds that sale\'s recorded line price (product-matched lines capped at it, ambiguous prices refused), create and edit alike; a linked line and a sale-less return are unchanged')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
