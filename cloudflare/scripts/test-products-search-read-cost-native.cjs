// D1 rows read by GET /api/products/search (and the products list), GET /api/products/search-index and the
// customer picker, on local workerd (D1's own meta.rows_read per statement, summed over the request), with every
// response pinned byte-for-byte to the output of the implementation before the read-cost lane (04ab054cb) on a
// production-shaped fixture: name families, parent-linked variants (one family under a BLANK-name parent), blank
// names, discounts, a live promotion rule, two branches, lots, galleries.
//
// GOLDEN[label] = [sha256 of the response body at 04ab054cb, rows read at 04ab054cb, ceiling for this code].
// A drift in any hash means rows, order, totals, stock or galleries changed. The ceilings are the measured rows
// of the new code plus 5 per cent, so a regression to the old three-walk statement (or to the index scan in
// search-index) fails here. PRINT_GOLDEN=1 prints [sha, rows] for the current code instead of asserting.
//
// Run: node scripts/test-products-search-read-cost-native.cjs   (about two minutes: it migrates a workerd D1)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { openWorld } = require('./harness/read-cost-world.cjs')
const { catalogFixture } = require('./harness/read-cost-fixture.cjs')
const P = 2000, CUSTOMERS = 3000
const sha = text => createHash('sha256').update(text).digest('hex')
const SEARCH = '/api/products/search'
const BATTERY = {
  'browse': `${SEARCH}?page=1&pageSize=20&surface=pos&sort=name_asc`,
  'browse_p3_50': `${SEARCH}?page=3&pageSize=50&surface=products&sort=name_asc`,
  'browse_past_end': `${SEARCH}?page=999&pageSize=20&surface=pos`,
  'created_desc': `${SEARCH}?page=2&pageSize=30&sort=created_desc`,
  'created_asc': `${SEARCH}?page=1&pageSize=25&sort=created_asc`,
  'name_desc': `${SEARCH}?page=1&pageSize=20&sort=name_desc`,
  'q_serum': `${SEARCH}?page=1&pageSize=20&surface=pos&query=serum`,
  'q_serum_p2': `${SEARCH}?page=2&pageSize=20&surface=pos&query=serum`,
  'q_multiword': `${SEARCH}?page=1&pageSize=20&surface=pos&query=product%20120%20powder`,
  'q_barcode': `${SEARCH}?page=1&pageSize=20&surface=pos&query=8850000001203`,
  'q_title_only': `${SEARCH}?page=1&pageSize=20&query=cream&searchFields=name`,
  'q_nothing': `${SEARCH}?page=1&pageSize=20&query=zzzzqqqq`,
  'q_page_past_end': `${SEARCH}?page=50&pageSize=20&query=serum`,
  'branch1_in_stock': `${SEARCH}?page=1&pageSize=20&branchId=1&stockState=in_stock`,
  'branch2_out': `${SEARCH}?page=1&pageSize=20&branchId=2&stockState=out`,
  'low_stock': `${SEARCH}?page=1&pageSize=20&stockState=low&sort=name_asc`,
  'brand_cat': `${SEARCH}?page=1&pageSize=20&brand=Brand3,Brand5&category=Cat3,Cat5`,
  'grouped': `${SEARCH}?page=1&pageSize=20&groupState=grouped`,
  'standalone': `${SEARCH}?page=1&pageSize=20&groupState=standalone`,
  'initial': `${SEARCH}?page=1&pageSize=20&initial=P`,
  'promoted': `${SEARCH}?page=1&pageSize=20&promo=promoted`,
  'discounted': `${SEARCH}?page=1&pageSize=20&promo=discounted`,
  'by_ids': `${SEARCH}?pageSize=5&ids=1003,1004,1011,1012`,
  'by_ids_none': `${SEARCH}?pageSize=5&ids=abc`,
  'rank_ids': `${SEARCH}?page=1&pageSize=60&surface=pos&query=serum&rankIds=1004,1008,1012,1016,1011,1051,1100,1104&rankTiers=01233333`,
  'q_child_sku': `${SEARCH}?page=1&pageSize=20&surface=pos&query=SKU-1011`,
  'q_blank_child': `${SEARCH}?page=1&pageSize=20&surface=pos&query=SKU-1006`,
  'include_lots': `${SEARCH}?page=1&pageSize=10&include=tagged_lots`,
  'list': '/api/products',
  'index_p0': '/api/products/search-index?page=0',
  'index_p1': '/api/products/search-index?page=1',
}

