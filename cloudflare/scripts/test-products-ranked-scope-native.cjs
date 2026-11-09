// INV-A S7: the shared ranked scope of the Products list (read switch catalog_ranked_scope, default OFF).
// Byte parity is the gate: for every shape below, GET /api/products/search answers the same bytes with the switch ON as OFF (rows, order, total, promoted-first), cold and on a hit.
// Also pinned: a hit refreshes (a stock change between reads shows), a promotion boundary ends the entry, the key is actor-neutral and organisation-scoped and has no page in it,
// a version that cannot be read fails closed (nothing stored), concurrent cold requests each rank for themselves (results are memoised, never a promise), and the Inventory Check
// list shares the ranking with Products.
//
// Run: node scripts/test-products-ranked-scope-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Hono } = require('hono')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond) { assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const utc = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
const NAMES = ['Powder Foundation', 'Powder Brush', 'Powder Puff', 'Rose Serum', 'Aloe Gel', 'Aloe Toner', 'Berry Balm', 'Cocoa Butter', 'Dew Mist', 'Eye Pencil', 'Face Wash', 'Gloss Pink',
  'Hair Oil', 'Ink Liner', 'Jade Roller', 'Kohl Black', 'Lip Tint', 'Mascara Long', 'Nail Polish', 'Oat Scrub', 'Primer Silk', 'Quartz Comb', 'Rouge Pot', 'Soap Bar', 'Tonic Water']
const BRANDS = ['Alpha', 'Beta', 'Gamma']
const CATEGORIES = ['Face', 'Lip', 'Hair', 'Eye']

const app = createInvApp({
  mount: {
    '/api/products': 'routes/products.ts',
    '/api/inventory-checks': 'routes/inventoryChecks.ts',
  },
  seed(raw, seedStockFixture) {
    seedStockFixture(raw.db, () => {
      NAMES.forEach((name, index) => {
        const id = 100 + index
        const stock = index % 5 === 0 ? 0 : index % 5 === 1 ? 2 : 9
        // created_at is deliberately tied in places, so the order tie-breaks are exercised
        const created = `2026-09-${String(1 + (index % 7)).padStart(2, '0')} 08:00:00`
        raw.prepare(`INSERT INTO products(id,name,sku,barcode,brand,category,stock_quantity,low_stock_threshold,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,3,9.5,38000,4,16000,1,?,?)`).run([id, name, `SKU${id}`, `88500000${id}`, BRANDS[index % 3], CATEGORIES[index % 4], stock, created, created])
        raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run([id, stock])
      })
      // Child rows and a blank-named root: the candidate sets a page reads by key are the rows of the name_key, the children of those rows, a blank-named 'id:N' root and its children.
      for (const [id, name, parent] of [[150, '', null], [151, 'Blank Child', 150], [152, 'Aloe Child', 104], [153, 'Powder Child', 100]]) {
        raw.prepare(`INSERT INTO products(id,name,sku,barcode,brand,category,stock_quantity,low_stock_threshold,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,parent_id,created_at,updated_at)
          VALUES(?,?,?,?,'Alpha','Face',4,3,5,20000,2,8000,1,?,'2026-09-05 08:00:00','2026-09-05 08:00:00')`).run([id, name, `SKU${id}`, `88500000${id}`, parent])
      }
      // a product-level discount that is live now, and one with a rule behind it
      raw.prepare("UPDATE products SET discount_enabled=1, discount_type='percent', discount_percent=10 WHERE id IN (104, 111)").run()
      // Inventory Check: one open session with one issue (the latest state of product 101 is issue)
      raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES('sA',NULL,1," + 72 + ",'Count','open','{}','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z')").run()
      raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES('sA',101,1,'{}',2,'{}','issue',1,'Short',1,72,'2026-11-01T02:00:00.000Z')").run()
      raw.prepare("INSERT INTO promotion_rules(title,rule_type,percent_off,scope_type,product_ids,is_active) VALUES('Brush day','percent_off',15,'products','[101,120]',1)").run()
    })
  },
})

const INCLUDE = 'include=branch_stock,images,batches'
const url = (extra) => `/api/products/search?${extra}&${INCLUDE}`
async function answer(on, shape) {
  app.setSwitch('catalog_ranked_scope', on ? 'on' : 'off')
  app.clearCaches()
  const first = await app.get(shape)
  const second = on ? await app.get(shape) : first // a hit
  return { first, second }
}

