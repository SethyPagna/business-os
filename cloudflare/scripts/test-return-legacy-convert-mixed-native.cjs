// 6.0.992 review fixes, native workerd/Miniflare D1 with every migration and the real returns + action-history routers.
//
//   P1-1 report basis: an old-format refund is reported on refund x net / subtotal, a current-format one on its net
//        entitlement. On a sale with a receipt discount, a membership discount or tax, an old-format return priced at the
//        net quote has an equal payout but a different report basis. Conversion must leave every report total of the
//        sale unchanged (real readSalesReportSnapshot + salesTotalsFromSnapshot at 4 places) or refuse it.
//   P1-2 mixed sale: one v1 return, one convertible old-format return, one old-format return priced wrong. The
//        convertible one converts on its own; the screen's advice for the other ("cancel this return and record it
//        again") works end to end; restoring an old-format return next to exact ones is still refused.
//   P2-1 a cancelled old-format return whose sale line was amended after the return is not converted (the "no restore
//        after reprice" ledger rule); the control (amended before the return) converts.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function kernelBundle() {
  const bundle = await build({ stdin: { contents: `export * from './src/lib/saleItemPricing';
      export { executeRawStockTransaction } from './src/lib/stockTransaction'`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

// One test-only route reads the sale's report totals through the production report reader and reducer.
async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns'; import history from './src/routes/actionHistory';
      import { readSalesReportSnapshot, salesTotalsFromSnapshot } from './src/lib/salesAnalytics';
      const app=new Hono(); app.route('/api/returns',returns); app.route('/api/action-history',history);
      app.get('/test/report/:id', async c => {
        const id = Number(c.req.param('id'))
        const snapshot = await readSalesReportSnapshot(c.env, {}, false, (alias) => ({ sql: alias + '.id=@reportScope_saleId', params: { reportScope_saleId: id } }))
        return c.json({ ...salesTotalsFromSnapshot(snapshot, 4) })
      });
      export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'],
    plugins: [{ name: 'return-legacy-convert-mixed-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-user');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',JSON.parse(raw));return next()}`,
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersion=async()=>0;',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'mixed-fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'mixed-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
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

async function main() {
  const [kernel, bundle] = await Promise.all([kernelBundle(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    const products = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    await kernel.executeRawStockTransaction(db, [
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare(`INSERT INTO products(id,name,is_active,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr) VALUES
        ${products.map(id => `(${id},'P${id}',1,0,10,40000,1,4000)`).join(',')}`),
      db.prepare(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES ${products.map(id => `(${id},1,0)`).join(',')}`),
    ])

    const seedV1Sale = async (saleId, lines, header) => {
      const { discount = 0, membership = 0, tax = 0 } = header
      const pool = { version: 1, pool_key: `mixed-pool-${saleId}`, evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [],
        lines: lines.map(line => ({ line_key: line.key, source: 'selling', product: { id: line.product, selling_price_usd: line.price, selling_price_khr: line.price * 4000,
          wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
          selling_price_input_usd: null, manual: { type: 'none', value: 0 } })) }
      const amounts = lines.map(line => Number((line.price * line.quantity).toFixed(4)))
      const allocation = { version: 1, lines: lines.map((line, index) => ({ line_key: line.key, amount: amounts[index] })),
        discount_usd: discount, membership_discount_usd: membership, tax_usd: tax }
      const quantities = Object.fromEntries(lines.map(line => [line.key, line.quantity]))
      const pricing = lines.map(line => kernel.materializeCapturedPricingRow({ id: line.id, product_id: line.product }, pool, quantities, line.key, allocation))
      const entitlement = Number(pricing.map(row => kernel.parseSaleItemPricing(row.pricing_snapshot_json).receipt_allocation.net_entitlement_usd)
        .reduce((sum, value) => sum + value, 0).toFixed(4))
      const total = Math.round(entitlement * 100) / 100
      await db.batch([
        db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,tax_usd,
          calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status,amount_paid_usd,amount_paid_khr,created_at)
          VALUES(?,?,1,'Shop',4000,?,?,?,?,?,?,?,1,'completed',?,0,'2026-10-01 03:00:00')`).bind(saleId, `MX-${saleId}`, Number(amounts.reduce((s, v) => s + v, 0).toFixed(4)),
          discount, membership, tax, entitlement, Number((total - entitlement).toFixed(4)), total, total),
        ...pricing.map((row, index) => db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,total_usd,total_khr,base_price_usd,base_price_khr,
          applied_price_usd,applied_price_khr,product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,manual_discount_usd,manual_discount_khr,
          manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json,cost_price_usd) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).bind(
          lines[index].id, saleId, lines[index].product, `Line ${lines[index].id}`, lines[index].quantity, row.total_usd, row.total_khr, row.base_price_usd, row.base_price_khr,
          row.applied_price_usd, row.applied_price_khr, row.product_discount_usd, row.product_discount_khr, row.product_discount_type, row.product_discount_label,
          row.manual_discount_usd, row.manual_discount_khr, row.manual_discount_type, row.manual_discount_value, row.price_mode, row.pricing_snapshot_json)),
      ])
    }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(ADMIN) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${method} ${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }
    const one = async (sql, ...binds) => db.prepare(sql).bind(...binds).first()
    const insertV0 = async (rows, items) => db.batch([
      ...rows.map(row => db.prepare(`INSERT INTO returns(id,return_number,client_request_id,sale_id,branch_id,branch_name,return_scope,reason,return_type,total_refund_usd,
        total_refund_khr,exchange_rate,status,money_precision_version,refund_currency,owed_reduction_usd,created_at,updated_at)
        VALUES(?,?,?,?,1,'Shop','customer','Old','restock',?,?,4000,?,0,'USD',0,?,?)`).bind(row.id, `RET-${row.id}`, `legacy-${row.id}`, row.sale, row.usd,
        Math.round(row.usd * 4000), row.status || 'completed', row.at || '2026-10-02 03:00:00', row.at || '2026-10-02 03:00:00')),
      ...items.map(item => db.prepare(`INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,
        return_to_stock,branch_id) VALUES(?,?,?,?,'Line',?,?,?,?,?,0,1)`).bind(item.id, item.ret, item.si, item.product, item.qty,
        Number((item.usd / item.qty).toFixed(4)), Math.round(item.usd * 4000 / item.qty), item.usd, Math.round(item.usd * 4000))),
    ])
    const quote = async (saleId, saleItemId, quantity = 1) => send('POST', '/api/returns/quote', { sale_id: saleId, items: [{ sale_item_id: saleItemId, quantity }] })
    const createV1 = async (key, saleId, saleItemId, productId, quantity = 1) => {
      const quoted = await quote(saleId, saleItemId, quantity)
      assert.equal(quoted.status, 200, JSON.stringify(quoted.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quoted.body
      return send('POST', '/api/returns', { client_request_id: key, money_precision_version: 1, sale_id: saleId, reason: 'Exact', expected_quote: expected,
        items: [{ sale_item_id: saleItemId, product_id: productId, quantity, stock_action: 'none', branch_id: 1 }] })
    }
    const bulk = async (key, id, source, target) => {
      const row = await one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      return send('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source, target,
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: row.return_type, expected_updated_at: row.updated_at }] })
    }
    const report = async saleId => (await send('GET', `/test/report/${saleId}`)).body
    const convert = async (key, ids) => {
      const preview = await send('POST', '/api/returns/legacy-convert/preview', { return_ids: ids })
      assert.equal(preview.status, 200, JSON.stringify(preview.body))
      const applied = await send('POST', '/api/returns/legacy-convert', { return_ids: ids, client_request_id: key, expected_digest: preview.body.digest })
      assert.equal(applied.status, 200, JSON.stringify(applied.body))
      return { preview: preview.body, applied: applied.body }
    }
    const outcome = (preview, id) => preview.rows.find(row => row.id === id)

    // ---------------------------------------------------------------------------------------------------------------
    // P1-1. Three sales whose old-format return equals the net quote to the cent: receipt discount, membership discount,
    // tax. Converting moves the report basis, so each is refused with the report figures; the report stays put. A sale
    // with no header adjustment (control) converts, and its report totals are identical after.
    // ---------------------------------------------------------------------------------------------------------------
    const headerCases = [
      { saleId: 10, header: { discount: 3 }, product: 1 },
      { saleId: 11, header: { membership: 3 }, product: 2 },
      { saleId: 12, header: { tax: 3 }, product: 3 },
      { saleId: 13, header: {}, product: 4 },
    ]
    for (const [index, item] of headerCases.entries()) {
      const saleItemId = item.saleId * 10 + 1
      await seedV1Sale(item.saleId, [{ id: saleItemId, key: `h${item.saleId}`, product: item.product, price: 10, quantity: 3 }], item.header)
      const quoted = await quote(item.saleId, saleItemId)
      assert.equal(quoted.status, 200, JSON.stringify(quoted.body))
      const line = quoted.body.items[0]
      const returnId = 500 - index * 10 // descending: a recorded-again return takes max(id)+1
      await insertV0([{ id: returnId, sale: item.saleId, usd: quoted.body.total_refund_usd }],
        [{ id: returnId * 10, ret: returnId, si: saleItemId, product: item.product, qty: 1, usd: Number(line.total_usd.toFixed(2)) }])
      const before = await report(item.saleId)
      const { preview, applied } = await convert(`header-${item.saleId}`, [returnId])
      const after = await report(item.saleId)
      assert.deepEqual(after, before, `sale ${item.saleId}: report totals never move (${JSON.stringify(item.header)})`)
      if (Object.keys(item.header).length) {
        assert.equal(outcome(preview, returnId).code, 'return_convert_report_changed', `sale ${item.saleId} ${JSON.stringify(item.header)}: ${JSON.stringify(outcome(preview, returnId))}`)
        assert.ok(outcome(preview, returnId).params.before !== outcome(preview, returnId).params.after, 'the refusal names the revenue it would have moved')
        assert.deepEqual(applied.converted, [])
        // The way through: cancel (the sale has no exact return, so the legacy cancel path) and record it again.
        assert.equal((await bulk(`cancel-${returnId}`, returnId, 'completed', 'cancelled')).status, 200)
        const again = await createV1(`again-${returnId}`, item.saleId, saleItemId, item.product)
        assert.equal(again.status, 200, JSON.stringify(again.body))
      } else {
        assert.deepEqual(applied.converted, [returnId], 'control: a sale without header adjustments converts')
      }
    }
    console.log('PASS P1-1: receipt discount, membership and tax refuse with the revenue figures and leave the report unchanged; the control converts with identical report totals')

    // ---------------------------------------------------------------------------------------------------------------
    // P1-2. The reviewer's mixed shape: v1 return first, then an old-format return the sale prices exactly (930) and one
    // priced wrong (931: 9.00 where the sale allows 10.01).
    // ---------------------------------------------------------------------------------------------------------------
    await seedV1Sale(1, [{ id: 11, key: 'a1', product: 5, price: 10.01, quantity: 3 }, { id: 12, key: 'a2', product: 6, price: 5, quantity: 2 }], {})
    const v1 = await createV1('v1-mixed', 1, 11, 5)
    assert.equal(v1.status, 200, JSON.stringify(v1.body))
    await insertV0([{ id: 930, sale: 1, usd: 5 }, { id: 931, sale: 1, usd: 9 }],
      [{ id: 9301, ret: 930, si: 12, product: 6, qty: 1, usd: 5 }, { id: 9311, ret: 931, si: 11, product: 5, qty: 1, usd: 9 }])
    assert.notEqual((await quote(1, 12)).status, 200, 'precondition: the old-format rows close the sale to new returns')
    const mixed = await convert('mixed-1', [930, 931])
    assert.equal(outcome(mixed.preview, 930).outcome, 'convert', 'the convertible return is no longer blocked by its sibling')
    assert.equal(outcome(mixed.preview, 931).code, 'return_convert_amount_changed')
    assert.deepEqual(mixed.applied.converted, [930])
    assert.equal(Number((await one('SELECT money_precision_version v FROM returns WHERE id=930')).v), 1)
    assert.equal(Number((await one('SELECT money_precision_version v FROM returns WHERE id=931')).v), 0)
    // The screen's advice for 931: cancel it ...
    const cancel931 = await bulk('cancel-931', 931, 'completed', 'cancelled')
    assert.equal(cancel931.status, 200, `cancelling the refused old-format return works: ${JSON.stringify(cancel931.body)}`)
    // ... and a restore of it next to exact returns is still refused (restore checks unchanged).
    const restore931 = await bulk('restore-931', 931, 'cancelled', 'completed')
    assert.equal(restore931.status, 409, `restoring an old-format return beside exact ones stays refused: ${JSON.stringify(restore931.body)}`)
    // ... and record it again at what the sale allows.
    const again931 = await createV1('again-931', 1, 11, 5)
    assert.equal(again931.status, 200, `recording it again works: ${JSON.stringify(again931.body)}`)
    assert.equal(Number((await one('SELECT total_refund_usd t FROM returns WHERE id=?', Number(again931.body.id))).t), 10.01)
    // The sale is open again: the last unit of line 2 quotes, and the converted return answers like any current-format return.
    const lastQuote = await quote(1, 12)
    assert.equal(lastQuote.status, 200, JSON.stringify(lastQuote.body))
    const row930 = await one('SELECT updated_at FROM returns WHERE id=930')
    const edit930 = await send('PATCH', '/api/returns/930', { client_request_id: 'edit-930', expected_updated_at: row930.updated_at, reason: 'Fix',
      items: [{ sale_item_id: 12, product_id: 6, quantity: 1, stock_action: 'none', branch_id: 1 }] })
    assert.equal(edit930.body.code, 'customer_return_edit_v1_not_supported', JSON.stringify(edit930.body))
    // Cancelling the converted one and the sale's original v1 return both work.
    assert.equal((await bulk('cancel-930', 930, 'completed', 'cancelled')).status, 200)
    assert.equal((await bulk('cancel-v1', Number(v1.body.id), 'completed', 'cancelled')).status, 200)
    // B4: the sale's own exact return cancels while an ACTIVE old-format return still sits on the sale (before 6.0.992 a
    // 409 "exact refund entitlement changed"); the old-format row still keeps the sale closed to new returns.
    await seedV1Sale(2, [{ id: 21, key: 'b1', product: 9, price: 10.01, quantity: 3 }], {})
    const v1b = await createV1('v1-b4', 2, 21, 9)
    assert.equal(v1b.status, 200, JSON.stringify(v1b.body))
    await insertV0([{ id: 935, sale: 2, usd: 9 }], [{ id: 9351, ret: 935, si: 21, product: 9, qty: 1, usd: 9 }])
    const cancelV1b = await bulk('cancel-v1-b4', Number(v1b.body.id), 'completed', 'cancelled')
    assert.equal(cancelV1b.status, 200, `the exact return cancels beside an active old-format one: ${JSON.stringify(cancelV1b.body)}`)
    assert.notEqual((await quote(2, 21)).status, 200, 'the old-format row still closes the sale to new returns')
    const restoreV1b = await bulk('restore-v1-b4', Number(v1b.body.id), 'cancelled', 'completed')
    assert.equal(restoreV1b.status, 409, `restoring beside an old-format return stays refused: ${JSON.stringify(restoreV1b.body)}`)
    console.log('PASS P1-2: on a mixed sale the convertible return converts alone; the refused one cancels and is recorded again; restore stays refused; the sale takes returns again')

    // ---------------------------------------------------------------------------------------------------------------
    // P2-1. A cancelled old-format return whose sale line was amended AFTER the return was entered is not converted (its
    // restore is judged by the amendment ledger); amended BEFORE the return, it converts.
    // ---------------------------------------------------------------------------------------------------------------
    await seedV1Sale(3, [{ id: 31, key: 'c1', product: 7, price: 10, quantity: 3 }], {})
    await seedV1Sale(4, [{ id: 41, key: 'd1', product: 8, price: 10, quantity: 3 }], {})
    await insertV0([{ id: 940, sale: 3, usd: 10, status: 'cancelled', at: '2026-10-02 03:00:00' }, { id: 941, sale: 4, usd: 10, status: 'cancelled', at: '2026-10-02 03:00:00' }],
      [{ id: 9401, ret: 940, si: 31, product: 7, qty: 1, usd: 10 }, { id: 9411, ret: 941, si: 41, product: 8, qty: 1, usd: 10 }])
    await db.batch([
      db.prepare(`INSERT INTO sale_amendments(sale_id,kind,sale_item_id,product_id,quantity_before,quantity_after,quantity_delta,created_at)
        VALUES(3,'line_quantity_increased',31,7,2,3,1,'2026-10-03 03:00:00')`),
      db.prepare(`INSERT INTO sale_amendments(sale_id,kind,sale_item_id,product_id,quantity_before,quantity_after,quantity_delta,created_at)
        VALUES(4,'line_quantity_increased',41,8,2,3,1,'2026-10-01 05:00:00')`),
    ])
    const amended = await convert('amended-1', [940, 941])
    assert.equal(outcome(amended.preview, 940).code, 'return_convert_sale_amended', JSON.stringify(outcome(amended.preview, 940)))
    assert.equal(outcome(amended.preview, 941).outcome, 'convert', 'control: an amendment before the return does not block it')
    assert.deepEqual(amended.applied.converted, [941])
    assert.equal(Number((await one('SELECT money_precision_version v FROM returns WHERE id=940')).v), 0, 'the amended one is left as it was')
    console.log('PASS P2-1: a cancelled old-format return amended after it was entered is not converted; the control converts')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
