'use strict'
// The reverse of the delivery-person delete guard: a sale or an expense that names a delivery person must find that person INSIDE its
// own write batch. The real Worker runs under Miniflare; a source transform (in memory, src/ untouched) deletes the driver at the exact
// moment between the route's read and its write batch, which is the race. The write must abort with a refusal and record nothing.
// Then the same run against a mutant bundle with the in-batch guard removed, which must go red (a dangling link).
//
// Run (from cloudflare/): node scripts/test-delivery-contact-reverse-race-native.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const root = path.resolve(__dirname, '..')
const lf = (s) => s.split('\r\n').join('\n')
const once = (source, anchor, replacement) => {
  const text = lf(source)
  assert.equal(text.split(anchor).length - 1, 1, 'anchor occurs once: ' + anchor.slice(0, 60))
  return text.replace(anchor, () => replacement)
}

// The race: delete the driver after the route has read it and before its batch is built.
const SALE_ANCHOR = '    const statements: Array<{ sql: string; params: Record<string, unknown> }> = [\n      capturedSourceGuard,'
const FEE_POST_ANCHOR = '    const feeEffectGuard = feeRedirect ?'
const FEE_PUT_ANCHOR = '  const editGuard = editRedirect ?'
const raceTransform = (mutant) => (file, source) => {
  if (file === 'routes/sales.ts') {
    let text = once(source, SALE_ANCHOR, "    if (deliveryContact) await db.prepare('DELETE FROM delivery_contacts WHERE id = ?').run([deliveryContact.id])\n" + SALE_ANCHOR)
    if (mutant === true) text = once(text, '      ...(deliveryContact ? [buildDeliveryContactExistsGuard(deliveryContact.id)] : []),\n', '')
    if (mutant === 'early') text = once(text, "  if (deliveryContactRead && !deliveryContact) {\n    return c.json({ error: 'That delivery driver no longer exists. Choose another driver.', code: DELIVERY_CONTACT_MISSING_CODE }, 409)\n  }\n", '')
    return text
  }
  if (file === 'routes/fees.ts') {
    let text = once(source, FEE_POST_ANCHOR, "    if (deliveryContactId != null) await db.prepare('DELETE FROM delivery_contacts WHERE id = @id').run({ id: deliveryContactId })\n" + FEE_POST_ANCHOR)
    text = once(text, FEE_PUT_ANCHOR, "  if (deliveryContactId != null && deliveryContactId !== existing.delivery_contact_id) await db.prepare('DELETE FROM delivery_contacts WHERE id = @id').run({ id: deliveryContactId })\n" + FEE_PUT_ANCHOR)
    if (mutant === true) {
      text = once(text, '      ...(deliveryContactId != null ? [buildDeliveryContactExistsGuard(deliveryContactId)] : []),\n', '')
      text = once(text, '      ...(deliveryContactId != null && deliveryContactId !== existing.delivery_contact_id ? [buildDeliveryContactExistsGuard(deliveryContactId)] : []),\n', '')
    }
    return text
  }
  return undefined
}

