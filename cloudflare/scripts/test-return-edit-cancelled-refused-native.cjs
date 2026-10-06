// Native workerd/Miniflare D1 boundary for the rule "a cancelled return is
// not edited in place".
//
// The defect (hunt H-stock #3, 2026-09-27): PATCH /api/returns/:id had no
// status check. Cancelling a restocked return already took its units back out
// of stock; editing it afterwards reversed the (already reversed) restock and
// re-applied the new lines, so the edit moved branch/lot stock on a return that
// counts for nothing. Restoring it then moved stock a second time.
//
// Chosen rule: refuse (409 return_edit_cancelled, action restore_required) and
// write nothing. Restore first, then edit. A "stock-neutral" edit of a
// cancelled row was rejected because the row's lines are what the restore
// replays: silently rewriting them while cancelled would make the later
// restore restock quantities the operator never saw applied.
//
// Locks:
//   1. positive control -- editing a completed return still succeeds;
//   2. editing a cancelled return is refused and writes nothing (stock, lots,
//      return row, items, movements);
//   3. restore after the refused edit lands branch stock exactly back at 10;
//   4. after the restore the return is editable again.
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
    plugins: [{ name: 'return-edit-cancelled-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:raw});return next()}`,
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
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    // Lot L1 received 10, sold 2 (8 on hand), one legacy sale line of 2.
    await db.batch([
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum',1,8,2,5)",
      `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity)
        VALUES(1,1,'L1','L1','2026-09-01',1,10)`,
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,8)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,8)',
      `INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(1,'S-1',1,'Shop',4000,10,10,'completed',10)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(1,1,1,'Serum',2,1,5,10,2,1)`,
      'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,1,1,2,0)',
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
    const create = (key, quantity) => send('POST', '/api/returns', { client_request_id: key, sale_id: 1, reason: 'Changed mind', items: line(quantity) })
    const edit = async (id, key, quantity) => {
      const row = await db.prepare('SELECT updated_at FROM returns WHERE id=?').bind(id).first()
      return send('PATCH', `/api/returns/${id}`, { client_request_id: key, expected_updated_at: row.updated_at, items: line(quantity) })
    }
    const bulk = async (key, id, source, target) => {
      const row = await db.prepare('SELECT status,return_type,updated_at FROM returns WHERE id=?').bind(id).first()
      return send('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source, target,
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'),
          expected_updated_at: row.updated_at ?? null }] })
    }
    const stock = async () => ({
      branch: Number((await db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).q),
      product: Number((await db.prepare('SELECT stock_quantity q FROM products WHERE id=1').first()).q),
      lot: Number((await db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').first()).q),
    })
    const snapshot = async id => JSON.stringify({
      stock: await stock(),
      ret: await db.prepare('SELECT status,updated_at,total_refund_usd FROM returns WHERE id=?').bind(id).first(),
      items: (await db.prepare('SELECT product_id,quantity,stock_action,total_usd FROM return_items WHERE return_id=? ORDER BY id').bind(id).all()).results,
      movements: (await db.prepare('SELECT COUNT(*) n FROM inventory_movements').first()).n,
      lots: (await db.prepare('SELECT COUNT(*) n FROM return_item_batch_allocations').first()).n,
    })

    // 1. Positive control: a completed return is still editable (1 -> 2 restocked).
    const control = await create('edit-control-1', 1)
    assert.equal(control.status, 200, JSON.stringify(control.body))
    assert.deepEqual(await stock(), { branch: 9, product: 9, lot: 9 })
    const controlEdit = await edit(control.body.id, 'edit-control-2', 2)
    assert.equal(controlEdit.status, 200, JSON.stringify(controlEdit.body))
    assert.deepEqual(await stock(), { branch: 10, product: 10, lot: 10 }, 'a completed return edit still restocks the new quantity')

    // 2. Cancel it (stock back to 8), then try to edit it.
    const cancel = await bulk('edit-cancel-1', control.body.id, 'completed', 'cancelled')
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body))
    assert.deepEqual(await stock(), { branch: 8, product: 8, lot: 8 })
    const before = await snapshot(control.body.id)
    const refused = await edit(control.body.id, 'edit-cancelled-1', 2)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'return_edit_cancelled', JSON.stringify(refused.body))
    assert.equal(refused.body.action, 'restore_required', JSON.stringify(refused.body))
    assert.equal(await snapshot(control.body.id), before, 'a refused edit of a cancelled return writes nothing')

    // 3. Restoring it puts the 2 units back exactly once.
    const restore = await bulk('edit-restore-1', control.body.id, 'cancelled', 'completed')
    assert.equal(restore.status, 200, JSON.stringify(restore.body))
    assert.deepEqual(await stock(), { branch: 10, product: 10, lot: 10 }, 'restore after a refused edit lands stock at 10, not above')

    // 4. Once restored, the return is editable again.
    const reEdit = await edit(control.body.id, 'edit-after-restore-1', 1)
    assert.equal(reEdit.status, 200, JSON.stringify(reEdit.body))
    assert.deepEqual(await stock(), { branch: 9, product: 9, lot: 9 })

    console.log('PASS native return edit on a cancelled return: refused with return_edit_cancelled (restore_required) and writes nothing; completed returns still edit, and restore-then-edit works')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
