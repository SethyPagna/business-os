const fs = require('fs')
const path = require('path')
const assert = require('assert')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
const start = source.indexOf('function buildSearchFilters(')
const end = source.indexOf('\nasync function searchProductsWithIndexFallback', start)
assert.ok(start >= 0 && end > start, 'buildSearchFilters source must be locatable')
const filters = source.slice(start, end)

for (const legacyKey of ['batchDateFrom', 'batch_date_from', 'batchDateTo', 'batch_date_to']) {
  assert.ok(!filters.includes(legacyKey), `catalog eligibility must ignore deprecated ${legacyKey}`)
}
assert.doesNotMatch(filters, /product_batches[\s\S]*received_at/, 'generic catalog search must not require a received-date lot')
assert.match(filters, /const where: string\[\] = \['p\.is_active = 1'\]/, 'active-product eligibility must remain enforced')

// Positive control: received dates still exist elsewhere in this route for
// stock-in/reporting data. The all-time catalog change must not erase lot
// provenance from the product domain.
assert.match(source, /received_at/, 'product reporting/detail code must retain received-date provenance')

console.log('PASS product catalog ignores legacy received-date bounds while retaining active eligibility and provenance')