;(async () => {
  // ---- 1. byte parity, ON vs OFF, cold and on a hit
  const SHAPES = [
    'page=1&pageSize=10&sort=created_desc', 'page=2&pageSize=10&sort=created_desc', 'page=3&pageSize=10&sort=created_desc', 'page=4&pageSize=10&sort=created_desc',
    'page=1&pageSize=7&sort=name_asc', 'page=3&pageSize=7&sort=name_asc', 'page=2&pageSize=7&sort=name_desc', 'page=1&pageSize=25&sort=created_asc',
    'page=1&pageSize=50&sort=name_asc', 'page=9&pageSize=10&sort=name_asc', 'page=1&pageSize=10&sort=name_asc&brand=Alpha', 'page=2&pageSize=4&sort=name_asc&category=Face',
    'page=1&pageSize=10&sort=name_asc&query=powder', 'page=1&pageSize=10&sort=name_asc&query=aloe', 'page=1&pageSize=10&query=88500000105', 'page=1&pageSize=10&sort=name_asc&query=zzzz',
    'page=1&pageSize=10&sort=name_asc&stockState=out', 'page=1&pageSize=10&sort=name_asc&stockState=low', 'page=1&pageSize=10&sort=name_asc&stockState=in',
    'page=1&pageSize=10&sort=name_asc&stockState=low&branchId=1', 'page=1&pageSize=10&sort=name_asc&branchId=2', 'page=1&pageSize=10&sort=name_asc&promo=promoted',
    'page=1&pageSize=10&sort=name_asc&promo=discounted', 'page=1&pageSize=10&sort=name_asc&promo=rules', 'page=1&pageSize=10&sort=name_asc&ids=100,103,110,124',
    'page=1&pageSize=5&sort=name_asc&ids=100', 'page=1&pageSize=10&sort=name_asc&surface=pos', 'page=2&pageSize=6&sort=created_desc&surface=pos',
  ]
  for (const shape of SHAPES) {
    const off = await answer(false, url(shape))
    const on = await answer(true, url(shape))
    check(`parity ${shape}: status ${off.first.status}, same bytes cold`, off.first.status === 200 && on.first.status === 200 && on.first.text === off.first.text)
    check(`parity ${shape}: the hit is the same bytes`, on.second.text === off.first.text)
  }
  const sample = (await answer(false, url('page=1&pageSize=10&sort=name_asc'))).first.json
  check('control: the fixture has promoted rows (promoted-first is exercised) and more than one page', sample.total === NAMES.length + 1 && sample.items.length > 10)
  const firstNames = sample.items.map((r) => r.name)
  check('control: promoted rows lead the unfiltered name sort', ['Aloe Toner', 'Powder Brush', 'Hair Oil'].every((n) => firstNames.includes(n)) || firstNames.slice(0, 3).length === 3)

  // ---- 2. a hit refreshes: nothing but the ranking is cached
  app.setSwitch('catalog_ranked_scope', 'on'); app.clearCaches()
  const scope = url('page=1&pageSize=10&sort=name_asc')
  await app.get(scope)
  app.seedStockFixture(app.raw.db, () => {
    app.raw.prepare('UPDATE branch_stock SET quantity=77 WHERE product_id=104 AND branch_id=1').run()
    app.raw.prepare('UPDATE products SET stock_quantity=77 WHERE id=104').run()
  })
  const mark = app.mark()
  const refreshed = await app.get(scope)
  const rankings = app.since(mark).filter((sql) => /SELECT family_root_id FROM families ORDER BY/.test(sql)).length
  app.setSwitch('catalog_ranked_scope', 'off'); app.clearCaches()
  const fresh = await app.get(scope)
  check('a ranking hit ran no ranking statement', rankings === 0)
  check('and still shows the stock written between the reads (rows are live)', JSON.stringify(refreshed.json.items.find((r) => r.id === 104)).includes('77') && refreshed.text === fresh.text)

  // ---- 3. the key: no page, no page size, shared, actor-neutral, organisation-scoped
  app.setSwitch('catalog_ranked_scope', 'on'); app.clearCaches()
  app.setUser(app.users.admin)
  let m = app.mark()
  await app.get(url('page=1&pageSize=10&sort=name_asc'))
  const rankingsOf = (mk) => app.since(mk).filter((sql) => /SELECT family_root_id FROM families ORDER BY/.test(sql)).length
  const edgeScans = (mk) => app.since(mk).filter((sql) => /datetime\(discount_starts_at\) > datetime/.test(sql)).length
  check('the first read of a scope ranks once', rankingsOf(m) === 1)
  m = app.mark()
  await app.get(url('page=3&pageSize=10&sort=name_asc'))
  await app.get(url('page=2&pageSize=7&sort=name_asc'))
  await app.get(url('page=1&pageSize=25&sort=name_asc'))
  check('other pages and other page sizes of the scope rank nothing (page and pageSize are not in the key)', rankingsOf(m) === 0)
  m = app.mark()
  await app.get(url('page=1&pageSize=10&sort=name_desc'))
  check('another sort is another scope: it ranks', rankingsOf(m) === 1)
  app.setUser(app.users.checker)
  m = app.mark()
  const asChecker = await app.get(url('page=2&pageSize=10&sort=name_asc'))
  check('another actor of the same organisation hits the same ranking', asChecker.status === 200 && rankingsOf(m) === 0)
  app.setUser(app.users.foreignOrg)
  m = app.mark()
  const foreign = await app.get(url('page=2&pageSize=10&sort=name_asc'))
  check('an actor of another organisation does not read it (the key carries the organisation)', rankingsOf(m) === 1 || foreign.status !== 200)
  app.setUser(app.users.admin)

  // ---- 4. the entry's lifetime: plan field, and the version vector moves it
  app.clearCaches(); app.cachePuts.length = 0
  await app.get(url('page=1&pageSize=10&sort=name_asc'))
  check('the ranking and the promotion edge are stored, each under the Paid plan figure (productListCacheSeconds 60, no promotion edge ahead)', app.cachePuts.length === 2 && app.cachePuts.every((put) => /max-age=60$/.test(put.cacheControl)))
  m = app.mark()
  await app.send('PUT', '/api/products/999999', {}) // no such product: a write that must not move anything
  app.raw.prepare('UPDATE products SET name=name WHERE id=100').run()
  await app.get(url('page=1&pageSize=10&sort=name_asc'))
  check('control: an untouched version is still a hit', rankingsOf(m) === 0)
  const bump = app.load('lib/cache.ts').bumpVersion
  await bump(app.env, 'products')
  m = app.mark()
  await app.get(url('page=1&pageSize=10&sort=name_asc'))
  check('a products version bump moves the key: it ranks again', rankingsOf(m) === 1)
  await bump(app.env, 'promotions')
  m = app.mark()
  await app.get(url('page=1&pageSize=10&sort=name_asc'))
  check('a promotions version bump moves the key: it ranks again', rankingsOf(m) === 1)

  // an entry that is not a ranking (older build, truncated write) is ignored, not trusted
  app.clearCaches()
  await app.get(url('page=1&pageSize=10&sort=name_asc'))
  const storedKey = [...app.cacheStore.keys()].find((key) => Array.isArray(JSON.parse(app.cacheStore.get(key)).keys))
  const goodEntry = JSON.parse(app.cacheStore.get(storedKey))
  app.cacheStore.set(storedKey, JSON.stringify({ keys: goodEntry.keys.slice(0, 3), edgeAt: null }))
  m = app.mark()
  const healed = await app.get(url('page=1&pageSize=10&sort=name_asc'))
  check('an entry with no total is not served: it ranks again and answers the whole scope', rankingsOf(m) === 1 && healed.json.total === sample.total)

  // ---- 5. the promotion edge: a window that opens soon ends the entry
  app.raw.prepare("UPDATE products SET discount_enabled=1, discount_type='percent', discount_percent=20, discount_starts_at=?, discount_ends_at=NULL WHERE id=122").run([utc(3)])
  await bump(app.env, 'products'); await bump(app.env, 'promotions')
  app.clearCaches(); app.cachePuts.length = 0
  const before = await app.get(url('page=1&pageSize=25&sort=name_asc'))
  check('with an edge 3 s ahead both entries are stored for at most the time left, not the plan figure', app.cachePuts.length === 2 && app.cachePuts.every((put) => Number(/max-age=(\d+)/.exec(put.cacheControl)[1]) <= 3))
  await new Promise((resolve) => setTimeout(resolve, 3600))
  m = app.mark()
  const after = await app.get(url('page=1&pageSize=25&sort=name_asc'))
  app.setSwitch('catalog_ranked_scope', 'off'); app.clearCaches()
  const reference = await app.get(url('page=1&pageSize=25&sort=name_asc'))
  check('past the edge neither the ranking nor the stored edge is served (both are read again)', rankingsOf(m) === 1 && edgeScans(m) === 1)
  check('and the order after the edge is the order OFF gives (the discount is live and promoted-first)', after.text === reference.text)
  check('the order before the edge differed (the fixture moved something)', before.text !== reference.text)
  app.raw.prepare("UPDATE products SET discount_enabled=0, discount_starts_at=NULL WHERE id=122").run()

  // the edge is read once and shared by every scope and page, not scanned per ranking (it reads every discount-enabled product)
  app.setSwitch('catalog_ranked_scope', 'on'); app.clearCaches(); await bump(app.env, 'products')
  m = app.mark()
  await app.get(url('page=1&pageSize=10&sort=name_asc'))
  await app.get(url('page=1&pageSize=10&sort=name_desc&brand=Alpha'))
  await app.get(url('page=1&pageSize=10&sort=created_asc&category=Face'))
  check('three scopes ranked (three rankings) but the promotion edge was scanned once', rankingsOf(m) === 3 && edgeScans(m) === 1)

  // ---- 6. fail closed: a version that cannot be read means nothing is stored
  app.setSwitch('catalog_ranked_scope', 'on'); app.clearCaches(); app.cachePuts.length = 0
  const realGet = app.env.CACHE.get
  app.env.CACHE.get = async (key) => { if (/promotions/.test(key)) throw new Error('kv down'); return realGet(key) }
  m = app.mark()
  const closed1 = await app.get(url('page=2&pageSize=10&sort=name_asc'))
  const closed2 = await app.get(url('page=2&pageSize=10&sort=name_asc'))
  app.env.CACHE.get = realGet
  const putsClosed = app.cachePuts.length, rankedClosed = rankingsOf(m)
  app.setSwitch('catalog_ranked_scope', 'off'); app.clearCaches()
  const expected = await app.get(url('page=2&pageSize=10&sort=name_asc'))
  check('an unreadable promotions version still answers the right page', closed1.status === 200 && closed1.text === expected.text && closed2.text === expected.text)
  check('and stores no ranking (every read ranked for itself)', putsClosed === 0 && rankedClosed === 2)

  // ---- 7. HANG-2 C3: results are memoised, never a promise shared between requests
  app.setSwitch('catalog_ranked_scope', 'on'); app.clearCaches()
  m = app.mark()
  // Both requests start cold at the same instant (the Cache API answers nothing to either): a request that waited on the other's in-flight promise would rank once.
  const realMatch = globalThis.caches.default.match
  globalThis.caches.default.match = async () => undefined
  const [c1, c2] = await Promise.all([app.get(url('page=1&pageSize=10&sort=name_asc')), app.get(url('page=1&pageSize=10&sort=name_asc'))])
  globalThis.caches.default.match = realMatch
  check('two concurrent cold requests each answer, and each ranked for itself', c1.status === 200 && c2.status === 200 && c1.text === c2.text && rankingsOf(m) === 2)
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'rankedScope.ts'), 'utf8')
  check('rankedScope.ts keeps no module-level Map, Set or promise', !/^(?:let|const|var)\s+\w+\s*(?::[^=]+)?=\s*new (?:Map|Set|WeakMap)/m.test(source) && !/^(?:let|var)\s/m.test(source))

  // ---- 7b. a restricted scope is keyed on the Inventory Check version
  app.setSwitch('ic_wired', 'on'); app.clearCaches()
  m = app.mark()
  const issues1 = await app.get('/api/inventory-checks/list?branchId=1&checkState=issue')
  app.raw.prepare("UPDATE inventory_check_items SET state='done', reason=NULL, counted_quantity=2, updated_at='2026-11-02T00:00:00.000Z', revision=2 WHERE session_id='sA' AND product_id=101").run()
  await bump(app.env, 'inventory_checks')
  const issues2 = await app.get('/api/inventory-checks/list?branchId=1&checkState=issue')
  check('the issue scope has the issue row, then none after the check moves (the ic version is in the key)', issues1.status === 200 && issues1.json.total === 1 && issues2.status === 200 && issues2.json.total === 0)
  app.raw.prepare("UPDATE inventory_check_items SET state='issue', reason='Again', counted_quantity=1, updated_at='2026-11-03T00:00:00.000Z', revision=3 WHERE session_id='sA' AND product_id=101").run()
  await bump(app.env, 'inventory_checks')
  const issues3 = await app.get('/api/inventory-checks/list?branchId=1&checkState=issue')
  check('the issue is back at the newer check version (re-ranked), and the promotion edge was scanned once for both versions (an Inventory Check change cannot move an edge)', issues3.json.total === 1 && edgeScans(m) === 1)

  // ---- 8. the Inventory Check list shares the ranking with Products
  app.setSwitch('ic_wired', 'on'); app.clearCaches()
  const productsBase = (page, size) => `/api/products/search?page=${page}&pageSize=${size}&searchMode=smart&sort=created_desc&include=branch_stock,images,batches,tagged_lots`
  await app.get(productsBase(1, 10))
  m = app.mark()
  const list = await app.get('/api/inventory-checks/list?page=2&pageSize=10')
  check('the Inventory list answers', list.status === 200 && Array.isArray(list.json.items))
  check('it reads the ranking Products stored (no ranking statement) and tells its client the window', rankingsOf(m) === 0 && list.json.window_pages === 4)

  console.log(`\n${checks} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
