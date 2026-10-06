// G37 phase 2: D1 rows read per product search, measured by the REAL local D1
// (workerd, the same engine and meta.rows_read accounting as production) running
// the REAL routes/products.ts, inventory.ts and branches.ts bundled into a
// Worker, over a 6,200-row catalog with every migration applied.
//
// The design measured 25-60k rows read per multi-word search on the legacy
// clause (every LIMIT 200/500 fallback subquery scans the table whenever it
// finds fewer hits than its LIMIT, and the unindexed barcode catch-all scans
// again). On Free (5M rows/day) that is 80-200 searches a day.
//
//   1. BASELINE: with no document written (the state right after the migration)
//      the same requests use the legacy clause; their rows read are recorded.
//      This is also the positive control: a budget that the legacy path meets
//      would prove nothing, so every budget below sits under what legacy costs.
//   2. BACKFILL: ops/scripts/backfill-search-doc.mjs's files are applied through
//      D1; rows WRITTEN per product are measured (the cost the lead is told).
//   3. BUDGET: the same requests on the stored document read a small fraction,
//      cold (vocabulary read) and warm; the plan of the page statement walks no
//      products table (EXPLAIN QUERY PLAN, same SQL and binds the route sent).
//   4. Results are the SAME rows as the legacy clause for every non-typo query
//      (a faster path that changes the answer is not a fix).
//
// Run (from cloudflare/): node scripts/test-product-search-rows-read-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const { buildCatalog } = require('./harness/search_catalog_fixture.cjs')
const searchMatch = require('./harness/load_search_match.cjs')

const root = path.resolve(__dirname, '..')
const SRC = path.join(root, 'src')
const catalog = buildCatalog()
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

// Worker-runtime seams the route tests also stub (see harness/load_products_route.cjs).
const STUBS = {
  'lib/auth': `module.exports = { requireAuth: async (c, next) => { c.set('user', ${JSON.stringify(ADMIN)}); return next() } }`,
  'lib/cache': `const pass = async (_r, _c, _v, _t, producer) => producer()
    module.exports = { cachedJsonResponse: pass, getVersion: async () => '0', getVersionWithFallback: async () => 1, bumpVersion: async () => {}, bumpVersions: async () => {} }`,
  'lib/rateLimit': `module.exports = { checkRateLimit: async () => ({ allowed: true, ok: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' }`,
  'lib/uploadSecurity': `module.exports = { validateUploadedBuffer: async () => ({ ok: true }) }`,
  'lib/imageAudit': `module.exports = { enqueueImageNormalization: async () => {} }`,
  'lib/reviewGate': `module.exports = { maybeQueueForReview: async () => null }`,
  'durable-objects/broadcastHub': `module.exports = { broadcast: async () => {} }`,
}

const ENTRY = `
  import products from ${JSON.stringify(path.join(SRC, 'routes', 'products.ts').replace(/\\/g, '/'))}
  import inventory from ${JSON.stringify(path.join(SRC, 'routes', 'inventory.ts').replace(/\\/g, '/'))}
  import branches from ${JSON.stringify(path.join(SRC, 'routes', 'branches.ts').replace(/\\/g, '/'))}
  import { resetProductSearchVocabCache } from ${JSON.stringify(path.join(SRC, 'lib', 'productSearchDocQuery.ts').replace(/\\/g, '/'))}
  const apps = { products, inventory, branches }
  const acc = { rows: 0, written: 0, calls: 0 }
  globalThis[Symbol.for('business-os.request-metrics.v1')] = {
    d1Call(_ms, metas) { acc.calls += 1; for (const m of metas || []) { acc.rows += Number(m?.rows_read || 0); acc.written += Number(m?.rows_written || 0) } },
    cache() {},
  }
  // Records every statement the route sends (sql + binds) so the test can EXPLAIN it.
  // Also keeps the rows each statement read, to name the expensive one.
  function recording(db, log, spent) {
    const note = (sql, result) => { spent.push({ sql: sql.replace(/s+/g, ' ').slice(0, 140), rows: Number(result?.meta?.rows_read || 0) }); return result }
    return {
      prepare(sql) {
        const s = db.prepare(sql)
        return { bind(...v) {
          log.push({ sql, values: v })
          const bound = s.bind(...v)
          return { __inner: bound, __sql: sql, all: async () => note(sql, await bound.all()), run: async () => note(sql, await bound.run()),
            first: (c) => bound.first(c), raw: (o) => bound.raw(o) }
        } }
      },
      async batch(items) { const results = await db.batch(items.map((item) => item.__inner || item)); results.forEach((r, i) => note(items[i].__sql || 'batch', r)); return results },
      exec: (q) => db.exec(q),
    }
  }
  export default {
    async fetch(request, env, ctx) {
      const url = new URL(request.url)
      if (url.pathname === '/__reset') { resetProductSearchVocabCache(); return Response.json({ ok: true }) }
      const [, which, ...rest] = url.pathname.split('/')
      const app = apps[which]
      acc.rows = 0; acc.written = 0; acc.calls = 0
      const log = []
      const spent = []
      const res = await app.fetch(new Request('http://x/' + rest.join('/') + url.search, request), { ...env, DB: recording(env.DB, log, spent) }, ctx)
      const body = await res.text()
      const headers = new Headers(res.headers)
      headers.set('x-rows-read', String(acc.rows)); headers.set('x-d1-calls', String(acc.calls))
      headers.set('x-spent', encodeURIComponent(JSON.stringify(spent.sort((a, b) => b.rows - a.rows).slice(0, 6).map((e) => ({ ...e, sql: String(e.sql).slice(0, 120) })))))
      headers.set('x-sql', encodeURIComponent(JSON.stringify(log.filter((e) => /products_search_fts/.test(e.sql)).slice(-3))))
      return new Response(body, { status: res.status, headers })
    },
  }
`