const GOLDEN = {
  browse: ['9615695cc6650b4514602463bb1449b92a092044d08f6dd17fc42d048591f470', 18452, 9710],
  browse_p3_50: ['c0fa848aacd54e44c30ff6d0a2b36b096c5c0ba8ab37ec783f71c75b64771a19', 18917, 10790],
  browse_past_end: ['ec04628d9bef8b3d6947c3d29b1cb56bf95b0368d84980d9c9fd13a45f1e62bb', 16062, 13170],
  created_desc: ['5a66778f129430ee36c15c668e2e47010975e771dc145ded3aa02d8b3ac94a1e', 18670, 10180],
  created_asc: ['15b2a8a288ef3cbc4db3b21536d4b0ad34135234dfa7c0c52a85e97ff554bf91', 18347, 9590],
  name_desc: ['667d32578b7dd654a1452f0d5d7502f55697a839a79a13dbf9c68e904aa50015', 18381, 9610],
  q_serum: ['2d0974061d40eb53e01a517725212f284831103cc6787666df3f64484873104b', 22071, 13730],
  q_serum_p2: ['2e251269fbe34488ed34b884ae487fb9921d4c8cfb4c2c1f35ded53d3ae301b2', 22059, 13700],
  q_multiword: ['854c57cf8e8d6f862d6d2ed1381d5676de914bbcf7134ee13afe37832c26f54e', 24741, 10910],
  q_barcode: ['936de0e211bdd96a5fb257cfa4316098194dc7aa97469caa7a259b5dced633b0', 8136, 2160],
  q_title_only: ['34718a4fab2177b11857424e1692f112f4c19d793f71c70eadcfb038e153215c', 10958, 4420],
  q_nothing: ['fe057055e890dbe518aa0da78e08378dcea953539f70223b09ea3d9e6649fdf6', 6123, 2140],
  q_page_past_end: ['82fae6ef43876da06661e601d7dc873028d9d71b173c8f264c48f267b0ad22b6', 19203, 17460],
  branch1_in_stock: ['07d2d9223c8239d4a317b5b3a317ef5de2d21be8a2fb7e1596ba2c959797b519', 22019, 10670],
  branch2_out: ['87f0c4b1a8cb4c8f5990c33e1becef39d8fe03f96e4ee8359903503cb84c3af1', 16787, 8380],
  low_stock: ['bdac6536b6196177e75c81923ea511e3625af431f88a4f7e84b4a9a9f7189b82', 34491, 13720],
  brand_cat: ['88000fd37c496fc94935d73d15b2671f399fe81a60073c87202dea6b4b3733fe', 18637, 7680],
  grouped: ['e99b1b908c46161a1b2ac7e3c453baba9c1e8bcaaf1daea8534a86a73281960b', 10568, 5380],
  standalone: ['71532408373d3f5b0865a1704551926389e010222382b69d8a06e04d1c54da71', 14489, 7640],
  initial: ['800e1960a957255afc01a71e7303885b2830296b21454ea5bad45898444ed286', 18437, 9700],
  promoted: ['47fab09e420d866a84c07c729594505a0de3d861af53441349efe91d5462b6b8', 8824, 4300],
  discounted: ['c94c7507de51995dd9ba370711789ed99e6a4058b14a8bd36050612e8f8338c9', 6582, 2890],
  by_ids: ['3019fb31ba7a8b71e10fcbb888ce09773a648f5ae10e73f6153db852c1b0a27e', 4098, 160],
  by_ids_none: ['ae286f60d56af8f483ef3339d811940971b8c42cb53ec4df046ea413f7d33245', 7, 10],
  rank_ids: ['a00847d5f4d4a6fffc5d7d99abb3946b93eac5aa9dc1b01a54e7c3d6f79c5413', 494, 590],
  q_child_sku: ['b1ff8c7441f12b0ad2583d6d8536603ca1904e4180b610d3b4a5d7d3b7347cf5', 16300, 6590],
  q_blank_child: ['a16ae90401a94e4969d40ba64b9b16d448fb255bf0c30553336da4c738acdecb', 16228, 6470],
  include_lots: ['087e32f99da54055bf6a783b886b6cdd52a4c0375e477b9138e1114198add60a', 18317, 9370],
  list: ['6ae039ac2de057cc3446b980776c34b95238c729c0f7b355a6a7d2019294c086', 19861, 12870],
  index_p0: ['8b8d3f9e92b8eed05d8dd7fc3a91734bb1ee0a6062fb9a9fa899d79f935ec2a2', 3009, 1060],
  index_p1: ['e1a7c3a85a565cf2790490b6a14b940e72655706d8492ae63287aca1a8935843', 3011, 1060],
}