let kernelPromise
const stockKernel = () => kernelPromise ||= require('esbuild').build({ stdin: { contents: "export { executeRawStockTransaction } from './src/lib/stockTransaction'", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).then((bundle) => {
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
})

async function run(label, mutant) {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword, transformSources: raceTransform(mutant) })
  const { check, finish } = createReporter()
  try {
    await world.db.batch([
      world.db.prepare("UPDATE branches SET role='shop', canonical_key='shop' WHERE id=1"),
      world.db.prepare("UPDATE branches SET role='warehouse', canonical_key='warehouse' WHERE id=2"),
    ])
    const { executeRawStockTransaction } = await stockKernel()
    const org = (await world.first('SELECT organization_id o FROM users WHERE id = ?', world.adminId)).o
    let seq = 0
    const product = async () => {
      const n = ++seq, id = 800 + n, lot = id * 10 + 1
      await executeRawStockTransaction(world.db, [
        world.db.prepare('INSERT INTO products(id,name,barcode,sku,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,stock_quantity,is_active) VALUES(?,?,?,?,4,0,10,40000,20,1)').bind(id, 'RR Powder ' + id, '88800' + String(id).padStart(8, '0'), 'RR-' + id),
        world.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,20)').bind(id, 1),
        world.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,'2026-09-02',1,4,1)").bind(lot, id, 'RR' + id, 'RR' + id),
        world.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,20)').bind(lot, 1),
      ])
      return { id, lot }
    }
    const saleBody = async (p, key, driverId) => {
      const body = {
        branch_id: 1, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD', client_request_id: key,
        offline_owner: { version: 1, actor_id: world.adminId, organization_id: org ?? null, authority: 'http://localhost', runtime: 'cloudflare-workers' },
        payment_details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: 10, amount_paid_khr: 0,
        is_delivery: true, delivery_contact_id: driverId,
        items: [{ product_id: p.id, quantity: 1, branch_id: 1, batch_id: p.lot, client_line_key: key + '-l1', pricing_source: 'selling', pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } }],
      }
      const first = await world.api('POST', '/api/sales', body)
      assert.equal(first.status, 409, 'zero quote is answered with the server quote: ' + first.text.slice(0, 300))
      const quote = first.json.pricing_quotes.find((q) => q.client_line_key === key + '-l1')
      body.items[0].pricing_quote = Object.fromEntries(['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr'].map((k) => [k, quote[k]]))
      return body
    }
    const cache = await world.mf.getKVNamespace('CACHE')
    const clearLimits = async () => { for (const k of (await cache.list({ prefix: 'ratelimit:' })).keys) await cache.delete(k.name) }

    await check('sale create: the driver deleted between the read and the write batch aborts the sale (409), nothing recorded', async (t) => {
      await clearLimits()
      await world.run("INSERT INTO delivery_contacts(id,name) VALUES (71,'Gone driver')")
      const p = await product()
      const body = await saleBody(p, 'rr-sale-1', 71)
      const r = await world.api('POST', '/api/sales', body)
      t.eq('status and code', [r.status, r.json && r.json.code], [409, 'delivery_contact_missing'])
      t.eq('no sale recorded', (await world.first("SELECT COUNT(*) n FROM sales WHERE client_request_id = 'rr-sale-1'")).n, 0)
      t.eq('no sale points at a missing driver', (await world.first('SELECT COUNT(*) n FROM sales s LEFT JOIN delivery_contacts d ON d.id=s.delivery_contact_id WHERE s.delivery_contact_id IS NOT NULL AND d.id IS NULL')).n, 0)
    })

    await check('sale create: a driver deleted BEFORE the request is refused 409 delivery_contact_missing, never saved as a sale with no driver', async (t) => {
      await clearLimits()
      const p = await product()
      const body = await saleBody(p, 'rr-sale-2', 79)
      const r = await world.api('POST', '/api/sales', body)
      t.eq('status and code', [r.status, r.json && r.json.code], [409, 'delivery_contact_missing'])
      t.eq('no sale recorded', (await world.first("SELECT COUNT(*) n FROM sales WHERE client_request_id = 'rr-sale-2'")).n, 0)
    })

    await check('fee create: the driver deleted between the read and the write batch aborts the expense (400 Invalid delivery contact), nothing recorded', async (t) => {
      await clearLimits()
      await world.run("INSERT INTO delivery_contacts(id,name) VALUES (72,'Gone driver 2')")
      const r = await world.api('POST', '/api/fees', { fee_type: 'delivery', label: 'Courier', amount_usd: 2, amount_khr: 0, fee_date: '2026-11-10', branch_id: 1, delivery_contact_id: 72, client_request_id: 'rr-fee-1' })
      t.eq('status and code', [r.status, r.json && r.json.code], [400, 'delivery_contact_missing'])
      t.eq('no fee recorded', (await world.first("SELECT COUNT(*) n FROM fees WHERE delivery_contact_id = 72")).n, 0)
    })

    await check('fee edit: moving an expense to a driver deleted in the window aborts the edit, the fee keeps its old driver', async (t) => {
      await clearLimits()
      await world.run("INSERT INTO delivery_contacts(id,name) VALUES (73,'Old driver'),(74,'Gone driver 3')")
      await world.run("INSERT INTO fees(id,fee_type,label,amount_usd,amount_khr,fee_date,branch_id,delivery_contact_id,updated_at) VALUES (9301,'delivery','x',2,0,'2026-11-10',1,73,'2026-11-10T00:00:00.000Z')")
      const r = await world.api('PUT', '/api/fees/9301', { delivery_contact_id: 74, expected_updated_at: '2026-11-10T00:00:00.000Z' })
      t.eq('status and code', [r.status, r.json && r.json.code], [400, 'delivery_contact_missing'])
      t.eq('the fee still names the old driver', (await world.first('SELECT delivery_contact_id d FROM fees WHERE id = 9301')).d, 73)
    })
  } finally {
    console.log(`-- ${label}`)
    finish(`delivery contact reverse race (${label})`)
    await world.dispose()
  }
}

async function main() {
  await run('real source', false)
  if (process.exitCode) return
  for (const [name, kind] of [['in-batch driver guards removed', true], ['early missing-driver refusal removed', 'early']]) {
    await run('MUTANT: ' + name, kind)
    if (process.exitCode) { console.log('KILLED mutant (red as required)'); process.exitCode = 0 } else { console.log('SURVIVED mutant'); process.exitCode = 1; return }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
