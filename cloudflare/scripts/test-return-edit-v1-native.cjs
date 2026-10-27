// 6.0.997 slice S1 native workerd/Miniflare D1: managers and admins edit the NON-MONEY parts of a current-format customer return
// (reason, notes, handling method, per-line stock handling at the same quantities).
//
// Real modules: the returns router, the action-history router, lib/returnEditV1.ts, lib/returnStockDeltas.ts, the undo applier
// registry and every migration. Returns are created by the REAL create route so their lots, allocations and snapshots are the ones
// production writes. Fixtures: authentication (a header names the user), cache, broadcast and Telegram only.
//
// Locks, in order (each is written so the plausible wrong build fails it -- see the mutation notes in LANE-6.0.997-S1.md):
//   1. permissions: Review tier, Returns Edit switched off and View-only get 403 on preview and apply; manager and admin get 200;
//   2. refusals with a way out: a changed quantity / line / currency / refund echo is refused as "money edits are coming" and
//      writes nothing; a stale digest or stale updated_at is refused; a missing request id is refused;
//   3. header-only edit: reason/notes/method change, stock and money untouched, one history entry, one audit row (the return's Records);
//   4. restock -> none on a return drawn from TWO lots: BOTH ledgers move, each recorded lot by its own quantity (a branch-only
//      build leaves the lots alone; a newest-lot build takes all units from one lot);
//   5. restock -> damaged opens a held row and its damage_in movement without touching sellable stock twice; damaged -> restock
//      puts the units back into the sale's lots; damaged -> none closes the row; a used-up damaged row refuses with its product;
//   6. money (every refund, currency, riel, debt, quantity, price, date, status) is byte-identical after every step;
//   7. undo is byte-identical to the state before the edit, redo to the state after it, an undo retry is idempotent, and an undo is
//      refused once a later return on the sale was written;
//   8. idempotency: the same request id with the same body replays the receipt; with a different body it conflicts;
//   9. budget: 50 lines fit the Free plan's 50 queries per request; 51 lines are refused and nothing is written.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function kernelBundle() {
  const bundle = await build({ stdin: { contents: `export * from './src/lib/saleItemPricing'; export { executeRawStockTransaction } from './src/lib/stockTransaction'`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns'; import history from './src/routes/actionHistory';
      const app=new Hono(); app.route('/api/returns',returns); app.route('/api/action-history',history); export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'],
    plugins: [{ name: 'return-edit-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-user');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',JSON.parse(raw));return next()}`,
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersion=async()=>0;',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'edit-fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'edit-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
    } }],
  })
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    }
  }
}

const ADMIN = { id: 7, username: 'admin', name: 'Fixture Admin', role_code: 'admin', permissions: '{}' }
const MANAGER = { id: 8, username: 'manager', name: 'Fixture Manager', role_code: 'manager', permissions: JSON.stringify({ returns: true }) }
const REVIEWER = { id: 9, username: 'reviewer', name: 'Fixture Reviewer', role_code: 'manager', permissions: JSON.stringify({ returns: 'review' }) }
const EDIT_OFF = { id: 10, username: 'editoff', name: 'Fixture Edit Off', role_code: 'manager', permissions: JSON.stringify({ returns: true, 'returns:edit': false }) }
const VIEWER = { id: 11, username: 'viewer', name: 'Fixture Viewer', role_code: 'staff', permissions: JSON.stringify({ sales: 'view', returns: 'view' }) }

