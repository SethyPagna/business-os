// 6.0.992 native workerd/Miniflare D1: "Convert to current format" for an old-format (v0) return locked on a v1 sale.
//
// Real modules: the returns router, the action-history router, lib/returnLegacyConvert.ts, the undo applier registry and
// every migration. Fixtures: authentication (a header names the user), cache, broadcast and Telegram only.
//
// Locks, in order:
//   1. the lock is real before conversion: PATCH refuses (money_precision_review_needed), a new v1 quote on the sale is
//      refused;
//   2. owner ruling 27 Oct: full Returns access (admins AND managers) may update; Review tier, Edit switched off and no
//      Returns access are refused preview and apply, writing nothing (the manager performs the real apply in step 5);
//   3. a legacy row whose stored refund is the gross price on a discounted sale is REFUSED, with the reason, nothing written;
//   4. the preview names every old-format return on the sale (active, a product-only line, a cancelled one) with before/after;
//   5. a stale digest is refused; apply converts, preserving total_refund_usd, total_refund_khr, owed_reduction_usd,
//      refund_currency, quantities, shift drawer USD/KHR, the Not Paid receivable and every stock ledger;
//   6. a repeat of the same request replays the receipt; a fresh request with nothing left converts nothing (idempotent);
//   7. undo restores the exact old bytes, redo re-applies, both through POST /api/action-history/:id/{undo,redo};
//   8. after conversion the sale is unlocked: PATCH answers the ordinary v1 refusal (not the old-format one), a new v1
//      quote succeeds, and the v1 return can be cancelled; after that write, undo is refused (record changed).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function kernelBundle() {
  const bundle = await build({ stdin: { contents: `export * from './src/lib/saleItemPricing';
      export { executeRawStockTransaction } from './src/lib/stockTransaction';
      export { refundDrawerUsdSql, refundDrawerKhrSql } from './src/lib/shiftReconciliation';
      export { recordedSaleOutstandingUsd, sumRefundsUsd } from './src/lib/saleStatusResolution'`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns'; import history from './src/routes/actionHistory';
      const app=new Hono(); app.route('/api/returns',returns); app.route('/api/action-history',history); export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'],
    plugins: [{ name: 'return-legacy-convert-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-user');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',JSON.parse(raw));return next()}`,
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersion=async()=>0;',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
        path: args.path.split('/').pop(), namespace: 'convert-fixture',
      }))
      b.onLoad({ filter: /.*/, namespace: 'convert-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
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

const ADMIN = { id: 7, username: 'admin', name: 'Fixture Admin', role_code: 'admin', permissions: '{}' }
// Returns Full with Edit on, every other key off: everything except the admin role.
const MANAGER = { id: 8, username: 'manager', name: 'Fixture Manager', role_code: 'manager', permissions: JSON.stringify({ returns: true }) }
// Refused: Review Required on Returns; Returns Full with Edit switched off; no Returns access (a view-only seat elsewhere).
const REVIEWER = { id: 9, username: 'reviewer', name: 'Fixture Reviewer', role_code: 'manager', permissions: JSON.stringify({ returns: 'review' }) }
const EDIT_OFF = { id: 10, username: 'editoff', name: 'Fixture Edit Off', role_code: 'manager', permissions: JSON.stringify({ returns: true, 'returns:edit': false }) }
const VIEWER = { id: 11, username: 'viewer', name: 'Fixture Viewer', role_code: 'staff', permissions: JSON.stringify({ sales: 'view', returns: 'view' }) }

async function main() {
  const [kernel, bundle] = await Promise.all([kernelBundle(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    await kernel.executeRawStockTransaction(db, [
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare(`INSERT INTO products(id,name,is_active,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr)
        VALUES(1,'A one',1,0,10.01,40040,1,4000),(2,'A two',1,0,5,20000,1,4000),(3,'B one',1,0,10.01,40040,1,4000),
        (4,'B two',1,0,30.03,120120,1,4000),(5,'C one',1,0,7.5,30000,1,4000)`),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0),(2,1,0),(3,1,0),(4,1,0),(5,1,0)'),
    ])

    // A v1 sale exactly as checkout writes it: captured pricing snapshots, calculated total, cent payable.
    const seedV1Sale = async (saleId, lines, discount, status) => {
      const pool = { version: 1, pool_key: `convert-pool-${saleId}`, evaluation_time: '2026-09-13T00:00:00.000Z',
        exchange_rate: 4000, rules: [], lines: lines.map(line => ({ line_key: line.key, source: 'selling',
          product: { id: line.product, selling_price_usd: line.price, selling_price_khr: line.price * 4000,
            wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0,
            discount_percent: 0 }, selling_price_input_usd: null, manual: { type: 'none', value: 0 } })) }
      const amounts = lines.map(line => Number((line.price * line.quantity).toFixed(4)))
      const allocation = { version: 1, lines: lines.map((line, index) => ({ line_key: line.key, amount: amounts[index] })),
        discount_usd: discount, membership_discount_usd: 0, tax_usd: 0 }
      const quantities = Object.fromEntries(lines.map(line => [line.key, line.quantity]))
      const pricing = lines.map(line => kernel.materializeCapturedPricingRow({ id: line.id, product_id: line.product }, pool, quantities, line.key, allocation))
      const entitlement = Number(pricing.map(row => kernel.parseSaleItemPricing(row.pricing_snapshot_json).receipt_allocation.net_entitlement_usd)
        .reduce((sum, value) => sum + value, 0).toFixed(4))
      const total = Math.round(entitlement * 100) / 100
      await db.batch([
        db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,tax_usd,
          calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status,amount_paid_usd,amount_paid_khr)
          VALUES(?,?,1,'Shop',4000,?,?,0,0,?,?,?,1,?,?,0)`).bind(saleId, `V1-${saleId}`, Number(amounts.reduce((s, v) => s + v, 0).toFixed(4)), discount,
          entitlement, Number((total - entitlement).toFixed(4)), total, status, status === 'awaiting_payment' ? 0 : total),
        ...pricing.map((row, index) => db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,
          total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,product_discount_usd,product_discount_khr,
          product_discount_type,product_discount_label,manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json)
          VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(lines[index].id, saleId, lines[index].product, `Line ${lines[index].id}`, lines[index].quantity,
          row.total_usd, row.total_khr, row.base_price_usd, row.base_price_khr, row.applied_price_usd, row.applied_price_khr,
          row.product_discount_usd, row.product_discount_khr, row.product_discount_type, row.product_discount_label,
          row.manual_discount_usd, row.manual_discount_khr, row.manual_discount_type, row.manual_discount_value, row.price_mode, row.pricing_snapshot_json)),
      ])
      return { total }
    }
    // Sale A: paid, no discount -- old-format refunds on it equal what v1 would pay. Sale B: the gross-priced defect on a
    // discounted sale. Sale C: Not Paid, its old-format return lowered the debt.
    await seedV1Sale(1, [{ id: 11, key: 'a1', product: 1, price: 10.01, quantity: 3 }, { id: 12, key: 'a2', product: 2, price: 5, quantity: 1 }], 0, 'completed')
    await seedV1Sale(2, [{ id: 21, key: 'b1', product: 3, price: 10.01, quantity: 3 }, { id: 22, key: 'b2', product: 4, price: 30.03, quantity: 1 }], 40.04, 'completed')
    await seedV1Sale(3, [{ id: 31, key: 'c1', product: 5, price: 7.5, quantity: 2 }], 0, 'awaiting_payment')

    const send = async (method, url, body, user = ADMIN) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${method} ${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }

    // The sale's own v1 return, recorded the ordinary way before the old-format rows appeared.
    const quote = await send('POST', '/api/returns/quote', { sale_id: 1, items: [{ sale_item_id: 11, quantity: 1 }] })
    assert.equal(quote.status, 200, JSON.stringify(quote.body))
    const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
    const v1Return = await send('POST', '/api/returns', { client_request_id: 'v1-a', money_precision_version: 1, sale_id: 1, reason: 'Exact',
      expected_quote: expected, items: [{ sale_item_id: 11, product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1 }] })
    assert.equal(v1Return.status, 200, JSON.stringify(v1Return.body))
    const v1Id = Number(v1Return.body.id)

    // Old-format rows as the pre-rule writer left them in production.
    await db.batch([
      db.prepare(`INSERT INTO returns(id,return_number,client_request_id,sale_id,branch_id,branch_name,return_scope,reason,return_type,total_refund_usd,
        total_refund_khr,exchange_rate,status,money_precision_version,refund_currency,owed_reduction_usd) VALUES
        (901,'RET-A1','legacy-a1',1,1,'Shop','customer','Old','restock',10.01,40040,4000,'completed',0,'USD',0),
        (902,'RET-A2','legacy-a2',1,1,'Shop','customer','Old','restock',5,20000,4000,'completed',0,'KHR',0),
        (903,'RET-A3','legacy-a3',1,1,'Shop','customer','Old','restock',10.01,40040,4000,'cancelled',0,NULL,0),
        (904,'RET-B1','legacy-b1',2,1,'Shop','customer','Old','restock',30.03,120120,4000,'completed',0,'USD',0),
        (905,'RET-C1','legacy-c1',3,1,'Shop','customer','Old','restock',7.5,30000,4000,'completed',0,'USD',7.5)`),
      db.prepare(`INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,return_to_stock,branch_id) VALUES
        (9011,901,11,1,'Line',1,10.01,40040,10.01,40040,0,1),(9021,902,NULL,2,'Line',1,5,20000,5,20000,0,1),
        (9031,903,11,1,'Line',1,10.01,40040,10.01,40040,0,1),(9041,904,21,3,'Line',3,10.01,40040,30.03,120120,0,1),
        (9051,905,31,5,'Line',1,7.5,30000,7.5,30000,0,1)`),
    ])

    const all = async (sql, ...binds) => (await db.prepare(sql).bind(...binds).all()).results
    const one = async (sql, ...binds) => db.prepare(sql).bind(...binds).first()
    const shift = async () => one(`SELECT ROUND(SUM(${kernel.refundDrawerUsdSql('r')}),4) usd, SUM(${kernel.refundDrawerKhrSql('r')}) khr
      FROM returns r WHERE COALESCE(r.status,'completed')<>'cancelled'`)
    const receivable = async saleId => {
      const sale = await one('SELECT * FROM sales WHERE id=?', saleId)
      const rows = await all("SELECT * FROM returns WHERE sale_id=? AND COALESCE(status,'completed')<>'cancelled'", saleId)
      const notPaid = sale.sale_status === 'awaiting_payment'
      const lowered = rows.map(row => row.refund_currency == null ? (notPaid ? row.total_refund_usd : 0) : row.owed_reduction_usd)
      return kernel.recordedSaleOutstandingUsd({ ...sale, refund_usd: kernel.sumRefundsUsd(lowered) })
    }
    const ledgers = async () => JSON.stringify(await Promise.all(['sales', 'sale_items', 'products', 'branch_stock', 'product_batches',
      'branch_batch_stock', 'inventory_movements', 'return_item_batch_allocations'].map(table => all(`SELECT * FROM ${table} ORDER BY rowid`))))
    const kept = async () => JSON.stringify(await all(`SELECT id,total_refund_usd,owed_reduction_usd,refund_currency,exchange_rate,status,return_type,
      (SELECT json_group_array(json_array(quantity,return_to_stock,applied_price_usd,total_khr)) FROM return_items WHERE return_id=returns.id) lines FROM returns ORDER BY id`))
    const money = async id => one('SELECT money_precision_version,calculated_refund_usd,rounding_adjustment_usd,total_refund_usd,total_refund_khr,updated_at FROM returns WHERE id=?', id)
    const lines = async id => all('SELECT id,sale_item_id,total_usd,refund_snapshot_json FROM return_items WHERE return_id=? ORDER BY id', id)
    const counts = async () => JSON.stringify(await one(`SELECT (SELECT COUNT(*) FROM undo_snapshots) s,(SELECT COUNT(*) FROM action_history) h,
      (SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'return_money_convert%' OR action IN ('action_undo','action_redo')) a`))
    const exactBytes = async () => JSON.stringify(await Promise.all([901, 902, 903, 904, 905].map(async id => [await money(id), await lines(id)])))

    // 1. The lock is real.
    const lockedRow = await money(901)
    const lockedEdit = await send('PATCH', '/api/returns/901', { client_request_id: 'edit-locked', expected_updated_at: lockedRow.updated_at, reason: 'Fix',
      items: [{ sale_item_id: 11, product_id: 1, quantity: 1, applied_price_usd: 10.01, applied_price_khr: 40040, stock_action: 'none', branch_id: 1 }] })
    assert.equal(lockedEdit.status, 409, JSON.stringify(lockedEdit.body))
    assert.equal(lockedEdit.body.code, 'money_precision_review_needed')
    assert.notEqual((await send('POST', '/api/returns/quote', { sale_id: 1, items: [{ sale_item_id: 11, quantity: 1 }] })).status, 200,
      'an old-format row closes the whole sale to new returns')
    // (Cancelling the sale's own v1 return is no longer refused here: test-return-legacy-convert-mixed-native.cjs.)

    const baseBytes = await exactBytes()
    const baseShift = await shift()
    const baseReceivable = await receivable(3)
    const baseLedgers = await ledgers()
    const baseKept = await kept()
    const baseCounts = await counts()
    assert.equal(baseReceivable, 7.5, 'the Not Paid fixture owes 15.00 less the 7.50 the old return lowered')
    assert.deepEqual({ usd: Number(baseShift.usd), khr: Number(baseShift.khr) }, { usd: 50.05, khr: 20000 }, 'three dollar refunds (sale A twice, sale B) and one riel refund left the drawers; sale C lowered a debt')

    // 2. Permission: full Returns access (admin or manager) only.
    for (const [label, user, code] of [['review tier', REVIEWER, 'return_convert_forbidden'], ['Edit switched off', EDIT_OFF, 'return_convert_forbidden'],
      ['no Returns access (view elsewhere)', VIEWER, null]]) {
      for (const [url, body] of [['/api/returns/legacy-convert/preview', { return_ids: [901] }],
        ['/api/returns/legacy-convert', { return_ids: [901], client_request_id: `try-${user.id}`, expected_digest: 'x' }]]) {
        const refused = await send('POST', url, body, user)
        assert.equal(refused.status, 403, `${label} ${url} ${JSON.stringify(refused.body)}`)
        if (code) assert.equal(refused.body.code, code, label)
      }
    }
    const managerPreview = await send('POST', '/api/returns/legacy-convert/preview', { return_ids: [901] }, MANAGER)
    assert.equal(managerPreview.status, 200, `a manager with full Returns may preview: ${JSON.stringify(managerPreview.body)}`)
    assert.equal(await exactBytes(), baseBytes, 'refusals and the preview write nothing')
    assert.equal(await counts(), baseCounts)

    // 3. A conversion that would change money is refused, with the figures, writing nothing.
    const grossPreview = await send('POST', '/api/returns/legacy-convert/preview', { return_ids: [904] })
    assert.equal(grossPreview.status, 200, JSON.stringify(grossPreview.body))
    const gross = grossPreview.body.rows.find(row => row.id === 904)
    assert.equal(gross.outcome, 'refused')
    assert.equal(gross.code, 'return_convert_amount_changed')
    assert.deepEqual(gross.params, { before: 30.03, after: 10.01 }, 'the reason carries the saved refund and what the sale allows')
    assert.deepEqual(grossPreview.body.convertible, [])
    const grossApply = await send('POST', '/api/returns/legacy-convert', { return_ids: [904], client_request_id: 'gross-1', expected_digest: grossPreview.body.digest })
    assert.equal(grossApply.status, 200, JSON.stringify(grossApply.body))
    assert.deepEqual(grossApply.body.converted, [], 'nothing convertible -> nothing converted')
    assert.equal(await exactBytes(), baseBytes, 'a refused conversion writes no return row')
    assert.equal(await counts(), baseCounts, 'and records no history')

    // 4. Preview: selecting one return brings in every old-format return on its sale.
    const preview = await send('POST', '/api/returns/legacy-convert/preview', { return_ids: [901, 905] })
    assert.equal(preview.status, 200, JSON.stringify(preview.body))
    assert.deepEqual(preview.body.convertible, [901, 902, 903, 905], 'the whole old-format set of each sale, cancelled one included')
    const row901 = preview.body.rows.find(row => row.id === 901)
    assert.deepEqual(row901.before, { total_refund_khr: 40040, calculated_refund_usd: null, rounding_adjustment_usd: 0 })
    assert.deepEqual(row901.after, { total_refund_khr: 40040, calculated_refund_usd: 10.01, rounding_adjustment_usd: 0 })
    assert.equal(row901.total_refund_usd, 10.01)
    assert.deepEqual(row901.lines.map(line => [line.before_total_usd, line.after_total_usd]), [[10.01, 10.01]])
    assert.equal(await exactBytes(), baseBytes, 'preview is read-only')

    // 5. Apply: a stale digest is refused; the real one converts and moves no money, cash, debt or stock.
    const stale = await send('POST', '/api/returns/legacy-convert', { return_ids: [901, 905], client_request_id: 'convert-1', expected_digest: '0'.repeat(64) })
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.equal(stale.body.code, 'return_convert_preview_stale')
    assert.equal(await exactBytes(), baseBytes)
    // The manager (full Returns, not admin) performs the real apply.
    const applied = await send('POST', '/api/returns/legacy-convert', { return_ids: [901, 905], client_request_id: 'convert-1', expected_digest: preview.body.digest }, MANAGER)
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.deepEqual(applied.body.converted, [901, 902, 903, 905])
    assert.equal(applied.body.replayed, false)
    const historyId = Number(applied.body.history_id)
    assert.ok(historyId > 0, 'one undoable history entry')
    for (const id of [901, 902, 903, 905]) {
      const row = await money(id)
      assert.equal(Number(row.money_precision_version), 1, `return ${id} is in the current format`)
      assert.equal(Number((Number(row.calculated_refund_usd) + Number(row.rounding_adjustment_usd)).toFixed(4)), Number(row.total_refund_usd))
      for (const line of await lines(id)) assert.ok(line.refund_snapshot_json && line.sale_item_id, `line ${line.id} carries its entitlement snapshot`)
    }
    assert.equal((await lines(902))[0].sale_item_id, 12, 'the product-only line is linked to the one sale line that sells it')
    assert.equal(await kept(), baseKept, 'total_refund_usd, owed_reduction_usd, refund_currency, rate, status, quantities, prices and riel lines are untouched')
    assert.deepEqual(await shift(), baseShift, 'shift drawers: unchanged in dollars and riel')
    assert.equal(await receivable(3), baseReceivable, 'Not Paid receivable: unchanged')
    assert.equal(await ledgers(), baseLedgers, 'sales, sale lines, stock, lots and movements: unchanged')
    const auditRows = await all("SELECT entity,entity_id,old_value,new_value FROM audit_logs WHERE action='return_money_convert' ORDER BY id")
    assert.deepEqual(auditRows.map(row => row.entity_id), ['901', '902', '903', '905'], 'one audit row per converted return')
    assert.equal(JSON.parse(auditRows[0].old_value).money_precision_version, 0)
    assert.equal(JSON.parse(auditRows[0].new_value).money_precision_version, 1)
    assert.equal((await money(904)).money_precision_version, 0, 'the refused sale is left as it was')
    const convertedBytes = await exactBytes()

    // 6. Idempotency: the same request replays its receipt; a new request finds nothing left to convert.
    const replay = await send('POST', '/api/returns/legacy-convert', { return_ids: [901, 905], client_request_id: 'convert-1', expected_digest: preview.body.digest }, MANAGER)
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.replayed, true)
    assert.equal(Number(replay.body.history_id), historyId)
    const again = await send('POST', '/api/returns/legacy-convert/preview', { return_ids: [901] })
    assert.deepEqual(again.body.convertible, [])
    assert.equal(again.body.rows[0].outcome, 'already_converted')
    const second = await send('POST', '/api/returns/legacy-convert', { return_ids: [901], client_request_id: 'convert-2', expected_digest: again.body.digest })
    assert.equal(second.status, 200, JSON.stringify(second.body))
    assert.deepEqual(second.body.converted, [])
    assert.equal(await exactBytes(), convertedBytes, 'a second conversion changes nothing')
    const historyCount = Number((await one('SELECT COUNT(*) n FROM action_history')).n)

    // 7. Undo restores the exact old bytes (version, columns, empty link, no snapshot); redo re-applies.
    for (const user of [REVIEWER, EDIT_OFF]) {
      const refusedUndo = await send('POST', `/api/action-history/${historyId}/undo`, { require_applied: true, expected_generation: 0 }, user)
      assert.notEqual(refusedUndo.status, 200, `${user.username} cannot replay it either`)
    }
    const undo = await send('POST', `/api/action-history/${historyId}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    const undone = JSON.parse(await exactBytes())
    const base = JSON.parse(baseBytes)
    for (let index = 0; index < base.length; index += 1) {
      const { updated_at: _a, ...restored } = undone[index][0]
      const { updated_at: _b, ...original } = base[index][0]
      assert.deepEqual(restored, original, `return ${[901, 902, 903, 904, 905][index]} header restored`)
      assert.deepEqual(undone[index][1], base[index][1], 'lines restored exactly')
    }
    assert.deepEqual(await shift(), baseShift)
    assert.equal(await ledgers(), baseLedgers)
    // A retry of the same undo after its response was lost answers 200 and writes nothing (the applier sees its own
    // generation already applied; the route does not refuse it as a stale status).
    const undoneBytes = await exactBytes()
    const retry = await send('POST', `/api/action-history/${historyId}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(retry.status, 200, `undo retry is idempotent: ${JSON.stringify(retry.body)}`)
    assert.equal(await exactBytes(), undoneBytes, 'the retried undo changed nothing')
    const redo =await send('POST', `/api/action-history/${historyId}/redo`, { require_applied: true, expected_generation: 1 })
    assert.equal(redo.status, 200, JSON.stringify(redo.body))
    const redone = JSON.parse(await exactBytes())
    const converted = JSON.parse(convertedBytes)
    for (let index = 0; index < converted.length; index += 1) {
      const { updated_at: _a, ...left } = redone[index][0]
      const { updated_at: _b, ...right } = converted[index][0]
      assert.deepEqual(left, right)
      assert.deepEqual(redone[index][1], converted[index][1])
    }
    assert.equal(Number((await one('SELECT COUNT(*) n FROM action_history')).n), historyCount, 'undo/redo add no history rows')
    const replayedAudit = await all("SELECT action FROM audit_logs WHERE entity='return' AND entity_id='901' AND action IN ('action_undo','action_redo') ORDER BY id")
    assert.deepEqual(replayedAudit.map(row => row.action), ['action_undo', 'action_redo'], "the return's Records show both replays")

    // 8. The sale is unlocked: the old-format refusal is gone, a new return quotes, the v1 return cancels; undo then refuses.
    const convertedRow = await money(901)
    const editAfter = await send('PATCH', '/api/returns/901', { client_request_id: 'edit-after', expected_updated_at: convertedRow.updated_at, reason: 'Fix',
      items: [{ sale_item_id: 11, product_id: 1, quantity: 1, applied_price_usd: 10.01, applied_price_khr: 40040, stock_action: 'none', branch_id: 1 }] })
    assert.equal(editAfter.body.code, 'customer_return_edit_v1_not_supported',
      `after conversion the return answers like every current-format return, not with the old-format lock: ${JSON.stringify(editAfter.body)}`)
    const quoteAfter = await send('POST', '/api/returns/quote', { sale_id: 1, items: [{ sale_item_id: 11, quantity: 1 }] })
    assert.equal(quoteAfter.status, 200, `the sale takes new returns again: ${JSON.stringify(quoteAfter.body)}`)
    assert.equal(quoteAfter.body.total_refund_usd, 10.01, 'the last unit of line 1 is quoted at its exact share')
    const v1After = await one('SELECT status,return_type,updated_at FROM returns WHERE id=?', v1Id)
    const cancel = await send('POST', '/api/returns/bulk', { client_request_id: 'cancel-v1-after', field: 'status', source: 'completed', target: 'cancelled',
      items: [{ id: v1Id, expected_status: 'completed', expected_method: v1After.return_type, expected_updated_at: v1After.updated_at }] })
    assert.equal(cancel.status, 200, `the sale's v1 return can be cancelled now: ${JSON.stringify(cancel.body)}`)
    const blockedUndo = await send('POST', `/api/action-history/${historyId}/undo`, { require_applied: true, expected_generation: 2 })
    assert.equal(blockedUndo.status, 409, JSON.stringify(blockedUndo.body))
    assert.equal(blockedUndo.body.code, 'undo_record_changed', 'a later write on the sale closes the undo instead of restoring a shape it relied on')
    assert.equal(Number((await money(901)).money_precision_version), 1, 'the refused undo changed nothing')

    console.log('PASS native return legacy convert: locked before, full Returns access only (admin or manager), refuses a money change with its figures, converts the whole old-format set of a sale preserving refund, riel, debt, shift drawers and stock, replays idempotently, undoes/redoes exactly, unlocks the sale, and closes undo after a later write')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
