'use strict'
// Products -> Conflicts data gaps (lane 6.0.988), through the REAL products route over a real migrated SQLite (0273 applied).
// Owner rulings 14-15 Oct: every unknown-cost item is listed (catalog NULL, received dates with units on hand and no cost, held damaged
// lots with no cost, and an old $0 nobody has proven), blank and "0" placeholder barcodes are separate lists, an admin can confirm a $0
// or mark "no barcode", reversibly, and a decision never touches cost, stock or sales.
//
// The fixture holds the plausible wrong answers on purpose: a proven $0 (confirmed, latest cost entry, $0 lot), a $0 on a product
// created after the watermark, a no-stock lot, a spent held lot, an inactive row, a legacy group parent, tab / NBSP / newline barcodes,
// and "00A" (not a placeholder). The count cache is a real keyed cache with version invalidation, not the harness pass-through.
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const role = grants => ({ id: 31, username: 'staff', name: 'Staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}' })
const admin = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
// Conflicts reader with cost view / editor without it; the grants are what the permission editor stores.
const MERGE = { products: true, 'products:merge_duplicates': true }
const withCost = role({ ...MERGE, product_cost_view: true, product_cost_edit: true })
const noCostView = role({ ...MERGE })
const costViewOnly = role({ ...MERGE, product_cost_view: true })

// A cache that behaves like lib/cache.ts: entries are keyed by URL + version, a bump moves the version.
const versions = new Map()
const cached = new Map()
let producerRuns = 0
const cacheOverride = {
  cachedJsonResponse: async (request, _ctx, version, _ttl, producer) => {
    const key = `${request.url}|${version}`
    if (!cached.has(key)) { producerRuns++; cached.set(key, JSON.stringify(await producer())) }
    return JSON.parse(cached.get(key))
  },
  getVersion: async (_env, ns) => String(versions.get(ns) || 0),
  getVersionWithFallback: async (_env, ns) => versions.get(ns) || 0,
  bumpVersion: async (_env, ns) => { versions.set(ns, (versions.get(ns) || 0) + 1) },
  bumpVersions: async (_env, list) => { for (const ns of list) versions.set(ns, (versions.get(ns) || 0) + 1) },
}

const h = createProductsRouteHarness({ user: admin, overrides: { '../lib/cache': cacheOverride } })
const real = h.load('lib/permissions.ts')
h.setActionTier((...args) => real.getActionTier(...args))
const lib = h.load('lib/productDataGaps.ts')
const db = h.raw.db