async function world(planTier) {
  const [kernel, bundle] = await Promise.all([kernelBundle(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], bindings: planTier ? { PLAN_TIER: planTier } : {},
    compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR) })
  const db = await mf.getD1Database('DB')
  await migrate(db)
  const send = async (method, url, body, user = ADMIN) => {
    const response = await mf.dispatchFetch(`http://local${url}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error(`${method} ${url} returned ${response.status}: ${text}`) }
    return { status: response.status, body: parsed }
  }
  const all = async (sql, ...binds) => (await db.prepare(sql).bind(...binds).all()).results
  const one = async (sql, ...binds) => (await all(sql, ...binds))[0]
  return { kernel, mf, db, send, all, one }
}

// A current-format sale exactly as checkout writes it, drawn from the named lots.
async function seedSale(w, saleId, lines) {
  const { kernel, db } = w
  const pool = { version: 1, pool_key: `edit-pool-${saleId}`, evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [], lines: lines.map(line => ({ line_key: line.key, source: 'selling',
    product: { id: line.product, selling_price_usd: line.price, selling_price_khr: line.price * 4000, wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
    selling_price_input_usd: null, manual: { type: 'none', value: 0 } })) }
  const amounts = lines.map(line => Number((line.price * line.quantity).toFixed(4)))
  const allocation = { version: 1, lines: lines.map((line, index) => ({ line_key: line.key, amount: amounts[index] })), discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
  const quantities = Object.fromEntries(lines.map(line => [line.key, line.quantity]))
  const pricing = lines.map(line => kernel.materializeCapturedPricingRow({ id: line.id, product_id: line.product }, pool, quantities, line.key, allocation))
  const entitlement = Number(pricing.map(row => kernel.parseSaleItemPricing(row.pricing_snapshot_json).receipt_allocation.net_entitlement_usd).reduce((sum, value) => sum + value, 0).toFixed(4))
  const total = Math.round(entitlement * 100) / 100
  await db.batch([
    db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,tax_usd,
      calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status,amount_paid_usd,amount_paid_khr)
      VALUES(?,?,1,'Shop',4000,?,0,0,0,?,?,?,1,'completed',?,0)`).bind(saleId, `EDIT-${saleId}`, Number(amounts.reduce((s, v) => s + v, 0).toFixed(4)), entitlement, Number((total - entitlement).toFixed(4)), total, total),
    ...pricing.map((row, index) => db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,cost_price_usd,cost_price_khr,
      total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,
      manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json)
      VALUES(?,?,?,?,?,1,?,7,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(lines[index].id, saleId, lines[index].product, `Product ${lines[index].product}`, lines[index].quantity,
      lines[index].lots.length === 1 ? lines[index].lots[0].batch : null,
      row.total_usd, row.total_khr, row.base_price_usd, row.base_price_khr, row.applied_price_usd, row.applied_price_khr, row.product_discount_usd, row.product_discount_khr,
      row.product_discount_type, row.product_discount_label, row.manual_discount_usd, row.manual_discount_khr, row.manual_discount_type, row.manual_discount_value, row.price_mode, row.pricing_snapshot_json)),
    ...lines.flatMap(line => line.lots.map(lot => db.prepare('INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(?,?,1,?,0)').bind(line.id, lot.batch, lot.quantity))),
  ])
}

async function createReturn(w, saleId, requestId, items) {
  const quote = await w.send('POST', '/api/returns/quote', { sale_id: saleId, items: items.map(({ sale_item_id, quantity }) => ({ sale_item_id, quantity })) })
  assert.equal(quote.status, 200, JSON.stringify(quote.body))
  const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
  const created = await w.send('POST', '/api/returns', { client_request_id: requestId, money_precision_version: 1, sale_id: saleId, reason: 'Customer changed mind', expected_quote: expected,
    items: items.map(item => ({ branch_id: 1, ...item })) })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  return Number(created.body.id)
}

// Every row an edit may touch or must not touch, as one comparable document.
async function dump(w, returnId) {
  const money = await w.one(`SELECT status,money_precision_version,total_refund_usd,total_refund_khr,calculated_refund_usd,rounding_adjustment_usd,owed_reduction_usd,refund_currency,
    exchange_rate,branch_id,sale_id,created_at,replacement_sale_id FROM returns WHERE id=?`, returnId)
  const items = await w.all('SELECT id,sale_item_id,product_id,quantity,total_usd,total_khr,applied_price_usd,applied_price_khr,refund_snapshot_json FROM return_items WHERE return_id=? ORDER BY id', returnId)
  return JSON.stringify({ money, items })
}
async function stockState(w, returnId) {
  return JSON.stringify({
    returns: await w.one('SELECT reason,notes,return_type,status FROM returns WHERE id=?', returnId),
    lines: await w.all('SELECT id,stock_action,return_to_stock,batch_id FROM return_items WHERE return_id=? ORDER BY id', returnId),
    allocs: await w.all('SELECT * FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM return_items WHERE return_id=?) ORDER BY id', returnId),
    lots: await w.all('SELECT * FROM damaged_stock_lots ORDER BY id'),
    branch: await w.all('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id'),
    batch: await w.all('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id'),
    products: await w.all('SELECT id,stock_quantity FROM products ORDER BY id'),
  })
}
const lotStock = async (w, batch) => Number((await w.one('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1', batch)).quantity)
const branchStock = async (w, product) => Number((await w.one('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', product)).quantity)
const productStock = async (w, product) => Number((await w.one('SELECT stock_quantity FROM products WHERE id=?', product)).stock_quantity)

