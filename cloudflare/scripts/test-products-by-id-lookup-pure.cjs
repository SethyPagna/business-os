// Pins the 2026-09-03 "Adjust Stock edits the WRONG product" fix.
//
// The production failure: GET /api/products/search accepted `ids` from every
// client (frontend/src/api/productReadTransport.ts -> getProductsByIds) and
// never read it. A silently-dropped filter on a LIST endpoint is not "an
// unfiltered list" to a by-id caller -- it is the WRONG RECORD, because every
// by-id consumer asks for one id and takes items[0]. Verified live against a
// production snapshot: `?ids=7231&pageSize=1` answered total 10212 with
// items[0] = id 1, so opening Adjust Stock on the id-7231 product loaded, and
// would have written stock against, the catalog's first row by name.
//
// The same silent-drop shape broke the Change-stock picker's search box: it
// sent `search=<typed or scanned text>`, which buildSearchFilters did not read
// either, so every keystroke returned the whole catalog with a 200.
//
// This test does NOT re-assert the SQL engine. It extracts the real `ids`
// parsing block out of the shipped source and RUNS it, so a future edit that
// keeps the words but breaks the behavior (drops the fail-closed branch, stops
// clamping, stops deduping, starts trusting unparseable input) goes red.
//
// Run: node scripts/test-products-by-id-lookup-pure.cjs
// Path-independent: every path below is resolved from __dirname, so this
// passes from cloudflare/ and from cloudflare/scripts/ alike.

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const productsRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'products.ts'), 'utf8')
const frontendRoot = path.join(root, '..', 'frontend', 'src')
const read = (...parts) => fs.readFileSync(path.join(frontendRoot, ...parts), 'utf8')
const transport = read('api', 'productReadTransport.ts')
const stockAdjustModal = read('components', 'products', 'forms', 'StockAdjustModal.tsx')
const inventoryPage = read('components', 'inventory', 'Inventory.tsx')
const productsPage = read('components', 'products', 'Products.tsx')
const lookupSnapshots = read('components', 'products', 'lookups', 'productLookupSnapshots.ts')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- extract the shipped `ids` block and run it ------------------------

const START = 'const rawIdFilter = query.ids ?? query.id'
const startIndex = productsRoute.indexOf(START)
assert.ok(startIndex >= 0, 'buildSearchFilters must read the `ids` (or `id`) parameter')

// Walk braces from the `if (` that follows, so the slice is the real block
// rather than a line count that drifts with every edit above it.
const ifIndex = productsRoute.indexOf('if (rawIdFilter', startIndex)
assert.ok(ifIndex > startIndex, '`ids` must be guarded by a presence check')
let depth = 0
let end = -1
for (let i = ifIndex; i < productsRoute.length; i += 1) {
  const ch = productsRoute[i]
  if (ch === '{') depth += 1
  else if (ch === '}') {
    depth -= 1
    if (depth === 0) { end = i + 1; break }
  }
}
assert.ok(end > 0, 'could not find the end of the `ids` filter block')
const idsBlockSource = productsRoute.slice(startIndex, end)

// TypeScript-free by construction; if that ever stops being true this throws
// loudly rather than silently skipping the behavioral half of this test.
const runIdsFilter = new Function('query', `
  const where = []
  const params = {}
  ${idsBlockSource}
  return { where, params }
`)

check('a single id becomes a bound p.id IN clause, not a dropped filter', () => {
  const { where, params } = runIdsFilter({ ids: '7231' })
  assert.deepEqual(where, ['p.id IN (@byId0)'])
  assert.deepEqual(params, { byId0: 7231 })
})

check('`id` is accepted as an alias for `ids`', () => {
  const { where, params } = runIdsFilter({ id: '42' })
  assert.deepEqual(where, ['p.id IN (@byId0)'])
  assert.deepEqual(params, { byId0: 42 })
})

check('a comma list is parsed, trimmed and deduped', () => {
  const { where, params } = runIdsFilter({ ids: ' 7231 , 1, 7231 ,  42 ' })
  assert.deepEqual(where, ['p.id IN (@byId0, @byId1, @byId2)'])
  assert.deepEqual(params, { byId0: 7231, byId1: 1, byId2: 42 })
})

check('present-but-unusable ids resolve to NO rows, never to the whole catalog', () => {
  // This is the entire point of the fix. Returning everything to a by-id
  // lookup is what bound Adjust Stock to a stranger; "no rows" is the only
  // safe answer, and the caller's own fallback then keeps the picked row.
  for (const value of ['abc', '0', '-5', ',,,', '1.5.2']) {
    const { where } = runIdsFilter({ ids: value })
    assert.deepEqual(where, ['1 = 0'], `ids=${JSON.stringify(value)} must not match everything`)
  }
})