const WATERMARK = 32
seedStockFixture(db, () => {
  db.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)")
  const add = db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,is_active,is_group,parent_id,stock_quantity,selling_price_usd) VALUES(?,?,?,?,?,?,?,0,1)')
  const rows = [
    [1, 'Null cost', 'B1', null], [2, 'Old zero', 'B2', 0], [3, 'Old zero confirmed', 'B3', 0], [4, 'Old zero, latest entry is $0', 'B4', 0],
    [5, 'Old zero with a $0 lot', 'B5', 0], [6, 'Healthy', 'B6', 1.25], [7, 'Lot without cost', 'B7', 2], [8, 'Lot without cost, no stock', 'B8', 2],
    [9, 'Held damaged without cost', 'B9', 2], [10, 'Held damaged spent', 'B10', 2],
  ]
  for (const [id, name, barcode, cost] of rows) add.run(id, name, barcode, cost, 1, 0, null)
  add.run(11, 'Inactive null cost', 'B11', null, 0, 0, null)
  add.run(12, 'Legacy group parent', null, null, 1, 1, 0)
  const barcodes = [[13, null], [14, ''], [15, '   '], [16, '\t'], [17, ' '], [18, '\n'], [19, '0'], [20, '000'], [21, ' 0 '], [22, '00A'], [24, null]]
  for (const [id, barcode] of barcodes) add.run(id, `Barcode case ${id}`, barcode, 1, 1, 0, null)
  add.run(23, 'Real barcode', '8850000000023', 1, 1, 0, null)
  for (let id = 25; id <= 30; id++) add.run(id, `Bulk unknown ${id}`, `885000000${id}`, null, 1, 0, null)
  add.run(31, 'Old zero, only a sold-out $0 lot', 'B31', 0, 1, 0, null)
  add.run(32, 'Filler at the watermark', 'B32', 1, 1, 0, null)
  add.run(33, 'New zero typed by a person', 'B33', 0, 1, 0, null)
  const lot = db.prepare('INSERT INTO product_batches(variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(?,?,1,?,?)')
  const stock = db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)')
  stock.run(Number(lot.run(5, 'k5', 0, '2026-10-01').lastInsertRowid), 1, 4)
  stock.run(Number(lot.run(7, 'k7', null, '2026-10-02').lastInsertRowid), 1, 3)
  stock.run(Number(lot.run(8, 'k8', null, '2026-10-02').lastInsertRowid), 1, 0)
  stock.run(Number(lot.run(31, 'k31', 0, '2026-10-03').lastInsertRowid), 1, 0)
  const held = db.prepare('INSERT INTO damaged_stock_lots(product_id,quantity,quantity_remaining,unit_cost_usd) VALUES(?,?,?,NULL)')
  held.run(9, 2, 2)
  held.run(10, 2, 0)
  db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source) VALUES(4,0,'edit')").run()
  db.prepare("INSERT INTO product_conflict_marks(product_id,mark) VALUES(3,'zero_cost_confirmed')").run()
  db.prepare("INSERT INTO product_conflict_marks(product_id,mark) VALUES(24,'no_barcode')").run()
  // The lot triggers derive catalog costs; restore the fixture's intended catalog costs.
  const set = db.prepare('UPDATE products SET cost_price_usd = ? WHERE id = ?')
  set.run(0, 5); set.run(2, 7); set.run(2, 8); set.run(0, 31)
  db.prepare("UPDATE system_flags SET value = ? WHERE key = 'cost_zero_watermark'").run(String(WATERMARK))
})
assert.equal(db.prepare("SELECT value v FROM system_flags WHERE key = 'cost_zero_watermark'").get().v, String(WATERMARK), 'control: the watermark is set')
assert.equal(db.prepare('SELECT cost_price_usd c FROM products WHERE id = 5').get().c, 0, 'control: product 5 holds a $0 catalog cost')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.stack || error.message) }
}
const get = async (path, user = admin) => { h.setUser(user); return h.request('GET', path) }
const post = async (body, user = admin) => { h.setUser(user); return h.request('POST', '/data-gaps/marks', body) }
const ids = res => res.json.items.map(item => item.id)
const UNKNOWN = [1, 2, 7, 9, 25, 26, 27, 28, 29, 30, 31]
const business = () => ({
  products: db.prepare('SELECT * FROM products ORDER BY id').all(),
  lots: db.prepare('SELECT * FROM product_batches ORDER BY id').all(),
  stock: db.prepare('SELECT * FROM branch_batch_stock ORDER BY id').all(),
  damaged: db.prepare('SELECT * FROM damaged_stock_lots ORDER BY id').all(),
  sales: db.prepare('SELECT COUNT(*) n FROM sales').get().n,
  movements: db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
})

