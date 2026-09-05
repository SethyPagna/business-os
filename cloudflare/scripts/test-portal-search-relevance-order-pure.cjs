// THE ORDERING TEST for the PUBLIC STOREFRONT's product search.
//
// routes/portal.ts carried the LAST hand-copy of the product-search tail.
// products.ts, inventory.ts and branches.ts had already moved onto
// lib/productSearchQuery.ts; the storefront had not, so it kept both of the
// shapes that module exists to end:
//
//   1. its own buildFtsMatchExpression + short/partial-word fallbacks, with
//      no exact-barcode disjunct at all -- so a GTIN-14 scan could not reach
//      the EAN-13 twin this catalog also stores;
//   2. a hardcoded ORDER BY of
//        family_promoted DESC, match_rank ASC, family_sort_value ASC, family_name ASC
//      which put the PROMOTED key ABOVE relevance. bm25 is continuous, so
//      that made "discounted" the de-facto primary sort of every storefront
//      search -- a discounted product that merely shared a word with what the
//      shopper typed outranked the product they actually typed -- and it had
//      no discrete exact-barcode / exact-name / name-prefix tier at all.
//
// Both are the reported "it shows products not really matched, top to
// bottom", on the one search surface that reaches real customers.
//
// This file asserts the EXACT ORDER the shipped endpoint returns, by
// transpiling the REAL routes/portal.ts and calling the actual Hono
// app.request() against real SQLite with every real migration applied
// (node:sqlite via scripts/harness/d1compat.cjs -- the same FTS5 D1 runs).
// Nothing here re-implements the ranking: the ORDER BY under test is the one
// the route itself builds. Same technique as test-portal-catalog-sort-pure.cjs.
//
// The ordering contract, in this order:
//   tier 0  exact barcode (leading-zero folded: the GTIN-14/EAN-13 twins)
//   tier 1  exact name
//   tier 2  name prefix
//   tier 3  everything else
//   then    family_promoted DESC, but only WITHIN a tier (G1b)
//   then    match_rank ASC (bm25)
//   then    the storefront's own tail: family_sort_value (brand-first) and
//           family_name, plus the family_root_id terminal key
//           lib/familyPagination.ts appends for every caller.
//
// Probes: an exact barcode, a leading-zero GTIN twin, a name prefix, and a
// two-page query -- plus the no-search browse order, which must come back
// byte-identical to what it was before this change.
//
// NON-VACUITY. Every ordering assertion is paired with a CONTROL that runs
// the SAME matched rows through the ordering this endpoint used to hardcode
// (searchWithOldOrder below) and asserts that ordering answers a DIFFERENT,
// WRONG row. The fixture is built so that alphabet, brand order and
// "discounted leads" each point at a decoy and only the relevance tier points
// at the real hit; if a future edit ever made those agree, the control goes
// red and says so instead of the suite passing while proving nothing.
//
// Run from the cloudflare directory (NOT from scripts/):
//   node scripts/test-portal-search-relevance-order-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const db = openDb(loadAll())
const fakeEnv = { DB: db, ASSETS: null, CACHE: { get: async () => null, put: async () => {} } }

function transpile(relPath) {
  const sourcePath = path.join(root, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(root, 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

// Every module that decides an ORDER is the real one. Only the surrounding
// plumbing (auth, cache, uploads, sessions) is stubbed -- stubbing any of the
// four below would test the stub's idea of the ranking instead of the app's.
const searchMatch = loadReal('lib/searchMatch.ts')
const productSearchQuery = loadReal('lib/productSearchQuery.ts', { './searchMatch': searchMatch })
const familyPagination = loadReal('lib/familyPagination.ts')
const promotionRulesSql = loadReal('lib/promotionRulesSql.ts', { './promotionRules': loadReal('lib/promotionRules.ts') })

const { paginateProductFamilies } = familyPagination
const { loadActivePromotionRules, productPromotedSql } = promotionRulesSql
const { normalizeSearchText } = searchMatch

const portalRoute = loadReal('routes/portal.ts', {
  '../lib/requestBodyGuard': loadReal('lib/requestBodyGuard.ts'),
  '../lib/db': { getDb: () => db },
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/familyPagination': familyPagination,
  '../lib/searchMatch': searchMatch,
  '../lib/productSearchQuery': productSearchQuery,
  // Real, not a constant: the promoted key is half of what this file is
  // about (it must lead WITHIN a tier and never above one), so stubbing
  // productPromotedSql to '0' would delete the assertion.
  '../lib/promotionRulesSql': promotionRulesSql,
  '../lib/cache': {
    cachedJsonResponse: async (_req, _ctx, _version, _ttl, producer) => producer(),
    getVersionWithFallback: async () => '0',
  },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': { createPortalSession: async () => ({ token: '', expiresAt: '' }), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {}, getPortalAccount: async () => null },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), recordPortalFailure: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (v) => String(v || '').replace(/[^0-9]/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (name) => name },
  '../lib/media': { sanitizeMediaList: (list) => list },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), getPortalAiUsageStatus: () => ({}) },
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})

const app = portalRoute.default
const { buildPortalProductFilters } = portalRoute
const fakeExecutionCtx = { waitUntil: (p) => { if (p && p.catch) p.catch(() => {}) }, passThroughOnException: () => {} }

const portalSrc = fs.readFileSync(path.join(root, 'src', 'routes', 'portal.ts'), 'utf8')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error && error.message}`)
    console.log(`FAIL ${name}\n      ${error && error.message}`)
  }
}

// --- fixture -------------------------------------------------------------

// The scanned code and its zero-padded twin, the exact production shape: one
// product stored as the bare EAN-13 a scanner emits, its duplicate stored as
// the 14-character GTIN-14. Both must lead a scan of EITHER form.
const SCANNED = '3348901770569'
const TWIN = `0${SCANNED}`

// Every decoy is arranged so that the three orderings this endpoint could
// otherwise fall back on -- alphabet, brand-first, and "discounted leads" --
// each point at the WRONG row, and only the relevance tier points at the
// right one. 'Aaa Brand' sorts before 'Zeta Brand', so the storefront's own
// brand-first tail actively fights the correct answer on every probe below.
const PROMOTED = { discount_enabled: 1, discount_type: 'percent', discount_percent: 20 }
const PLAIN = { discount_enabled: 0, discount_type: null, discount_percent: null }
const FIXTURE = [
  // id, name, brand, barcode, sku, discount
  [101, 'Aaa Decoy Cleanser', 'Aaa Brand', '1111111111111', 'AAA-1', PLAIN],
  // Carries the scanned digits in its NAME, so an FTS name hit competes with
  // the row whose BARCODE actually is the code.
  [102, 'Aab Decoy Toner 3348901770569 In The Name', 'Aaa Brand', '2222222222222', 'AAB-1', PLAIN],
  // Carries the scanned digits as a barcode FRAGMENT, and is DISCOUNTED --
  // under the ordering this endpoint used to hardcode, this row led every
  // scan of the code above.
  [103, 'Aac Contains The Digits Somewhere', 'Aaa Brand', `99${SCANNED}`, 'AAC-1', PROMOTED],
  // The two barcode twins. Both sort LAST alphabetically and last by brand.
  [104, 'Zebra Backstage Highlighter', 'Zeta Brand', SCANNED, 'SCAN-1', PLAIN],
  [105, 'Zulu Backstage Highlighter', 'Zeta Brand', TWIN, 'SCAN-2', PLAIN],
  // The name probes: an exact-name hit, two prefix hits, one mid-name hit.
  [106, 'Matte', 'Zeta Brand', '9990001112221', 'MAT-EXACT', PLAIN],
  [107, 'Matte Lipstick', 'Zeta Brand', '9990001112222', 'MAT-P1', PLAIN],
  [108, 'Matte Lipstick Refill Pack', 'Zeta Brand', '9990001112223', 'MAT-P2', PLAIN],
  [109, 'Zzz Ultra Matte Finish Powder', 'Zeta Brand', '9990001112224', 'MAT-MID', PLAIN],
  // Sorts first alphabetically, first by brand, AND is discounted -- so all
  // three fallback orderings answer THIS row for "matte", and only the
  // relevance tier answers the lipstick.
  [110, 'Aaa Matte Cleanup Wipes', 'Aaa Brand', '3330001112225', 'AAA-3', PROMOTED],
]
// A block used only by the pagination probe. Inserted in an order that is
// neither alphabetical nor by id, so a page that merely echoed insertion
// order would fail.
const PAGEABLE_COUNT = 9
for (let i = 0; i < PAGEABLE_COUNT; i += 1) {
  const n = ((i * 7) % PAGEABLE_COUNT) + 1
  const pad = String(n).padStart(2, '0')
  FIXTURE.push([200 + i, `Pageable Product ${pad}`, 'Pageable Brand', `7770000000${pad}`, `PG-${n}`, PLAIN])
}

const raw = db.db
raw.exec("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)")
const insert = raw.prepare(`INSERT INTO products
  (id, name, sku, barcode, brand, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold,
   is_active, name_normalized, selling_price_usd, discount_enabled, discount_type, discount_percent)
  VALUES (?, ?, ?, ?, ?, '', 'pcs', 50, 10, 0, 1, ?, 10, ?, ?, ?)`)
const stock = raw.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 25)')
for (const [id, name, brand, barcode, sku, discount] of FIXTURE) {
  // name_normalized is written in JS by lib/productWrites.ts's insertRow in
  // production; use the REAL fold here so the tier comparison is honest.
  insert.run(id, name, sku, barcode, brand, normalizeSearchText(name),
    discount.discount_enabled, discount.discount_type, discount.discount_percent)
  stock.run(id)
}
// name_key is what FAMILY_ROOT_KEY_SQL groups on. Production maintains it by
// trigger (migration 0010); fill it in case the trigger did not fire here.
raw.exec("UPDATE products SET name_key = lower(trim(name)) WHERE COALESCE(name_key, '') = ''")

const seeded = raw.prepare('SELECT COUNT(*) AS n FROM products').get().n
assert.equal(seeded, FIXTURE.length, 'fixture must be fully seeded before any ordering assertion runs')

// --- the endpoint under test ---------------------------------------------

async function search(rawQuery, { page = 1, pageSize = 50 } = {}) {
  const qs = `q=${encodeURIComponent(rawQuery)}&page=${page}&pageSize=${pageSize}`
  const res = await app.request(`/catalog/products/search?${qs}`, { method: 'GET' }, fakeEnv, fakeExecutionCtx)
  assert.equal(res.status, 200, `search(${JSON.stringify(rawQuery)}) must answer 200`)
  const json = await res.json()
  return {
    names: (json.items || []).map((r) => String(r.name)),
    ids: (json.items || []).map((r) => Number(r.id)),
    total: json.total,
    totalPages: json.totalPages,
  }
}

// --- the CONTROL: the ordering this endpoint used to hardcode -------------
//
// Same rows, same filters, same shared pagination helper -- only the
// familyOrderSql differs, and it is the literal string routes/portal.ts
// carried before this change. That is what makes every assertion below
// demonstrably about the ORDERING and not about which rows got matched.
const brandSortKeyMatch = portalSrc.match(/const PORTAL_BRAND_SORT_KEY_SQL = "([^"]+)"/)
assert.ok(brandSortKeyMatch, 'PORTAL_BRAND_SORT_KEY_SQL must still be a double-quoted literal in routes/portal.ts')
const PORTAL_BRAND_SORT_KEY_SQL = brandSortKeyMatch[1]

async function searchWithOldOrder(rawQuery, { page = 1, pageSize = 50 } = {}) {
  const filters = buildPortalProductFilters({ q: rawQuery }, true, true)
  const params = filters.params
  const rules = await loadActivePromotionRules(db)
  const promotedRankSql = `CASE WHEN ${productPromotedSql(rules, params)} THEN 1 ELSE 0 END`
  const paged = await paginateProductFamilies({
    db,
    selectColumns: 'p.id, p.name, p.brand',
    joinSql: filters.joins.join('\n'),
    whereSql: `WHERE ${filters.where.join(' AND ')}`,
    params,
    page,
    pageSize,
    familyOrderSql: filters.matchRankSql
      ? 'family_promoted DESC, match_rank ASC, family_sort_value ASC, family_name ASC'
      : 'family_promoted DESC, family_sort_value ASC, family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    matchRankSql: filters.matchRankSql,
    promotedRankSql,
    familySortValueSql: PORTAL_BRAND_SORT_KEY_SQL,
  })
  return paged.items.map((r) => String(r.name))
}

async function main() {
  // 0. the control ---------------------------------------------------------
  await check('CONTROL: the ordering this endpoint used to hardcode answers the WRONG row', async () => {
    const scan = await searchWithOldOrder(SCANNED)
    assert.equal(scan[0], 'Aac Contains The Digits Somewhere',
      'promoted-first must answer a discounted decoy for a scan, or the assertions below prove nothing. '
      + `got: ${JSON.stringify(scan)}`)
    const name = await searchWithOldOrder('matte')
    assert.equal(name[0], 'Aaa Matte Cleanup Wipes',
      'promoted-first must answer a discounted decoy for a name search too. '
      + `got: ${JSON.stringify(name)}`)
  })

  // 1. exact barcode -------------------------------------------------------
  await check('an exact barcode scan puts that product FIRST, above a discounted near-match', async () => {
    const { names } = await search(SCANNED)
    assert.deepStrictEqual(names, [
      'Zebra Backstage Highlighter',               // tier 0, its barcode IS the code
      'Zulu Backstage Highlighter',                // tier 0, the GTIN-14 twin
      'Aac Contains The Digits Somewhere',         // tier 3, DISCOUNTED -> leads its tier
      'Aab Decoy Toner 3348901770569 In The Name', // tier 3
    ], `got: ${JSON.stringify(names)}`)
    // Stated as its own claim so a future fixture change cannot quietly turn
    // this into a filtering test: the decoys are IN the result set, and the
    // discounted one is still above its equally-relevant peer -- G1b holds
    // WITHIN a tier, which is exactly where it was always meant to hold.
    assert.ok(names.includes('Aac Contains The Digits Somewhere'),
      'the discounted decoy must be matched, not filtered out')
    assert.ok(
      names.indexOf('Aac Contains The Digits Somewhere') < names.indexOf('Aab Decoy Toner 3348901770569 In The Name'),
      'among equally relevant matches the discounted one must still lead',
    )
  })

  // 2. the leading-zero GTIN twin -----------------------------------------
  await check('a GTIN-14 scan finds BOTH twins and lets nothing else above them', async () => {
    const { names } = await search(TWIN)
    assert.deepStrictEqual(names, [
      'Zulu Backstage Highlighter',  // the row stored AS the GTIN-14
      'Zebra Backstage Highlighter', // the EAN-13 twin
    ], `got: ${JSON.stringify(names)}`)
    // The storefront could not reach the second row at all before this
    // change: FTS5 prefix-matches '03348901770569*', which never matches the
    // stored token '3348901770569', and the trigram table cannot help either
    // because the padded form is not a substring of the bare one. Only the
    // leading-zero-folded exact-barcode disjunct gets there.
  })

  // 3. name tiers: exact > prefix > the rest ------------------------------
  await check('an exact name outranks a prefix match, which outranks a discounted mid-name one', async () => {
    const { names } = await search('matte')
    assert.deepStrictEqual(names, [
      'Matte',                         // tier 1, exact name
      'Matte Lipstick',                // tier 2, prefix
      'Matte Lipstick Refill Pack',    // tier 2, prefix
      'Aaa Matte Cleanup Wipes',       // tier 3, DISCOUNTED -> leads its tier
      'Zzz Ultra Matte Finish Powder', // tier 3
    ], `got: ${JSON.stringify(names)}`)
  })

  await check('the name-prefix probe is about RANKING, not filtering: same rows, different order', async () => {
    const fixed = (await search('matte')).names
    const old = await searchWithOldOrder('matte')
    // Identical row sets. The only thing that changed is the order, so
    // nothing here can be explained by the WHERE clause matching differently.
    assert.deepStrictEqual([...fixed].sort(), [...old].sort(),
      `both orderings must match the same rows.\n  now: ${JSON.stringify(fixed)}\n  old: ${JSON.stringify(old)}`)
    assert.notDeepStrictEqual(fixed, old,
      'fixture is broken: the two orderings agree, so the assertions above prove nothing')
    assert.equal(fixed[0], 'Matte', 'the exact-name hit must lead now')
    assert.equal(old[0], 'Aaa Matte Cleanup Wipes', 'and the discounted decoy led before')
    // The typed prefix also beats the discounted decoy, which is the specific
    // complaint: a product that merely shares a word sat at the top.
    assert.ok(fixed.indexOf('Matte Lipstick') < fixed.indexOf('Aaa Matte Cleanup Wipes'),
      `a prefix hit must outrank a discounted mid-name hit. got: ${JSON.stringify(fixed)}`)
  })

  // 4. two pages -----------------------------------------------------------
  await check('page 2 CONTINUES page 1 exactly -- no repeated and no dropped family', async () => {
    const all = await search('pageable', { page: 1, pageSize: 50 })
    assert.equal(all.total, PAGEABLE_COUNT, `expected ${PAGEABLE_COUNT} families. got ${all.total}`)
    const size = 4
    const p1 = await search('pageable', { page: 1, pageSize: size })
    const p2 = await search('pageable', { page: 2, pageSize: size })
    const p3 = await search('pageable', { page: 3, pageSize: size })
    assert.deepStrictEqual(p1.names, [
      'Pageable Product 01', 'Pageable Product 02', 'Pageable Product 03', 'Pageable Product 04',
    ], `page 1 got: ${JSON.stringify(p1.names)}`)
    assert.deepStrictEqual(p2.names, [
      'Pageable Product 05', 'Pageable Product 06', 'Pageable Product 07', 'Pageable Product 08',
    ], `page 2 got: ${JSON.stringify(p2.names)}`)
    assert.deepStrictEqual(p3.names, ['Pageable Product 09'], `page 3 got: ${JSON.stringify(p3.names)}`)
    const stitched = [...p1.ids, ...p2.ids, ...p3.ids]
    assert.deepStrictEqual(stitched, all.ids,
      'paged reads must reproduce the single-page order exactly.'
      + `\n  paged:  ${JSON.stringify(stitched)}\n  single: ${JSON.stringify(all.ids)}`)
    assert.equal(new Set(stitched).size, stitched.length, `no id may appear on two pages. got ${JSON.stringify(stitched)}`)
    assert.equal(p1.total, all.total, 'the family total must not change with page size')
    assert.equal(p1.totalPages, 3, `9 families at 4 per page = 3 pages. got ${p1.totalPages}`)
  })

  await check('a barcode scan keeps its top row on page 1 at any page size', async () => {
    const { names } = await search(SCANNED, { page: 1, pageSize: 1 })
    assert.deepStrictEqual(names, ['Zebra Backstage Highlighter'],
      `the exact hit must be the single row a pageSize-1 read returns. got: ${JSON.stringify(names)}`)
  })

  // 5. the browse order must be untouched ---------------------------------
  await check('with NO search term the storefront browse order is exactly what it was', async () => {
    const res = await app.request('/catalog/products/search?page=1&pageSize=50', { method: 'GET' }, fakeEnv, fakeExecutionCtx)
    assert.equal(res.status, 200)
    const json = await res.json()
    const names = json.items.map((r) => String(r.name))
    // family_promoted DESC, then brand A-Z, then name A-Z: the two discounted
    // rows lead, and 'Aaa Brand' precedes 'Pageable Brand' precedes 'Zeta
    // Brand' inside each block. No tier, no rank -- nothing was typed.
    assert.deepStrictEqual(names.slice(0, 2), ['Aaa Matte Cleanup Wipes', 'Aac Contains The Digits Somewhere'],
      `promoted families must still lead the browse order. got: ${JSON.stringify(names.slice(0, 6))}`)
    assert.deepStrictEqual(names.slice(2, 5),
      ['Aaa Decoy Cleanser', 'Aab Decoy Toner 3348901770569 In The Name', 'Pageable Product 01'],
      `brand-first browse order must be unchanged. got: ${JSON.stringify(names.slice(0, 8))}`)
    assert.equal(names.length, FIXTURE.length, 'every seeded family must be browsable')
  })

  // 6. the ordering must be WIRED, not merely available --------------------
  await check('the storefront orders through the ONE shared relevance builder', async () => {
    assert.match(portalSrc, /buildFamilyRelevanceOrderSql\(/,
      'routes/portal.ts must order through the shared relevance builder')
    assert.match(portalSrc, /buildProductSearchQuery\(/,
      'routes/portal.ts must build its search tail through the shared module, not a fifth hand-copy')
    assert.match(portalSrc, /matchTierSql: filters\.matchTierSql/,
      'routes/portal.ts must pass the relevance tier to paginateProductFamilies')
    // Comment lines are stripped first: the comment above the ORDER BY quotes
    // the old string on purpose (it explains what was wrong with it), and a
    // check that cannot tell code from prose would either fire on that or
    // have to be weakened until it fires on nothing.
    const portalCode = portalSrc
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    assert.ok(!/'family_promoted DESC, match_rank ASC/.test(portalCode),
      'routes/portal.ts must not hardcode promoted-first ahead of the relevance tier again')
    assert.equal(
      productSearchQuery.buildFamilyRelevanceOrderSql(
        'family_sort_value ASC, family_name ASC',
        { hasTier: true, hasRank: true, promotedFirst: true },
      ),
      'match_tier ASC, family_promoted DESC, match_rank ASC, family_sort_value ASC, family_name ASC',
      'a discounted product must never outrank the product the shopper actually typed or scanned',
    )
    assert.equal(
      productSearchQuery.buildFamilyRelevanceOrderSql(
        'family_sort_value ASC, family_name ASC',
        { hasTier: false, hasRank: false, promotedFirst: true },
      ),
      'family_promoted DESC, family_sort_value ASC, family_name ASC',
      'with no search term the storefront browse order must be exactly what it was',
    )
  })

  // 7. the auto-merge identity normalizer must NOT learn this folding ------
  await check('the product-identity normalizer never folds leading zeros', async () => {
    const detailSrc = fs.readFileSync(path.join(root, 'src', 'lib', 'productDetailRule.ts'), 'utf8')
    const fnStart = detailSrc.indexOf('function normalizedBarcode')
    assert.ok(fnStart >= 0, 'normalizedBarcode must still exist in lib/productDetailRule.ts')
    const fn = detailSrc.slice(fnStart)
    const body = fn.slice(0, fn.indexOf('\n}') + 2)
    assert.ok(!/padStart|checkDigit|check_digit|ltrim/i.test(body),
      'normalizedBarcode must stay trim+lowercase only -- it decides what AUTO-MERGES, and the '
      + 'GTIN-14/EAN-13 twin pairs in this catalog are reserved for the operator to resolve by hand. '
      + "Search-only folding belongs in searchMatch.ts's normalizeBarcodeKey, which the twin probe "
      + `above exercises. got:\n${body}`)
  })

  console.log(`\n${passed} checks passed`)
  if (failures.length) {
    console.log(`${failures.length} FAILED:`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
