// Dashboard "view more" lists (SF-C): the three ranked lists reuse the rows the Dashboard card has just stored
// (src/lib/dashboardRankingsCache.ts) instead of re-reading the verified report snapshot (24 to 26 D1 statements
// at 4,200 sales). A stored row is only worth reading while it is the same ranking of the same data, so this test pins
// what the key must separate and what must never be a request fault:
//   * a hit returns the stored rows; a different KIND, range, branch or limit schema is a miss
//   * a bump of any of the four versions every sale, return, customer and product writer already bumps is a miss
//   * no Cache API, unreadable versions, a throwing match and a rejecting put all fall back to computing
//   * getVersionsWithFallback answers like getVersionWithFallback but spends at most ONE D1 statement for all
//     namespaces KV does not hold (the cache must not add four statements to the thing it removes)
//   * the route opens the cache BEFORE the snapshot read (a version read after it could name newer data than the rows)
//     and writes all three rankings; the list reads the cache first and computes only when nothing is stored
// Each rule is attacked with an in-memory mutant that must turn the test red.
//
// Run (from cloudflare/): node scripts/test-dashboard-rankings-cache-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const root = path.join(__dirname, '..')
let passed = 0
const ok = (name) => { passed += 1; console.log(`PASS ${name}`) }

function loadTs(relative, overrides, patches = []) {
  const file = path.resolve(root, relative)
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  for (const patch of patches) {
    assert.equal(text.split(patch.from).length - 1, 1, `mutant anchor must occur once: ${patch.from.slice(0, 70)}`)
    text = text.replace(patch.from, () => patch.to)
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(text, { loader: 'ts', format: 'cjs', target: 'es2022' }).code)((id) => {
    if (id in overrides) return overrides[id]
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

// A Workers-like cache: keyed by full URL, stores the body text.
function makeCache({ failMatch = false, failPut = false } = {}) {
  const store = new Map()
  return {
    store,
    async match(request) {
      if (failMatch) throw new Error('match failed')
      const body = store.get(request.url)
      return body == null ? undefined : new Response(body, { headers: { 'content-type': 'application/json' } })
    },
    async put(request, response) {
      if (failPut) throw new Error('put failed')
      store.set(request.url, await response.text())
    },
  }
}

// Env whose KV holds the given versions and whose D1 holds the rest; counts D1 statements.
function makeEnv({ kv = {}, d1 = {} } = {}) {
  const state = { kv: { ...kv }, d1: { ...d1 }, statements: 0 }
  const env = {
    CACHE: { get: async (key) => (key in state.kv ? String(state.kv[key]) : null) },
    __db: {
      prepare() {
        return {
          all: async ({ namespaces }) => {
            state.statements += 1
            return JSON.parse(namespaces).filter((namespace) => namespace in state.d1).map((namespace) => ({ namespace, version: state.d1[namespace] }))
          },
          get: async ({ namespace }) => (namespace in state.d1 ? { version: state.d1[namespace] } : null),
        }
      },
    },
  }
  return { env, state }
}

function load(patches = {}) {
  const cacheLib = loadTs('src/lib/cache.ts', {
    './db': { getDb: (env) => env.__db },
    './quotaGuard': { consumeQuota: async () => true },
  }, patches['src/lib/cache.ts'] || [])
  const lib = loadTs('src/lib/dashboardRankingsCache.ts', { './cache': cacheLib }, patches['src/lib/dashboardRankingsCache.ts'] || [])
  return { cacheLib, lib }
}

const URL_ = 'https://admin.example.test/api/dashboard/insights/top_products'
const FILTERS = { startDate: '2026-10-01', endDate: '2026-10-13', createdFrom: null, createdTo: null, branchId: 1 }
const ROWS = [{ product_id: 7, product_name: 'A', qty_sold: 3, revenue_usd: 1.2345 }, { product_id: 8, product_name: 'B', qty_sold: 1, revenue_usd: 0.0001 }]
const ALL_KV = { 'v2:sales': 5, 'v2:returns': 2, 'v2:customers': 9, 'v2:products': 4 }

async function behaviour(patches = {}) {
  const { lib } = load(patches)
  const cache = makeCache()
  const waits = []
  const ctx = (c = cache) => ({ requestUrl: URL_, waitUntil: (p) => waits.push(p), cache: c })
  const drain = async () => { await Promise.all(waits.splice(0)) }
  const { env, state } = makeEnv({ kv: ALL_KV })

  // miss, write, hit with the same rows
  let handle = await lib.openDashboardRankingsCache(env, ctx(), FILTERS)
  assert.ok(handle, 'a cache opens when the Cache API and the versions are there')
  assert.equal(await handle.read('top_products'), null, 'nothing stored: a miss')
  handle.write('top_products', ROWS)
  await drain()
  assert.deepEqual(await handle.read('top_products'), ROWS, 'what the card stored comes back unchanged, 4 places and all')
  handle = await lib.openDashboardRankingsCache(env, ctx(), FILTERS)
  assert.deepEqual(await handle.read('top_products'), ROWS, 'a later open reads the same rows')

  // the kind, the range and the branch are part of the key
  assert.equal(await handle.read('top_products_qty'), null, 'another ranking is not served from this one')
  assert.equal(await handle.read('top_customers'), null, 'customers are not served from products')
  for (const [name, filters] of [['branch', { ...FILTERS, branchId: 2 }], ['all branches', { ...FILTERS, branchId: null }], ['start date', { ...FILTERS, startDate: '2026-10-02' }],
    ['end date', { ...FILTERS, endDate: '2026-10-12' }], ['timed window', { ...FILTERS, createdFrom: '2026-10-01 08:00:00' }], ['timed window end', { ...FILTERS, createdTo: '2026-10-13 20:00:00' }]]) {
    const other = await lib.openDashboardRankingsCache(env, ctx(), filters)
    assert.equal(await other.read('top_products'), null, `another ${name} is a miss`)
  }

  // any of the four versions moving makes the stored rows unreachable
  for (const namespace of ['sales', 'returns', 'customers', 'products']) {
    const bumped = makeEnv({ kv: { ...ALL_KV, [`v2:${namespace}`]: 99 } })
    const after = await lib.openDashboardRankingsCache(bumped.env, ctx(), FILTERS)
    assert.equal(await after.read('top_products'), null, `a ${namespace} write makes the stored rows a miss`)
  }
  // the same versions, held by D1 instead of KV, key differently from KV (a source change must not collide)
  const viaD1 = makeEnv({ d1: { sales: 5, returns: 2, customers: 9, products: 4 } })
  const fromD1 = await lib.openDashboardRankingsCache(viaD1.env, ctx(), FILTERS)
  assert.equal(await fromD1.read('top_products'), null, 'versions read from D1 never collide with the same numbers from KV')
  assert.equal(viaD1.state.statements, 1, 'all four namespaces missing from KV cost ONE D1 statement')

  // never a request fault
  assert.equal(await lib.openDashboardRankingsCache(env, ctx(null), FILTERS), null, 'no Cache API: compute, store nothing')
  const throwing = { CACHE: { get: async () => { throw new Error('kv down') } }, __db: { prepare() { throw new Error('d1 down') } } }
  assert.equal(await lib.openDashboardRankingsCache(throwing, ctx(), FILTERS), null, 'unreadable versions: no safe key, so no cache')
  const badMatch = await lib.openDashboardRankingsCache(env, ctx(makeCache({ failMatch: true })), FILTERS)
  assert.equal(await badMatch.read('top_products'), null, 'a throwing match is a miss')
  const badPut = await lib.openDashboardRankingsCache(env, ctx(makeCache({ failPut: true })), FILTERS)
  badPut.write('top_products', ROWS)
  await drain()
  const corrupt = makeCache()
  const probe = await lib.openDashboardRankingsCache(env, ctx(corrupt), FILTERS)
  probe.write('top_products', ROWS)
  await drain()
  for (const key of [...corrupt.store.keys()]) corrupt.store.set(key, '{"rows":"not a list"}')
  assert.equal(await probe.read('top_products'), null, 'a stored body that is not a row list is a miss')
  void state
}

async function versionsBehaviour(patches = {}) {
  const { cacheLib } = load(patches)
  const names = ['sales', 'returns', 'customers', 'products']
  const allKv = makeEnv({ kv: ALL_KV })
  const kvTokens = await cacheLib.getVersionsWithFallback(allKv.env, names)
  assert.equal(allKv.state.statements, 0, 'versions KV holds cost no D1 statement')
  const mixed = makeEnv({ kv: { 'v2:sales': 5 }, d1: { returns: 2, customers: 9 } })
  const mixedTokens = await cacheLib.getVersionsWithFallback(mixed.env, names)
  assert.equal(mixed.state.statements, 1, 'three namespaces missing from KV are read with ONE D1 statement')
  assert.equal(new Set(mixedTokens).size, 4, 'four namespaces, four distinct tokens')
  // same answer, namespace by namespace, as the single-namespace reader
  for (const [index, namespace] of names.entries()) {
    const single = await cacheLib.getVersionWithFallback(mixed.env, namespace)
    assert.equal(mixedTokens[index], single, `${namespace}: the batched token equals the single-namespace token`)
  }
  assert.deepEqual(kvTokens.length, 4)
}

async function suite(patches = {}) {
  await behaviour(patches)
  await versionsBehaviour(patches)
}

const DRC = 'src/lib/dashboardRankingsCache.ts'
const CACHE = 'src/lib/cache.ts'

async function main() {
  await suite()
  ok('rankings cache: hit, kind, range, branch and all four versions separate keys; every failure mode computes instead of faulting')
  ok('getVersionsWithFallback: KV versions cost 0 statements, the rest ONE, and each token equals the single-namespace reader')

  // ---- route wiring (source shape) ----
  const compat = fs.readFileSync(path.join(root, 'src/routes/compat.ts'), 'utf8').replace(/\r\n/g, '\n')
  const body = (start) => {
    const at = compat.indexOf(start)
    assert.ok(at !== -1, `${start} found`)
    return compat.slice(at, compat.indexOf('\n}\n', at))
  }
  const analyticsBody = body('async function dashboardAnalytics(')
  const openAt = analyticsBody.indexOf('openDashboardRankingsCache(')
  const snapshotAt = analyticsBody.indexOf('getSalesTotalsAndPeriodSeries(')
  assert.ok(openAt !== -1 && snapshotAt !== -1 && openAt < snapshotAt, 'the cache (its versions) is opened BEFORE the snapshot is read')
  for (const kind of ['top_customers', 'top_products', 'top_products_qty']) {
    assert.ok(new RegExp(`rankingsCache\\?\\.write\\('${kind}'`).test(analyticsBody), `the card stores ${kind}`)
  }
  assert.ok(/getSalesTotalsAndPeriodSeries\([^)]*DASHBOARD_RANKING_ROWS\)/.test(analyticsBody), 'the card asks for the full stored depth')
  assert.ok(/\.slice\(0, DASHBOARD_TOP_ROWS\)/.test(analyticsBody), 'the card still shows only its top rows')
  const listBody = body('async function dashboardInsightList(')
  const readAt = listBody.indexOf('rankingsCache?.read(kind)')
  const computeAt = listBody.indexOf('dashboardRankingRows(')
  assert.ok(readAt !== -1 && computeAt !== -1 && readAt < computeAt, 'the list reads the stored rows before it computes')
  assert.ok(/if \(!rows\) \{[\s\S]*dashboardRankingRows\([\s\S]*rankingsCache\?\.write\(kind, rows\)/.test(listBody), 'with nothing stored the list computes one ranking and stores it')
  ok('route wiring: cache opened before the snapshot, three rankings stored, list reads then computes only on a miss')

  // ---- mutants ----
  const mutants = [
    ...['sales', 'returns', 'customers', 'products'].map((namespace) => ({ name: `key ignores the ${namespace} version`, patches: { [DRC]: [{ from: 'versions[index]]', to: `namespace === '${namespace}' ? '' : versions[index]]` }] } })),
    { name: 'key ignores the kind', patches: { [DRC]: [{ from: "['kind', kind], ", to: '' }] } },
    { name: 'key ignores the branch', patches: { [DRC]: [{ from: "['branchId', filters.branchId], ", to: '' }] } },
    { name: 'key ignores the end date', patches: { [DRC]: [{ from: "['endDate', filters.endDate], ", to: '' }] } },
    { name: 'key ignores the timed window', patches: { [DRC]: [{ from: "['createdFrom', filters.createdFrom], ['createdTo', filters.createdTo],", to: '' }] } },
    { name: 'a failing cache faults the request', patches: { [DRC]: [{ from: "      } catch {\n        return null\n      }\n    },\n    write", to: "      } catch (error) {\n        throw error\n      }\n    },\n    write" }] } },
    { name: 'unreadable versions still open a cache', patches: { [DRC]: [{ from: "  } catch {\n    return null\n  }\n  const keyFor", to: "  } catch {\n    versions = []\n  }\n  const keyFor" }] } },
    { name: 'a body that is not a row list is served', patches: { [DRC]: [{ from: 'return Array.isArray(body.rows) ? (body.rows as RankingRow[]) : null', to: 'return body.rows as RankingRow[]' }] } },
    { name: 'versions read one statement per namespace', patches: { [CACHE]: [{ from: 'const fromD1 = await readD1Versions(env, namespaces.filter((_, index) => fromKv[index] == null))',
      to: 'const fromD1 = new Map<string, number>(); for (const [index, namespace] of namespaces.entries()) { if (fromKv[index] == null) for (const [k, v] of await readD1Versions(env, [namespace])) fromD1.set(k, v) }' }] } },
    { name: 'D1 version collides with KV token', patches: { [CACHE]: [{ from: 'return d1 != null ? cacheVersionToken(\'d1\', d1) : cacheVersionToken(\'kv\', \'0\')', to: 'return d1 != null ? cacheVersionToken(\'kv\', d1) : cacheVersionToken(\'kv\', \'0\')' }] } },
  ]
  for (const mutant of mutants) {
    let red = true
    try { await suite(mutant.patches) } catch { red = false }
    assert.equal(red, false, `mutant "${mutant.name}" must turn the test red`)
    ok(`mutant (${mutant.name}) is caught`)
  }
  console.log(`GREEN dashboard rankings cache: ${passed} checks hold`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
