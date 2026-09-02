// Source lock: every product-catalog read in routes/products.ts is permission
// gated. GET /filters (facet vocabulary: categories, brands, suppliers, units,
// initials) was the one read with no check, so any signed-in account could
// enumerate supplier and brand names. The gate must sit INSIDE the handler,
// before loadProductFilters(), and accept any catalog-reading surface
// (Products / POS / Inventory / promotions rule editor) because POS and the
// promotion editor do not send `surface`.
//
// Run (from cloudflare/): node scripts/test-products-filters-gate-source.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
const handler = source.match(/app\.get\('\/filters', async \(c\) => \{([\s\S]*?)\r?\n\}\)/)
assert.ok(handler, 'GET /filters handler must exist')
const body = handler[1]
assert.match(body, /const denial = catalogVocabularyDenialReason\(c\.get\('user'\)\)/, '/filters must compute the catalog denial from the session user')
assert.match(body, /if \(denial\) return c\.json\(\{ error: denial \}, 403\)/, '/filters must reply 403 when denied')
assert.ok(body.indexOf('catalogVocabularyDenialReason') < body.indexOf('loadProductFilters'), 'the gate must run before the vocabulary is loaded')

const gate = source.match(/function catalogVocabularyDenialReason\(user: SessionUser\): string \| null \{([\s\S]*?)\r?\n\}/)
assert.ok(gate, 'catalogVocabularyDenialReason must exist')
for (const surface of ["'products'", "'pos'", "'inventory'"]) assert.ok(gate[1].includes(surface), `gate must accept the ${surface} surface`)
assert.match(gate[1], /getPermissionTier\(user, 'promotions'\) !== 'none'/, 'gate must accept a promotions grant (the rule editor reads the vocabulary)')
assert.match(gate[1], /productSurfaceDenialReason\(user, surface\) === null/, 'gate must reuse the sibling reads\' surface rule, not re-implement it')

console.log('test-products-filters-gate-source: ok')