async function seedCatalog(w) {
  const { kernel, db } = w
  await kernel.executeRawStockTransaction(db, [
    db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
    db.prepare(`INSERT INTO products(id,name,is_active,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr)
      VALUES(1,'Widget',1,20,10,40000,7,28000),(2,'Gadget',1,6,5,20000,3,12000),(3,'Gizmo',1,4,8,32000,5,20000)`),
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,20),(2,1,6),(3,1,4)'),
    db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES
      (500,1,'lot-500','LOT-500','2026-08-01',1,1),(501,1,'lot-501','LOT-501','2026-08-15',1,2),(502,2,'lot-502','LOT-502','2026-08-20',1,1),(503,3,'lot-503','LOT-503','2026-08-25',1,1)`),
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10),(501,1,10),(502,1,6),(503,1,4)'),
  ])
}

async function main() {
  const w = await world('paid')
  try {
    await seedCatalog(w)
    // Sale 1: line 11 = 3 x Widget drawn from TWO lots (500 once, 501 twice); line 12 = 2 x Gadget from lot 502; line 13 = 1 x Gizmo from lot 503.
    await seedSale(w, 1, [
      { id: 11, key: 'a', product: 1, price: 10, quantity: 3, lots: [{ batch: 500, quantity: 1 }, { batch: 501, quantity: 2 }] },
      { id: 12, key: 'b', product: 2, price: 5, quantity: 2, lots: [{ batch: 502, quantity: 2 }] },
      { id: 13, key: 'c', product: 3, price: 8, quantity: 1, lots: [{ batch: 503, quantity: 1 }] },
    ])
    const returnId = await createReturn(w, 1, 'edit-v1-create-1', [
      { sale_item_id: 11, product_id: 1, quantity: 3, stock_action: 'restock' },
      { sale_item_id: 12, product_id: 2, quantity: 1, stock_action: 'restock' },
    ])
    // After the return: Widget lots 500 -> 11, 501 -> 12 (last drawn first), Gadget lot 502 -> 7.
    assert.deepEqual([await lotStock(w, 500), await lotStock(w, 501), await lotStock(w, 502)], [11, 12, 7], 'create put the units back into the recorded lots')
    const lineA = Number((await w.one('SELECT id FROM return_items WHERE return_id=? AND sale_item_id=11', returnId)).id)
    const lineB = Number((await w.one('SELECT id FROM return_items WHERE return_id=? AND sale_item_id=12', returnId)).id)
    const head = () => w.one('SELECT updated_at,reason,notes,return_type FROM returns WHERE id=?', returnId)
    const moneyBase = await dump(w, returnId)
    const body = async (extra = {}) => ({ expected_updated_at: (await head()).updated_at, ...extra })

    // ---- 1. permissions ------------------------------------------------------------------------------------------------
    for (const user of [REVIEWER, EDIT_OFF, VIEWER]) {
      const preview = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ reason: 'Nope' }), user)
      assert.equal(preview.status, 403, `${user.username} preview: ${JSON.stringify(preview.body)}`)
      const apply = await w.send('PATCH', `/api/returns/${returnId}`, await body({ reason: 'Nope', client_request_id: `deny-${user.id}`, expected_digest: 'x' }), user)
      assert.equal(apply.status, 403, `${user.username} apply: ${JSON.stringify(apply.body)}`)
    }
    assert.equal((await head()).reason, 'Customer changed mind', 'a refused request wrote nothing')
    assert.equal(await dump(w, returnId), moneyBase)

    // ---- 2. refusals that name the way out ---------------------------------------------------------------------------------
    const lineBody = (overrides = {}, only) => (extra = {}) => ({ items: [
      { id: lineA, sale_item_id: 11, product_id: 1, quantity: 3, stock_action: 'restock', ...(only === 'a' ? overrides : {}) },
      { id: lineB, sale_item_id: 12, product_id: 2, quantity: 1, stock_action: 'restock', ...(only === 'b' ? overrides : {}) }], ...extra })
    const stockBefore = await stockState(w, returnId)
    for (const [label, mutate] of [
      ['a quantity change', { items: lineBody({ quantity: 2 }, 'a')().items }],
      ['a removed line', { items: lineBody()().items.slice(0, 1) }],
      ['a refund echo that differs', { total_refund_usd: 1 }],
      ['a currency change', { refund_currency: 'KHR' }],
    ]) {
      const refused = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body(mutate))
      assert.equal(refused.status, 409, `${label}: ${JSON.stringify(refused.body)}`)
      assert.equal(refused.body.code, 'return_edit_money_locked', label)
      assert.match(refused.body.error, /reason, notes and stock handling/i, `${label} names what can still be edited`)
    }
    assert.equal((await w.send('POST', `/api/returns/${returnId}/edit/preview`, { reason: 'No version' })).body.code, 'expected_updated_at_required')
    assert.equal((await w.send('POST', `/api/returns/${returnId}/edit/preview`, { expected_updated_at: 'old', reason: 'Stale' })).body.code, 'return_edit_preview_stale')
    assert.equal((await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ reason: 'x', surprise: 1 }))).status, 400)
    const noId = await w.send('PATCH', `/api/returns/${returnId}`, await body({ reason: 'No id' }))
    assert.equal(noId.body.code, 'client_request_id_required')
    assert.equal(await stockState(w, returnId), stockBefore, 'refusals write nothing')

    // ---- 3. header-only edit by a manager ---------------------------------------------------------------------------------
    const headerBefore = await head()
    const headerPreview = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ reason: 'Wrong size', notes: 'Customer wanted a bigger box', return_type: 'refund' }), MANAGER)
    assert.equal(headerPreview.status, 200, JSON.stringify(headerPreview.body))
    assert.equal(headerPreview.body.changed, true)
    assert.deepEqual(headerPreview.body.header.map(row => row.field).sort(), ['notes', 'reason', 'return_type'])
    assert.equal(headerPreview.body.stock.length, 0, 'a header edit moves no stock')
    assert.equal(headerPreview.body.money.unchanged, true)
    const headerRequest = await body({ reason: 'Wrong size', notes: 'Customer wanted a bigger box', return_type: 'refund' })
    const stale = await w.send('PATCH', `/api/returns/${returnId}`, { ...headerRequest, client_request_id: 'hdr-stale', expected_digest: 'not-the-digest' }, MANAGER)
    assert.equal(stale.body.code, 'return_edit_preview_stale')
    const headerApply = await w.send('PATCH', `/api/returns/${returnId}`, { ...headerRequest, client_request_id: 'hdr-1', expected_digest: headerPreview.body.digest }, MANAGER)
    assert.equal(headerApply.status, 200, JSON.stringify(headerApply.body))
    assert.equal(headerApply.body.replayed, false)
    const headerHistory = Number(headerApply.body.history_id)
    assert.ok(headerHistory > 0, 'one undoable history entry')
    const afterHeader = await head()
    assert.deepEqual([afterHeader.reason, afterHeader.notes, afterHeader.return_type], ['Wrong size', 'Customer wanted a bigger box', 'refund'])
    assert.equal(await dump(w, returnId), moneyBase, 'money untouched by a header edit')
    assert.deepEqual([await lotStock(w, 500), await lotStock(w, 501), await lotStock(w, 502)], [11, 12, 7], 'stock untouched by a header edit')
    const audit = await w.all("SELECT action,user_name,old_value,new_value,details FROM audit_logs WHERE entity='return' AND entity_id=? AND action='update' ORDER BY id", String(returnId))
    assert.equal(audit.length, 1, 'one audit row in the same batch (the return\'s Records)')
    assert.equal(JSON.parse(audit[0].old_value).reason, 'Customer changed mind')
    assert.equal(JSON.parse(audit[0].new_value).reason, 'Wrong size')
    assert.equal(JSON.parse(audit[0].new_value).return_type, 'refund')
    // Undo of a header edit restores the three fields and writes an undo audit row.
    const undoHeader = await w.send('POST', `/api/action-history/${headerHistory}/undo`, { require_applied: true, expected_generation: 0 }, MANAGER)
    assert.equal(undoHeader.status, 200, JSON.stringify(undoHeader.body))
    const restored = await head()
    assert.deepEqual([restored.reason, restored.notes, restored.return_type], [headerBefore.reason, headerBefore.notes, headerBefore.return_type], 'undo restores the three fields exactly')
    const redoHeader = await w.send('POST', `/api/action-history/${headerHistory}/redo`, { require_applied: true, expected_generation: 1 }, MANAGER)
    assert.equal(redoHeader.status, 200, JSON.stringify(redoHeader.body))
    assert.equal((await head()).reason, 'Wrong size')
    assert.deepEqual((await w.all("SELECT action FROM audit_logs WHERE entity='return' AND entity_id=? AND action IN ('action_undo','action_redo') ORDER BY id", String(returnId))).map(row => row.action), ['action_undo', 'action_redo'])

    // ---- 4. restock -> none on a return drawn from two lots: BOTH ledgers, each recorded lot by its own quantity ---------------
    const baseStock = await stockState(w, returnId)
    const noneItems = [{ id: lineA, sale_item_id: 11, product_id: 1, quantity: 3, stock_action: 'none' }, { id: lineB, sale_item_id: 12, product_id: 2, quantity: 1, stock_action: 'restock' }]
    const nonePreview = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ items: noneItems }), ADMIN)
    assert.equal(nonePreview.status, 200, JSON.stringify(nonePreview.body))
    assert.deepEqual(nonePreview.body.stock.filter(row => row.kind === 'sellable').map(row => [row.batch_id, row.quantity]).sort((a, b) => a[0] - b[0]), [[500, -1], [501, -2]], 'the preview names the recorded lots')
    assert.equal(await stockState(w, returnId), baseStock, 'a preview writes nothing')
    const noneRequest = await body({ items: noneItems })
    const noneApply = await w.send('PATCH', `/api/returns/${returnId}`, { ...noneRequest, client_request_id: 'none-1', expected_digest: nonePreview.body.digest }, ADMIN)
    assert.equal(noneApply.status, 200, JSON.stringify(noneApply.body))
    const afterNone = await stockState(w, returnId)
    assert.deepEqual([await lotStock(w, 500), await lotStock(w, 501), await lotStock(w, 502)], [10, 10, 7], 'lot ledger: lot 500 gave back 1, lot 501 gave back 2')
    assert.equal(await branchStock(w, 1), 20, 'branch ledger: back to the 20 before the return')
    assert.equal(await productStock(w, 1), 20, 'products total: back to 20')
    assert.equal((await w.all('SELECT * FROM return_item_batch_allocations WHERE return_item_id=?', lineA)).length, 0, 'the allocations of the line are gone')
    assert.deepEqual(await w.one('SELECT stock_action,return_to_stock,batch_id FROM return_items WHERE id=?', lineA), { stock_action: 'none', return_to_stock: 0, batch_id: null })
    const movements = await w.all("SELECT movement_type,quantity,batch_id FROM inventory_movements WHERE reference_id=? AND movement_type='return_reversal' ORDER BY id", returnId)
    assert.deepEqual(movements.map(row => [row.batch_id, row.quantity]).sort((a, b) => a[0] - b[0]), [[500, -1], [501, -2]], 'one reversal movement per recorded lot')
    assert.equal(await dump(w, returnId), moneyBase, 'money untouched by a stock-handling edit')
    const noneHistory = Number(noneApply.body.history_id)

    // ---- 7. undo is byte-identical, an undo retry is idempotent, redo re-applies --------------------------------------------------
    const undo = await w.send('POST', `/api/action-history/${noneHistory}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    const normalise = text => { const doc = JSON.parse(text); delete doc.returns.updated_at; return JSON.stringify(doc) }
    assert.equal(normalise(await stockState(w, returnId)), normalise(baseStock), 'undo restores every row and both ledgers exactly')
    assert.equal(await dump(w, returnId), moneyBase)
    const undone = await stockState(w, returnId)
    const retry = await w.send('POST', `/api/action-history/${noneHistory}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(retry.status, 200, JSON.stringify(retry.body))
    assert.equal(await stockState(w, returnId), undone, 'the retried undo changed nothing')
    const redo = await w.send('POST', `/api/action-history/${noneHistory}/redo`, { require_applied: true, expected_generation: 1 })
    assert.equal(redo.status, 200, JSON.stringify(redo.body))
    assert.equal(normalise(await stockState(w, returnId)), normalise(afterNone), 'redo re-applies exactly')
    assert.deepEqual((await w.all("SELECT action FROM audit_logs WHERE entity='return' AND entity_id=? ORDER BY id", String(returnId))).map(row => row.action),
      ['update', 'action_undo', 'action_redo', 'update', 'action_undo', 'action_redo'], 'every edit, undo and redo is in the return\'s Records')
    for (const user of [REVIEWER, EDIT_OFF]) {
      assert.notEqual((await w.send('POST', `/api/action-history/${noneHistory}/undo`, { require_applied: true, expected_generation: 2 }, user)).status, 200, `${user.username} cannot undo`)
    }

    // ---- 8. idempotency ---------------------------------------------------------------------------------------------------
    const replay = await w.send('PATCH', `/api/returns/${returnId}`, { ...noneRequest, client_request_id: 'none-1', expected_digest: nonePreview.body.digest }, ADMIN)
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.replayed, true, 'same id, same body: the saved receipt')
    assert.equal(Number(replay.body.history_id), noneHistory)
    const conflict = await w.send('PATCH', `/api/returns/${returnId}`, { ...noneRequest, items: [{ ...noneItems[0] }, { ...noneItems[1], stock_action: 'none' }], client_request_id: 'none-1', expected_digest: nonePreview.body.digest }, ADMIN)
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body))
    assert.equal(conflict.body.code, 'idempotency_conflict', 'same id, different body: a conflict, never a second write')
    assert.equal(normalise(await stockState(w, returnId)), normalise(afterNone))

    // ---- 5. none -> restock (the sale's own lots, last drawn first), restock -> damaged, damaged -> restock / none -----------------
    const backItems = [{ id: lineA, sale_item_id: 11, product_id: 1, quantity: 3, stock_action: 'restock' }, { id: lineB, sale_item_id: 12, product_id: 2, quantity: 1, stock_action: 'restock' }]
    const backPreview = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ items: backItems }))
    assert.equal(backPreview.status, 200, JSON.stringify(backPreview.body))
    const backApply = await w.send('PATCH', `/api/returns/${returnId}`, { ...(await body({ items: backItems })), client_request_id: 'back-1', expected_digest: backPreview.body.digest })
    assert.equal(backApply.status, 200, JSON.stringify(backApply.body))
    assert.deepEqual([await lotStock(w, 500), await lotStock(w, 501), await lotStock(w, 502)], [11, 12, 7], 'restock again: lot 501 first (last drawn), then 500, as the create route does')
    assert.equal(await branchStock(w, 1), 23)
    assert.deepEqual((await w.all('SELECT batch_id,quantity FROM return_item_batch_allocations WHERE return_item_id=? ORDER BY batch_id', lineA)).map(row => [row.batch_id, row.quantity]), [[500, 1], [501, 2]])

    const damagedItems = [{ id: lineA, sale_item_id: 11, product_id: 1, quantity: 3, stock_action: 'restock' }, { id: lineB, sale_item_id: 12, product_id: 2, quantity: 1, stock_action: 'damaged', condition_tag: 'expired' }]
    const dmgPreview = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ items: damagedItems }))
    assert.equal(dmgPreview.status, 200, JSON.stringify(dmgPreview.body))
    const dmgApply = await w.send('PATCH', `/api/returns/${returnId}`, { ...(await body({ items: damagedItems })), client_request_id: 'dmg-1', expected_digest: dmgPreview.body.digest })
    assert.equal(dmgApply.status, 200, JSON.stringify(dmgApply.body))
    assert.equal(await lotStock(w, 502), 6, 'the unit left sellable stock (lot ledger)')
    assert.equal(await branchStock(w, 2), 6, 'and branch stock')
    const lot = await w.one('SELECT * FROM damaged_stock_lots WHERE return_id=?', returnId)
    assert.deepEqual([lot.product_id, lot.quantity, lot.quantity_remaining, lot.condition_tag, lot.source, lot.batch_id], [2, 1, 1, 'expired', 'return', 502], 'a held row carries the tag the manager chose')
    assert.equal(Number((await w.one("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id=? AND movement_type='damage_in'", returnId)).n), 1)
    assert.equal(await dump(w, returnId), moneyBase)
    const dmgHistory = Number(dmgApply.body.history_id)
    // A re-tag changes the tag and nothing else.
    const tagItems = [damagedItems[0], { ...damagedItems[1], condition_tag: 'broken' }]
    const tagPreview = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ items: tagItems }))
    assert.equal(tagPreview.status, 200, JSON.stringify(tagPreview.body))
    assert.equal(tagPreview.body.stock.length, 0, 'a re-tag moves no stock')
    const tagApply = await w.send('PATCH', `/api/returns/${returnId}`, { ...(await body({ items: tagItems })), client_request_id: 'tag-1', expected_digest: tagPreview.body.digest })
    assert.equal(tagApply.status, 200, JSON.stringify(tagApply.body))
    assert.equal((await w.one('SELECT condition_tag FROM damaged_stock_lots WHERE return_id=?', returnId)).condition_tag, 'broken')
    // Undo of the re-tag, then of the damaged edit (in order) restore the held row and sellable stock exactly.
    assert.equal((await w.send('POST', `/api/action-history/${Number(tagApply.body.history_id)}/undo`, { require_applied: true, expected_generation: 0 })).status, 200)
    assert.equal((await w.one('SELECT condition_tag FROM damaged_stock_lots WHERE return_id=?', returnId)).condition_tag, 'expired')
    // damaged -> restock puts the unit back in the sale's lot and removes the held row.
    const undamagePreview = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ items: backItems }))
    assert.equal(undamagePreview.status, 200, JSON.stringify(undamagePreview.body))
    const undamage = await w.send('PATCH', `/api/returns/${returnId}`, { ...(await body({ items: backItems })), client_request_id: 'undmg-1', expected_digest: undamagePreview.body.digest })
    assert.equal(undamage.status, 200, JSON.stringify(undamage.body))
    assert.equal((await w.all('SELECT * FROM damaged_stock_lots WHERE return_id=?', returnId)).length, 0)
    assert.equal(await lotStock(w, 502), 7)
    assert.equal(Number((await w.one("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id=? AND movement_type='damage_reversal'", returnId)).n), 1)
    // A damaged row whose units were already used refuses with the product and a way out; nothing is written.
    assert.equal((await w.send('POST', `/api/action-history/${Number(undamage.body.history_id)}/undo`, { require_applied: true, expected_generation: 0 })).status, 200)
    await w.kernel.executeRawStockTransaction(w.db, [w.db.prepare('UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE return_id=?').bind(returnId)])
    const usedBefore = await stockState(w, returnId)
    const used = await w.send('POST', `/api/returns/${returnId}/edit/preview`, await body({ items: backItems }))
    assert.equal(used.status, 409, JSON.stringify(used.body))
    assert.equal(used.body.code, 'return_edit_damaged_used')
    assert.equal(used.body.params.product, 'Product 2')
    assert.equal(await stockState(w, returnId), usedBefore)
    await w.kernel.executeRawStockTransaction(w.db, [w.db.prepare('UPDATE damaged_stock_lots SET quantity_remaining=quantity WHERE return_id=?').bind(returnId)])

    // ---- 7b. an undo is refused once a later return on the sale was written ----------------------------------------------------
    const history0 = await w.one("SELECT id FROM action_history WHERE entity='return' AND entity_id=? AND status='undoable' ORDER BY id DESC LIMIT 1", String(returnId))
    if (history0) {
      const sibling = await createReturn(w, 1, 'edit-v1-create-2', [{ sale_item_id: 13, product_id: 3, quantity: 1, stock_action: 'restock' }])
      assert.ok(sibling > 0)
      const state0 = await stockState(w, returnId)
      const blocked = await w.send('POST', `/api/action-history/${history0.id}/undo`, { require_applied: true, expected_generation: Number(JSON.parse((await w.one('SELECT undo_payload FROM action_history WHERE id=?', history0.id)).undo_payload).generation) })
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body))
      assert.equal(blocked.body.code, 'undo_record_changed', 'a later write on the sale closes the undo')
      assert.equal(await stockState(w, returnId), state0, 'the refused undo changed nothing')
    }
    console.log('PASS native return edit (current format): permissions, refusals with a way out, header edit, two-lot reversal in both ledgers, damaged/restock/none transitions, money byte-identical, undo/redo exact, idempotency')
  } finally {
    await w.mf.dispose()
  }
}

// The budget: 50 lines fit one Free-plan request; 51 are refused and nothing is written.
async function budget() {
  const w = await world('free')
  try {
    const { db, kernel } = w
    const stmts = [db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)")]
    for (let n = 1; n <= 51; n += 1) {
      stmts.push(db.prepare(`INSERT INTO products(id,name,is_active,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr) VALUES(${n},'P${n}',1,5,1,4000,1,4000)`))
      stmts.push(db.prepare(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(${n},1,5)`))
      stmts.push(db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(${1000 + n},${n},'k${n}','L${n}','2026-08-01',1,1)`))
      stmts.push(db.prepare(`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${1000 + n},1,5)`))
    }
    await kernel.executeRawStockTransaction(db, stmts)
    const seedReturn = async (id, lines) => {
      await db.prepare(`INSERT INTO returns(id,return_number,branch_id,branch_name,reason,return_type,status,return_scope,money_precision_version,calculated_refund_usd,rounding_adjustment_usd,total_refund_usd,total_refund_khr,
        refund_currency,owed_reduction_usd,exchange_rate) VALUES(?,?,1,'Shop','r','restock','completed','customer',1,0,0,0,0,'USD',0,4000)`).bind(id, `RET-${id}`).run()
      for (let n = 1; n <= lines; n += 1) {
        await db.prepare(`INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,return_to_stock,stock_action,branch_id,batch_id)
          VALUES(?,?,NULL,?,?,1,0,0,0,0,1,'restock',1,?)`).bind(id * 1000 + n, id, n, `P${n}`, 1000 + n).run()
        await db.prepare('INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity) VALUES(?,?,1,1)').bind(id * 1000 + n, 1000 + n).run()
      }
    }
    await seedReturn(1, 50)
    const items = Array.from({ length: 50 }, (_, index) => ({ id: 1000 + index + 1, product_id: index + 1, quantity: 1, stock_action: 'none' }))
    const head = await w.one('SELECT updated_at FROM returns WHERE id=1')
    const preview = await w.send('POST', '/api/returns/1/edit/preview', { expected_updated_at: head.updated_at, items })
    assert.equal(preview.status, 200, JSON.stringify(preview.body))
    assert.ok(preview.body.statements.planned + 8 <= preview.body.statements.limit, `50 lines: ${JSON.stringify(preview.body.statements)} fit the Free limit`)
    assert.equal(preview.body.statements.limit, 50)
    const applied = await w.send('PATCH', '/api/returns/1', { expected_updated_at: head.updated_at, items, client_request_id: 'budget-50', expected_digest: preview.body.digest })
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(Number((await w.one('SELECT SUM(quantity) n FROM branch_batch_stock WHERE batch_id>1000 AND batch_id<=1050')).n), 250 - 50, 'all 50 lots gave their unit back in one request')
    await seedReturn(2, 50)
    await db.prepare("INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,return_to_stock,stock_action,branch_id,batch_id) VALUES(2051,2,NULL,51,'P51',1,0,0,0,0,1,'restock',1,1051)").run()
    await db.prepare('INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity) VALUES(2051,1051,1,1)').run()
    const before = Number((await w.one('SELECT COUNT(*) n FROM inventory_movements')).n)
    const head2 = await w.one('SELECT updated_at FROM returns WHERE id=2')
    const items51 = Array.from({ length: 51 }, (_, index) => ({ id: 2000 + index + 1, product_id: index + 1, quantity: 1, stock_action: 'none' }))
    const refused = await w.send('POST', '/api/returns/2/edit/preview', { expected_updated_at: head2.updated_at, items: items51 })
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'return_edit_too_large')
    const refusedApply = await w.send('PATCH', '/api/returns/2', { expected_updated_at: head2.updated_at, items: items51, client_request_id: 'budget-51', expected_digest: 'x' })
    assert.equal(refusedApply.status, 400)
    assert.equal(Number((await w.one('SELECT COUNT(*) n FROM inventory_movements')).n), before, 'a refused edit wrote no movement row')
    console.log('PASS native return edit budget: 50 lines fit the Free plan, 51 are refused whole')
  } finally {
    await w.mf.dispose()
  }
}

main().then(budget).catch(error => { console.error(error); process.exitCode = 1 })
