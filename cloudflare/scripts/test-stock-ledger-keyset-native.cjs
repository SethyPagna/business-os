'use strict'
// INV-B S8 on the real Worker (Miniflare, counting D1 proxy, the production-sized seed: 33,514 stock movements): GET /api/products/stock-ledger with read
// switch `ledger_keyset` OFF and ON, Free tier.
//   - the first request answers the same body with the switch ON as OFF (next_cursor aside); the cursor the route hands out for page 400 equals the one the
//     read-budget harness builds for that position;
//   - a deep page by cursor is the offset list's page, row for row, five pages running, and carries no total, count or summary;
//   - rows read: a deep page costs <= 2,000 with the switch ON and (control) far more with it OFF, so the ceiling really separates the two;
//   - the page cap on this path is the plan's stockLedgerExportPageRows (Free 500); with the switch OFF it is the 1,000 it always was;
//   - a cursor that is not ours is a 400; with the switch OFF the same request is simply served (the key is ignored).
//
// Run (from cloudflare/): node scripts/test-stock-ledger-keyset-native.cjs
//   The first run seeds the world (several minutes). READ_BUDGET_SEED_SCRIPT_FILE=<file> pins the seed bundle; RUNNER_TEMP=<short dir> keeps the seed out of the
//   system temp directory (a long path gives SQLITE_CANTOPEN on Windows).
const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')

const DEEP_ROWS_MAX = 2000
const PAGE = 25 // the list's own page size
const DEEP = 400
const CURSOR_OFFSET = (DEEP - 1) * PAGE - 1
const BASE = `/api/products/stock-ledger?pageSize=${PAGE}`

async function measure(world, url) {
  await world.send('GET', url, undefined, { miss: true })
  const r = await world.send('GET', url, undefined, { miss: true })
  assert.equal(r.status, 200, `${url}: ${r.text.slice(0, 200)}`)
  return r
}
const strip = (body) => { const { next_cursor, ...rest } = body; return rest }

