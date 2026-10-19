// Image-only Products reads (6.0.854): received-date + stock + category/brand filters,
// grant enforcement, no shared-cache leak, vocabulary projection. Mounted route
// (routes/products.ts) over native Miniflare D1 + KV; only authentication is a
// fixture (it picks the permission set from an `x-fixture-user` header).
//
// Negative controls N1, N2, N3, N5, N6 and P1/P2/P4/P5/P6/P8/P9 fail on the
// pre-854 code (it applied every filter without a grant check, answered
// image-only users from the shared cache and returned the full vocabulary).
// N4 changed by owner ruling 19 Oct: barcode search stays ALLOWED for image-only
// users; only the barcode COLUMN is hidden without its grant.
//
// Run (from cloudflare/): node scripts/test-products-image-only-filters-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const ts = require('typescript')

// The real predicate builder (it has no imports), so the plan check below runs the exact SQL the route runs.
function loadReceivedWindow() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'productImageOnlyQuery.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file })
  const mod = { exports: {} }
  new Function('exports', 'module', outputText)(mod.exports, mod)
  return mod.exports.pushReceivedWindow
}

const BASE = { products_image_only: true }
const GRANT = (...names) => Object.fromEntries(names.map((name) => [`products_image_only_show_${name}`, true]))
const USERS = {
  full: { all: true },
  pos: { pos: true },
  io_none: BASE,
  io_all: { ...BASE, ...GRANT('price', 'barcode', 'category', 'brand', 'stock', 'branch_stock', 'batches') },
  io_stock: { ...BASE, ...GRANT('stock') },
  io_batches: { ...BASE, ...GRANT('batches') },
  io_cat: { ...BASE, ...GRANT('category') },
  io_brand: { ...BASE, ...GRANT('brand') },
  io_barcode: { ...BASE, ...GRANT('barcode') },
  io_branches: { ...BASE, ...GRANT('branch_stock') },
  io_pos: { ...BASE, pos: true },
}
const BASE_FIELDS = ['id', 'image_gallery', 'image_path', 'name', 'updated_at']

