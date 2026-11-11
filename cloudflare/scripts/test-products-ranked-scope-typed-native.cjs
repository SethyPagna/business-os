#!/usr/bin/env node
// catalog_ranked_scope ON, except for a typed search. A typed search (a list of ranked ids, or text typed into a search box, a till barcode scan included) is unique to the
// keystroke: a stored ranking is never read again, and the ranked read costs more rows and calls than the page statement it replaces. So it keeps the page path with the switch ON,
// and every other read (the default page, the Products page, a facet) uses the ranked scope.
//
// Three readings on one seed:
//   OFF      the switch not stored (the reference),
//   ON       the switch stored, this code (the carve-out),
//   ON-RAW   the switch stored with the carve-out patched out (what flipping the switch alone would ship: the control).
// Typed shapes under ON must answer the same as OFF at the same cost; the same shapes under ON-RAW must cost clearly more (the control that the carve-out is what saves it).
// Every other shape under ON must take the ranked path (no page cache entry) and answer the same rows and total as OFF.
//
// Run: node scripts/test-products-ranked-scope-typed-native.cjs
'use strict'

const assert = require('node:assert/strict')
const { bootWorld, runShape, lastStatements } = require('./read-budget/world.cjs')

const NO_CARVE_OUT = [{ name: 'no-typed-carve-out', file: 'src/routes/products.ts', from: '!(!restricted && isTypedSearch(query)) && await readSwitch(', to: 'await readSwitch(' }]
const TILL = '&searchMode=smart&branchId=1&sort=name_asc&include=branch_stock,images,family&metadata=0&surface=pos&money_precision_version=1'
const PRODUCTS = '&searchMode=smart&sort=created_desc&include=branch_stock,images,batches,tagged_lots'

async function read(world, url) {
  const r = await runShape(world, { method: 'GET', url }, { cold: false, cacheMiss: true })
  assert.equal(r.status, 200, `${url} answers 200 (${JSON.stringify(r.json).slice(0, 160)})`)
  const statements = (await lastStatements(world)).filter((s) => !/system_flags|telegram_scheduled_sends/.test(s.sql))
  return { rows: r.rowsRead, calls: statements.length, cache: r.cache, ids: r.json.items.map((item) => item.id), total: r.json.total, ms: r.ms }
}

async function main() {
  const world = await bootWorld({ tier: 'free', switches: { ic_simple: 'on' } })
  const raw = await bootWorld({ tier: 'free', switches: { ic_simple: 'on', catalog_ranked_scope: 'on' }, patches: NO_CARVE_OUT })
  try {
    const ids = (n) => world.all('SELECT id FROM products WHERE is_active = 1 ORDER BY lower(name), id LIMIT ?', n).then((rows) => rows.map((row) => row.id))
    const ranked = async (n) => { const list = await ids(n); return `rankIds=${list.join(',')}&rankTiers=${'1'.repeat(list.length)}` }
    const barcode = (await world.all("SELECT barcode FROM products WHERE is_active = 1 AND length(barcode) >= 8 ORDER BY id LIMIT 1"))[0].barcode
    const typed = {
      'one-word text': `/api/products/search?page=1&pageSize=30&query=cream${TILL}`,
      'two-word text': `/api/products/search?page=1&pageSize=30&query=face%20cream${TILL}`,
      'Products page typed text': `/api/products/search?page=1&pageSize=50&query=cream${PRODUCTS}`,
      'barcode scan': `/api/products/search?page=1&pageSize=30&query=${encodeURIComponent(barcode)}${TILL}`,
      'ranked ids (20)': `/api/products/search?page=1&pageSize=30&${await ranked(20)}${TILL}`,
      'ranked ids (300)': `/api/products/search?page=1&pageSize=30&${await ranked(300)}${TILL}`,
      'ranked ids (1500)': `/api/products/search?page=1&pageSize=30&${await ranked(1500)}${TILL}`,
    }
    const rankedPath = {
      'till default page': `/api/products/search?page=1&pageSize=30${TILL}`,
      'till page 2': `/api/products/search?page=2&pageSize=30${TILL}`,
      'Products default page': `/api/products/search?page=1&pageSize=50${PRODUCTS}`,
      'till stock filter': `/api/products/search?page=1&pageSize=30&stockState=low${TILL}`,
    }
    const off = {}
    for (const [name, url] of Object.entries({ ...typed, ...rankedPath })) off[name] = await read(world, url)

    await world.addSwitches(['catalog_ranked_scope']); await world.restart()
    await read(world, `/api/products/search?page=1&pageSize=5${TILL}`)
    await read(raw, `/api/products/search?page=1&pageSize=5${TILL}`)
    const lines = []
    for (const [name, url] of Object.entries(typed)) {
      const on = await read(world, url)
      const noCarve = await read(raw, url)
      assert.deepEqual(on.ids, off[name].ids, `${name}: same rows as OFF`)
      assert.equal(on.total, off[name].total, `${name}: same total as OFF`)
      assert.equal(on.cache, off[name].cache, `${name}: keeps the page cache path (${off[name].cache}), not the ranked one (${on.cache})`)
      assert.ok(on.calls <= off[name].calls, `${name}: ${on.calls} calls is no more than OFF ${off[name].calls}`)
      assert.ok(on.rows <= off[name].rows + 40, `${name}: ${on.rows} rows is no more than OFF ${off[name].rows}`)
      assert.notEqual(noCarve.cache, on.cache, `${name}: control: without the carve-out the ranked path answers (${noCarve.cache})`)
      assert.ok(noCarve.calls > on.calls, `${name}: control: without the carve-out it costs more calls (${noCarve.calls} vs ${on.calls})`)
      lines.push(`${name}: OFF ${off[name].rows}r/${off[name].calls}c, ON ${on.rows}r/${on.calls}c, ON-RAW ${noCarve.rows}r/${noCarve.calls}c`)
    }
    for (const [name, url] of Object.entries(rankedPath)) {
      const on = await read(world, url)
      assert.deepEqual(on.ids, off[name].ids, `${name}: same rows as OFF`)
      assert.equal(on.total, off[name].total, `${name}: same total as OFF`)
      assert.equal(on.cache, 'bypass', `${name}: takes the ranked path (no page cache entry), saw ${on.cache}`)
      lines.push(`${name}: OFF ${off[name].rows}r/${off[name].calls}c, ON ${on.rows}r/${on.calls}c`)
    }
    console.log('PASS\n  ' + lines.join('\n  '))
  } finally {
    await world.dispose()
    await raw.dispose()
  }
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })
