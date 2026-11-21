#!/usr/bin/env node
// QW3: the filters vocabulary (300 s), the legacy page payload cache and the plain list that shares it (20 s) and the search-index pages (3,600 s) take their lifetime from getPlanLimits(env) (lib/planTier.ts), as the owner rule
// on adjustable Free limits asks. This fails if a numeric lifetime comes back on any of those paths. The plan values stay what the literals were, on both tiers.
//
// Run: node scripts/test-products-catalogue-ttl-no-literals-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n')
const SRC = read('src', 'routes', 'products.ts')
const PLAN = read('src', 'lib', 'planTier.ts')

const between = (from, to) => {
  const start = SRC.indexOf(from)
  assert.ok(start >= 0, `anchor not found: ${from}`)
  const end = SRC.indexOf(to, start + from.length)
  assert.ok(end > start, `end anchor not found: ${to}`)
  return SRC.slice(start, end)
}
// A cachedJsonResponse call with a number where the lifetime goes: (request, ctx, version, <digits>, producer ...)
const NUMERIC_TTL = /cachedJsonResponse\([^]*?,\s*(?:version|await catalogReadVersion\([^)]*\)[^,]*),\s*\d[\d_]*\s*,/
// The control: the pattern catches what it forbids.
assert.ok(NUMERIC_TTL.test("cachedJsonResponse(new Request(u), ctx, version, 3600,\n () => x)"), 'control: a literal lifetime is caught')
assert.ok(!NUMERIC_TTL.test("cachedJsonResponse(new Request(u), ctx, version, getPlanLimits(c.env).x,\n () => x)"), 'control: a plan lifetime is not')

const filtersRoute = between("app.get('/filters', async (c) => {", "// D4 (Part 578")
const searchIndexRoute = between("app.get('/search-index', async (c) => {", "app.get('/', async (c) => {")
const plainList = between("app.get('/', async (c) => {", 'return searchProductsPayload(c.env, { page')
const listReader = between('const cachedPayload = await cachedJsonResponse(', '// I2-1: a cache hit is refreshed')

assert.ok(/getPlanLimits\(c\.env\)\.catalogVocabularyCacheSeconds/.test(filtersRoute), 'filters: the plan field')
assert.ok(!NUMERIC_TTL.test(filtersRoute) && !/\b300\b/.test(filtersRoute), 'filters: no literal lifetime')
assert.ok(/getPlanLimits\(c\.env\)\.productSearchIndexCacheSeconds/.test(searchIndexRoute), 'search-index: the plan field')
assert.ok(!NUMERIC_TTL.test(searchIndexRoute) && !/\b3600\b/.test(searchIndexRoute), 'search-index: no literal lifetime')
assert.ok(/getPlanLimits\(c\.env\)\.productListLegacyCacheSeconds/.test(listReader), 'page payload cache: the plan field')
assert.ok(!NUMERIC_TTL.test(listReader), 'page payload cache: no literal lifetime')
assert.ok(/getPlanLimits\(c\.env\)\.productListLegacyCacheSeconds/.test(plainList), 'plain product list (GET /): the same plan field as /search, which it shares a lifetime with')
assert.ok(!NUMERIC_TTL.test(plainList), 'plain product list (GET /): no literal lifetime')
for (const gone of ['PRODUCT_FILTERS_TTL_SECONDS', 'PRODUCT_LIST_LEGACY_CACHE_SECONDS = ']) assert.ok(!SRC.includes(gone), `the ${gone.trim()} literal constant is gone`)
assert.ok(/max-age=\$\{getPlanLimits\(env!\)\.catalogVocabularyCacheSeconds\}/.test(SRC), 'the image-only facet entry takes the same plan field')

// Today's values on both tiers.
for (const [field, value] of [['catalogVocabularyCacheSeconds', '300'], ['productListLegacyCacheSeconds', '20'], ['productSearchIndexCacheSeconds', '3_600']]) {
  const hits = PLAN.match(new RegExp(`^\\s*${field}: ${value},`, 'gm')) || []
  assert.equal(hits.length, 2, `${field} is ${value} on both tiers`)
}
// The bell's lifetime is 245 on both tiers (owner 11 Nov: up to 5 minutes).
assert.equal((PLAN.match(/^\s*notificationSectionCacheSeconds: 245,/gm) || []).length, 2, 'notificationSectionCacheSeconds is 245 on both tiers')

console.log('PASS the three catalogue lifetimes and the filters facet entry come from getPlanLimits; no numeric lifetime on those paths; the bell is 245 on both tiers')
