// Native workerd/Miniflare D1 boundary for the rule "a customer return puts
// units back into a lot; it is not a supplier receipt".
//
// The defect (hunt H-stock #4, 2026-09-27): POST /api/returns and PATCH
// /api/returns/:id restocked a sale's original lot through
// planReceiveBatchStock's explicit-batch path, which is the supplier-receipt
// UPDATE: `received_quantity = received_quantity + @quantity`. Nothing ever
// took it back out (edit reversal and bulk cancel only move on-hand stock), so
// every return -- and every edit of one -- inflated the supplier's "units
// received" (routes/contacts.ts purchases totals) for a lot the supplier
// delivered once.
//
// Locks:
//   kernel -- a normal explicit-batch receipt still counts received units
//             (positive control); restockOnly moves stock and reactivates the
//             lot but never touches received_quantity / received cost /
//             supplier attribution, and refuses a missing lot or a cost;
//   route  -- create and edit of a return against a 2+2 multi-lot sale line
//             leave both lots' received_quantity, received_cost_usd and
//             supplier untouched, while stock does move and an archived lot is
//             reactivated.
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
    plugins: [{ name: 'return-restock-receipt-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:raw});return next()}`,
        audit: 'export const audit=async()=>{};export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendTelegramEvent=async()=>{};
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
  const bundle = await build({ stdin: { contents: "export * from './src/lib/productBatches'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}

function kernelChecks(k) {
  const sqlOf = plan => plan.statements.map(statement => statement.sql).join('\n;\n')
  const receipt = sqlOf(k.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 2, batchId: 5 }))
  assert.match(receipt, /received_quantity = COALESCE\(received_quantity, 0\) \+ @quantity/,
    'positive control: an explicit-batch supplier receipt still counts received units')
  const restock = k.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 2, batchId: 5, restockOnly: true })
  const restockSql = sqlOf(restock)
  assert.doesNotMatch(restockSql, /received_quantity|received_cost_usd|supplier_id|supplier_name|payment_status|unit_cost_usd/,
    'a restock never writes supplier-receipt columns')
  assert.match(restockSql, /UPDATE product_batches SET[\s\S]*is_active = 1/, 'a restock still reactivates the lot')
  assert.match(restockSql, /INSERT INTO branch_batch_stock/)
  assert.match(restockSql, /INSERT INTO branch_stock/)
  assert.match(restockSql, /UPDATE products SET stock_quantity/)
  assert.equal(restock.batchIdSql, '@batchId')
  assert.throws(() => k.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 2, restockOnly: true }), /existing lot/)
  assert.throws(() => k.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 2, batchId: 5, restockOnly: true, unitCostUsd: 3 }), /cost/)
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

async function main() {
  kernelChecks(await kernel())
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    // Supplier 9 delivered two lots of 2 (4.00 each). All 4 sold on one line,
    // drawn A then B. Lot B sold out and was archived (is_active 0).
    await db.batch([
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum',1,0,2,5)",
      `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity,received_cost_usd,supplier_id,supplier_name,unit_cost_usd)
        VALUES(1,1,'A','A','2026-08-01',1,2,8,9,'Supplier Nine',4),(2,1,'B','B','2026-09-01',0,2,8,9,'Supplier Nine',4)`,
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,0),(2,1,0)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)',
      `INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(1,'S-1',1,'Shop',4000,20,20,'completed',20)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(1,1,1,'Serum',4,1,5,20,2,NULL)`,
      'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,1,1,2,0),(1,2,1,2,0)',
    ].map(sql => db.prepare(sql)))

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }
    const line = quantity => [{ sale_item_id: 1, product_id: 1, quantity, stock_action: 'restock', branch_id: 1 }]
    const supplierSide = async () => (await db.prepare(`SELECT id,received_quantity,received_cost_usd,supplier_id,supplier_name,unit_cost_usd
      FROM product_batches WHERE id IN (1,2) ORDER BY id`).all()).results
      .map(row => [row.id, Number(row.received_quantity), Number(row.received_cost_usd), row.supplier_id, row.supplier_name, Number(row.unit_cost_usd)])
    const onHand = async () => ({
      branch: Number((await db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).q),
      lots: Number((await db.prepare('SELECT SUM(quantity) q FROM branch_batch_stock WHERE branch_id=1').first()).q),
      active: (await db.prepare('SELECT id FROM product_batches WHERE id IN (1,2) AND is_active=1 ORDER BY id').all()).results.map(row => row.id),
    })
    const delivered = [[1, 2, 8, 9, 'Supplier Nine', 4], [2, 2, 8, 9, 'Supplier Nine', 4]]

    // Create: 2 come back into the sale's last-drawn lot (B, archived).
    const created = await send('POST', '/api/returns', { client_request_id: 'restock-receipt-1', sale_id: 1, reason: 'Changed mind', items: line(2) })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.deepEqual(await onHand(), { branch: 2, lots: 2, active: [1, 2] }, 'the return restocked 2 and reactivated the archived lot')
    assert.deepEqual(await supplierSide(), delivered, 'a customer return does not add to the supplier lot received quantity or cost')

    // Edit 2 -> 3: reversal plus re-restock, still no supplier receipt.
    const row = await db.prepare('SELECT updated_at FROM returns WHERE id=?').bind(created.body.id).first()
    const edited = await send('PATCH', `/api/returns/${created.body.id}`, { client_request_id: 'restock-receipt-edit-1',
      expected_updated_at: row.updated_at, items: line(3) })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.deepEqual(await onHand(), { branch: 3, lots: 3, active: [1, 2] })
    assert.deepEqual(await supplierSide(), delivered, 'editing a return does not add to the supplier lot received quantity or cost')

    console.log('PASS native return restock is not a supplier receipt: create and edit move stock and reactivate the lot but leave received_quantity, received cost and supplier attribution as delivered; ordinary explicit-lot receipts still count')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
