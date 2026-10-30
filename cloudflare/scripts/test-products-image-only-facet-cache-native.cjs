// Actual image-only route/native D1/CacheAPI facet regression. Fixture auth only.
// Reuses the small schema/catalog from test-products-image-only-filters-native.cjs.
// Old source must pass value authority then fail repeat-facet SQL; no provider/whole-Free claim.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const sha = (value) => createHash('sha256').update(value).digest('hex')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

const BASE = { products_image_only: true }
const GRANT = (...names) => Object.fromEntries(names.map((name) => [`products_image_only_show_${name}`, true]))
const USERS = {
  denied: {},
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

const fixtureEntry = String.raw`
import { Hono } from 'hono';
import products from './src/routes/products';
const app = new Hono(); app.route('/api/products', products);
const facetSql = (sql) => /GROUP BY\s+lower\(trim\(p\.(?:brand|category)\)\)/i.test(sql);
const pathOf = (request) => new URL(typeof request === 'string' ? request : request.url).pathname;
export default { async fetch(request, env, ctx) {
  const fault = request.headers.get('x-fixture-fault') || '';
  const ledger = { facet_attempts: 0, facet_native_statements: 0, version_authority_failures: 0, native_calls: 0, sql: [], cache: [], writes: [], wait_failures: [] };
  const nativeCache = globalThis.caches.default;
  globalThis.__FACET_TEST_CACHES__ = { default: {
    async match(key, options) {
      ledger.cache.push({ method: 'match', path: pathOf(key) });
      if (fault === 'match') throw new Error('fixture CacheAPI match failure');
      if (fault === 'json') return new Response('{bad-json');
      if (fault === 'shape') return Response.json({ brands: ['wrong'], categories: [], items: [{ secret: true }] });
      return nativeCache.match(key, options);
    },
    async put(key, response) {
      ledger.cache.push({ method: 'put', path: pathOf(key) });
      ledger.writes.push({ path: pathOf(key), body: await response.clone().json(), control: response.headers.get('cache-control') });
      if (fault === 'put') throw new Error('fixture CacheAPI put failure');
      return nativeCache.put(key, response);
    },
  } };
  const raw = new WeakMap();
  const note = (sql, args, native = true) => {
    ledger.sql.push({ sql, args, native });
    if (native && facetSql(sql)) ledger.facet_native_statements++;
  };
  const statement = (target, sql, args = []) => {
    const proxy = new Proxy(target, { get(t, key) {
      if (key === 'bind') return (...values) => statement(t.bind(...values), sql, values);
      if (['all', 'first', 'run', 'raw'].includes(String(key))) return async (...values) => {
        if (key === 'all' && fault === 'versions' && /cache_versions/i.test(sql)) {
          ledger.version_authority_failures++; note(sql, args, false);
          throw new Error('fixture cache version authority failure before native dispatch');
        }
        ledger.native_calls++; note(sql, args); return t[key](...values);
      };
      const value = t[key]; return typeof value === 'function' ? value.bind(t) : value;
    } });
    raw.set(proxy, { target, sql, args }); return proxy;
  };
  const db = new Proxy(env.DB, { get(t, key) {
    if (key === 'prepare') return (sql) => statement(t.prepare(sql), sql);
    if (key === 'batch') return async (list) => {
      const values = list.map((item) => raw.get(item));
      if (values.some((item) => facetSql(item.sql))) {
        ledger.facet_attempts++;
        if (fault === 'producer') {
          values.forEach((item) => note(item.sql, item.args, false));
          throw new Error('fixture facet producer failure');
        }
      }
      ledger.native_calls++;
      values.forEach((item) => note(item.sql, item.args));
      return t.batch(values.map((item) => item.target));
    };
    const value = t[key]; return typeof value === 'function' ? value.bind(t) : value;
  } });
  const pending = [];
  const execution = { waitUntil(promise) { pending.push(Promise.resolve(promise)); ctx.waitUntil(promise); }, passThroughOnException() {} };
  const response = await app.fetch(request, { ...env, DB: db }, execution);
  const body = await response.text();
  const tasks = await Promise.allSettled(pending);
  ledger.wait_failures = tasks.filter((task) => task.status === 'rejected').map((task) => String(task.reason));
  return Response.json({ status: response.status, headers: Object.fromEntries(response.headers), body, ledger });
} };
`;
async function main() {
  const root = path.join(__dirname, '..')
  const sourcePath = path.join(root, 'src/routes/products.ts')
  const sourceBefore = sha(fs.readFileSync(sourcePath))
  const bundle = await build({
    stdin: { contents: fixtureEntry, resolveDir: root, loader: 'ts' },
    define: { caches: 'globalThis.__FACET_TEST_CACHES__' },
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

    const versionMigration = fs.readFileSync(path.join(root, 'migrations/0050_quota_usage_and_cache_versions.sql'), 'utf8');
    const versionSchema = versionMigration.match(/CREATE TABLE IF NOT EXISTS cache_versions \([\s\S]*?\n\);/)?.[0];
    assert.ok(versionSchema, 'actual cache_versions DDL');
    await db.prepare(versionSchema).run();
    let requests = 0;
    const summaries = [];
    const facetPath = '/api/products/image-only-facets-cache';
    async function call(user, query = '', fault = '', endpoint = 'search') {
      const response = await mf.dispatchFetch(`http://local/api/products/${endpoint}${query ? '?' + query : ''}`, {
        headers: { 'x-fixture-user': user, ...(fault ? { 'x-fixture-fault': fault } : {}) },
      });
      const outer = await response.json();
      let body; try { body = JSON.parse(outer.body); } catch { body = outer.body; }
      const result = { ...outer, body };
      requests++;
      assert.deepEqual(result.ledger.wait_failures, [], 'all fixture waitUntil tasks settle');
      for (const operation of result.ledger.cache) assert.equal(operation.path, facetPath, 'no image-only list response cache access');
      for (const write of result.ledger.writes) {
        assert.equal(write.path, facetPath);
        assert.equal(write.control, 'public, max-age=300');
        const keys = Object.keys(write.body).sort();
        assert.ok(keys.length > 0 && keys.every((key) => ['brands', 'categories'].includes(key)), 'facet cache stores no list/row/other fields');
        for (const values of Object.values(write.body)) assert.ok(Array.isArray(values) && values.every((value) => typeof value === 'string'));
      }
      summaries.push({ user, query, fault, endpoint, status: result.status, facet_attempts: result.ledger.facet_attempts,
        facet_native_statements: result.ledger.facet_native_statements, version_authority_failures: result.ledger.version_authority_failures, native_calls: result.ledger.native_calls });
      return result;
    }
    function ok(result) {
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.headers['cache-control'], 'private, no-store', 'actual list remains private/no-store');
      assert.ok(Array.isArray(result.body.items));
      return result;
    }
    function miss(result) {
      assert.equal(result.ledger.facet_attempts, 1, 'one real facet producer batch on a miss');
      assert.ok(result.ledger.facet_native_statements > 0, 'positive actual native facet SQL witness');
    }
    function hit(result, label) {
      assert.equal(result.ledger.facet_attempts, 0, label + ': cached metadata skips facet producer');
      assert.equal(result.ledger.facet_native_statements, 0, label + ': no repeated native facet GROUP BY');
      assert.ok(result.ledger.native_calls > 0, label + ': request still reaches native D1');
      assert.ok(result.ledger.cache.some((operation) => operation.method === 'match'), label + ': CacheAPI hit reached');
    }
    async function bump(namespace) {
      await db.prepare(`INSERT INTO cache_versions(namespace,version,updated_at) VALUES(?,1,CURRENT_TIMESTAMP)
        ON CONFLICT(namespace) DO UPDATE SET version=version+1,updated_at=CURRENT_TIMESTAMP`).bind(namespace).run();
    }
    const base = 'pageSize=2';
    const cold = ok(await call('io_all', base));
    assert.deepEqual(cold.body.facets, { brands: ['Acme', 'Beta', 'Delta'], categories: ['Hair', 'Makeup', 'Skin'] });
    assert.ok(cold.body.items.length > 0);
    miss(cold);
    console.log('PASS cold actual route/manual complete facet authority before reuse assertion');
    const same = ok(await call('io_all', base));
    assert.deepEqual(same.body, cold.body, 'complete ordered identical-query body');
    hit(same, 'repeat request'); // Old source must reach this intended RED after value authority.
    // Missing KV + empty D1 warmed a zero-version key above; ambiguous authority must not reuse it.
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM cache_versions').first()).n, 0);
    await db.prepare("UPDATE products SET brand='FreshVersionBrand' WHERE id=7").run();
    await bump('products');
    const noAuthority = ok(await call('io_all', base, 'versions'));
    assert.equal(noAuthority.ledger.version_authority_failures, 1, 'one injected pre-native version read failure');
    assert.ok(noAuthority.body.facets.brands.includes('FreshVersionBrand'), 'ambiguous version authority must expose newly committed brand');
    miss(noAuthority);
    assert.deepEqual(noAuthority.ledger.cache, [], 'failed version authority permits no cache read');
    assert.deepEqual(noAuthority.ledger.writes, [], 'failed version authority permits no cache write');
    await db.prepare('UPDATE products SET brand=NULL WHERE id=7').run(); await bump('products');
    const restoredAuthority = ok(await call('io_all', base)); miss(restoredAuthority);
    assert.deepEqual(restoredAuthority.body.facets, cold.body.facets, 'restore and rewarm before existing cohorts');
    const searched = ok(await call('io_all', 'pageSize=2&query=Bravo'));
    assert.deepEqual(searched.body.items.map((row) => row.id), [2]);
    assert.deepEqual(searched.body.facets, cold.body.facets); hit(searched, 'different search text');
    const page = ok(await call('io_all', 'pageSize=2&page=2&sort=name_desc'));
    assert.notDeepEqual(page.body.items.map((row) => row.id), cold.body.items.map((row) => row.id), 'fresh list page/order');
    assert.deepEqual(page.body.facets, cold.body.facets); hit(page, 'different page/sort');
    const skin = ok(await call('io_all', 'pageSize=2&category=Skin'));
    assert.deepEqual(skin.body.facets, { brands: ['Acme', 'Beta'], categories: ['Hair', 'Makeup', 'Skin'] }); miss(skin);
    hit(ok(await call('io_all', 'pageSize=2&category=Skin&query=Alpha')), 'structural cohort reuse');
    const earlyQuery = 'pageSize=2&startDate=2026-10-01&endDate=2026-10-05';
    const early = ok(await call('io_all', earlyQuery));
    assert.deepEqual(early.body.facets, { brands: ['Acme', 'Beta'], categories: ['Skin'] }); miss(early);
    assert.deepEqual(ok(await call('io_all', earlyQuery + '&page=2')).body.facets, early.body.facets);
    hit(ok(await call('io_all', earlyQuery + '&query=Bravo')), 'received cohort reuse');
    const stock = ok(await call('io_all', 'pageSize=2&stockState=healthy'));
    assert.deepEqual(stock.body.facets, { brands: ['Acme', 'Beta', 'Delta'], categories: ['Hair', 'Makeup', 'Skin'] }); miss(stock);
    const cat = ok(await call('io_cat', base));
    assert.deepEqual(Object.keys(cat.body.facets), ['categories']); miss(cat);
    assert.ok(cat.body.items.every((row) => !('brand' in row) && !('stock_quantity' in row)), 'warm broad grants cannot leak row fields');
    hit(ok(await call('io_cat', base)), 'same restricted grant');
    const none = ok(await call('io_none', base));
    assert.deepEqual(none.body.facets, {});
    assert.ok(none.body.items.every((row) => Object.keys(row).every((key) => BASE_FIELDS.includes(key))));
    assert.equal(none.ledger.facet_attempts, 0); assert.deepEqual(none.ledger.cache, [], 'no grant, no facet cache work');
    for (const [user, query, status, code] of [
      ['io_cat', 'brand=Acme', 403, 'image_only_filter_hidden'],
      ['io_none', 'category=Skin', 403, 'image_only_filter_hidden'],
      ['denied', '', 403, null],
    ]) {
      const result = await call(user, query); assert.equal(result.status, status);
      if (code) assert.equal(result.body.code, code);
      assert.equal(result.ledger.facet_attempts, 0); assert.deepEqual(result.ledger.cache, [], 'authorization/refusal precedes warmed cache');
    }
    const boot = ok(await call('io_all', base + '&metadata=0', '', 'bootstrap'));
    assert.deepEqual(boot.body.facets, cold.body.facets); hit(boot, 'bootstrap shares only facet metadata');
    assert.ok(!('filters' in boot.body));
    for (const namespace of ['products', 'stock', 'settings', 'promotions']) {
      hit(ok(await call('io_all', base)), namespace + ' before bump');
      await bump(namespace);
      const changed = ok(await call('io_all', base)); miss(changed);
      assert.deepEqual(changed.body.facets, cold.body.facets, namespace + ' invalidates even unchanged fixture vocabulary');
    }
    await db.prepare("UPDATE products SET brand='NewBrand' WHERE id=7").run(); await bump('products');
    const productChanged = ok(await call('io_all', base)); miss(productChanged);
    assert.ok(productChanged.body.facets.brands.includes('NewBrand'), 'product update visible after namespace change');
    const outQuery = base + '&stockState=out';
    const beforeStock = ok(await call('io_all', outQuery)); miss(beforeStock);
    assert.ok(!beforeStock.body.facets.brands.includes('NewBrand'));
    await db.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=7 AND branch_id=2').run(); await bump('stock');
    const afterStock = ok(await call('io_all', outQuery)); miss(afterStock);
    assert.ok(afterStock.body.facets.brands.includes('NewBrand'), 'stock-filter facet cohort changes after stock version');
    const authority = ok(await call('io_all', base));
    for (const fault of ['match', 'json', 'shape']) {
      const fresh = ok(await call('io_all', base, fault)); miss(fresh);
      assert.deepEqual(fresh.body.facets, authority.body.facets, fault + ' falls back to one fresh producer');
    }
    await bump('products');
    const putFailure = ok(await call('io_all', base, 'put')); miss(putFailure);
    assert.equal(putFailure.ledger.writes.length, 1); assert.deepEqual(putFailure.body.facets, authority.body.facets);
    miss(ok(await call('io_all', base))); // Failed put must not create an entry.
    await bump('products');
    const producerFailure = await call('io_all', base, 'producer');
    assert.equal(producerFailure.status, 500);
    assert.equal(producerFailure.ledger.facet_attempts, 1, 'producer failure is not retried by cache fallback');
    assert.equal(producerFailure.ledger.facet_native_statements, 0, 'injected producer refusal occurs before native dispatch');
    assert.deepEqual(producerFailure.ledger.writes, [], 'producer failure is never cached');
    miss(ok(await call('io_all', base)));
    assert.equal(sha(fs.readFileSync(sourcePath)), sourceBefore, 'actual route source unchanged')
    console.log(JSON.stringify({ status: 'PASS', requests, cases: summaries, source_sha256: sourceBefore,
      test_sha256: sha(fs.readFileSync(__filename)), fixture_worker_sha256: sha(fixtureEntry), node: process.version,
      scope: 'Actual mounted route/native fixture D1/real CacheAPI forwarded by test observer; fixture auth, manual facet/body/redaction, cache versions and fault controls. Not full app auth, provider cache hit rate, D1 daily or Free certification.' }));
  } finally {
    await mf.dispose();
    console.log('PASS fixture Miniflare disposed');
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 });