async function bundle() {
  const stubPlugin = {
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (args.namespace !== 'file' || !args.importer.startsWith(SRC.replace(/\//g, path.sep))) return null
        const rel = path.relative(SRC, path.resolve(args.resolveDir, args.path)).replace(/\\/g, '/').replace(/\.ts$/, '')
        return STUBS[rel] ? { path: rel, namespace: 'stub' } : null
      })
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }))
    },
  }
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022',
    mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:*'], plugins: [stubPlugin], logLevel: 'error',
  })
  return result.outputFiles[0].text
}

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

;(async () => {
  const script = await bundle()
  const mf = new Miniflare({ modules: true, script, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], log: new Log(LogLevel.ERROR) })
  const db = await mf.getD1Database('DB')
  try {
    for (const name of fs.readdirSync(path.join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        try { await db.prepare(sql).run() } catch (error) { throw new Error(`${name}: ${error.message}`) }
      }
    }
    await db.prepare("INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1)").run()

    // Seed without trg_products_ai_name_key (it re-counts the name group per insert), then restore it.
    const trigger = (await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_products_ai_name_key'").first()).sql
    await db.prepare('DROP TRIGGER trg_products_ai_name_key').run()
    const sizes = new Map()
    const keyOf = (row) => String(row.name).trim().toLowerCase()
    for (const row of catalog) sizes.set(keyOf(row), (sizes.get(keyOf(row)) || 0) + 1)
    const insert = db.prepare(`INSERT INTO products(id, name, brand, category, barcode, sku, name_key, is_grouped_cached, name_normalized,
      cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 5, 3, 1)`)
    for (let i = 0; i < catalog.length; i += 100) {
      await db.batch(catalog.slice(i, i + 100).map((row) => insert.bind(row.id, row.name, row.brand ?? null, row.category ?? null, row.barcode ?? null, row.sku ?? null,
        keyOf(row), sizes.get(keyOf(row)) > 1 ? 1 : 0, searchMatch.normalizeSearchText(row.name))))
    }
    await db.prepare(trigger).run()
    await db.prepare('INSERT INTO branch_stock(product_id, branch_id, quantity) SELECT id, 1, 3 FROM products').run()

    const get = async (urlPath) => {
      const res = await mf.dispatchFetch(`http://local${urlPath}`)
      const json = await res.json().catch(() => null)
      return { status: res.status, json, rows: Number(res.headers.get('x-rows-read')), calls: Number(res.headers.get('x-d1-calls')), sql: JSON.parse(decodeURIComponent(res.headers.get('x-sql') || '[]')), spent: JSON.parse(decodeURIComponent(res.headers.get('x-spent') || '[]')) }
    }
    const QUERIES = ['Blush Palette', 'Hourglass Blush pa', 'Hourglass Blush Palette Love', 'palette', 'SK-II', 'sk2', 'lipstik', 'blush pallet']
    // The legacy clause is expensive (50-90k rows each): only the queries the comparisons need.
    const LEGACY_QUERIES = ['Blush Palette', 'Hourglass Blush pa', 'Hourglass Blush Palette Love', 'palette']
    const url = (q) => `/products/search?query=${encodeURIComponent(q)}&pageSize=30`

    const legacy = {}
    const missingBefore = (await db.prepare('SELECT COUNT(*) n FROM products WHERE search_doc IS NULL AND is_active = 1').first()).n
    assert.equal(missingBefore, catalog.length, 'state after the migration: no document anywhere')
    await check('BASELINE: before the backfill every search uses the legacy clause (rows read recorded)', async () => {
      for (const q of LEGACY_QUERIES) {
        const res = await get(url(q))
        assert.equal(res.status, 200, JSON.stringify(res.json))
        legacy[q] = { rows: res.rows, names: new Set(res.json.items.map((item) => String(item.name).trim().toLowerCase())), total: res.json.total, first: res.json.items.slice(0, 3).map((i) => i.name) }
      }
      console.log('     legacy rows read:', Object.entries(legacy).map(([q, v]) => `${q}=${v.rows}`).join(', '), JSON.stringify(Object.entries(legacy).map(([q, v]) => [q, v.total, [...v.names]])))
      assert.ok(legacy['Blush Palette'].rows > 5000, `legacy "Blush Palette" reads ${legacy['Blush Palette'].rows} rows (the design measured 12,452 on 6,226 products)`)
      assert.ok(legacy['Hourglass Blush pa'].rows > legacy['Blush Palette'].rows, 'the short-word query scans more, as measured')
    })

    await check('BACKFILL: the ops script\'s files applied through D1; rows written per product measured', async () => {
      const rows = (await db.prepare('SELECT id, name, brand FROM products INDEXED BY idx_products_search_doc_missing WHERE search_doc IS NULL AND is_active = 1 ORDER BY id').all()).results
      assert.equal(rows.length, catalog.length)
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rows-read-'))
      fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{ results: rows }]))
      const run = spawnSync(process.execPath, [path.join(root, '..', 'ops', 'scripts', 'backfill-search-doc.mjs'), '--input', path.join(dir, 'rows.json'), '--out-dir', path.join(dir, 'plan')], { encoding: 'utf8' })
      assert.equal(run.status, 0, run.stderr)
      const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan', 'plan.json'), 'utf8'))
      let written = 0
      let read = 0
      let statements = 0
      for (const file of plan.files) {
        const sqls = fs.readFileSync(path.join(dir, 'plan', file.name), 'utf8').split('\n').filter(Boolean)
        for (let i = 0; i < sqls.length; i += 50) {
          const results = await db.batch(sqls.slice(i, i + 50).map((sql) => db.prepare(sql)))
          for (const result of results) { written += result.meta.rows_written; read += result.meta.rows_read; statements += 1 }
        }
      }
      fs.rmSync(dir, { recursive: true, force: true })
      const perProduct = written / catalog.length
      console.log(`     backfill: ${statements} updates, rows written ${written} (${perProduct.toFixed(1)} per product), rows read ${read}`)
      assert.equal(statements, catalog.length)
      assert.ok(perProduct < 16, `each product update writes ${perProduct.toFixed(1)} rows (plan said ~10)`)
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM products WHERE search_doc IS NULL AND is_active = 1').first()).n, 0)
      await db.prepare("INSERT INTO products_search_fts(products_search_fts, rank) VALUES('integrity-check', 1)").run()
    })

    const fresh = {}
    await check('BUDGET: the stored document reads a small fraction of the legacy rows, cold and warm', async () => {
      await get('/__reset')
      for (const q of QUERIES) {
        const cold = await get(url(q))
        const warm = await get(url(q))
        assert.equal(cold.status, 200, JSON.stringify(cold.json))
        if (warm.rows >= 1500 || cold.rows >= 2500) console.log(`     EXPENSIVE ${q}: cold ${cold.rows} warm ${warm.rows}`, JSON.stringify(warm.spent.slice(0, 4)))
        fresh[q] = { cold: cold.rows, warm: warm.rows, calls: warm.calls, names: new Set(warm.json.items.map((item) => String(item.name).trim().toLowerCase())), total: warm.json.total, first: warm.json.items[0] && warm.json.items[0].name, sql: warm.sql }
      }
      console.log('     new rows read (cold/warm):', Object.entries(fresh).map(([q, v]) => `${q}=${v.cold}/${v.warm}`).join(', '))
      // The targeted multi-word searches (a name being typed) are far below one
      // pass over the catalog (6,200 rows). A broad single word, a typo or the
      // SK-II spellings match 60-95 products and pay per MATCH (about 25 rows
      // each: the index entry, its length, the product, its family), so they
      // are bounded by the catalog pass, never by it.
      const TARGETED = ['Blush Palette', 'Hourglass Blush pa', 'Hourglass Blush Palette Love', 'blush pallet']
      for (const q of QUERIES) {
        if (TARGETED.includes(q)) {
          assert.ok(fresh[q].cold < 1500, `${q}: cold ${fresh[q].cold} rows read`)
          assert.ok(fresh[q].warm < 700, `${q}: warm ${fresh[q].warm} rows read`)
        } else {
          assert.ok(fresh[q].cold < 4000, `${q}: cold ${fresh[q].cold} rows read (broad query, per match)`)
          assert.ok(fresh[q].warm < 4000, `${q}: warm ${fresh[q].warm} rows read (broad query, per match)`)
        }
      }
      for (const q of ['Blush Palette', 'Hourglass Blush pa', 'Hourglass Blush Palette Love']) {
        assert.ok(fresh[q].warm * 25 < legacy[q].rows, `${q}: ${fresh[q].warm} vs legacy ${legacy[q].rows} (at least 25x fewer)`)
      }
    })

    await check('PLAN: the page statement reads the FTS and the matched rows, never the products table', async () => {
      const res = await get(url('Blush Palette'))
      const statements = res.sql.filter((entry) => /products_search_fts/.test(entry.sql))
      assert.ok(statements.length >= 1, 'the route sent the index statement')
      for (const entry of statements) {
        const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all()).results.map((row) => row.detail)
        const text = plan.join('\n')
        assert.ok(!/SCAN (p|products)\b(?! USING COVERING INDEX idx_products_search_doc_missing)/.test(text.replace(/SCAN (parent|listed)\b[^\n]*/g, '')), `no table scan:\n${text}`)
      }
    })

    await check('SAME ROWS: the stored document loses only rows the legacy clause matched on SOME of the words, and adds only rows reached through their BRAND; the target ranks first', async () => {
      const brandOf = new Map(catalog.map((row) => [String(row.name).trim().toLowerCase(), String(row.brand || '').toLowerCase()]))
      for (const q of ['Blush Palette', 'Hourglass Blush pa', 'Hourglass Blush Palette Love']) {
        assert.ok(legacy[q].total <= 30 && fresh[q].total <= 30, 'one page, so the sets are the whole answers')
        // The legacy clause is looser than "every word": it also returns rows that match only
        // some of the words (Hourglass Blush Palette Dragon for "...Palette Love"). The search the
        // pickers use (the shared core, AND over every word) never did, and the server now equals it.
        // So the rows the legacy clause found and this one drops must each lack one of the words.
        const words = q.toLowerCase().split(/s+/)
        const text = (name) => `${name} ${brandOf.get(name)}`
        const lost = [...legacy[q].names].filter((name) => !fresh[q].names.has(name))
        for (const name of lost) assert.ok(!words.every((word) => text(name).includes(word)), `${q}: "${name}" matches every word yet is lost`)
        for (const name of [...fresh[q].names].filter((candidate) => !legacy[q].names.has(candidate))) {
          assert.ok(words.some((word) => brandOf.get(name).includes(word)), `${q}: "${name}" is added only through its brand (brand is a search field, weight 0.8, as in the picker index)`)
        }
      }
      assert.equal(fresh['Hourglass Blush Palette Love'].first, 'Blush Palette Love', 'the typed target ranks first')
      for (const q of ['palette']) assert.ok(fresh[q].total >= legacy[q].total, `${q}: total ${fresh[q].total} vs legacy ${legacy[q].total}`)
    })

    await check('ENDPOINTS: inventory search and branch stock read as little as the products search', async () => {
      const inventory = await get(`/inventory/products/search?query=${encodeURIComponent('Hourglass Blush pa')}&pageSize=30&metadata=0`)
      const stock = await get(`/branches/1/stock?query=${encodeURIComponent('Hourglass Blush pa')}&pageSize=30&stockState=all`)
      console.log(`     inventory rows read ${inventory.rows}, branch stock ${stock.rows}`)
      assert.equal(inventory.status, 200, JSON.stringify(inventory.json))
      assert.equal(stock.status, 200, JSON.stringify(stock.json))
      if (stock.rows >= 1500) console.log('     EXPENSIVE branch stock', JSON.stringify(stock.spent.slice(0, 4)))
      assert.ok(inventory.rows < 1200, `inventory ${inventory.rows}`)
      assert.ok(stock.rows < 1500, `branch stock ${stock.rows}`)
    })
  } finally {
    await mf.dispose()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS test-product-search-rows-read-native')
  process.exit(failed ? 1 : 0)
})().catch((error) => { console.error(error); process.exit(1) })