async function main() {
  const off = await bootWorld({ tier: 'free' })
  const on = await bootWorld({ tier: 'free', switches: { ledger_keyset: 'on' } })
  const results = []
  const check = (name, fn) => { try { fn(); results.push([name, true]); console.log('PASS', name) } catch (error) { results.push([name, false]); console.log('FAIL', name, '\n    ', String(error.message).split('\n').join('\n     ')) } }
  try {
    const offFirst = await measure(off, `${BASE}&page=1`)
    const onFirst = await measure(on, `${BASE}&page=1`)
    const offDeep = await measure(off, `${BASE}&page=${DEEP}`)
    // the route's own cursor for page 400: the answer to the page before it with no cursor (the offset page, which hands one out)
    const onBefore = await measure(on, `${BASE}&page=${DEEP - 1}`)
    const onDeep = await measure(on, `${BASE}&page=${DEEP}&cursor=${encodeURIComponent(onBefore.json.next_cursor)}`)
    const offBefore = await measure(off, `${BASE}&page=${DEEP - 1}`)

    check('ON page 1 is the OFF page 1 (the same body; OFF never sends next_cursor, ON does)', () => {
      assert.deepEqual(strip(onFirst.json), offFirst.json)
      assert.equal('next_cursor' in offFirst.json, false)
      assert.equal(typeof onFirst.json.next_cursor, 'string')
      assert.equal(offFirst.json.total > 30000, true, `the seed's ledger is large (${offFirst.json.total})`)
      assert.equal(offFirst.json.items.length, PAGE)
    })
    const harnessRow = (await off.all(`SELECT id, substr(created_at, 1, 10) AS d, COALESCE(strftime('%Y-%m-%d %H:%M:%f', created_at), created_at) AS i FROM inventory_movements ORDER BY COALESCE(strftime('%Y-%m-%d %H:%M:%f', created_at), created_at) DESC, id DESC LIMIT 1 OFFSET ${CURSOR_OFFSET}`))[0]
    check('the route cursor for page 400 is the harness cursor for the offset before page 400 (the cursor format the shapes use is the real one)', () => {
      assert.equal(onBefore.json.next_cursor, Buffer.from(JSON.stringify({ v: 1, d: harnessRow.d, i: harnessRow.i, id: harnessRow.id })).toString('base64url'))
    })
    check('the deep page by cursor is the offset list\'s page 400, row for row, with no total, count or summary', () => {
      assert.deepEqual(onDeep.json.items, offDeep.json.items)
      assert.equal(onDeep.json.items.length, PAGE)
      for (const key of ['total', 'totalPages', 'summary']) assert.equal(key in onDeep.json, false, `no ${key}`)
      assert.equal(onDeep.json.page, DEEP)
      assert.equal(typeof onDeep.json.next_cursor, 'string')
      assert.deepEqual(onBefore.json.items, offBefore.json.items, 'and the page before it, served from the offset path, is the offset page too')
    })
    check(`rows read: a deep page is <= ${DEEP_ROWS_MAX} with the switch ON; OFF is far above it, so the ceiling separates them`, () => {
      assert.ok(onDeep.rr <= DEEP_ROWS_MAX, `ON deep page read ${onDeep.rr} rows`)
      assert.ok(offDeep.rr > DEEP_ROWS_MAX * 5, `control: OFF deep page read ${offDeep.rr} rows, over the ceiling`)
    })

    check('page 1 with the switch ON reads less than with it OFF: with no In/Out view the summary count is the total, so the count is not run twice', () => {
      assert.ok(onFirst.rr < offFirst.rr * 0.7, `ON page 1 read ${onFirst.rr} rows, OFF ${offFirst.rr}`)
    })

    // five pages running by cursor, against the offset list
    let cursor = onDeep.json.next_cursor
    const walked = []
    for (let page = DEEP + 1; page <= DEEP + 4; page += 1) {
      const r = await measure(on, `${BASE}&page=${page}&cursor=${encodeURIComponent(cursor)}`)
      const o = await measure(off, `${BASE}&page=${page}`)
      walked.push({ page, same: JSON.stringify(r.json.items) === JSON.stringify(o.json.items), rr: r.rr, calls: r.calls, offRr: o.rr })
      cursor = r.json.next_cursor
    }
    check('four more pages by cursor equal the offset pages; each costs a page, not the depth', () => {
      assert.deepEqual(walked.filter((w) => !w.same), [])
      assert.ok(walked.every((w) => w.rr <= DEEP_ROWS_MAX), JSON.stringify(walked))
    })

    // the totals again after a write
    const again = await measure(on, `${BASE}&page=2&cursor=${encodeURIComponent(onFirst.json.next_cursor)}&totals=1`)
    check('totals=1 on a cursor page brings the total and the summary the first page had', () => {
      assert.equal(again.json.total, offFirst.json.total)
      assert.deepEqual(again.json.summary, offFirst.json.summary)
    })

    // the page cap
    const bigOn = await measure(on, '/api/products/stock-ledger?page=1&pageSize=1000')
    const bigOff = await measure(off, '/api/products/stock-ledger?page=1&pageSize=1000')
    check('the page cap: ON follows the plan (Free 500); OFF keeps its 1,000', () => {
      assert.equal(bigOn.json.items.length, 500); assert.equal(bigOn.json.pageSize, 500)
      assert.equal(bigOff.json.items.length, 1000); assert.equal(bigOff.json.pageSize, 1000)
    })

    // refusals
    const bad = await on.send('GET', `${BASE}&page=2&cursor=not-a-cursor-at-all`, undefined, { miss: true })
    const ignored = await off.send('GET', `${BASE}&page=1&cursor=not-a-cursor-at-all`, undefined, { miss: true })
    check('a cursor that is not ours is a 400 (ON); with the switch OFF it is ignored and the page number serves', () => {
      assert.equal(bad.status, 400); assert.equal(bad.json.code, 'invalid_cursor')
      assert.equal(ignored.status, 200); assert.deepEqual(ignored.json, offFirst.json)
    })

    console.log('\nrows read / D1 calls per GET /api/products/stock-ledger (Free, 33,514 movements, page size 25)')
    console.log(`  ${''.padEnd(34)} ${'rows'.padStart(8)} ${'calls'.padStart(6)}`)
    for (const [label, r] of [['OFF page 1', offFirst], ['ON page 1 (adds the cursor)', onFirst], ['OFF page 400 (offset)', offDeep], ['ON the page before it (no cursor: offset page)', onBefore], ['ON page 400 (by cursor)', onDeep]]) {
      console.log(`  ${label.padEnd(34)} ${String(r.rr).padStart(8)} ${String(r.calls).padStart(6)}`)
    }
    for (const w of walked) console.log(`  ${('ON page ' + w.page + ' (by cursor)').padEnd(34)} ${String(w.rr).padStart(8)} ${String(w.calls).padStart(6)}   (OFF page ${w.page}: ${w.offRr})`)
  } finally { await off.dispose(); await on.dispose() }
  const failed = results.filter(([, ok]) => !ok)
  console.log(`\n${failed.length ? 'RED' : 'GREEN'} stock ledger keyset native: ${results.length - failed.length}/${results.length} checks hold`)
  process.exit(failed.length ? 1 : 0)
}
main().catch((error) => { console.error(error); process.exit(1) })
