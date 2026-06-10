'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

runTest('portal membership lookup builds customer match clauses without nullable parameter type checks', () => {
  const source = readSource('src/routes/portal.ts')
  assert.match(source, /const salesWhere = \[\]/, 'membership route should build sales clauses dynamically')
  assert.match(source, /const returnsWhere = \[\]/, 'membership route should build return clauses dynamically')
  assert.match(source, /const submissionWhere = \[\]/, 'membership route should build submission clauses dynamically')
  assert.match(source, /function joinWrappedClauses\(clauses\) \{[\s\S]*if \(!clauses\.length\) return 'FALSE'[\s\S]*wrapped\.push\(`\(\$\{clause\}\)`\)/, 'membership route should guard empty clauses through a shared direct-loop helper')
  assert.match(source, /const salesWhereSql = joinWrappedClauses\(salesWhere\)/, 'membership route should guard empty sales clauses')
  assert.match(source, /const returnsWhereSql = joinWrappedClauses\(returnsWhere\)/, 'membership route should guard empty return clauses')
  assert.match(source, /const submissionWhereSql = joinWrappedClauses\(submissionWhere\)/, 'membership route should guard empty submission clauses')
  assert.match(source, /salesWhere\.push\('s\.customer_id = @customerId'\)/, 'membership route should still prefer customer_id matching')
  assert.match(source, /submissionWhere\.push\("lower\(trim\(COALESCE\(membership_number, ''\)\)\) = lower\(trim\(@membershipNumber\)\)"\)/, 'membership route should still fall back to membership number matching')
  assert.doesNotMatch(source, /@customerId IS NOT NULL AND s\.customer_id = @customerId/, 'membership route must not use nullable parameter type guards in SQL')
  assert.doesNotMatch(source, /@customerId IS NOT NULL AND r\.customer_id = @customerId/, 'returns lookup must not use nullable parameter type guards in SQL')
})

runTest('portal catalog product payloads share image and branch-stock materialization', () => {
  const source = readSource('src/routes/portal.ts')
  assert.match(source, /function getPortalProductAssets\(productIds\) \{/, 'portal route should centralize product asset queries')
  assert.match(source, /function buildPortalProductPayload\(product, signals, assets\) \{/, 'portal route should centralize product payload decoration')
  assert.match(source, /function buildPortalProductPayloads\(products, signals, assets\) \{[\s\S]*buildPortalProductPayload\(product, signals, assets\)/, 'portal route should share direct-loop payload list decoration')
  assert.match(source, /const assets = getPortalProductAssets\(ids\)[\s\S]*return buildPortalProductPayloads\(products, signals, assets\)/, 'full portal product list should use shared payload builder')
  assert.match(source, /const assets = getPortalProductAssets\(ids\)[\s\S]*const items = buildPortalProductPayloads\(products, signals, assets\)/, 'paged portal product search should use shared payload builder')
  assert.equal((source.match(/function getPortalProductAssets\(productIds\) \{/g) || []).length, 1, 'portal asset materialization should have one implementation')
})

runTest('public portal read endpoints advertise bounded shared-cache headers', () => {
  const source = readSource('src/routes/portal.ts')
  assert.match(source, /function setPublicPortalCacheHeaders\(res, seconds = 20\) \{[\s\S]*Cache-Control'[\s\S]*public, max-age=\$\{ttl\}, stale-while-revalidate=\$\{Math\.max\(60, ttl \* 6\)\}/, 'portal read cache helper should emit bounded public cache headers')
  assert.match(source, /router\.get\('\/config'[\s\S]*setPublicPortalCacheHeaders\(res, 20\)[\s\S]*res\.json\(await getCachedPortalConfig\(\)\)/, 'portal config should be briefly cacheable')
  assert.match(source, /const portalBootstrapPayloadCache = \{[\s\S]*pending: null[\s\S]*\}/, 'portal bootstrap should have an in-process burst cache')
  assert.match(source, /async function buildFreshPublicPortalBootstrapPayload\(config\)[\s\S]*products: catalog\.items/, 'portal bootstrap payload should include the cached catalog product items')
  assert.match(source, /async function buildPublicPortalBootstrapPayload\(\)[\s\S]*portalBootstrapPayloadCache\.pending[\s\S]*getOrSetJson\('portal:bootstrap', ttl,[\s\S]*buildFreshPublicPortalBootstrapPayload\(config\)/, 'portal bootstrap should reuse runtime cache and dedupe in-flight builds')
  assert.match(source, /res\.setHeader\('X-Business-OS-Portal-Bootstrap-Cache', getPublicPortalBootstrapCacheStatus\(\)\)/, 'portal bootstrap should expose a safe cache-state proof header')
  assert.match(source, /module\.exports\.getPublicPortalBootstrapCacheStatus = getPublicPortalBootstrapCacheStatus/, 'portal bootstrap cache-state helper should stay exported for runtime proof')
  assert.match(source, /router\.get\('\/bootstrap'[\s\S]*setPublicPortalCacheHeaders\(res, config\?\.refreshSeconds \|\| 20\)[\s\S]*res\.json\(payload\)/, 'portal bootstrap should be briefly cacheable')
  assert.match(source, /router\.get\('\/catalog\/meta'[\s\S]*setPublicPortalCacheHeaders\(res, 20\)[\s\S]*res\.json\(await getCachedPortalMeta\(\)\)/, 'portal metadata should be briefly cacheable')
  assert.match(source, /router\.get\('\/catalog\/products'[\s\S]*setPublicPortalCacheHeaders\(res, config\?\.refreshSeconds \|\| 20\)[\s\S]*res\.json\(await getCachedPortalProducts\(config\)\)/, 'full portal products should be briefly cacheable')
  assert.match(source, /router\.get\('\/catalog\/products\/search'[\s\S]*setPublicPortalCacheHeaders\(res, config\?\.refreshSeconds \|\| 20\)[\s\S]*res\.json\(getPortalCatalogProductPage\(config, req\.query\)\)/, 'paged portal product search should be briefly cacheable')
  assert.doesNotMatch(source, /router\.post\('\/ai\/chat'[\s\S]*setPublicPortalCacheHeaders/, 'AI chat must not use public cache headers')
  assert.doesNotMatch(source, /router\.post\('\/submissions'[\s\S]*setPublicPortalCacheHeaders/, 'share submissions must not use public cache headers')
})

runTest('inventory movements accept large page sizes and use text-safe created_at ordering', () => {
  const source = readSource('src/routes/inventory.ts')
  assert.match(source, /normalizePositiveInt\(requestedPageSize,\s*50000,\s*\{\s*min:\s*1,\s*max:\s*50000\s*\}\)/, 'movements route should allow explicit pageSize values up to 50000')
  assert.match(source, /COALESCE\(NULLIF\(im\.created_at::text,\s*''\), CURRENT_TIMESTAMP::text\) AS created_at/, 'movement rows should keep text-safe created_at fallback')
  assert.match(source, /ORDER BY COALESCE\(NULLIF\(im\.created_at::text,\s*''\), CURRENT_TIMESTAMP::text\) DESC, im\.id DESC/, 'movement ordering should avoid timestamp/text COALESCE mismatches')
})

runTest('inventory product reads reuse the shared runtime cache', () => {
  const source = readSource('src/routes/inventory.ts')
  assert.match(source, /const \{ getOrSetJson \} = require\('\.\.\/runtimeCache\.ts'\)/, 'inventory route should use the shared runtime cache helper')
  assert.match(source, /INVENTORY_PRODUCT_SNAPSHOT_VERSION_MEMO_MS/, 'inventory cache keys should use a short memoized snapshot version')
  assert.match(source, /function getInventoryProductSnapshotVersion\(\)/, 'inventory product reads should include a live data snapshot token')
  assert.match(source, /snapshot_version \|\| ''\)\.trim\(\) \|\| 'empty'/, 'inventory snapshot fallback should be stable for legacy rows with null timestamps')
  assert.match(source, /function buildInventoryProductReadCacheKey\(kind, query = \{\}\)/, 'inventory product reads should have a bounded query-specific cache key')
  assert.match(source, /inventory:\$\{kind\}:\$\{getInventoryProductSnapshotVersion\(\)\}:/, 'inventory product cache keys should include the snapshot version')
  assert.match(source, /function getCachedInventoryProductSearchPayload\(query = \{\}\) \{[\s\S]*getOrSetJson\(buildInventoryProductReadCacheKey\('products', query\), 12,/m, 'inventory product search should cache repeated bootstrap/search payloads briefly')
  assert.match(source, /products: await getCachedInventoryProductSearchPayload\(req\.query\)/, 'inventory bootstrap should reuse cached product payloads')
  assert.match(source, /res\.json\(await getCachedInventoryProductSearchPayload\(req\.query\)\)/, 'inventory product search should reuse cached product payloads')
})

runTest('sales and returns stock upserts qualify branch_stock quantity for Postgres', () => {
  const salesSource = readSource('src/routes/sales.ts')
  const returnsSource = readSource('src/routes/returns.ts')

  assert.match(salesSource, /GREATEST\(0,\s*branch_stock\.quantity\s*-\s*CAST\(\?\s+AS numeric\)\)/, 'sales stock deduction should qualify branch_stock.quantity')
  assert.match(salesSource, /SET quantity = branch_stock\.quantity \+ excluded\.quantity/, 'sales stock restoration should use excluded.quantity')
  assert.doesNotMatch(salesSource, /SET quantity = quantity \+ \?/, 'sales stock restoration should not use ambiguous bare quantity references')

  assert.match(returnsSource, /GREATEST\(0,\s*branch_stock\.quantity\s*-\s*CAST\(\?\s+AS numeric\)\)/, 'returns stock deduction should qualify branch_stock.quantity')
  assert.match(returnsSource, /SET quantity = branch_stock\.quantity \+ excluded\.quantity/, 'returns stock restoration should use excluded.quantity')
  assert.doesNotMatch(returnsSource, /SET quantity = quantity \+ \?/, 'returns stock restoration should not use ambiguous bare quantity references')
})

runTest('product image uploads compress immediately and return cache-busting metadata', () => {
  const source = readSource('src/routes/products.ts')
  assert.match(source, /validateUploadedFile,\s*compressUpload/, 'product upload route should run synchronous image compression')
  assert.match(source, /registerUploadFromRequest\(req\.file, getAuditActor\(req\), \{ deferOptimization: false \}\)/, 'product upload route should register images after immediate compression')
  assert.match(source, /public_path: asset\.public_path/, 'product upload route should return the public asset path directly')
  assert.match(source, /cache_version: String\(asset\.updated_at \|\| asset\.created_at \|\| Date\.now\(\)\)\.replace/, 'product upload route should return sanitized cache-busting metadata')
})

runTest('product updates only re-check uniqueness when identifier fields actually change', () => {
  const source = readSource('src/routes/products.ts')
  assert.match(source, /const nameChanged = normalizeProductIdentifier\(merged\.name, \{ lower: true \}\) !== normalizeProductIdentifier\(prev\.name, \{ lower: true \}\)/, 'product updates should compare normalized names before running duplicate validation')
  assert.match(source, /const skuChanged = normalizeProductIdentifier\(merged\.sku\) !== normalizeProductIdentifier\(prev\.sku\)/, 'product updates should compare SKU before duplicate validation')
  assert.match(source, /const barcodeChanged = normalizeProductIdentifier\(merged\.barcode\) !== normalizeProductIdentifier\(prev\.barcode\)/, 'product updates should compare barcode before duplicate validation')
  assert.match(source, /if \(nameChanged \|\| skuChanged \|\| barcodeChanged\) \{[\s\S]*checkName: nameChanged,[\s\S]*checkSku: skuChanged,[\s\S]*checkBarcode: barcodeChanged,/m, 'product updates should only validate the identifier fields that were actually edited')
})

runTest('upload path sanitization verifies object-storage references before serving them', () => {
  const snapshotSource = readSource('src/settingsSnapshot.ts')
  const cleanupSource = readSource('src/uploadReferenceCleanup.ts')
  const assetSource = readSource('src/fileAssets.ts')

  assert.match(snapshotSource, /const \{ isObjectStorageEnabled, objectExists \} = require\('\.\/objectStore\.ts'\)/, 'settings snapshot sanitization should know when object storage is enabled and how to verify object existence')
  assert.match(snapshotSource, /async function sanitizeMediaPathAsync/, 'settings snapshot sanitization should expose an async object-storage-aware path check')
  assert.match(snapshotSource, /await objectExists\(toUploadObjectKey\(normalized\)\)/, 'object-storage media paths should be verified before they are returned')
  assert.match(snapshotSource, /const \[cleanPath\] = raw\.split\(\/\[\?#\]\/, 1\)/, 'upload sanitization should strip cache-busting query strings from persisted upload paths')
  assert.match(cleanupSource, /async function repairMissingUploadReferencesAsync/, 'upload reference cleanup should support async object-storage-aware repairs')
  assert.match(assetSource, /await repairMissingUploadReferencesAsync\(getDb\(\)\)/, 'file asset warmup and reconcile paths should await async upload reference repair')
  assert.match(assetSource, /function ensureReferencedAssetsRegistered\(\)/, 'file assets should rebuild missing library rows from persisted references')
  assert.match(assetSource, /source: 'reference_backfill'/, 'recovered file assets should be marked as reference backfills')
})

if (failed > 0) {
  process.exitCode = 1
}
