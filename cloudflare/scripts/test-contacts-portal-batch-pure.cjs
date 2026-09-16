// p6/efficiency-3 step 6: leftover round-trip fixes.
//
// 1. routes/contacts.ts:557 mergeSupplierIntoExisting() used to bump three
//    cache namespaces with Promise.allSettled(['suppliers','products',
//    'returns'].map(bumpVersion)) -- one independent KV/D1 plan derivation
//    per namespace. lib/cache.ts's bumpVersions() already exists (from a
//    prior wave) and folds every namespace's D1 fallback into one
//    db.batch(); this call site just never switched to it.
//
// 1b. The generic contact-merge handler (customers/suppliers/employees,
//    around contacts.ts:1278) had the identical
//    Promise.allSettled([...new Set(mergeVersions)].map(bumpVersion)) shape
//    -- same fix, same reasoning, different call site.
//
// 2. routes/portal.ts's public storefront catalog paths (buildPortalCatalog
//    and runPortalProductSearch) had two independent-read patterns still
//    sequential: (a) attachPortalStockStatus (branches + threshold settings
//    + branch_stock reads) run-then-wait before the unrelated A-Z initials
//    rail query, in both the bootstrap snapshot and every search/filter
//    request; and (b) the fuzzy-fallback COUNT-then-page pair, same
//    COUNT+page shape already fixed elsewhere in this wave via db.batch.
//
// Run (from cloudflare/): node scripts/test-contacts-portal-batch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const contactsSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'contacts.ts'), 'utf8')
const portalSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'portal.ts'), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `${label}: start marker not found`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${label}: end marker not found after start`)
  return source.slice(start, end)
}

// ---- 1. contacts.ts:557 ----
check('contacts.ts imports bumpVersions', () => {
  assert.match(contactsSource, /import \{ bumpVersion, bumpVersions, cachedJsonResponse, getVersionWithFallback \} from '\.\.\/lib\/cache'/)
})

check('mergeSupplierIntoExisting uses one bumpVersions call, not three bumpVersion calls', () => {
  const block = sliceBetween(contactsSource, 'async function mergeSupplierIntoExisting', 'async function computeCustomerPointsMap', 'mergeSupplierIntoExisting')
  assert.doesNotMatch(block, /Promise\.allSettled\(\['suppliers', 'products', 'returns'\]\.map\(\(namespace\) => bumpVersion\(/, 'must not regress to the per-namespace map(bumpVersion) shape')
  assert.match(block, /await bumpVersions\(env, \['suppliers', 'products', 'returns'\]\)/, 'expected the batched bumpVersions call')
})

check('generic contact-merge handler uses one bumpVersions call, not a per-namespace map(bumpVersion)', () => {
  const block = sliceBetween(contactsSource, 'const mergeVersions: string[]', "app.get('/suppliers/:id/purchases'", 'generic contact-merge handler')
  assert.doesNotMatch(block, /Promise\.allSettled\(\[\.\.\.new Set\(mergeVersions\)\]\.map\(\(namespace\) => bumpVersion\(/, 'must not regress to the per-namespace map(bumpVersion) shape')
  assert.match(block, /await bumpVersions\(c\.env, \[\.\.\.new Set\(mergeVersions\)\]\)/, 'expected the batched bumpVersions call')
})

// ---- 2. portal.ts public catalog paths ----
check('buildPortalCatalog fans out attachPortalStockStatus with the initials rail query', () => {
  const block = sliceBetween(portalSource, 'async function buildPortalCatalog', "app.get('/config'", 'buildPortalCatalog')
  assert.match(block, /const \[itemsWithStockStatus, initials\] = await Promise\.all\(\[\s*attachPortalStockStatus\(env,/, 'expected attachPortalStockStatus and the initials query fanned out together')
})

check('runPortalProductSearch fans out attachPortalStockStatus with its own initials rail query', () => {
  const block = sliceBetween(portalSource, 'async function runPortalProductSearch', "app.get('/catalog/products/search'", 'runPortalProductSearch')
  assert.match(block, /const \[itemsWithStockStatus, initials\] = await Promise\.all\(\[\s*attachPortalStockStatus\(c\.env,/, 'expected attachPortalStockStatus and the initials query fanned out together')
})

check('runPortalProductSearch batches the fuzzy-fallback COUNT+page pair', () => {
  const block = sliceBetween(portalSource, 'async function runPortalProductSearch', "app.get('/catalog/products/search'", 'runPortalProductSearch fuzzy fallback')
  assert.match(block, /const \[fuzzyTotalResult, fuzzyItemsResult\] = await db\.batch\(\[/, 'expected the fuzzy fallback COUNT+page to go over one db.batch()')
  assert.doesNotMatch(block, /const fuzzyTotalRow = await db\.prepare/, 'must not regress to a standalone awaited fuzzy COUNT')
})

console.log(`\n${passed} checks passed`)