const PRINT = Boolean(process.env.PRINT_GOLDEN)
const root = path.resolve(__dirname, '..')
const COUNT_ONLY = /SELECT COUNT\(\*\) AS count FROM families/

async function main() {
  const world = await openWorld(catalogFixture(P, CUSTOMERS))
  try {
    const out = {}
    let hit
    for (const [label, route] of Object.entries(BATTERY)) {
      const r = await world.call(route)
      assert.equal(r.status, 200, `${label}: status ${r.status} ${r.text.slice(0, 200)}`)
      out[label] = r
      // Immediately: the page cache lives 20 seconds and the battery takes longer than that.
      if (label === 'browse') hit = await world.call(route)
      if (PRINT) console.log(`  '${label}': ['${sha(r.text)}', ${r.rows}],`)
    }
    if (PRINT) return

    // 1. Byte-identical to 04ab054cb, and cheaper than the ceiling for every shape.
    let oldTotal = 0, newTotal = 0
    for (const label of Object.keys(BATTERY)) {
      const [hash, oldRows, ceiling] = GOLDEN[label]
      assert.equal(sha(out[label].text), hash, `${label}: response differs from the 04ab054cb output`)
      assert.ok(out[label].rows <= ceiling, `${label}: ${out[label].rows} rows read, ceiling ${ceiling} (was ${oldRows} at 04ab054cb)`)
      oldTotal += oldRows
      newTotal += out[label].rows
    }
    assert.ok(newTotal < oldTotal * 0.55, `battery reads ${newTotal} rows, was ${oldTotal}; expected under 55 per cent`)
    console.log(`PASS ${Object.keys(BATTERY).length} responses byte-identical to 04ab054cb; rows read ${oldTotal} -> ${newTotal} (${Math.round(100 * newTotal / oldTotal)} per cent)`)
    for (const label of ['browse', 'browse_p3_50', 'created_desc', 'q_serum', 'q_multiword', 'q_child_sku', 'branch1_in_stock', 'low_stock', 'list', 'index_p0'])
      console.log(`MEASURE ${label}: ${GOLDEN[label][1]} -> ${out[label].rows}`)

    // 2. Statement shape: page one is one family statement (the count rides the page), keyed row fetch present;
    // only a page past the end still counts separately.
    const familyStatements = log => log.filter(entry => /page_candidates|FROM families/.test(entry.sql))
    assert.equal(familyStatements(out.browse.log).length, 1, 'page 1 reads the families in ONE statement')
    assert.ok(/page_candidates/.test(familyStatements(out.browse.log)[0].sql), 'the page rows are fetched by key')
    assert.equal(out.browse.log.filter(entry => COUNT_ONLY.test(entry.sql)).length, 0, 'no separate COUNT on a page that has rows')
    assert.equal(out.browse_past_end.log.filter(entry => COUNT_ONLY.test(entry.sql)).length, 1, 'a page past the end still counts, once')
    assert.equal(JSON.parse(out.browse_past_end.text).total, JSON.parse(out.browse.text).total, 'past-end total equals the first page total')
    assert.equal(JSON.parse(out.q_nothing.text).total, 0, 'an empty first page means total 0 without a second statement')
    assert.equal(out.q_nothing.log.filter(entry => COUNT_ONLY.test(entry.sql)).length, 0)
    console.log('PASS one family statement per page; count only when the page is past the end')

    // 3. A cache hit does not re-run the page query and returns the same bytes.
    assert.equal(hit.text, out.browse.text, 'cache hit is byte-identical to the miss')
    assert.equal(familyStatements(hit.log).length, 0, 'cache hit does not run the family statement')
    assert.ok(hit.rows < 600, `cache hit read ${hit.rows} rows`)
    console.log(`PASS cache hit: ${hit.rows} rows (live rows and stock for the 20-row page only)`)

    // 4. search-index: a primary-key range, so a 1,000-id page reads about 1,000 rows, never the whole catalogue.
    for (const label of ['index_p0', 'index_p1']) assert.ok(out[label].rows <= 1100, `${label} read ${out[label].rows} rows`)
    const planned = await world.probeSql("EXPLAIN QUERY PLAN SELECT id, name, brand, category, barcode, sku FROM products WHERE id >= 1000 AND id < 3000 AND +products.is_active = 1 ORDER BY id")
    assert.ok(planned.results.some(row => /PRIMARY KEY \(rowid>\? AND rowid<\?\)/.test(row.detail)), 'the index page is a rowid range')
    const indexed = await world.probeSql('SELECT id, name, brand, category, barcode, sku FROM products WHERE id >= 1000 AND id < 3000 AND products.is_active = 1 ORDER BY id')
    const pinned = await world.probeSql('SELECT id, name, brand, category, barcode, sku FROM products WHERE id >= 1000 AND id < 3000 AND +products.is_active = 1 ORDER BY id')
    assert.equal(JSON.stringify(pinned.results), JSON.stringify(indexed.results), 'same rows, same order')
    assert.ok(indexed.rows > pinned.rows * 1.5, `the indexed predicate reads ${indexed.rows} rows, the pinned one ${pinned.rows}`)
    console.log(`PASS search-index page: pinned ${pinned.rows} rows vs ${indexed.rows} with the indexed predicate`)

    // 5. Customer picker (GET /api/customers?fields=sales_picker): no index serves ORDER BY lower(name), so every
    // call reads the table twice (scan + sort). The PROPOSED index (not a migration here) is checked on the lab
    // database: same bytes, a fraction of the rows.
    const picker = await world.call('/api/customers?fields=sales_picker')
    assert.equal(picker.status, 200)
    assert.ok(picker.rows >= CUSTOMERS * 2, `today the picker reads the table twice (${picker.rows} rows for ${CUSTOMERS} customers)`)
    await world.db.prepare('CREATE INDEX proposed_customers_lower_name_id ON customers (lower(name), id)').run()
    const indexedPicker = await world.call('/api/customers?fields=sales_picker')
    assert.equal(indexedPicker.text, picker.text, 'the proposed index changes no byte of the picker')
    assert.ok(indexedPicker.rows * 20 < picker.rows, `with the index the picker reads ${indexedPicker.rows} rows, not ${picker.rows}`)
    console.log(`MEASURE customers sales_picker, ${CUSTOMERS} customers: ${picker.rows} rows -> ${indexedPicker.rows} with CREATE INDEX (lower(name), id)`)
    console.log('PASS the proposed customers index is byte-identical and about 100x cheaper')

    // 6. Source guards.
    const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
    const products = read('src/routes/products.ts')
    assert.equal((products.match(/seekPage: true/g) || []).length, 1, 'only the product search opts in')
    assert.ok(/catalogProductSql\('products', false\)\} ORDER BY id/.test(products), 'search-index pins the primary-key range')
    for (const rel of ['src/routes/inventory.ts', 'src/routes/branches.ts', 'src/routes/portal.ts', 'src/lib/inventoryCheckProducts.ts'])
      assert.ok(!/seekPage/.test(read(rel)), `${rel} keeps the default pagination statements`)
    console.log('PASS source guards')
  } finally { await world.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
