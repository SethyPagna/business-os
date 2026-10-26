'use strict'
// Products -> Conflicts data gaps (unknown cost, empty barcode), through the REAL products route over a real
// migrated SQLite. Owner rule 14 Oct: a cost of 0 is a recorded $0 and is NOT flagged; a NULL cost is unknown and is;
// an empty barcode is flagged. The fixture holds the plausible wrong answers on purpose: a $0 row, a whitespace
// barcode, an inactive row, a legacy group parent, and a child under that parent.
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const role = grants => ({ id: 31, username: 'staff', name: 'Staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}' })
const admin = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

const h = createProductsRouteHarness({ user: admin })
const real = h.load('lib/permissions.ts')
h.setActionTier((...args) => real.getActionTier(...args))

// id, name, barcode, cost_price_usd, is_active, is_group, parent_id
const ROWS = [
  [1, 'Unknown cost', '8850000000011', null, 1, 0, null],
  [2, 'Free sample', '8850000000028', 0, 1, 0, null],
  [3, 'No barcode', null, 2.5, 1, 0, null],
  [4, 'Blank barcode', '   ', 2, 1, 0, null],
  [5, 'Both gaps', '', null, 1, 0, null],
  [6, 'Free no barcode', '', 0, 1, 0, null],
  [7, 'Inactive gap', null, null, 0, 0, null],
  [8, 'Legacy group parent', null, null, 1, 1, 0],
  [9, 'Legacy group parent', '8850000000093', null, 1, 0, 8],
  [10, 'Healthy', '8850000000101', 1.25, 1, 0, null],
]
seedStockFixture(h.raw.db, () => {
  const insert = h.raw.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,is_active,is_group,parent_id,stock_quantity,selling_price_usd) VALUES(?,?,?,?,?,?,?,0,1)')
  for (const row of ROWS) insert.run(...row)
  for (let id = 20; id < 27; id++) insert.run(id, `Bulk unknown ${id}`, `885000000${id}`, null, 1, 0, null)
})

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.message) }
}
const ids = page => page.json.items.map(item => item.id)

async function main() {
  await check('unknown cost lists NULL cost only: the $0 row, inactive row, group parent and healthy row are excluded', async () => {
    h.setUser(admin)
    const res = await h.request('GET', '/data-gaps?kind=unknown_cost&limit=100')
    assert.equal(res.status, 200)
    assert.deepEqual(ids(res), [1, 5, 9, 20, 21, 22, 23, 24, 25, 26])
    assert.ok(!ids(res).includes(2) && !ids(res).includes(6), 'a $0 cost is a recorded $0, not unknown')
  })
  await check('empty barcode lists NULL, empty and whitespace barcodes, nothing else', async () => {
    const res = await h.request('GET', '/data-gaps?kind=empty_barcode&limit=100')
    assert.deepEqual(ids(res), [3, 4, 5, 6])
    assert.equal(res.json.has_more, false)
    assert.equal(res.json.next_after, null)
  })
  await check('a $0 row with a real barcode is in neither list', async () => {
    for (const kind of ['unknown_cost', 'empty_barcode']) {
      assert.ok(!ids(await h.request('GET', `/data-gaps?kind=${kind}&limit=100`)).includes(2))
    }
  })
  await check('the list is keyset-paginated: pages are disjoint, ordered, and join to the full list', async () => {
    const seen = []
    let after = 0
    let pages = 0
    for (;;) {
      const res = await h.request('GET', `/data-gaps?kind=unknown_cost&limit=4&after=${after}`)
      assert.equal(res.status, 200)
      assert.ok(res.json.items.length <= 4)
      seen.push(...ids(res))
      pages++
      if (!res.json.has_more) { assert.equal(res.json.next_after, null); break }
      assert.equal(res.json.next_after, ids(res).at(-1))
      after = res.json.next_after
    }
    assert.equal(pages, 3)
    assert.deepEqual(seen, [1, 5, 9, 20, 21, 22, 23, 24, 25, 26])
  })
  await check('the page size is capped at 100 and a junk limit/after falls back to the default', async () => {
    const res = await h.request('GET', '/data-gaps?kind=empty_barcode&limit=99999&after=zzz')
    assert.equal(res.status, 200)
    assert.deepEqual(ids(res), [3, 4, 5, 6])
  })
  await check('an unknown kind is a 400', async () => {
    assert.equal((await h.request('GET', '/data-gaps?kind=nope')).status, 400)
    assert.equal((await h.request('GET', '/data-gaps')).status, 400)
  })
  await check('counts match the lists exactly', async () => {
    const res = await h.request('GET', '/data-gaps/counts')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json.counts, { unknown_cost: 10, empty_barcode: 4 })
  })
  await check('a row fixed in place leaves both the list and the count', async () => {
    seedStockFixture(h.raw.db, () => {
      h.raw.db.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = 1').run()
      h.raw.db.prepare("UPDATE products SET barcode = '8850000000999' WHERE id = 3").run()
    })
    assert.deepEqual(ids(await h.request('GET', '/data-gaps?kind=unknown_cost&limit=100')).slice(0, 2), [5, 9])
    assert.deepEqual(ids(await h.request('GET', '/data-gaps?kind=empty_barcode&limit=100')), [4, 5, 6])
    assert.deepEqual((await h.request('GET', '/data-gaps/counts')).json.counts, { unknown_cost: 9, empty_barcode: 3 })
  })
  await check('the Conflicts permission is enforced on both reads; the same grant that shows the tab is served', async () => {
    const reads = ['/data-gaps?kind=unknown_cost', '/data-gaps/counts']
    for (const user of [role({ products: 'review' }), role({ products: true, 'products:merge_duplicates': false }), role({ pos: true })]) {
      h.setUser(user)
      for (const path of reads) {
        const res = await h.request('GET', path)
        assert.equal(res.status, 403, `${JSON.stringify(user.role_permissions)} ${path} answered ${res.status}`)
        assert.equal(res.json.items, undefined)
        assert.equal(res.json.counts, undefined)
      }
    }
    h.setUser(role({ products: true }))
    for (const path of reads) assert.notEqual((await h.request('GET', path)).status, 403, path)
    h.setUser(admin)
    for (const path of reads) assert.equal((await h.request('GET', path)).status, 200, path)
  })
  if (failed) throw new Error(failed + ' data-gap checks failed')
  console.log('product data gaps PASS')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