async function main() {
  await check('unknown cost lists every reason and nothing proven: NULL catalog, no-cost lot with units, held lot with units, unproven old $0', async () => {
    const res = await get('/data-gaps?kind=unknown_cost&limit=100')
    assert.equal(res.status, 200)
    assert.deepEqual(ids(res), UNKNOWN)
    const by = id => res.json.items.find(item => item.id === id)
    assert.deepEqual(by(1).reasons, ['catalog_unknown'])
    assert.deepEqual(by(2).reasons, ['zero_unconfirmed'])
    assert.deepEqual(by(7).reasons, ['lots_unknown'])
    assert.equal(by(7).unknown_lot_count, 1)
    assert.equal(by(7).unknown_units, 3)
    assert.deepEqual(by(31).reasons, ['zero_unconfirmed'], 'a $0 whose only $0 lot is sold out is still unproven (owner Q2: sold-out lots carry no weight)')
    assert.deepEqual(by(9).reasons, ['held_unknown'])
    assert.equal(by(9).held_unknown_units, 2)
  })

  await check('a $0 is NOT listed when it is proven (confirmed, latest cost entry is $0, an active $0 lot) or was typed after the watermark', async () => {
    const list = ids(await get('/data-gaps?kind=unknown_cost&limit=100'))
    for (const id of [3, 4, 5, 33]) assert.ok(!list.includes(id), `product ${id} is a real $0`)
    for (const id of [8, 10]) assert.ok(!list.includes(id), `product ${id}: a lot with no units / a spent held lot is not an item`)
    for (const id of [11, 12]) assert.ok(!list.includes(id), `product ${id}: inactive and group parent rows are never listed`)
  })

  await check('empty barcode lists NULL, empty and every blank JavaScript trim() strips (tab, no-break space, newline); the no-barcode mark hides a row', async () => {
    const res = await get('/data-gaps?kind=empty_barcode&limit=100')
    assert.equal(res.status, 200)
    assert.deepEqual(ids(res), [13, 14, 15, 16, 17, 18])
    for (const id of [24, 19, 22, 23]) assert.ok(!ids(res).includes(id), `product ${id} is not an empty barcode`)
    for (const barcode of [null, '', '   ', '\t', ' ', '\n']) assert.equal((barcode ?? '').trim(), '', 'control: the app itself calls this blank')
  })

  await check('placeholder barcodes ("0", "000", " 0 ") are their own list; "00A" and real barcodes are not placeholders', async () => {
    const res = await get('/data-gaps?kind=placeholder_barcode&limit=100')
    assert.deepEqual(ids(res), [19, 20, 21])
  })

  await check('keyset pagination: pages are disjoint, ordered, join to the full list, and the limit is capped', async () => {
    for (const [kind, expected] of [['unknown_cost', UNKNOWN], ['empty_barcode', [13, 14, 15, 16, 17, 18]]]) {
      const seen = []
      let after = 0
      let pages = 0
      for (;;) {
        const res = await get(`/data-gaps?kind=${kind}&limit=4&after=${after}`)
        assert.equal(res.status, 200)
        assert.ok(res.json.items.length <= 4)
        seen.push(...ids(res))
        pages++
        if (!res.json.has_more) { assert.equal(res.json.next_after, null); break }
        assert.equal(res.json.next_after, ids(res).at(-1))
        after = res.json.next_after
      }
      assert.deepEqual(seen, expected, kind)
      assert.equal(pages, Math.ceil(expected.length / 4), kind)
    }
    const capped = await get('/data-gaps?kind=empty_barcode&limit=99999&after=zzz')
    assert.equal(capped.status, 200)
    assert.deepEqual(ids(capped), [13, 14, 15, 16, 17, 18])
    assert.equal((await get('/data-gaps?kind=nope')).status, 400)
    assert.equal((await get('/data-gaps')).status, 400)
  })

  await check('the cost filter: the unknown-cost list and count need product_cost_view; barcode lists and counts do not', async () => {
    for (const user of [noCostView]) {
      const list = await get('/data-gaps?kind=unknown_cost', user)
      assert.equal(list.status, 403)
      assert.equal(list.json.items, undefined)
      const counts = await get('/data-gaps/counts', user)
      assert.equal(counts.status, 200)
      assert.equal('unknown_cost' in counts.json.counts, false, 'the unknown-cost count is cost data')
      assert.deepEqual(counts.json.counts, { empty_barcode: 6, placeholder_barcode: 3 })
      assert.equal((await get('/data-gaps?kind=empty_barcode', user)).status, 200)
      assert.equal((await get('/data-gaps?kind=placeholder_barcode', user)).status, 200)
    }
    for (const user of [costViewOnly, withCost, admin]) {
      assert.equal((await get('/data-gaps?kind=unknown_cost', user)).status, 200)
      assert.deepEqual((await get('/data-gaps/counts', user)).json.counts, { unknown_cost: UNKNOWN.length, empty_barcode: 6, placeholder_barcode: 3 })
    }
  })

  await check('the Conflicts permission is enforced on every read and write with exact statuses', async () => {
    const reads = ['/data-gaps?kind=empty_barcode', '/data-gaps/counts']
    for (const user of [role({ products: true, 'products:merge_duplicates': false }), role({ pos: true })]) {
      for (const path of reads) {
        const res = await get(path, user)
        assert.equal(res.status, 403, `${user.role_permissions} ${path}`)
        assert.equal(res.json.items, undefined)
        assert.equal(res.json.counts, undefined)
      }
    }
    // The Review tier reads the lists too (owner, 27 Oct 2026): it can ask for a decision, an admin approves it.
    for (const user of [role({ products: 'review' }), role({ products: true }), noCostView, withCost, admin]) {
      for (const path of reads) assert.equal((await get(path, user)).status, 200, path)
    }
  })

  await check('the count is served from the real cache and a decision invalidates it', async () => {
    const first = await get('/data-gaps/counts')
    const runs = producerRuns
    assert.equal(first.json.counts.unknown_cost, UNKNOWN.length)
    // A raw write moves no version, so the cache must still answer the OLD number: proof the cache path is in use.
    seedStockFixture(db, () => db.prepare('UPDATE products SET cost_price_usd = 1 WHERE id = 25').run())
    assert.equal((await get('/data-gaps/counts')).json.counts.unknown_cost, UNKNOWN.length, 'served from cache')
    assert.equal(producerRuns, runs, 'no recount happened')
    seedStockFixture(db, () => db.prepare('UPDATE products SET cost_price_usd = NULL WHERE id = 25').run())
    const before = business()
    const done = await post({ product_id: 2, mark: 'zero_cost_confirmed', set: true })
    assert.equal(done.status, 200)
    assert.equal(done.json.changed, true)
    const after = await get('/data-gaps/counts')
    assert.ok(producerRuns > runs, 'the decision bumped the products version, so the count was recomputed')
    assert.equal(after.json.counts.unknown_cost, UNKNOWN.length - 1)
    assert.deepEqual(business(), before, 'a decision changes no cost, stock, lot, sale or movement')
  })

  await check('Confirm $0: removes the product from unknown cost, writes the mark, one audit row and one undo record, and is idempotent', async () => {
    assert.ok(!ids(await get('/data-gaps?kind=unknown_cost&limit=100')).includes(2))
    const mark = db.prepare("SELECT * FROM product_conflict_marks WHERE product_id = 2 AND mark = 'zero_cost_confirmed'").get()
    assert.equal(mark.marked_by_id, 7)
    const audit = db.prepare("SELECT * FROM audit_logs WHERE entity = 'product' AND entity_id = '2' AND action = 'conflict_mark'").all()
    assert.equal(audit.length, 1)
    assert.equal(JSON.parse(audit[0].details).mark, 'zero_cost_confirmed')
    const history = db.prepare("SELECT * FROM action_history WHERE entity = 'product' AND entity_id = '2'").all()
    assert.equal(history.length, 1)
    assert.equal(history[0].reversible, 1)
    assert.equal(JSON.parse(history[0].undo_payload).applier, 'product.conflict_mark')
    const again = await post({ product_id: 2, mark: 'zero_cost_confirmed', set: true })
    assert.equal(again.status, 200)
    assert.equal(again.json.changed, false)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity_id = '2'").get().n, 1, 'no second record')
  })

  await check('Confirm $0 works on an old $0 whose only $0 lot is sold out', async () => {
    const done = await post({ product_id: 31, mark: 'zero_cost_confirmed', set: true })
    assert.equal(done.status, 200, JSON.stringify(done.json))
    assert.equal(done.json.changed, true)
    assert.ok(!ids(await get('/data-gaps?kind=unknown_cost&limit=100')).includes(31))
  })

  await check('Conflicts access gates the decisions too: merge_duplicates off and a missing cost view are refused with 403 and write nothing', async () => {
    const marksBefore = db.prepare('SELECT COUNT(*) n FROM product_conflict_marks').get().n
    const historyBefore = db.prepare('SELECT COUNT(*) n FROM action_history').get().n
    const employeeShape = role({ products: true, 'products:merge_duplicates': false, product_cost_view: true, product_cost_edit: true })
    const noCostView = role({ ...MERGE, product_cost_edit: true })
    for (const [who, user] of [['merge off', employeeShape]]) {
      assert.equal((await post({ product_id: 13, mark: 'no_barcode', set: true }, user)).status, 403, `${who}: no barcode`)
      assert.equal((await post({ product_id: 1, mark: 'zero_cost_confirmed', set: true }, user)).status, 403, `${who}: confirm $0`)
    }
    assert.equal((await post({ product_id: 2, mark: 'zero_cost_confirmed', set: false }, employeeShape)).status, 403, 'merge off: taking a mark back')
    assert.equal((await post({ product_id: 1, mark: 'zero_cost_confirmed', set: true }, noCostView)).status, 403, 'a $0 confirmation is cost data: cost view is required')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM product_conflict_marks').get().n, marksBefore, 'no mark was written')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM action_history').get().n, historyBefore, 'no undo record was written')
    assert.ok(ids(await get('/data-gaps?kind=empty_barcode&limit=100')).includes(13), 'the product is still listed')
  })

  await check('refusals: a $0 confirmation needs the cost-entry permission, products edit at the full tier; the gap must still exist', async () => {
    assert.equal((await post({ product_id: 1, mark: 'zero_cost_confirmed', set: true }, role({ ...MERGE, product_cost_view: true }))).status, 403)
    assert.equal((await post({ product_id: 13, mark: 'no_barcode', set: true }, role({ pos: true }))).status, 403)
    const notZero = await post({ product_id: 6, mark: 'zero_cost_confirmed', set: true })
    assert.equal(notZero.status, 409)
    assert.equal(notZero.json.code, 'zero_not_unconfirmed')
    const hasBarcode = await post({ product_id: 6, mark: 'no_barcode', set: true })
    assert.equal(hasBarcode.status, 409)
    assert.equal(hasBarcode.json.code, 'barcode_present')
    assert.equal((await post({ product_id: 99999, mark: 'no_barcode', set: true })).status, 404)
    assert.equal((await post({ product_id: 13, mark: 'bogus', set: true })).status, 400)
    assert.equal((await post({ product_id: 13, mark: 'no_barcode' })).status, 400)
    assert.equal((await post({ mark: 'no_barcode', set: true })).status, 400)
    assert.equal((await post({ product_id: 13, mark: 'no_barcode', set: true }, withCost)).status, 200, 'a cost editor with products edit may mark a barcode')
    assert.equal((await post({ product_id: 13, mark: 'no_barcode', set: false })).status, 200)
  })

  await check('No barcode mark: hides the product from both barcode lists, reversibly, with audit and undo each time', async () => {
    const before = business()
    for (const [id, kind] of [[14, 'empty_barcode'], [19, 'placeholder_barcode']]) {
      assert.ok(ids(await get(`/data-gaps?kind=${kind}&limit=100`)).includes(id))
      assert.equal((await post({ product_id: id, mark: 'no_barcode', set: true })).status, 200)
      assert.ok(!ids(await get(`/data-gaps?kind=${kind}&limit=100`)).includes(id), 'hidden once marked')
      assert.equal((await post({ product_id: id, mark: 'no_barcode', set: false })).status, 200)
      assert.ok(ids(await get(`/data-gaps?kind=${kind}&limit=100`)).includes(id), 'back after the mark is removed')
    }
    assert.deepEqual(business(), before)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id IN ('14','19') AND action IN ('conflict_mark','conflict_unmark')").get().n, 4)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity_id IN ('14','19')").get().n, 4)
  })

  await check('undo and redo are compensating writes with their own audit row; replays that no longer apply are refused with stable codes', async () => {
    const actor = { id: 7, name: 'Admin' }
    const replay = (direction, payload, canEditCosts = true) => lib.replayProductConflictMark(h.db, actor, canEditCosts, direction, payload)
    const payload = { applier: 'product.conflict_mark', product_id: 2, mark: 'zero_cost_confirmed', set: true }
    await assert.rejects(replay('undo', payload, false), error => error.code === 'undo_refused' && error.statusCode === 409)
    await replay('undo', payload)
    assert.ok(ids(await get('/data-gaps?kind=unknown_cost&limit=100')).includes(2), 'undo brings the product back to the list')
    await assert.rejects(replay('undo', payload), error => error.code === 'undo_already_done')
    await replay('redo', payload)
    assert.ok(!ids(await get('/data-gaps?kind=unknown_cost&limit=100')).includes(2))
    const barcodeMark = { applier: 'product.conflict_mark', product_id: 15, mark: 'no_barcode', set: true }
    assert.equal((await post({ product_id: 15, mark: 'no_barcode', set: true })).status, 200)
    await replay('undo', barcodeMark)
    seedStockFixture(db, () => db.prepare("UPDATE products SET barcode = '8859999999999' WHERE id = 15").run())
    await assert.rejects(replay('redo', barcodeMark), error => error.code === 'undo_record_changed', 'redo is refused once a barcode was typed meanwhile')
    await assert.rejects(replay('undo', { product_id: 2, mark: 'nope', set: true }), error => error.code === 'undo_history_unusable')
    assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id = '2' AND action IN ('conflict_mark','conflict_unmark')").get().n >= 3)
  })

  await check('plans on a schema WITHOUT sqlite_stat1: partial indexes and primary-key seeks, never a walk of the products table', async () => {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'sqlite_stat1'").get().n, 0, 'control: no statistics, like production')
    const plan = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(sql.includes('@after') ? [{ after: 0, limit: 51 }] : [])).map(row => row.detail).join('\n')
    const pageSql = kind => lib.productDataGapPageSql(kind)
    const expectations = [
      ['unknown_cost page', plan(pageSql('unknown_cost')), ['idx_products_unknown_cost', 'idx_product_batches_unknown_cost', 'idx_damaged_lots_unknown_cost', 'idx_products_zero_cost', 'SEARCH p USING INTEGER PRIMARY KEY']],
      ['empty_barcode page', plan(pageSql('empty_barcode')), ['SEARCH p USING INDEX idx_products_empty_barcode (is_active=? AND id>?)']],
      ['placeholder_barcode page', plan(pageSql('placeholder_barcode')), ['SEARCH p USING INDEX idx_products_placeholder_barcode (is_active=? AND id>?)']],
      ['counts', plan(lib.productDataGapCountSql(true)), ['idx_products_unknown_cost', 'idx_products_empty_barcode', 'idx_products_placeholder_barcode', 'SEARCH p USING INTEGER PRIMARY KEY']],
    ]
    for (const [name, text, needles] of expectations) {
      for (const needle of needles) assert.ok(text.includes(needle), `${name} should use ${needle}:\n${text}`)
      assert.ok(!/SCAN p\b/.test(text), `${name} must not scan products:\n${text}`)
      assert.ok(!text.includes('idx_products_active_grouped_pg'), `${name} must not walk every active product:\n${text}`)
    }
    // Control: without the unary plus the planner DOES pick the wide index (the defect this pin exists for).
    const unplussed = pageSql('unknown_cost').replace('WHERE +p.is_active = 1', 'WHERE p.is_active = 1')
    assert.notEqual(unplussed, pageSql('unknown_cost'))
    assert.ok(plan(unplussed).includes('idx_products_active_grouped_pg'), 'control: the plain term walks the active-product index')
  })

  if (failed) throw new Error(failed + ' data-gap checks failed')
  console.log('product data gaps PASS')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
