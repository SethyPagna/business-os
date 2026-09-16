// P9-perf (Sep 16 2026): readSalesReportSnapshot pages sales/sale_items/
// returns/return_items through reportKeysetRows, TWICE per report request
// (the intentional concurrent-write guard readSalesReportSnapshot's own
// header comment describes -- untouched by this change). Each page is one
// D1 round trip, and on the Free plan's per-invocation D1 query budget
// (~50, see planTier.ts's d1QueriesPerInvocation) a small page size turned
// a wide-range report into more D1 round trips than the budget allows.
// This is a regression guard, not a benchmark: it seeds the REAL migrated
// schema with enough sales/sale_items that the OLD 500-row page size would
// have needed >2x the D1 round trips the CURRENT page size needs, and
// fails loudly if REPORT_MONEY_PAGE_SIZE is ever shrunk back toward 500
// without that tradeoff being re-examined.
const assert = require('node:assert/strict')
const path = require('node:path')
const ts = require('typescript')
const fs = require('node:fs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function makeLoader() {
  const moduleCache = new Map()
  function load(rel, overrides = {}) {
    const cacheKey = rel
    if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    moduleCache.set(cacheKey, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`, overrides)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
  return load
}
const load = makeLoader()

const { REPORT_MONEY_PAGE_SIZE } = load('lib/reportMoneyPrecision.ts')
// Guard the direction of the tuning, not a specific pinned number: shrinking
// back toward the old 500 defeats the round-trip fix this file exists to
// pin, and a huge value risks D1's ~1MB per-query response ceiling.
assert.ok(REPORT_MONEY_PAGE_SIZE >= 1000 && REPORT_MONEY_PAGE_SIZE <= 4000,
  `REPORT_MONEY_PAGE_SIZE=${REPORT_MONEY_PAGE_SIZE} moved outside the reviewed 1000-4000 round-trip/response-size tradeoff band`)

const raw = openDb(loadAll())
raw.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
const insSale = raw.prepare(`INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,subtotal_usd,total_usd,created_at,
    money_precision_version,calculated_total_usd,rounding_adjustment_usd)
  VALUES(@id,@receipt,'completed',1,'Shop',9.5,9.5,@created_at,1,9.5,0)`)
const insItem = raw.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd,product_discount_usd)
  VALUES(@id,@sale_id,1,'Item',1,9.5,4,0)`)
const SALE_COUNT = 3000
let itemId = 1
for (let i = 1; i <= SALE_COUNT; i += 1) {
  insSale.run({ id: i, receipt: `R${i}`, created_at: '2026-06-01 00:00:00' })
  insItem.run({ id: itemId, sale_id: i }); itemId += 1
  insItem.run({ id: itemId, sale_id: i }); itemId += 1
}

function countQueries(saModule, env) {
  let queryCount = 0
  const wrapped = {
    prepare(sql) {
      const statement = raw.prepare(sql)
      return {
        all: (params) => { queryCount += 1; return statement.all(params) },
        get: (params) => { queryCount += 1; return statement.get(params) },
      }
    },
  }
  env.DB = wrapped
  return { run: (fn) => fn(), get count() { return queryCount } }
}

;(async () => {
  // Real (current) page size, through the normal module graph.
  const currentEnv = {}
  const currentCounter = countQueries(null, currentEnv)
  const currentSa = load('lib/salesAnalytics.ts', { './db': { getDb: () => currentEnv.DB } })
  await currentSa.getSalesTotals(currentEnv, { startDate: '2026-06-01', endDate: '2026-06-01' })
  const atCurrentPageSize = currentCounter.count

  // Positive control: the SAME code, with only REPORT_MONEY_PAGE_SIZE forced
  // back to the pre-fix 500, everything else (error classes, the exact-
  // decimal accumulator) taken from the real module untouched. A fresh
  // module-cache loader is required -- salesAnalytics.ts reads the
  // constant at call time via a plain top-level import, so this is the
  // only way to observe the pre-fix behaviour without duplicating logic.
  const oldLoad = makeLoader()
  const realPrecision = oldLoad('lib/reportMoneyPrecision.ts')
  const oldEnv = {}
  const oldCounter = countQueries(null, oldEnv)
  const oldSa = oldLoad('lib/salesAnalytics.ts', {
    './db': { getDb: () => oldEnv.DB },
    './reportMoneyPrecision': { ...realPrecision, REPORT_MONEY_PAGE_SIZE: 500 },
  })
  await oldSa.getSalesTotals(oldEnv, { startDate: '2026-06-01', endDate: '2026-06-01' })
  const atOldPageSize = oldCounter.count

  assert.ok(atCurrentPageSize < atOldPageSize,
    `expected fewer D1 round trips at PAGE_SIZE=${REPORT_MONEY_PAGE_SIZE} (${atCurrentPageSize}) than at the old 500 (${atOldPageSize})`)
  // Guard against the improvement quietly shrinking back to noise -- the
  // measured reduction should track the ~4x page-size increase, not just
  // be directionally positive.
  assert.ok(atOldPageSize / atCurrentPageSize >= 1.5,
    `expected a material round-trip reduction, got old=${atOldPageSize} current=${atCurrentPageSize}`)
  console.log(`PASS report money page size: PAGE_SIZE=${REPORT_MONEY_PAGE_SIZE}, queries current=${atCurrentPageSize} vs old(500)=${atOldPageSize}`)
})().catch((error) => { console.error(error); process.exit(1) })