check('an absent or blank ids parameter leaves the query untouched', () => {
  for (const query of [{}, { ids: '' }, { ids: '   ' }, { ids: null }, { ids: undefined }]) {
    const { where, params } = runIdsFilter(query)
    assert.deepEqual(where, [], 'a list request without ids must stay a list request')
    assert.deepEqual(params, {})
  }
})

check('the id list is clamped so a caller cannot blow the SQL variable limit', () => {
  const many = Array.from({ length: 250 }, (_, i) => i + 1).join(',')
  const { where, params } = runIdsFilter({ ids: many })
  assert.equal(Object.keys(params).length, 100)
  assert.ok(where[0].startsWith('p.id IN (@byId0, @byId1'))
  assert.ok(where[0].endsWith('@byId99)'))
})

// --- the free-text alias half ------------------------------------------

check('the catalog search reads query, q AND search as the same term', () => {
  // Matched on the alias chain rather than on one whole statement: the term
  // is read into a named variable so the barcode-equality probe can reuse the
  // raw text, and pinning the old single-line form made this test fail on a
  // pure refactor while the behaviour was intact. What must not drift is the
  // chain -- a picker that spells the term with a synonym used to get the
  // whole unfiltered catalog back with a 200.
  assert.match(
    productsRoute,
    /query\.query \|\| query\.q \|\| query\.search \|\| ''/,
    'a picker that spells the term `search` must not silently get the unfiltered catalog',
  )
  // The tokenizer moved behind the shared search-tail builder
  // (lib/productSearchQuery.ts), so the chain to pin is now
  // rawSearchText -> buildProductSearchQuery -> tokenizeSearchTermGroups.
  // Same invariant: the RESOLVED term (query || q || search) has to be what
  // actually reaches the parser, not just what got read into a variable.
  assert.ok(
    /buildProductSearchQuery\(\s*rawSearchText/.test(productsRoute)
    && /tokenizeSearchTermGroups\(rawSearchText/.test(
      fs.readFileSync(path.join(root, 'src', 'lib', 'productSearchQuery.ts'), 'utf8'),
    ),
    'the resolved term must be what actually feeds the search-term parser',
  )
})

check('/filters strips every free-text alias, including search', () => {
  assert.ok(
    /const \{ query: _searchTerm, q: _searchTermAlt, search: _searchTermAlias, \.\.\.structuralQuery \} = query/.test(productsRoute),
    'facet metadata must stay term-independent now that `search` is honoured',
  )
})

check('the client transport canonicalizes the term so no picker can drift again', () => {
  assert.ok(transport.includes('canonicalizeSearchTerm'), 'searchProducts must canonicalize its term key')
  assert.match(transport, /SEARCH_TERM_ALIASES = \[[^\]]*'search'[^\]]*\]/)
  assert.ok(
    transport.includes('canonicalizeSearchTerm(params)'),
    'both searchProducts and getProductBootstrap run the same term parsing server-side',
  )
})

// --- no by-id consumer may take items[0] positionally -------------------

check('the transport refuses to hand back a row that was not asked for', () => {
  assert.ok(transport.includes('restrictPayloadToIds'), 'getProductsByIds must filter its payload to the requested ids')
  assert.ok(
    transport.includes('products:byIds:v2:'),
    'the by-id cache key must be versioned past entries written while the server ignored `ids`',
  )
})

check('StockAdjustModal resolves the refreshed row by id', () => {
  assert.ok(
    /const refreshed = \(rows as PickedProduct\[\]\)\.find\(\(row\) => Number\(row\?\.id\) === Number\(id\)\)/.test(stockAdjustModal),
    'the adjust form must bind to the product the operator picked, not to items[0]',
  )
  assert.ok(!/rows\[0\] as PickedProduct/.test(stockAdjustModal), 'positional pick must not come back')
  assert.ok(
    !/searchProducts\(\{\s*search:/.test(stockAdjustModal),
    'the picker must send the canonical `query` key',
  )
})

check('Inventory resolves the detail product by id', () => {
  assert.ok(
    /result\.items\.find\(\(row: \{ id\?: unknown \}\) => Number\(row\?\.id\) === productId\)/.test(inventoryPage),
    'the movement detail card must not open a different product',
  )
  assert.ok(!/Array\.isArray\(result\?\.items\) \? result\.items\[0\] : null/.test(inventoryPage))
})

check('Products.fetchProductsByIds returns only the requested rows', () => {
  assert.ok(
    /payload\.filter\(\(row\) => wanted\.has\(Number\(\(row as \{ id\?: unknown \}\)\?\.id\)\)\)/.test(productsPage),
    'undo/redo and post-save snapshots must not bind to a stranger',
  )
})

check('the undo snapshot restore stays keyed on the snapshot id', () => {
  assert.ok(
    lookupSnapshots.includes('latestMap.get(productId)'),
    'restoring a lookup snapshot must match by id, so a short answer restores nothing rather than the wrong row',
  )
})

console.log(`\n${passed} checks passed`)