async function main() {
  const root = path.join(__dirname, '..')
  const bundle = await build({
    stdin: { contents: `import {Hono} from 'hono'; import products from './src/routes/products';
      const app=new Hono();app.route('/api/products',products);export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*', 'cloudflare:*'],
    plugins: [{ name: 'fixture-auth', setup(b) {
      b.onResolve({ filter: /lib\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const USERS=${JSON.stringify(USERS)};
        export const requireAuth=async(c,next)=>{const key=c.req.header('x-fixture-user')||'full';
        c.set('user',{id:7,username:key,permissions:JSON.stringify(USERS[key])});return next();};`, loader: 'ts' }))
    } }],
  })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], kvNamespaces: ['CACHE'] })
  try {
    const db = await mf.getD1Database('DB')
    const schema = fs.readFileSync(path.join(root, 'migrations/0001_init.sql'), 'utf8')
    for (const table of ['products', 'branches', 'branch_stock', 'product_images', 'product_batches', 'branch_batch_stock', 'settings']) {
      const sql = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0]
      assert.ok(sql, table)
      await db.prepare(sql).run()
    }
    const batchIndexes = [...schema.matchAll(/CREATE (?:UNIQUE )?INDEX idx_product_batches_\w+ ON product_batches[^;]+;/g)].map((m) => m[0])
    assert.ok(batchIndexes.length >= 2, 'migration 0001 product_batches indexes')
    const promotionTable = fs.readFileSync(path.join(root, 'migrations/0071_promotion_rules.sql'), 'utf8').match(/CREATE TABLE promotion_rules \([\s\S]*?\n\);/)?.[0]
    assert.ok(promotionTable)
    await db.batch([
      ...['name_key TEXT', 'cost_review_key TEXT', 'wholesale_price_usd REAL DEFAULT 0', 'wholesale_price_khr REAL DEFAULT 0',
        'auto_merged_count INTEGER DEFAULT 0', 'name_normalized TEXT', 'unit_normalized TEXT', 'brand_compact TEXT', 'categories TEXT', 'brands TEXT', 'tag_label TEXT', 'is_grouped_cached INTEGER DEFAULT 0']
        .map((column) => db.prepare(`ALTER TABLE products ADD COLUMN ${column}`)),
      db.prepare("ALTER TABLE branches ADD COLUMN role TEXT CHECK (role IS NULL OR role IN ('shop', 'warehouse'))"),
      db.prepare('CREATE INDEX idx_products_name_key_pg ON products(name_key)'),
      db.prepare('CREATE UNIQUE INDEX idx_branch_stock_product_branch_unique ON branch_stock(product_id,branch_id)'),
      ...batchIndexes.map((sql) => db.prepare(sql)),
      db.prepare(promotionTable),
      db.prepare("INSERT INTO branches(id,name,is_active,is_default,role) VALUES(2,'Shop',1,1,'shop'),(3,'Warehouse',1,0,NULL),(4,'Inactive',0,0,NULL)"),
    ])

    // id, name, barcode, category, brand, shop, warehouse, inactive-branch qty, active
    const products = [
      [1, 'Alpha Cream', 'B1', 'Skin', 'Acme', 20, 0, null, 1],
      [2, 'Bravo Serum', 'B2', 'Skin', 'Beta', 3, 0, null, 1],
      [3, 'Charlie Lip', 'B3', 'Makeup', 'Acme', 0, 0, null, 1],
      [4, 'Delta Mask', 'B4', 'Hair', 'Delta', 0, 0, 6, 1],      // stock only in an inactive branch
      [5, 'Echo Toner', 'B5', 'Skin', 'Acme', null, null, null, 1], // no ledger rows at all
      [6, 'Foxtrot Gel', 'B6', 'Makeup', 'Beta', 30, 0, null, 1],   // only an unreadable lot date ('garbage')
      [7, 'Golf Brush', 'B7', null, null, 8, 0, null, 1],
      [8, 'Hotel Gone', 'B8', 'Skin', 'Acme', 9, 0, null, 0],       // removed / merge loser
      [9, 'Alpha Cream', 'B9', 'Skin', 'Acme', 0, 0, null, 1],      // same-name sibling row, no lot
    ]
    for (const [id, name, barcode, category, brand, shop, warehouse, inactive, active] of products) {
      await db.prepare(`INSERT INTO products(id,name,name_key,barcode,category,brand,supplier,tag_label,unit,stock_quantity,low_stock_threshold,is_active)
        VALUES(?,?,?,?,?,?, 'SupplierX', 'TagX', 'pcs', 999, 5, ?)`).bind(id, name, name.toLowerCase(), barcode, category, brand, active).run()
      for (const [branch, qty] of [[2, shop], [3, warehouse], [4, inactive]]) if (qty != null) {
        await db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id, branch, qty).run()
      }
    }
    const lots = [[1, '2026-10-01'], [2, '2026-10-05'], [3, '2026-10-10T20:00:00Z'], [4, '2026-10-10'], [5, null], [6, 'garbage'], [7, '2026-09-30'], [8, '2026-10-05']]
    for (const [productId, receivedAt] of lots) {
      await db.prepare('INSERT INTO product_batches(variant_product_id,batch_key,received_at) VALUES(?,?,?)').bind(productId, `lot-${productId}`, receivedAt).run()
    }
    await db.prepare("INSERT INTO promotion_rules(title,rule_type,percent_off,scope_type,product_ids) VALUES('Fixture sale','percent_off',10,'products','[1]')").run()

    let nonce = 0
    async function call(user, endpoint, query = '', { fresh = true } = {}) {
      const glue = query ? `${query}&` : ''
      const url = `http://local/api/products/${endpoint}?${glue}${fresh && user === 'full' ? `nonce=${++nonce}` : ''}`.replace(/[?&]$/, '')
      const response = await mf.dispatchFetch(url, { headers: { 'x-fixture-user': user } })
      return { status: response.status, body: await response.json(), headers: response.headers }
    }
    const ids = (result) => result.body.items.map((row) => row.id).sort((a, b) => a - b)
    async function ok(user, endpoint, query) {
      const result = await call(user, endpoint, query)
      assert.equal(result.status, 200, `${user} ${endpoint}?${query} -> ${JSON.stringify(result.body)}`)
      return result
    }
    async function refused(user, endpoint, query, status, code, parameter) {
      const result = await call(user, endpoint, query)
      assert.equal(result.status, status, `${user} ${endpoint}?${query} -> ${JSON.stringify(result.body)}`)
      assert.equal(result.body.code, code, `${query}`)
      assert.equal(result.body.error, code)
      assert.equal(result.body.parameter, parameter, `${query}`)
    }

    const ACTIVE = [1, 2, 3, 4, 5, 6, 7, 9]
    const window = async (query, user = 'io_batches') => ids(await ok(user, 'search', `pageSize=100&${query}`))
    // SECTIONS=report keeps going after a failing section and prints one RED/GREEN line each, to show
    // which controls fail on the pre-854 code. Normally the first failure stops the run.
    const report = process.env.SECTIONS === 'report'
    let reds = 0
    async function section(name, body) {
      if (!report) return body()
      try { await body(); console.log('GREEN', name) } catch (error) { reds++; console.log('RED  ', name, '--', String(error.message).split(String.fromCharCode(10))[0].slice(0, 160)) }
    }

    await section("Response contract + N5 (no promotion_rules, no-store)", async () => {
    {
      const result = await ok('io_none', 'search', 'pageSize=100')
      assert.deepEqual(Object.keys(result.body).sort(), ['facets', 'items', 'page', 'pageSize', 'total', 'totalPages'], 'exact image-only response keys (no promotion_rules)')
      assert.equal(result.headers.get('cache-control'), 'private, no-store')
      assert.deepEqual(result.body.facets, {}, 'no category/brand grant -> no option lists')
      assert.deepEqual(ids(result), ACTIVE)
      for (const row of result.body.items) assert.ok(Object.keys(row).every((key) => BASE_FIELDS.includes(key)), `ungranted user sees base fields only: ${Object.keys(row)}`)
      assert.equal(result.body.total, ACTIVE.length - 1, 'total counts name families (Alpha Cream x2 = 1)')
    }
    // N5 control: the full user's payload carries the rules and the rule is live.
    {
      const full = await ok('full', 'search', 'pageSize=100')
      assert.equal(full.body.promotion_rules.length, 1, 'control: a full reader still receives promotion_rules')
      assert.ok('barcode' in full.body.items[0])
    }

    })
    await section("N1/N2: hidden filters are refused, not applied", async () => {
    await refused('io_none', 'search', 'stockState=out', 403, 'image_only_filter_hidden', 'stockState')
    await refused('io_none', 'search', 'stockState=bogus', 403, 'image_only_filter_hidden', 'stockState')
    await refused('io_none', 'search', 'category=Skin', 403, 'image_only_filter_hidden', 'category')
    await refused('io_none', 'search', 'brand=Acme', 403, 'image_only_filter_hidden', 'brand')
    await refused('io_none', 'search', 'startDate=2026-10-01', 403, 'image_only_filter_hidden', 'startDate')
    await refused('io_none', 'search', 'endDate=2026-10-01', 403, 'image_only_filter_hidden', 'endDate')
    await refused('io_stock', 'search', 'category=Skin', 403, 'image_only_filter_hidden', 'category')
    await refused('io_cat', 'search', 'brand=Acme', 403, 'image_only_filter_hidden', 'brand')
    await refused('io_cat', 'search', 'stockState=low', 403, 'image_only_filter_hidden', 'stockState')
    await refused('io_stock', 'search', 'startDate=2026-10-01', 403, 'image_only_filter_hidden', 'startDate')
    // "all" and empty values are the unfiltered state and need no grant.
    assert.deepEqual(ids(await ok('io_none', 'search', 'category=all&brand=&stockState=all')), ACTIVE)

    })
    await section("N3: filters the role can never use are a 400", async () => {
    for (const key of ['supplier=SupplierX', 'branchId=2', 'branch_id=2', 'promo=promoted', 'issueState=negative_stock', 'rankIds=1,2', 'ids=1,2',
      'tag_label=TagX', 'unit=pcs', 'initial=A', 'groupState=standalone', 'merged=auto', 'searchFields=name', 'stock_state=out',
      'money_precision_version=1', 'surface=products&include=cost', 'nonce=1']) {
      await refused('io_all', 'search', key.replace('surface=products&', ''), 400, 'image_only_filter_invalid', key.replace('surface=products&', '').split('=')[0])
    }
    // Grant order: an unknown key is rejected even when the request also carries a granted filter.
    await refused('io_all', 'search', 'stockState=low&supplier=SupplierX', 400, 'image_only_filter_invalid', 'supplier')
    // Value validation (with the grant present).
    await refused('io_all', 'search', 'stockState=positive', 400, 'image_only_filter_invalid', 'stockState')
    await refused('io_all', 'search', 'sort=created_desc', 400, 'image_only_filter_invalid', 'sort')
    await refused('io_all', 'search', 'page=abc', 400, 'image_only_filter_invalid', 'page')
    await refused('io_all', 'search', 'pageSize=-1', 400, 'image_only_filter_invalid', 'pageSize')

    })
    await section("P2: malformed / inverted dates", async () => {
    await refused('io_batches', 'search', 'startDate=2026-13-45', 400, 'image_only_filter_invalid', 'startDate')
    await refused('io_batches', 'search', 'endDate=10/10/2026', 400, 'image_only_filter_invalid', 'endDate')
    await refused('io_batches', 'search', 'startDate=2026-10-10&endDate=2026-10-01', 400, 'image_only_filter_invalid', 'endDate')

    })
    await section("N4 (changed): barcode search is allowed; the column stays hidden", async () => {
    {
      const hidden = await ok('io_none', 'search', 'query=B3')
      assert.deepEqual(ids(hidden), [3], 'an exact barcode finds the product for an image-only user without the barcode grant')
      assert.ok(!('barcode' in hidden.body.items[0]), 'the barcode column is still projected out')
      const granted = await ok('io_barcode', 'search', 'q=B3')
      assert.deepEqual(ids(granted), [3])
      assert.equal(granted.body.items[0].barcode, 'B3')
      assert.deepEqual(ids(await ok('io_none', 'search', 'search=B3')), [3], 'search alias works too')
    }

    })
    await section("P1/P3/P4 + sort: received window, unbounded = existing list, off-page facets", async () => {
    assert.deepEqual(await window('startDate=2026-10-01&endDate=2026-10-10'), [1, 2, 3, 4], 'inclusive both edges; undated lot (5), no lot (6), out-of-window lot (7) and the removed product (8) excluded')
    assert.deepEqual(await window('startDate=2026-10-02'), [2, 3, 4], 'open end')
    assert.deepEqual(await window('endDate=2026-10-04'), [1, 7], 'open start (lot of 7 is 2026-09-30)')
    assert.deepEqual(await window('startDate=2026-10-10&endDate=2026-10-10'), [3, 4], 'single day; the ISO-timestamp lot pins date() to 10-10')
    assert.deepEqual(await window('startDate=2026-10-11&endDate=2026-10-11'), [], 'no +7h Cambodia shift: 20:00Z on the 10th is not the 11th')
    assert.deepEqual(await window('startDate=2026-09-30&endDate=2026-09-30'), [7])
    // P3: no bounds -> exactly the existing list.
    {
      const unbounded = await ok('io_batches', 'search', 'pageSize=100')
      const full = await ok('full', 'search', 'pageSize=100')
      assert.deepEqual(ids(unbounded), ids(full))
      assert.equal(unbounded.body.total, full.body.total)
    }
    // P4: a match that is not on page 1 is counted and faceted.
    {
      const hair = await ok('io_all', 'search', 'pageSize=1&startDate=2026-10-10&endDate=2026-10-10&sort=name_desc')
      assert.equal(hair.body.total, 2, 'total is the whole window, not the page')
      assert.equal(hair.body.totalPages, 2)
      assert.deepEqual(hair.body.facets.categories, ['Hair', 'Makeup'], 'facets cover the window cohort, including the row on page 2')
      const second = await ok('io_all', 'search', 'pageSize=1&page=2&startDate=2026-10-10&endDate=2026-10-10&sort=name_desc')
      assert.deepEqual([...ids(hair), ...ids(second)].sort(), [3, 4])
    }
    // sort
    {
      const asc = (await ok('io_none', 'search', 'pageSize=100&sort=name_asc')).body.items.map((row) => row.name)
      const desc = (await ok('io_none', 'search', 'pageSize=100&sort=name_desc')).body.items.map((row) => row.name)
      assert.equal(asc[0], 'Alpha Cream'); assert.equal(desc[0], 'Golf Brush')
      assert.deepEqual(desc, [...asc].reverse(), 'name_desc is the exact reverse; the promoted Alpha Cream family does not lead')
    }

    })
    await section("P5: facets", async () => {
    {
      const skin = await ok('io_all', 'search', 'pageSize=100&category=Skin')
      assert.deepEqual(ids(skin), [1, 2, 5, 9])
      assert.deepEqual(skin.body.facets.categories, ['Hair', 'Makeup', 'Skin'], 'a facet keeps its own siblings')
      assert.deepEqual(skin.body.facets.brands, ['Acme', 'Beta'], 'the other facet narrows to the cohort')
      const early = await ok('io_all', 'search', 'pageSize=100&startDate=2026-10-01&endDate=2026-10-05')
      assert.deepEqual(early.body.facets.categories, ['Skin'], 'a category with no lot in the window is absent')
      assert.deepEqual(early.body.facets.brands, ['Acme', 'Beta'])
      const searched = await ok('io_all', 'search', 'pageSize=100&query=Bravo')
      assert.deepEqual(ids(searched), [2])
      assert.deepEqual(searched.body.facets.categories, ['Hair', 'Makeup', 'Skin'], 'option lists ignore the search text')
      const onlyCat = await ok('io_cat', 'search', 'pageSize=100')
      assert.deepEqual(Object.keys(onlyCat.body.facets), ['categories'], 'only granted fields are faceted')
      const onlyBrand = await ok('io_brand', 'search', 'pageSize=100&brand=Acme')
      assert.deepEqual(Object.keys(onlyBrand.body.facets), ['brands'])
      assert.deepEqual(onlyBrand.body.facets.brands, ['Acme', 'Beta', 'Delta'])
      assert.deepEqual(ids(onlyBrand), [1, 3, 5, 9])
      assert.ok(!('category' in onlyBrand.body.items[0]) && 'brand' in onlyBrand.body.items[0])
    }

    })
    await section("P6: stock states agree with the stock the user is shown", async () => {
    {
      const expected = { out: [3, 5, 9], in_stock: [1, 2, 4, 6, 7], low: [2], healthy: [1, 4, 6, 7] }
      for (const [state, want] of Object.entries(expected)) {
        const result = await ok('io_stock', 'search', `pageSize=100&stockState=${state}`)
        assert.deepEqual(ids(result), want, state)
        for (const row of result.body.items) {
          const quantity = row.stock_quantity
          assert.equal(typeof quantity, 'number')
          const holds = { out: quantity <= 0, in_stock: quantity > 0, low: quantity > 0 && quantity <= 5, healthy: quantity > 5 }[state]
          assert.ok(holds, `${state}: product ${row.id} shows ${quantity}`)
        }
      }
      const stock = Object.fromEntries((await ok('io_stock', 'search', 'pageSize=100')).body.items.map((row) => [row.id, row.stock_quantity]))
      assert.equal(stock[4], 6, 'inactive-branch stock counts in the total')
      assert.equal(stock[5], 0, 'a product with no ledger row reads 0')
      // Filters combine: stock x window x category.
      assert.deepEqual(ids(await ok('io_all', 'search', 'pageSize=100&stockState=healthy&startDate=2026-10-01&endDate=2026-10-10&category=Skin')), [1])
    }

    })
    await section("name families with a search term (existing behaviour, pinned)", async () => {
    {
      const family = await ok('io_batches', 'search', 'pageSize=100&query=Alpha&startDate=2026-10-01&endDate=2026-10-01')
      assert.deepEqual(ids(family), [1, 9], 'a search pulls in the same-name sibling row even outside the window (existing family behaviour)')
      assert.equal(family.body.total, 1)
    }

    })
    await section("P7: other readers never see the window", async () => {
    {
      const allTime = ids(await ok('full', 'search', 'pageSize=100'))
      assert.deepEqual(ids(await ok('full', 'search', 'pageSize=100&startDate=2026-10-11&endDate=2026-10-11')), allTime, 'full Products ignores received dates')
      assert.deepEqual(ids(await ok('pos', 'search', 'pageSize=100&surface=pos&startDate=2026-10-11&endDate=2026-10-11')), allTime, 'POS ignores received dates')
      assert.deepEqual(ids(await ok('full', 'search', 'pageSize=100&supplier=SupplierX&stockState=out&branchId=2')), [3, 4, 5, 9], 'full filters still apply (out at branch 2)')
      const posBootstrap = await ok('pos', 'bootstrap', 'pageSize=100&surface=pos')
      assert.equal(posBootstrap.body.promotion_rules.length, 1)
      assert.ok(posBootstrap.body.filters.suppliers.length > 0)
      const inPos = await ok('io_pos', 'search', 'pageSize=100&surface=pos&supplier=SupplierX')
      assert.ok('promotion_rules' in inPos.body && 'barcode' in inPos.body.items[0], 'an image-only user who also holds POS keeps the full POS read on the POS surface')
    }

    })
    await section("P8: cache isolation", async () => {
    {
      const same = 'query=B1&pageSize=20'
      const first = await call('io_none', 'search', same, { fresh: false })
      const full = await call('full', 'search', same, { fresh: false })
      const second = await call('full', 'search', same, { fresh: false })
      const after = await call('io_none', 'search', same, { fresh: false })
      assert.equal(first.status, 200); assert.equal(full.status, 200); assert.equal(second.status, 200); assert.equal(after.status, 200)
      assert.ok(!('barcode' in first.body.items[0]) && !('barcode' in after.body.items[0]))
      assert.equal(full.body.items[0].barcode, 'B1', 'the full user still gets barcode on the same URL')
      assert.equal(second.body.items[0].barcode, 'B1')
      assert.ok('promotion_rules' in second.body)
      assert.ok(!('promotion_rules' in after.body))
      assert.equal(after.headers.get('cache-control'), 'private, no-store')
    }

    })
    await section("P9: removed / merge-loser rows never appear", async () => {
    for (const user of ['io_batches', 'io_all']) {
      assert.ok(!ids(await ok(user, 'search', 'pageSize=100')).includes(8))
      assert.ok(!(await window('startDate=2026-10-05&endDate=2026-10-05', user)).includes(8))
    }

    })
    await section("N6: vocabulary and bootstrap", async () => {
    {
      const full = await ok('full', 'filters')
      assert.ok(full.body.suppliers.length && full.body.units.length && full.body.tags.length && full.body.categories.length && full.body.brands.length, 'control: full vocabulary')
      const none = await ok('io_none', 'filters', 'supplier=SupplierX&brand=Acme')
      assert.deepEqual(none.body, { brands: [], categories: [], units: [], suppliers: [], tags: [], promotions: [], initials: [] })
      const cat = await ok('io_cat', 'filters')
      assert.deepEqual(cat.body.categories, ['Hair', 'Makeup', 'Skin']); assert.deepEqual(cat.body.brands, [])
      const both = await ok('io_all', 'filters', 'category=Skin')
      assert.deepEqual(both.body.brands, ['Acme', 'Beta', 'Delta'], 'the vocabulary ignores narrowing parameters for image-only users')
      assert.deepEqual(both.body.suppliers, [])
      const withPos = await ok('io_pos', 'filters')
      assert.deepEqual(withPos.body.suppliers, ['SupplierX'], 'an image-only user who can also use POS keeps the POS vocabulary')

      const boot = await ok('io_none', 'bootstrap', 'pageSize=100')
      assert.ok(!('promotion_rules' in boot.body) && !('branches' in boot.body))
      assert.deepEqual(boot.body.filters, { brands: [], categories: [], units: [], suppliers: [], tags: [], promotions: [], initials: [] })
      assert.deepEqual(boot.body.initials, [])
      assert.equal(boot.headers.get('cache-control'), 'private, no-store')
      for (const row of boot.body.items) assert.ok(Object.keys(row).every((key) => BASE_FIELDS.includes(key)))
      await refused('io_none', 'bootstrap', 'supplier=SupplierX', 400, 'image_only_filter_invalid', 'supplier')
      await refused('io_none', 'bootstrap', 'stockState=out', 403, 'image_only_filter_hidden', 'stockState')
      const noMeta = await ok('io_all', 'bootstrap', 'pageSize=100&metadata=0')
      assert.ok(!('filters' in noMeta.body) && Array.isArray(noMeta.body.branches))
      const allBoot = await ok('io_all', 'bootstrap', 'pageSize=100&category=Skin')
      assert.deepEqual(allBoot.body.filters.categories, ['Hair', 'Makeup', 'Skin']); assert.deepEqual(allBoot.body.filters.brands, ['Acme', 'Beta'])
      assert.deepEqual(allBoot.body.branches.map((branch) => branch.id), [2, 3], 'active branches only')
      const branches = await ok('io_branches', 'bootstrap', 'pageSize=100')
      assert.deepEqual(branches.body.branches.map((branch) => branch.id), [2, 3])
      const fullBoot = await ok('full', 'bootstrap', 'pageSize=100')
      assert.ok(fullBoot.body.promotion_rules.length === 1 && fullBoot.body.filters.suppliers.length)
      // Per-branch stock follows its own grant.
      assert.ok('branch_stock' in (await ok('io_branches', 'search', 'pageSize=1')).body.items[0])
      assert.ok(!('branch_stock' in (await ok('io_stock', 'search', 'pageSize=1')).body.items[0]))
    }

    })
    await section("P10: the received predicate is indexed by product", async () => {
    {
      const where = ['p.is_active = 1']
      const params = {}
      loadReceivedWindow()(where, params, { receivedFrom: '2026-10-01', receivedTo: '2026-10-10' })
      assert.equal(where.length, 2)
      const plan = await db.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM products p WHERE ${where.join(' AND ')}`)
        .bind(params.receivedFrom, params.receivedBefore).all()
      assert.ok(plan.results.some((row) => /SEARCH receipt USING (?:COVERING )?INDEX idx_product_batches_\w+ \(variant_product_id=\?/.test(row.detail)), JSON.stringify(plan.results))
    }

    })
    if (report) { console.log(`${reds} red section(s)`); return }
    // Reads never write.
    assert.equal((await db.prepare('SELECT stock_quantity FROM products WHERE id = 1').first()).stock_quantity, 999)
    console.log('PASS native image-only products: grant-gated filters, received window, facets, stock states, cache isolation, vocabulary projection')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
