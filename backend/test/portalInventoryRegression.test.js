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
  const source = readSource('src/routes/portal.js')
  assert.match(source, /const salesWhere = \[\]/, 'membership route should build sales clauses dynamically')
  assert.match(source, /const returnsWhere = \[\]/, 'membership route should build return clauses dynamically')
  assert.match(source, /const submissionWhere = \[\]/, 'membership route should build submission clauses dynamically')
  assert.match(source, /const salesWhereSql = salesWhere\.length \? salesWhere\.map\(\(clause\) => `\(\$\{clause\}\)`\)\.join\(' OR '\) : 'FALSE'/, 'membership route should guard empty sales clauses')
  assert.match(source, /const returnsWhereSql = returnsWhere\.length \? returnsWhere\.map\(\(clause\) => `\(\$\{clause\}\)`\)\.join\(' OR '\) : 'FALSE'/, 'membership route should guard empty return clauses')
  assert.match(source, /const submissionWhereSql = submissionWhere\.length \? submissionWhere\.map\(\(clause\) => `\(\$\{clause\}\)`\)\.join\(' OR '\) : 'FALSE'/, 'membership route should guard empty submission clauses')
  assert.match(source, /salesWhere\.push\('s\.customer_id = @customerId'\)/, 'membership route should still prefer customer_id matching')
  assert.match(source, /submissionWhere\.push\("lower\(trim\(COALESCE\(membership_number, ''\)\)\) = lower\(trim\(@membershipNumber\)\)"\)/, 'membership route should still fall back to membership number matching')
  assert.doesNotMatch(source, /@customerId IS NOT NULL AND s\.customer_id = @customerId/, 'membership route must not use nullable parameter type guards in SQL')
  assert.doesNotMatch(source, /@customerId IS NOT NULL AND r\.customer_id = @customerId/, 'returns lookup must not use nullable parameter type guards in SQL')
})

runTest('inventory movements accept large page sizes and use text-safe created_at ordering', () => {
  const source = readSource('src/routes/inventory.js')
  assert.match(source, /normalizePositiveInt\(requestedPageSize,\s*50000,\s*\{\s*min:\s*1,\s*max:\s*50000\s*\}\)/, 'movements route should allow explicit pageSize values up to 50000')
  assert.match(source, /COALESCE\(NULLIF\(im\.created_at::text,\s*''\), CURRENT_TIMESTAMP::text\) AS created_at/, 'movement rows should keep text-safe created_at fallback')
  assert.match(source, /ORDER BY COALESCE\(NULLIF\(im\.created_at::text,\s*''\), CURRENT_TIMESTAMP::text\) DESC, im\.id DESC/, 'movement ordering should avoid timestamp/text COALESCE mismatches')
})

runTest('sales and returns stock upserts qualify branch_stock quantity for Postgres', () => {
  const salesSource = readSource('src/routes/sales.js')
  const returnsSource = readSource('src/routes/returns.js')

  assert.match(salesSource, /GREATEST\(0,\s*branch_stock\.quantity\s*-\s*CAST\(\?\s+AS numeric\)\)/, 'sales stock deduction should qualify branch_stock.quantity')
  assert.match(salesSource, /SET quantity = branch_stock\.quantity \+ excluded\.quantity/, 'sales stock restoration should use excluded.quantity')
  assert.doesNotMatch(salesSource, /SET quantity = quantity \+ \?/, 'sales stock restoration should not use ambiguous bare quantity references')

  assert.match(returnsSource, /GREATEST\(0,\s*branch_stock\.quantity\s*-\s*CAST\(\?\s+AS numeric\)\)/, 'returns stock deduction should qualify branch_stock.quantity')
  assert.match(returnsSource, /SET quantity = branch_stock\.quantity \+ excluded\.quantity/, 'returns stock restoration should use excluded.quantity')
  assert.doesNotMatch(returnsSource, /SET quantity = quantity \+ \?/, 'returns stock restoration should not use ambiguous bare quantity references')
})

runTest('product image uploads compress immediately and return cache-busting metadata', () => {
  const source = readSource('src/routes/products.js')
  assert.match(source, /validateUploadedFile,\s*compressUpload/, 'product upload route should run synchronous image compression')
  assert.match(source, /registerUploadFromRequest\(req\.file, getAuditActor\(req\), \{ deferOptimization: false \}\)/, 'product upload route should register images after immediate compression')
  assert.match(source, /public_path: asset\.public_path/, 'product upload route should return the public asset path directly')
  assert.match(source, /cache_version: String\(asset\.updated_at \|\| asset\.created_at \|\| Date\.now\(\)\)\.replace/, 'product upload route should return sanitized cache-busting metadata')
})

runTest('product updates only re-check uniqueness when identifier fields actually change', () => {
  const source = readSource('src/routes/products.js')
  assert.match(source, /const nameChanged = normalizeProductIdentifier\(merged\.name, \{ lower: true \}\) !== normalizeProductIdentifier\(prev\.name, \{ lower: true \}\)/, 'product updates should compare normalized names before running duplicate validation')
  assert.match(source, /const skuChanged = normalizeProductIdentifier\(merged\.sku\) !== normalizeProductIdentifier\(prev\.sku\)/, 'product updates should compare SKU before duplicate validation')
  assert.match(source, /const barcodeChanged = normalizeProductIdentifier\(merged\.barcode\) !== normalizeProductIdentifier\(prev\.barcode\)/, 'product updates should compare barcode before duplicate validation')
  assert.match(source, /if \(nameChanged \|\| skuChanged \|\| barcodeChanged\) \{[\s\S]*checkName: nameChanged,[\s\S]*checkSku: skuChanged,[\s\S]*checkBarcode: barcodeChanged,/m, 'product updates should only validate the identifier fields that were actually edited')
})

runTest('upload path sanitization keeps canonical R2-backed media references intact', () => {
  const snapshotSource = readSource('src/settingsSnapshot.js')
  const assetSource = readSource('src/fileAssets.js')

  assert.match(snapshotSource, /const \{ isObjectStorageEnabled \} = require\('\.\/objectStore'\)/, 'settings snapshot sanitization should know when object storage is enabled')
  assert.match(snapshotSource, /if \(isObjectStorageEnabled\(\)\) return normalized/, 'upload sanitization should keep canonical upload paths when R2/object storage is enabled')
  assert.match(snapshotSource, /const \[cleanPath\] = raw\.split\(\/\[\?#\]\/, 1\)/, 'upload sanitization should strip cache-busting query strings from persisted upload paths')
  assert.match(assetSource, /function ensureReferencedAssetsRegistered\(\)/, 'file assets should rebuild missing library rows from persisted references')
  assert.match(assetSource, /source: 'reference_backfill'/, 'recovered file assets should be marked as reference backfills')
})

if (failed > 0) {
  process.exitCode = 1
}
