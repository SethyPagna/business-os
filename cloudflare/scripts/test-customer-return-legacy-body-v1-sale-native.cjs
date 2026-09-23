// Native workerd/Miniflare D1 boundary for the rule "THE SALE DECIDES a
// return's money precision version".
//
// Reproduces the release blocker: POST /api/returns with the LEGACY body shape
// (no money_precision_version -- what every pre-deploy cached PWA shell and
// frontend/src/api/returnsTransport.ts createReturn sends) was accepted on a
// sale whose sales.money_precision_version = 1, because the route chose its
// branch from the REQUEST's version instead of the sale's. The legacy branch
// prices gross line price x quantity: no sale-level discount, no cumulative
// payout cap. On the fixture sale below -- line 1 = 3 x 10.01, line 2 = 30.03,
// receipt discount 40.04, payable 20.02 -- a legacy whole-line return of line 1
// was paid 30.03, more than the entire sale. Worse, the row was written with
// money_precision_version 0, after which every v1 quote of that sale answered
// 409 money_precision_invalid_legacy_shape forever.
//
// Locks, in order: a legacy body is refused on a v1 sale writing nothing; an
// explicit version-0 body is refused the same way; the sale still takes a
// proper v1 return afterwards and stays under its payout cap; a legacy body on
// a v0 sale still succeeds with exactly today's figures (the positive control
// that keeps history working); a v1 body on a v0 sale keeps today's refusal;
// the cumulative paid never exceeds the cap across the whole mix; and an
// already-poisoned v0 return row on a v1 sale cannot be re-priced by the edit
// route either.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function pricingKernel() {
  const bundle = await build({ stdin: { contents: "export * from './src/lib/saleItemPricing'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

// Only authentication, audit, cache, broadcast and external notification are
// fixtures; the returns router itself is the production module.
async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns';
      const app=new Hono(); app.route('/api/returns',returns); export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{ name: 'return-legacy-body-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',permissions:raw});return next()}`,
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
  const [kernel, bundle] = await Promise.all([pricingKernel(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    await db.batch([
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare(`INSERT INTO products(id,name,is_active,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr)
        VALUES(1,'V1 A',1,0,10.01,40040,1,4000),(2,'V1 B',1,0,30.03,120120,1,4000),
        (3,'Legacy A',1,0,10.01,40040,1,4000),(4,'Legacy B',1,0,30.03,120120,1,4000),
        (5,'V1 C',1,0,10.01,40040,1,4000),(6,'V1 D',1,0,30.03,120120,1,4000)`),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0),(2,1,0),(3,1,0),(4,1,0),(5,1,0),(6,1,0)'),
    ])

    // The exact sale the verifier used: two lines whose gross is 60.06, one
    // receipt discount of 40.04, payable 20.02. Line 1's own net entitlement is
    // 10.01 -- one third of what its gross price x quantity would refund.
    const seedV1Sale = async (saleId, firstItemId) => {
      const unitPrice = 10.01, discount = 40.04
      const amount = Number((unitPrice * 3).toFixed(4))
      const lines = [
        { id: firstItemId, key: `sale-${saleId}-line-1`, product: firstItemId, price: unitPrice, quantity: 3 },
        { id: firstItemId + 1, key: `sale-${saleId}-line-2`, product: firstItemId + 1, price: amount, quantity: 1 },
      ]
      const pool = { version: 1, pool_key: `legacy-body-pool-${saleId}`, evaluation_time: '2026-09-13T00:00:00.000Z',
        exchange_rate: 4000, rules: [], lines: lines.map(line => ({ line_key: line.key, source: 'selling',
          product: { id: line.product, selling_price_usd: line.price, selling_price_khr: line.price * 4000,
            wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0,
            discount_percent: 0 }, selling_price_input_usd: null, manual: { type: 'none', value: 0 } })) }
      const allocation = { version: 1, lines: lines.map(line => ({ line_key: line.key, amount })),
        discount_usd: discount, membership_discount_usd: 0, tax_usd: 0 }
      const quantities = Object.fromEntries(lines.map(line => [line.key, line.quantity]))
      const pricing = lines.map(line => kernel.materializeCapturedPricingRow({ id: line.id, product_id: line.product },
        pool, quantities, line.key, allocation))
      const entitlements = pricing.map(row => kernel.parseSaleItemPricing(row.pricing_snapshot_json).receipt_allocation.net_entitlement_usd)
      const productEntitlement = Number(entitlements.reduce((sum, value) => sum + value, 0).toFixed(4))
      const saleTotal = Math.round(productEntitlement * 100) / 100
      await db.batch([
        db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,
          membership_discount_usd,tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status)
          VALUES(?,?,1,'Shop',4000,?,?,0,0,?,?,?,1,'completed')`).bind(saleId, `V1-SALE-${saleId}`,
          Number((amount * 2).toFixed(4)), discount, productEntitlement,
          Number((saleTotal - productEntitlement).toFixed(4)), saleTotal),
        ...pricing.map((row, index) => db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,
          total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,
          product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,
          manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json)
          VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          lines[index].id, saleId, lines[index].product, `Line ${lines[index].id}`, lines[index].quantity,
          row.total_usd, row.total_khr, row.base_price_usd, row.base_price_khr, row.applied_price_usd, row.applied_price_khr,
          row.product_discount_usd, row.product_discount_khr, row.product_discount_type, row.product_discount_label,
          row.manual_discount_usd, row.manual_discount_khr, row.manual_discount_type, row.manual_discount_value,
          row.price_mode, row.pricing_snapshot_json)),
      ])
      return { saleId, saleItemId: lines[0].id, productId: lines[0].product,
        entitlement: entitlements[0], saleTotal, payoutCap: Math.min(saleTotal, Number(productEntitlement.toFixed(2))),
        grossLineRefund: Number((unitPrice * 3).toFixed(2)) }
    }

    // A genuinely pre-v1 sale: no precision version, no pricing snapshots, no
    // calculated total. This is the history the legacy branch exists to serve.
    const seedV0Sale = async (saleId, firstItemId) => {
      await db.batch([
        db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,
          membership_discount_usd,tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status)
          VALUES(?,?,1,'Shop',4000,60.06,40.04,0,0,NULL,0,20.02,0,'completed')`).bind(saleId, `V0-SALE-${saleId}`),
        db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,
          total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr)
          VALUES(?,?,?,'Legacy A',3,1,30.03,120120,10.01,40040,10.01,40040,1,4000)`).bind(firstItemId, saleId, firstItemId),
        db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,
          total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr)
          VALUES(?,?,?,'Legacy B',1,1,30.03,120120,30.03,120120,30.03,120120,1,4000)`).bind(firstItemId + 1, saleId, firstItemId + 1),
      ])
      return { saleId, saleItemId: firstItemId, productId: firstItemId, grossLineRefund: 30.03, grossLineRefundKhr: 120120 }
    }

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }
    const call = (url, body) => send('POST', url, body)

    // The legacy body byte-shape the shipped pre-v1 client sends: no
    // money_precision_version, no expected_quote, per-line prices posted.
    const legacyBody = (sale, key, quantity = 3) => ({
      client_request_id: key, sale_id: sale.saleId, reason: 'Legacy client', return_type: 'restock',
      branch_id: 1, exchange_rate: 4000, replacement_items: [],
      items: [{ sale_item_id: sale.saleItemId, product_id: sale.productId, product_name: 'Line', quantity,
        applied_price_usd: 10.01, applied_price_khr: 40040, stock_action: 'none', branch_id: 1 }],
    })

    const counts = async () => {
      const row = await db.prepare(`SELECT
        (SELECT COUNT(*) FROM returns) AS returns,
        (SELECT COUNT(*) FROM return_items) AS items,
        (SELECT COUNT(*) FROM return_create_receipts) AS receipts,
        (SELECT COUNT(*) FROM inventory_movements) AS movements,
        (SELECT COUNT(*) FROM action_history) AS history`).first()
      return JSON.stringify(row)
    }
    const paid = async saleId => Number((await db.prepare(`SELECT COALESCE(SUM(total_refund_usd),0) paid FROM returns
      WHERE sale_id=? AND COALESCE(status,'completed')<>'cancelled'`).bind(saleId).first()).paid.toFixed(4))
    const legacyRowsFor = async saleId => (await db.prepare(`SELECT COUNT(*) n FROM returns
      WHERE sale_id=? AND COALESCE(money_precision_version,0)<>1`).bind(saleId).first()).n

    const v1 = await seedV1Sale(1, 1)
    const v0 = await seedV0Sale(2, 3)
    const poisonable = await seedV1Sale(3, 5)
    assert.equal(v1.entitlement, 10.01, 'line 1 of the v1 sale is entitled to 10.01 net')
    assert.equal(v1.payoutCap, 20.02, 'the whole v1 sale can never refund more than its payable')
    assert.ok(v1.grossLineRefund > v1.payoutCap,
      'the fixture only discriminates if the legacy gross price of ONE line exceeds the whole sale payable')

    // -----------------------------------------------------------------
    // 1. Legacy body (no money_precision_version) on a v1 sale: refused,
    //    nothing written. Before the fix this was accepted and paid 30.03.
    // -----------------------------------------------------------------
    const before = await counts()
    const legacyOnV1 = await call('/api/returns', legacyBody(v1, 'legacy-on-v1'))
    assert.equal(legacyOnV1.status, 409,
      `a legacy return body must not be priced against a v1 sale: ${JSON.stringify(legacyOnV1.body)}`)
    assert.equal(legacyOnV1.body.code, 'money_precision_review_needed', JSON.stringify(legacyOnV1.body))
    assert.equal(await counts(), before, 'a refused legacy body writes no row of any kind')
    assert.equal(await paid(1), 0)
    assert.equal(await legacyRowsFor(1), 0, 'no v0 return row exists for a v1 sale')

    // -----------------------------------------------------------------
    // 2. Explicit money_precision_version: 0 on a v1 sale: same refusal,
    //    same code (not the canonicaliser's generic 400), nothing written.
    // -----------------------------------------------------------------
    const zeroOnV1 = await call('/api/returns', { ...legacyBody(v1, 'zero-on-v1'), money_precision_version: 0 })
    assert.equal(zeroOnV1.status, 409, JSON.stringify(zeroOnV1.body))
    assert.equal(zeroOnV1.body.code, 'money_precision_review_needed', JSON.stringify(zeroOnV1.body))
    assert.equal(await counts(), before, 'a refused version-0 body writes no row of any kind')
    assert.equal(await legacyRowsFor(1), 0)

    // -----------------------------------------------------------------
    // 3. The refusals leave the sale fully usable: a proper v1 quote and
    //    create still succeed, and the cumulative paid stays under the cap.
    // -----------------------------------------------------------------
    const quoted = await call('/api/returns/quote', { sale_id: v1.saleId, items: [{ sale_item_id: v1.saleItemId, quantity: 3 }] })
    assert.equal(quoted.status, 200, `the sale must still be quotable after the refusals: ${JSON.stringify(quoted.body)}`)
    const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quoted.body
    assert.equal(expected.total_refund_usd, 10.01, 'the exact refund for the whole line is its net entitlement')
    const created = await call('/api/returns', { client_request_id: 'v1-on-v1', money_precision_version: 1,
      sale_id: v1.saleId, reason: 'Exact refund', expected_quote: expected,
      items: [{ sale_item_id: v1.saleItemId, product_id: v1.productId, quantity: 3, stock_action: 'none', branch_id: 1 }] })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const createdRow = await db.prepare('SELECT money_precision_version,total_refund_usd FROM returns WHERE id=?')
      .bind(Number(created.body.id)).first()
    assert.equal(Number(createdRow.money_precision_version), 1, 'the accepted return inherits the sale version')
    assert.equal(Number(createdRow.total_refund_usd), 10.01)
    assert.equal(await paid(1), 10.01)
    assert.ok(await paid(1) <= v1.payoutCap, 'cumulative refunds never exceed the sale payout cap')
    assert.equal(await legacyRowsFor(1), 0)

    // A second legacy attempt after a v1 return exists is refused too -- the
    // rule is the sale's version, not "no returns yet".
    const afterV1 = await counts()
    const legacyAgain = await call('/api/returns', legacyBody(v1, 'legacy-on-v1-again'))
    assert.equal(legacyAgain.status, 409, JSON.stringify(legacyAgain.body))
    assert.equal(legacyAgain.body.code, 'money_precision_review_needed')
    assert.equal(await counts(), afterV1, 'the later refusal writes nothing either')

    // -----------------------------------------------------------------
    // 4. POSITIVE CONTROL: the same legacy body on a v0 sale still works,
    //    with exactly today's legacy figures (gross applied price x qty).
    // -----------------------------------------------------------------
    const legacyOnV0 = await call('/api/returns', legacyBody(v0, 'legacy-on-v0'))
    assert.equal(legacyOnV0.status, 200,
      `history must keep working: a legacy body on a legacy sale is still accepted: ${JSON.stringify(legacyOnV0.body)}`)
    const legacyRow = await db.prepare(`SELECT money_precision_version,calculated_refund_usd,total_refund_usd,total_refund_khr
      FROM returns WHERE id=?`).bind(Number(legacyOnV0.body.id)).first()
    assert.equal(Number(legacyRow.money_precision_version), 0, 'a v0 sale still records a v0 return')
    assert.equal(legacyRow.calculated_refund_usd, null, 'the legacy shape carries no exact refund columns')
    assert.equal(Number(legacyRow.total_refund_usd), v0.grossLineRefund, 'todays legacy figure is unchanged')
    assert.equal(Number(legacyRow.total_refund_khr), v0.grossLineRefundKhr)
    const legacyItems = (await db.prepare('SELECT quantity,total_usd,applied_price_usd FROM return_items WHERE return_id=?')
      .bind(Number(legacyOnV0.body.id)).all()).results
    assert.deepEqual(legacyItems.map(row => [Number(row.quantity), Number(row.total_usd), Number(row.applied_price_usd)]),
      [[3, 30.03, 10.01]], 'legacy line money is unchanged')

    // -----------------------------------------------------------------
    // 5. A v1 body on a v0 sale keeps today's result: the v1 quote plan
    //    refuses the legacy sale at the first thing it cannot read -- a sale
    //    line with no pricing snapshot cannot have its recorded product
    //    identity resolved -- and nothing is written. The rule "the sale
    //    decides" never promotes a v1 body into the legacy branch; it only
    //    ever refuses.
    // -----------------------------------------------------------------
    const beforeV1OnV0 = await counts()
    const v1OnV0 = await call('/api/returns', { client_request_id: 'v1-on-v0', money_precision_version: 1,
      sale_id: v0.saleId, reason: 'Exact refund on legacy sale',
      expected_quote: { money_precision_version: 1, sale_id: v0.saleId, sale_revision: 0,
        calculated_refund_usd: 30.03, rounding_adjustment_usd: 0, total_refund_usd: 30.03, total_refund_khr: 120120,
        items: [{ sale_item_id: v0.saleItemId, quantity: 3, total_usd: 30.03, total_khr: 120120,
          applied_price_usd: 10.01, applied_price_khr: 40040 }] },
      items: [{ sale_item_id: v0.saleItemId, product_id: v0.productId, quantity: 3, stock_action: 'none', branch_id: 1 }] })
    assert.equal(v1OnV0.status, 409, JSON.stringify(v1OnV0.body))
    assert.equal(v1OnV0.body.code, 'product_merge_lineage_conflict', JSON.stringify(v1OnV0.body))
    assert.equal(v1OnV0.body.action, 'review_required', JSON.stringify(v1OnV0.body))
    assert.equal(await counts(), beforeV1OnV0, 'a refused v1 body on a legacy sale writes nothing')

    // -----------------------------------------------------------------
    // 6. Cumulative invariant across the whole mix: every sale's active
    //    refunds stay at or under what that sale can ever pay out, and no
    //    v1 sale holds a legacy-shaped return row.
    // -----------------------------------------------------------------
    assert.ok(await paid(1) <= v1.payoutCap, 'v1 sale stays under its payout cap')
    assert.ok(await paid(2) <= 30.03, 'the legacy sale paid exactly its legacy line figure')
    assert.equal(await paid(3), 0)
    for (const saleId of [1, 3]) assert.equal(await legacyRowsFor(saleId), 0,
      `sale ${saleId} is v1 and must hold no legacy-shaped return row`)

    // -----------------------------------------------------------------
    // 7. The edit route is the other writer of returns money. A v0 return
    //    row that already sits on a v1 sale (exactly what the defect wrote
    //    in production) cannot be re-priced on the legacy basis either.
    // -----------------------------------------------------------------
    await db.prepare(`INSERT INTO returns(id,return_number,client_request_id,sale_id,branch_id,branch_name,return_scope,
      reason,return_type,total_refund_usd,total_refund_khr,exchange_rate,status,money_precision_version)
      VALUES(900,'RET-POISON','poisoned',3,1,'Shop','customer','Poisoned legacy row','restock',30.03,120120,4000,'completed',0)`).run()
    await db.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,
      applied_price_usd,applied_price_khr,total_usd,total_khr,return_to_stock,branch_id)
      VALUES(900,?,?,'Line',3,10.01,40040,30.03,120120,0,1)`).bind(poisonable.saleItemId, poisonable.productId).run()
    const poisonedRow = await db.prepare('SELECT updated_at,total_refund_usd FROM returns WHERE id=900').first()
    const edit = await send('PATCH', '/api/returns/900', { client_request_id: 'edit-poisoned',
      expected_updated_at: poisonedRow.updated_at, reason: 'Try to re-price a legacy row on a v1 sale',
      items: [{ sale_item_id: poisonable.saleItemId, product_id: poisonable.productId, quantity: 1,
        applied_price_usd: 10.01, applied_price_khr: 40040, stock_action: 'none', branch_id: 1 }] })
    assert.equal(edit.status, 409, JSON.stringify(edit.body))
    assert.equal(edit.body.code, 'money_precision_review_needed', JSON.stringify(edit.body))
    const afterEdit = await db.prepare('SELECT updated_at,total_refund_usd FROM returns WHERE id=900').first()
    assert.equal(Number(afterEdit.total_refund_usd), Number(poisonedRow.total_refund_usd), 'the refused edit rewrote no money')
    assert.equal(afterEdit.updated_at, poisonedRow.updated_at, 'the refused edit rewrote no row')

    console.log('PASS native return money version: the SALE decides -- a legacy or version-0 body is refused on a v1 sale without writing anything, the sale still takes an exact v1 return under its payout cap, a legacy body on a legacy sale still pays exactly today\'s figures, a v1 body on a legacy sale keeps today\'s refusal, and the edit route refuses to re-price a legacy row that sits on a v1 sale')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
