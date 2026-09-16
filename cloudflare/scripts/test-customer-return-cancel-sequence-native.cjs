// Native workerd/Miniflare D1 boundary for the customer-return v1
// CANCELLATION SEQUENCE. Mounts the real Hono returns router (quote, create,
// bulk status) and the real bulk undo/redo kernel against the complete
// migrated schema, on v1 sales whose entitlement leaves a sub-cent residual.
//
// Reproduces the reported "return sequence gap after cancellation of an
// earlier partial return": before the fix, cancelling R1 and then quoting a
// new return on the same sale line was refused forever with
// customer_return_cohort_invalid, because buildCustomerReturnQuoteV1 required
// the surviving returns to form an unbroken before/after chain from zero -- a
// chain that a cancelled member permanently breaks. Every later return on that
// sale, and every edit that re-quotes it, was dead.
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

// The only non-production surfaces are authentication, external notification
// and one test-only route that calls the real bulk replay kernel the undo
// applier calls (lib/undoAppliers.ts -> replayReturnBulkAction).
async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns';
      import { replayReturnBulkAction } from './src/lib/returnBulkAction';
      const app=new Hono(); app.route('/api/returns',returns);
      app.post('/test/replay', async c => {
        const body=await c.req.json();
        const user={id:7,username:'fixture',name:'Fixture',permissions:c.req.header('x-test-permissions')};
        try { await replayReturnBulkAction(c.env,user,body.direction,body.history_id,body.generation,body.payload);
          return c.json({ ok:true }) }
        catch (error) { return c.json({ error:String(error && error.message || error) }, 409) }
      });
      export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{ name: 'return-sequence-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',permissions:raw});return next()}`,
        audit: 'export const audit=async()=>{}',
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendTelegramEvent=async()=>{};
          export const formatSaleTelegramLines=()=>[]`,
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
      db.prepare(`INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Seq A',1,0),(2,'Seq B',1,0),
        (3,'Seq C',1,0),(4,'Seq D',1,0)`),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0),(2,1,0),(3,1,0),(4,1,0)'),
    ])

    // Two equal-amount lines with one receipt discount split evenly: the first
    // line sells three units whose net entitlement divides into neither whole
    // cents nor whole four-place units, so every partial return of it carries
    // both residuals. The second line is never returned, so no cohort can
    // cover the whole sale by accident.
    const seedSale = async (saleId, unitPrice, discount, firstItemId) => {
      const amount = Number((unitPrice * 3).toFixed(4))
      const lines = [
        { id: firstItemId, key: `sale-${saleId}-line-1`, product: firstItemId, price: unitPrice, quantity: 3 },
        { id: firstItemId + 1, key: `sale-${saleId}-line-2`, product: firstItemId + 1, price: amount, quantity: 1 },
      ]
      const pool = { version: 1, pool_key: `return-sequence-pool-${saleId}`, evaluation_time: '2026-09-13T00:00:00.000Z',
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
          VALUES(?,?,1,'Shop',4000,?,?,0,0,?,?,?,1,'completed')`).bind(saleId, `SEQ-SALE-${saleId}`,
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
      // The fixture only proves something about residual handling if the line
      // really does carry one.
      assert.notEqual(Number((entitlements[0] / 3).toFixed(2)), Number((entitlements[0] / 3).toFixed(4)),
        `sale ${saleId} line must not divide into whole cents`)
      return { saleId, saleItemId: lines[0].id, productId: lines[0].product,
        entitlement: entitlements[0], saleTotal, payoutCap: Math.min(saleTotal, Number(productEntitlement.toFixed(2))) }
    }

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const call = async (url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }
    const quote = (sale, quantity = 1) => call('/api/returns/quote',
      { sale_id: sale.saleId, items: [{ sale_item_id: sale.saleItemId, quantity }] })
    const create = async (sale, key, quantity = 1) => {
      const quoted = await quote(sale, quantity)
      assert.equal(quoted.status, 200, `${key} quote: ${JSON.stringify(quoted.body)}`)
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quoted.body
      const created = await call('/api/returns', { client_request_id: key, money_precision_version: 1, sale_id: sale.saleId,
        reason: 'Cancellation sequence', expected_quote: expected,
        items: [{ sale_item_id: sale.saleItemId, product_id: sale.productId, quantity, stock_action: 'none', branch_id: 1 }] })
      assert.equal(created.status, 200, `${key} create: ${JSON.stringify(created.body)}`)
      return { id: Number(created.body.id), quote: quoted.body }
    }
    const statusOf = async id => (await db.prepare('SELECT status FROM returns WHERE id=?').bind(id).first()).status
    const saleStatus = async saleId => (await db.prepare('SELECT sale_status FROM sales WHERE id=?').bind(saleId).first()).sale_status
    const itemRows = async ids => JSON.stringify((await db.prepare(`SELECT id,return_id,sale_item_id,quantity,total_usd,
      total_khr,refund_snapshot_json FROM return_items WHERE return_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
      .bind(...ids).all()).results)
    const headerRows = async ids => JSON.stringify((await db.prepare(`SELECT id,status,calculated_refund_usd,
      rounding_adjustment_usd,total_refund_usd,total_refund_khr FROM returns WHERE id IN (${ids.map(() => '?').join(',')})
      ORDER BY id`).bind(...ids).all()).results)
    const activePaid = async saleId => Number((await db.prepare(`SELECT COALESCE(SUM(total_refund_usd),0) paid FROM returns
      WHERE sale_id=? AND COALESCE(status,'completed')<>'cancelled'`).bind(saleId).first()).paid.toFixed(4))
    const snapshotField = async (returnId, field) => JSON.parse((await db
      .prepare('SELECT refund_snapshot_json FROM return_items WHERE return_id=?').bind(returnId).first()).refund_snapshot_json)[field]
    const bulk = async (key, id, source, target) => {
      const row = await db.prepare('SELECT id,status,return_type,updated_at FROM returns WHERE id=?').bind(id).first()
      return call('/api/returns/bulk', { client_request_id: key, field: 'status', source, target,
        items: [{ id, expected_status: String(row.status || 'completed'),
          expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null }] })
    }
    const replay = async (historyId, direction, generation) => {
      const row = await db.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').bind(historyId).first()
      return call('/test/replay', { direction, history_id: historyId, generation,
        payload: JSON.parse(direction === 'undo' ? row.undo_payload : row.redo_payload) })
    }

    // ---------------------------------------------------------------
    // Sale 1: line entitlement 10.01 over three units.
    // ---------------------------------------------------------------
    const first = await seedSale(1, 10.01, 40.04, 1)
    assert.equal(first.entitlement, 10.01)
    assert.equal(first.payoutCap, 20.02)

    // 1. R1 then R2 -- an ordinary cumulative chain.
    const r1 = await create(first, 'seq-r1')
    const r2 = await create(first, 'seq-r2')
    assert.deepEqual([r1.quote.calculated_refund_usd, r1.quote.total_refund_usd], [3.3367, 3.34])
    assert.deepEqual([r2.quote.calculated_refund_usd, r2.quote.total_refund_usd], [3.3366, 3.33])
    assert.equal(await snapshotField(r2.id, 'returned_quantity_before'), 1)
    assert.equal(await activePaid(1), 6.67)
    assert.equal(await saleStatus(1), 'partial_return')

    // 2. Cancel R1, then quote and create R3. Before the fix the quote was
    // refused with customer_return_cohort_invalid and the sale could never
    // take another return again.
    const beforeCancel = await itemRows([r1.id, r2.id])
    const cancelR1 = await bulk('seq-cancel-r1', r1.id, 'completed', 'cancelled')
    assert.equal(cancelR1.status, 200, JSON.stringify(cancelR1.body))
    assert.equal(await statusOf(r1.id), 'cancelled')
    assert.equal(await itemRows([r1.id, r2.id]), beforeCancel, 'cancelling rewrites no refund snapshot')
    assert.equal(await activePaid(1), 3.33)

    const quoteAfterCancel = await quote(first, 1)
    assert.equal(quoteAfterCancel.status, 200,
      `a sale must stay quotable after an earlier partial return is cancelled: ${JSON.stringify(quoteAfterCancel.body)}`)
    const r3 = await create(first, 'seq-r3')
    // Priors are exactly the non-cancelled cohort: one active prior unit, so
    // the new line consumes the active cumulative target and nothing else.
    assert.deepEqual([r3.quote.calculated_refund_usd, r3.quote.total_refund_usd], [3.3367, 3.34])
    assert.equal(await snapshotField(r3.id, 'returned_quantity_before'), 1, 'R3 chains onto the active cohort only')
    assert.equal(await snapshotField(r3.id, 'calculated_refund_before_usd'), 3.3366,
      'R3 consumes exactly what the active cohort holds -- the cancelled return is neither counted nor lost')
    assert.equal(await activePaid(1), 6.67, 'active refunds equal the two-unit cent settlement exactly')
    assert.equal(await itemRows([r1.id, r2.id]), beforeCancel, 'creating R3 rewrote no earlier refund snapshot')
    assert.ok(await activePaid(1) <= first.payoutCap)

    // 3. Restore R1 while R2 and R3 exist. The projected cohort is still
    // valid -- three of three units, exactly the line entitlement -- so it is
    // accepted, and no other return's snapshot or header is rewritten.
    const beforeRestore = await itemRows([r1.id, r2.id, r3.id])
    const othersBeforeRestore = await headerRows([r2.id, r3.id])
    const restoreR1 = await bulk('seq-restore-r1', r1.id, 'cancelled', 'completed')
    assert.equal(restoreR1.status, 200, JSON.stringify(restoreR1.body))
    assert.equal(await statusOf(r1.id), 'completed')
    assert.equal(await itemRows([r1.id, r2.id, r3.id]), beforeRestore, 'restoring rewrites no refund snapshot')
    assert.equal(await headerRows([r2.id, r3.id]), othersBeforeRestore, 'restoring rewrites no other return header')
    assert.equal(await activePaid(1), 10.01, 'three restored units pay the line entitlement exactly, never more')
    assert.ok(await activePaid(1) <= first.payoutCap)
    assert.equal(await saleStatus(1), 'partial_return', 'the second sale line is still unreturned')

    // 4. Undo then redo that restoration with R3 present; both directions must
    // land on the step 3 state and rewrite nothing.
    const historyId = restoreR1.body.actionHistoryId
    const undone = await replay(historyId, 'undo', 0)
    assert.equal(undone.status, 200, JSON.stringify(undone.body))
    assert.equal(await statusOf(r1.id), 'cancelled')
    assert.equal(await activePaid(1), 6.67)
    assert.equal(await itemRows([r1.id, r2.id, r3.id]), beforeRestore, 'undo rewrites no refund snapshot')
    const redone = await replay(historyId, 'redo', 1)
    assert.equal(redone.status, 200, JSON.stringify(redone.body))
    assert.equal(await statusOf(r1.id), 'completed')
    assert.equal(await activePaid(1), 10.01)
    assert.equal(await itemRows([r1.id, r2.id, r3.id]), beforeRestore, 'redo rewrites no refund snapshot')

    // 4b. Cancelling the MIDDLE return of this cohort is refused, because the
    // two survivors were each settled up one cent and together hold one cent
    // more than the remaining two-unit entitlement rounds to. That guard is
    // the cumulative payout cap, not the chain, and it refuses without writing.
    const beforeMiddle = await itemRows([r1.id, r2.id, r3.id])
    const middleHeaders = await headerRows([r1.id, r2.id, r3.id])
    const cancelR2 = await bulk('seq-cancel-r2', r2.id, 'completed', 'cancelled')
    assert.equal(cancelR2.status, 409, JSON.stringify(cancelR2.body))
    assert.match(String(cancelR2.body.error), /exact refund entitlement changed/i)
    assert.equal(await statusOf(r2.id), 'completed')
    assert.equal(await itemRows([r1.id, r2.id, r3.id]), beforeMiddle, 'a refused cancellation rewrites nothing')
    assert.equal(await headerRows([r1.id, r2.id, r3.id]), middleHeaders)
    assert.equal(await activePaid(1), 10.01)

    // ---------------------------------------------------------------
    // Sale 2: line entitlement 1.0001 over three units. Here the middle
    // return's cent settlement leaves the survivors BELOW the cap, so the
    // middle cancellation is allowed and the surviving cohort carries the
    // cancelled member's four-place residue.
    // ---------------------------------------------------------------
    const second = await seedSale(2, 1, 3.9998, 3)
    assert.equal(second.entitlement, 1.0001)
    const r5 = await create(second, 'seq-r5')
    const r6 = await create(second, 'seq-r6')
    const r7 = await create(second, 'seq-r7')
    assert.deepEqual([r5.quote.calculated_refund_usd, r5.quote.total_refund_usd], [0.3334, 0.33])
    assert.deepEqual([r6.quote.calculated_refund_usd, r6.quote.total_refund_usd], [0.3333, 0.34])
    assert.deepEqual([r7.quote.calculated_refund_usd, r7.quote.total_refund_usd], [0.3334, 0.33])
    assert.equal(await activePaid(2), 1)

    // 5. Cancel the middle return, then create a fourth return for the freed
    // unit. The survivors' four-place sum (0.6668) now sits one unit ABOVE the
    // two-unit target (0.6667): the new line must consume only the target, so
    // the residue is neither paid twice nor lost.
    const beforeMiddleCancel = await itemRows([r5.id, r6.id, r7.id])
    const cancelR6 = await bulk('seq-cancel-r6', r6.id, 'completed', 'cancelled')
    assert.equal(cancelR6.status, 200, JSON.stringify(cancelR6.body))
    assert.equal(await itemRows([r5.id, r6.id, r7.id]), beforeMiddleCancel, 'a middle cancellation rewrites no snapshot')
    assert.equal(await activePaid(2), 0.66)
    const r8 = await create(second, 'seq-r8')
    assert.deepEqual([r8.quote.calculated_refund_usd, r8.quote.total_refund_usd], [0.3334, 0.34])
    assert.equal(await snapshotField(r8.id, 'calculated_refund_before_usd'), 0.6667,
      'the refilling line consumes the prorated target, never the residue the cohort already holds')
    assert.equal(await snapshotField(r8.id, 'returned_quantity_before'), 2)
    assert.equal(await activePaid(2), 1, 'refilling the cancelled unit still pays exactly the line entitlement')
    assert.ok(await activePaid(2) <= second.payoutCap)
    assert.equal(await itemRows([r5.id, r6.id, r7.id]), beforeMiddleCancel, 'creating the refill rewrote no earlier snapshot')

    // Restoring the cancelled middle return now would put four returned units
    // on a three-unit line: refused with a clear code, and nothing is written.
    const beforeOverCap = await itemRows([r5.id, r6.id, r7.id, r8.id])
    const overCapHeaders = await headerRows([r5.id, r6.id, r7.id, r8.id])
    const restoreR6 = await bulk('seq-restore-r6', r6.id, 'cancelled', 'completed')
    assert.equal(restoreR6.status, 409, JSON.stringify(restoreR6.body))
    assert.match(String(restoreR6.body.error), /exact refund entitlement changed/i)
    assert.equal(await statusOf(r6.id), 'cancelled')
    assert.equal(await itemRows([r5.id, r6.id, r7.id, r8.id]), beforeOverCap, 'a refused restoration rewrites nothing')
    assert.equal(await headerRows([r5.id, r6.id, r7.id, r8.id]), overCapHeaders)
    assert.equal(await activePaid(2), 1)
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM return_bulk_operations WHERE request_id='seq-restore-r6'").first()).n, 0)

    // No sale, at any point in either sequence, refunded more than its cap.
    for (const sale of [first, second]) {
      assert.ok(await activePaid(sale.saleId) <= sale.payoutCap,
        `sale ${sale.saleId} cumulative active refunds must never exceed the payout cap`)
    }
    console.log('PASS native customer-return cancellation sequence: cancelled priors are excluded, the sale stays quotable, the surviving cohort residue is consumed exactly once, restoration re-validates the whole projected cohort and undo/redo replay agrees')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
