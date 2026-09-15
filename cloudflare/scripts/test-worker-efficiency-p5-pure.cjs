// Efficiency sweep (lane p5/efficiency): D1/R2/KV round-trip reductions.
//
// One discriminating check per finding. Source-pin checks assert the exact
// shape (memoized probe, single db.batch, Promise.all fan-out) rather than
// just "the function runs"; the R1 and D2 checks are behavioral against a
// fake caches.default / fake bucket / fake db so a regression that silently
// reintroduces a second round trip fails loudly instead of just compiling.
//
// Run (from cloudflare/): node scripts/test-worker-efficiency-p5-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')

function readSrc(relPath) {
  return fs.readFileSync(path.join(srcRoot, relPath), 'utf8')
}

function loadTs(relPath, stubs = {}) {
  const filePath = path.join(srcRoot, relPath)
  const outputText = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const mod = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      mod.exports, require, mod, filePath, path.dirname(filePath),
    )
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

async function main() {
  // --- D4: shared PRAGMA table_info memoization (lib/schemaProbe.ts) ---
  {
    const { tableColumnSet, hasColumn, __resetSchemaProbeCacheForTests } = loadTs('lib/schemaProbe.ts')
    __resetSchemaProbeCacheForTests()
    let probes = 0
    const fakeDb = {
      prepare(sql) {
        return {
          all: async () => {
            assert.match(sql, /PRAGMA table_info/)
            probes += 1
            return [{ name: 'id' }, { name: 'money_precision_version' }]
          },
        }
      },
    }
    const first = await tableColumnSet(fakeDb, 'returns')
    const second = await tableColumnSet(fakeDb, 'returns')
    assert.equal(probes, 1, 'second tableColumnSet call for the same table must not re-issue PRAGMA table_info')
    assert.equal(first, second, 'memoized result must be the same cached Set instance')
    assert.equal(await hasColumn(fakeDb, 'returns', 'money_precision_version'), true)
    assert.equal(probes, 1, 'hasColumn must reuse the memoized set, not probe again')

    // Every hot PRAGMA table_info/sqlite_master probe callsite in the Worker
    // must go through this one helper -- not reimplement its own memoization
    // or fire a fresh PRAGMA per request.
    for (const relPath of ['routes/sales.ts', 'lib/salesAnalytics.ts', 'lib/productWrites.ts', 'routes/compat.ts']) {
      const source = readSrc(relPath)
      assert.match(source, /from ['"].*schemaProbe['"]/, `${relPath} must import the shared schemaProbe helper`)
    }
    // sales.ts must not have any raw ad-hoc `PRAGMA table_info` probe left
    // outside schemaProbe.ts itself (each occurrence must be inside a comment
    // or already routed through hasColumn/tableColumnSet).
    const salesSource = readSrc('routes/sales.ts')
    const rawPragmaCalls = [...salesSource.matchAll(/db\.prepare\(\s*['"`]PRAGMA table_info/g)]
    assert.equal(rawPragmaCalls.length, 0, 'sales.ts must not issue PRAGMA table_info directly anymore')
  }

  // --- D2: familyPagination COUNT + page SELECT combined into one db.batch() ---
  {
    const batchCalls = []
    const fakeDb = {
      async batch(statements) {
        batchCalls.push(statements)
        return statements.map((stmt) => {
          if (/COUNT\(\*\)/.test(stmt.sql)) return { results: [{ count: 1 }] }
          return { results: [{ id: 1, name: 'Widget' }] }
        })
      },
      prepare() {
        throw new Error('paginateProductFamilies must not fall back to prepare().get()/all() for its count/page reads')
      },
    }
    const { paginateProductFamilies } = loadTs('lib/familyPagination.ts')
    const result = await paginateProductFamilies({
      db: fakeDb,
      selectColumns: 'p.id, p.name',
      joinSql: '',
      whereSql: 'WHERE 1=1',
      params: {},
      page: 1,
      pageSize: 20,
      familyOrderSql: 'family_name ASC',
      intraFamilyOrderSql: 'id ASC',
    })
    assert.equal(batchCalls.length, 1, 'COUNT and the ranked page SELECT must go out as exactly ONE db.batch() call')
    assert.equal(batchCalls[0].length, 2, 'the single batch call must carry exactly two statements (count, page)')
    assert.equal(result.total, 1)
    assert.equal(result.items.length, 1)
  }

  // --- D5: GET /api/sales list runs itemRows/refundRows/recordsBySale concurrently ---
  {
    const source = readSrc('routes/sales.ts')
    const start = source.indexOf('const [itemsBySale, refundsBySale, recordsBySale] = await Promise.all([')
    assert.ok(start >= 0, 'the three independent sales-list read chains must be combined via one Promise.all')
  }

  // --- D1: products.ts loadLowStockConfig + promotion-rules query run concurrently ---
  {
    const source = readSrc('routes/products.ts')
    const start = source.indexOf('const [lowStockConfig, promotionRules] = await Promise.all([')
    assert.ok(start >= 0, 'loadLowStockConfig and the promotion-rules read must run via Promise.all, not sequential awaits')
  }

  // --- D3: products.ts fans out attachBranchStock/attachImageGallery/attachBatchCounts ---
  {
    const source = readSrc('routes/products.ts')
    const fanoutStart = source.indexOf('const [itemsWithBranchStock, itemsWithGallery] = await Promise.all([')
    assert.ok(fanoutStart >= 0, 'attachBranchStock/attachImageGallery/attachBatchCounts must fan out via Promise.all')
    const fanoutBlock = source.slice(fanoutStart, fanoutStart + 400)
    assert.match(fanoutBlock, /attachBranchStock\(/)
    assert.match(fanoutBlock, /attachImageGallery\(/)
    assert.match(fanoutBlock, /attachBatchCounts\(/)
    // Regression pin for the merge-clobbering bug: the merge must pick
    // attachBranchStock's stock_quantity/branch_stock explicitly, never a
    // full-object spread of attachImageGallery's result (which would carry a
    // stale copy of stock_quantity and silently overwrite the live value).
    const mergeStart = source.indexOf('const mergedItems = (expandedItems as Array<Record<string, unknown>>).map(')
    assert.ok(mergeStart >= 0, 'merge step for the fanned-out attach helpers must exist')
    const mergeBlock = source.slice(mergeStart, mergeStart + 500)
    assert.match(mergeBlock, /stock_quantity:\s*itemsWithBranchStock\[index\]\.stock_quantity/)
    assert.match(mergeBlock, /branch_stock:\s*itemsWithBranchStock\[index\]\.branch_stock/)
    assert.doesNotMatch(mergeBlock, /\.\.\.itemsWithGallery\[index\]/,
      'must not full-object-spread itemsWithGallery -- that reintroduces the stock_quantity clobbering bug')
  }

  // --- R1: /uploads/* read-through caches.default caching (behavioral) ---
  {
    const { serveObject } = loadTs('lib/r2.ts')
    const store = new Map()
    const fakeCache = {
      async match(request) { return store.get(request.url) ? store.get(request.url).clone() : undefined },
      async put(request, response) { store.set(request.url, response) },
    }
    global.caches = { default: fakeCache }
    try {
      let bucketGetCalls = 0
      const fakeBucket = {
        async get(key) {
          bucketGetCalls += 1
          return {
            body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() } }),
            httpEtag: '"abc123"',
            writeHttpMetadata(headers) { headers.set('content-type', 'image/png') },
          }
        },
      }
      const waitUntils = []
      const ctx = { waitUntil: (p) => waitUntils.push(p) }
      const request = new Request('https://example.com/uploads/foo.png')

      const first = await serveObject(fakeBucket, 'foo.png', request, ctx)
      assert.equal(first.status, 200)
      assert.equal(bucketGetCalls, 1, 'first request is a genuine R2 miss')
      await Promise.all(waitUntils)

      const second = await serveObject(fakeBucket, 'foo.png', request, ctx)
      assert.equal(second.status, 200)
      assert.equal(bucketGetCalls, 1, 'second request for the same URL must be served from caches.default -- bucket.get() must NOT be called again')

      // Private/uncached caller (no ctx, e.g. portal.ts's screenshot route)
      // must never touch caches.default at all, and must always re-read R2.
      const uncached = await serveObject(fakeBucket, 'foo.png', request)
      assert.equal(uncached.status, 200)
      assert.equal(bucketGetCalls, 2, 'a caller that omits ctx must always hit R2, never the shared cache')
    } finally {
      delete global.caches
    }

    // index.ts's public route must pass ctx through; portal.ts's staff-only
    // screenshot route must not.
    const indexSource = readSrc('index.ts')
    assert.match(indexSource, /serveObject\(c\.env\.ASSETS, key, c\.req\.raw, c\.executionCtx\)/,
      'the public /uploads/* route must pass executionCtx so responses are shared-cached')
    const portalSource = readSrc('routes/portal.ts')
    assert.match(portalSource, /serveObject\(c\.env\.ASSETS, key, c\.req\.raw\)\s*$/m,
      'the staff-only portal screenshot route must NOT pass ctx -- it must stay uncached')
  }

  // --- K1: bumpVersions batches D1 fallback upserts in one db.batch() call ---
  {
    const batchCalls = []
    const fakeEnv = {
      CACHE: {
        async get() { return null },
        async put() { throw new Error('KV unavailable') },
        async delete() {},
      },
      DB: {},
    }
    const { bumpVersions } = loadTs('lib/cache.ts', {
      './db': { getDb: () => ({ batch: async (statements) => { batchCalls.push(statements); return statements.map(() => ({})) } }) },
      './quotaGuard': { consumeQuota: async () => ({ zone: 'critical' }) },
    })
    await bumpVersions(fakeEnv, ['products', 'sales', 'returns'])
    assert.equal(batchCalls.length, 1, 'bumping several namespaces that all fall back to D1 must issue ONE db.batch() call')
    assert.equal(batchCalls[0].length, 3, 'the single batch call must carry one upsert per namespace')

    // Multi-namespace call sites must use bumpVersions, not one bumpVersion()
    // per namespace.
    for (const [relPath, pattern] of [
      ['routes/returns.ts', /bumpVersions\(c\.env, \['products', 'returns', 'sales'\]\)/],
      ['routes/system.ts', /bumpVersions\(c\.env, \['sales', 'products', 'audit_log'\]\)/],
      ['routes/sales.ts', /bumpVersions\(c\.env, \['sales', 'returns'\]\)/],
      ['routes/products.ts', /bumpVersions\(c\.env, \['products', 'settings'\]\)/],
    ]) {
      assert.match(readSrc(relPath), pattern, `${relPath} must call bumpVersions for its multi-namespace bump`)
    }
  }

  // --- F1: debug log poll interval raised from 3s to 15s ---
  {
    const serverPageSource = fs.readFileSync(
      path.join(cloudflareRoot, '..', 'frontend', 'src', 'components', 'server', 'ServerPage.tsx'),
      'utf8',
    )
    assert.match(serverPageSource, /setInterval\(fetchServerLog, 15000\)/,
      'the debug log poll must run every 15s, not every 3s')
    assert.doesNotMatch(serverPageSource, /setInterval\(fetchServerLog, 3000\)/)
  }

  console.log('PASS worker efficiency sweep: D4 schema-probe memoization, D2 familyPagination single batch, D5 sales-list fan-out, D1 products bootstrap fan-out, D3 attach-helper fan-out (with clobbering regression pin), R1 uploads read-through cache (with bucket.get() call-count proof and portal.ts non-cache pin), K1 bumpVersions batched D1 fallback, F1 15s debug-log poll interval')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
