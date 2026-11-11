#!/usr/bin/env node
// GET /api/products/possible-duplicates keeps its groups for possibleDuplicatesCacheSeconds on the PRODUCTS version alone, and reads what a group shows live.
//   - A sale moves stock (and, through the lot triggers, a product's cost) and bumps only 'stock'/'sales': the groups stay a cache hit while the stock and cost shown are the live ones.
//   - Rename, barcode edit, dismissal and removal each advance the products version: the next read is a miss with the new groups.
//   - A product image upload changes no product row and must not advance the version (S15); the same upload in the base (patched to bump again) does, which is the control.
//   - A write that announced nothing (rows changed straight in D1) is still never shown: a changed member recomputes the groups, a stock change shows live.
//
// Run: node scripts/test-products-duplicates-cache-native.cjs
'use strict'

const assert = require('node:assert/strict')
const { bootWorld, ORIGIN } = require('./read-budget/world.cjs')
const { lots } = require('./read-budget/writes.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const QUOTE_KEYS = ['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr']
const ZERO_QUOTE = { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 }
const OLD_UPLOAD_BUMP = [{ name: 'upload-bumps-products', file: 'src/routes/products.ts',
  from: '// No products version bump: the upload writes R2 and file_assets only. Each route that attaches the path to a product bumps for itself.', to: "c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))" }]

const dups = async (world) => { const r = await world.send('GET', '/api/products/possible-duplicates'); assert.equal(r.status, 200); return { cache: r.cache, clusters: r.json.clusters, rr: r.rr, calls: r.calls } }
const member = (clusters, id) => clusters.flatMap((cluster) => cluster.products).find((product) => product.id === id)
async function upload(world) {
  const boundary = `----bos${Date.now()}`
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`)
  const body = Buffer.concat([head, PNG, Buffer.from(`\r\n--${boundary}--\r\n`)])
  const res = await world.mf.dispatchFetch(`${ORIGIN}/api/products/upload-image`, { method: 'POST', body,
    headers: { cookie: world.cookie, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': `multipart/form-data; boundary=${boundary}` } })
  assert.equal(res.status, 200, `upload ${await res.text()}`)
}
async function sellOne(world, pid, batch) {
  const k = `dupcache-${Date.now()}`
  const body = { branch_id: 1, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD', client_request_id: k,
    offline_owner: { version: 1, actor_id: 901, organization_id: world.orgId, authority: ORIGIN, runtime: 'cloudflare-workers' }, amount_paid_usd: 0, amount_paid_khr: 0,
    items: [{ product_id: pid, quantity: 1, branch_id: 1, batch_id: batch, client_line_key: `${k}-l0`, pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } }] }
  let r = await world.send('POST', '/api/sales', body)
  assert.equal(r.status, 409, `quote probe ${r.status} ${r.text.slice(0, 160)}`)
  const quote = r.json.pricing_quotes[0]
  body.items[0].pricing_quote = Object.fromEntries(QUOTE_KEYS.map((q) => [q, quote[q]]))
  const total = Number(body.items[0].pricing_quote.total_usd || 0)
  Object.assign(body, { payment_details: [{ method: 'Cash', amount_usd: Math.ceil(total), amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: Math.ceil(total), amount_paid_khr: 0 })
  r = await world.send('POST', '/api/sales', body)
  if (r.status === 409 && r.json?.code === 'sale_header_quote_conflict') { body.expected_header_quote = r.json.header_quote; r = await world.send('POST', '/api/sales', body) }
  assert.ok(r.status < 300, `sale ${r.status} ${r.text.slice(0, 200)}`)
  await sleep(600)
}
async function withPermit(world, statements) {
  await world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('stock_transaction_permit', 'legacy-separate-pool-v1')").run()
  await world.db.batch(statements)
  await world.db.prepare("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'").run()
}
const liveStock = async (world, id) => Number((await world.all('SELECT COALESCE(SUM(quantity),0) AS q FROM branch_stock WHERE product_id = ?', id))[0].q)

const SRC = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8').replace(/\r\n/g, '\n')
const ROUTE = SRC.slice(SRC.indexOf("app.get('/possible-duplicates', async (c) => {"), SRC.indexOf("app.get('/data-gaps/counts'"))
assert.ok(/catalogReadVersion\(c\.env, \['products'\]\)/.test(ROUTE), 'possible-duplicates is keyed on the products version alone')
assert.ok(/getPlanLimits\(c\.env\)\.possibleDuplicatesCacheSeconds/.test(ROUTE), 'its lifetime is the plan limit, not a literal')
assert.ok(!/\b300\b/.test(ROUTE), 'no literal lifetime')

async function main() {
  const world = await bootWorld({ tier: 'free', switches: { ic_simple: 'on' } })
  const base = await bootWorld({ tier: 'free', switches: { ic_simple: 'on' }, patches: OLD_UPLOAD_BUMP })
  try {
    // cache behaviour and the hit being cheaper than the miss
    const first = await dups(world)
    assert.equal(first.cache, 'miss')
    assert.ok(first.clusters.length > 100, 'the seed has many groups')
    const second = await dups(world)
    assert.equal(second.cache, 'hit', 'the groups are served from the cache')
    assert.ok(second.rr < first.rr * 0.6, `a hit reads far fewer rows than the miss (${second.rr} vs ${first.rr})`)
    assert.ok(second.calls <= 6, `a hit is a few calls whatever the number of members (${second.calls})`)
    assert.deepEqual(second.clusters.map((c) => c.value), first.clusters.map((c) => c.value), 'same groups')

    // a sale: 'stock' bump only; groups cached, the stock and cost shown are live
    const picked = (await lots(world, 400, 0)).find((row) => member(second.clusters, row.pid))
    assert.ok(picked, 'a stocked lot whose product sits in a group')
    const { pid, batch } = picked
    const stockBefore = member(second.clusters, pid).stock_quantity
    assert.equal(stockBefore, await liveStock(world, pid), 'control: the first read agrees with D1')
    await sellOne(world, pid, batch)
    const afterSale = await dups(world)
    assert.equal(afterSale.cache, 'hit', 'a sale does not move the products version: still a hit')
    assert.equal(member(afterSale.clusters, pid).stock_quantity, stockBefore - 1, 'and the stock shown is the live one, one less')
    assert.equal(member(afterSale.clusters, pid).stock_quantity, await liveStock(world, pid))
    const costNow = (await world.all('SELECT cost_price_usd AS c FROM products WHERE id = ?', pid))[0].c
    assert.equal(member(afterSale.clusters, pid).cost_price_usd, costNow, 'and so is the cost')

    // changes nothing announced: stock written straight to D1 shows live on a hit; a cost written straight shows live
    await withPermit(world, [
      world.db.prepare('UPDATE branch_stock SET quantity = quantity + 7 WHERE branch_id = 1 AND product_id = ?').bind(pid),
      world.db.prepare('UPDATE products SET stock_quantity = stock_quantity + 7, cost_price_usd = 9.5 WHERE id = ?').bind(pid),
    ])
    const direct = await dups(world)
    assert.equal(direct.cache, 'hit')
    assert.equal(member(direct.clusters, pid).stock_quantity, stockBefore - 1 + 7, 'unannounced stock is shown live')
    assert.equal(member(direct.clusters, pid).cost_price_usd, 9.5, 'unannounced cost is shown live')

    // image upload: no bump (S15); the base world (bump restored) is the control
    await upload(world); await sleep(600)
    assert.equal((await dups(world)).cache, 'hit', 'an image upload leaves the products version alone')
    await dups(base)
    assert.equal((await dups(base)).cache, 'hit', 'control: the base caches the same read')
    await upload(base); await sleep(600)
    assert.equal((await dups(base)).cache, 'miss', 'control: the base upload advanced the version and emptied the cache')

    // a member written straight to D1 with no bump: the hit validates its members and recomputes
    const clusterOf = (clusters, id) => clusters.find((c) => c.products.some((p) => p.id === id))
    const sibling = clusterOf((await dups(world)).clusters, pid).products.find((p) => p.id !== pid).id
    await world.db.prepare("UPDATE products SET barcode = 'UNANNOUNCED-1', name = 'Unannounced Rename' WHERE id = ?").bind(sibling).run()
    const stale = await dups(world)
    assert.equal(member(stale.clusters, sibling)?.name ?? null, null, 'a member renamed with no bump is out of its group, not shown stale')

    // each announced membership change is a miss and shows the new groups
    const fresh = async () => { await sleep(600); const a = await dups(world); return a }
    await dups(world)
    const a = clusterOf((await dups(world)).clusters, pid)
    const other = a.products.find((p) => p.id !== pid && p.id !== sibling)
    let r = await world.send('PUT', `/api/products/${other.id}`, { name: 'Renamed By Test' })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    let next = await fresh()
    assert.equal(next.cache, 'miss', 'a rename advances the version')
    assert.equal(member(next.clusters, other.id), undefined, 'the renamed product left its group')
    await dups(world)
    r = await world.send('PUT', `/api/products/${pid}`, { barcode: other.barcode })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    next = await fresh()
    assert.equal(next.cache, 'miss', 'a barcode edit advances the version')
    assert.equal(member(next.clusters, pid).barcode, other.barcode)
    const grp = next.clusters[0]
    await dups(world)
    r = await world.send('POST', '/api/products/possible-duplicates/dismiss', { type: grp.type, value: grp.value })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    next = await fresh()
    assert.equal(next.cache, 'miss', 'a dismissal advances the version')
    assert.ok(!next.clusters.some((c) => c.type === grp.type && c.value === grp.value), 'the dismissed group is gone')
    await dups(world)
    const removable = (await world.all('SELECT p.id FROM products p WHERE p.is_active = 1 AND p.stock_quantity = 0 AND NOT EXISTS (SELECT 1 FROM branch_stock b WHERE b.product_id = p.id AND b.quantity <> 0) AND p.id IN (SELECT value FROM json_each(?)) LIMIT 1',
      JSON.stringify(next.clusters.flatMap((c) => c.products.map((p) => p.id)))))[0].id
    r = await world.send('DELETE', `/api/products/${removable}`, { reason: 'duplicates cache test' })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    next = await fresh()
    assert.equal(next.cache, 'miss', 'a removal advances the version')
    assert.equal(member(next.clusters, removable), undefined, 'the removed product is out of its group')

    console.log(`PASS miss ${first.rr} rows / ${first.calls} calls; hit ${second.rr} rows / ${second.calls} calls over ${first.clusters.length} groups; sale keeps the hit with live stock; upload no bump; rename, barcode, dismissal, removal miss`)
  } finally {
    await world.dispose()
    await base.dispose()
  }
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })
