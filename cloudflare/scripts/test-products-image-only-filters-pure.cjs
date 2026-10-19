// lib/productImageOnlyQuery.ts: the server-trusted query contract of the
// "image upload only" Products reader. Pure table test -- the module has no
// imports, so it is transpiled and run directly. The mounted-route behaviour
// (SQL, cache, projection) is in test-products-image-only-filters-native.cjs.
//
// Run (from cloudflare/): node scripts/test-products-image-only-filters-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const file = path.join(__dirname, '..', 'src', 'lib', 'productImageOnlyQuery.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
})
const mod = { exports: {} }
new Function('exports', 'module', outputText)(mod.exports, mod)
const { parseImageOnlyQuery, pushReceivedWindow, imageOnlyGrants, ImageOnlyQueryError } = mod.exports

const NONE = { products_image_only: true }
const ALL = {
  products_image_only: true,
  products_image_only_show_category: true, products_image_only_show_brand: true, products_image_only_show_stock: true,
  products_image_only_show_batches: true, products_image_only_show_branch_stock: true, products_image_only_show_barcode: true,
}

let failures = 0
function check(name, fn) {
  try { fn(); console.log('PASS', name) } catch (error) { failures++; console.log('FAIL', name, '-', error.message) }
}
function refusal(raw, permissions, status, code, parameter, extra) {
  let thrown
  try { parseImageOnlyQuery(raw, permissions, extra) } catch (error) { thrown = error }
  assert.ok(thrown instanceof ImageOnlyQueryError, `${JSON.stringify(raw)} must be refused`)
  assert.deepStrictEqual([thrown.status, thrown.code, thrown.parameter], [status, code, parameter], JSON.stringify(raw))
}

check('grants are read from the merged permission map, strictly === true', () => {
  assert.deepStrictEqual(imageOnlyGrants(NONE), { category: false, brand: false, stock: false, batches: false, branchStock: false })
  assert.deepStrictEqual(imageOnlyGrants(ALL), { category: true, brand: true, stock: true, batches: true, branchStock: true })
  assert.strictEqual(imageOnlyGrants({ products_image_only_show_stock: 'review' }).stock, false)
  assert.strictEqual(imageOnlyGrants(null).stock, false)
})

check('every allowed key is accepted and rebuilt into a minimal query', () => {
  const parsed = parseImageOnlyQuery({
    query: 'cream', page: '2', pageSize: '40', surface: 'products', sort: 'NAME_DESC', category: 'Skin, Hair', brand: 'Acme',
    stockState: 'Low', startDate: '2026-10-01', endDate: '2026-10-10',
  }, ALL)
  assert.deepStrictEqual(parsed.query, {
    query: 'cream', page: '2', pageSize: '40', sort: 'name_desc', category: 'Skin, Hair', brand: 'Acme', stockState: 'low',
  })
  assert.deepStrictEqual(parsed.received, { receivedFrom: '2026-10-01', receivedTo: '2026-10-10' })
  assert.strictEqual('surface' in parsed.query, false, 'surface is routing, not a search parameter')
})

check('the three search aliases collapse to one, first non-empty wins; barcode search is never narrowed', () => {
  assert.deepStrictEqual(parseImageOnlyQuery({ search: '5012345' }, NONE).query, { query: '5012345' })
  assert.deepStrictEqual(parseImageOnlyQuery({ q: 'a', search: 'b' }, NONE).query, { query: 'a' })
  assert.deepStrictEqual(parseImageOnlyQuery({ query: '', q: 'b' }, NONE).query, { query: 'b' })
  assert.strictEqual('searchFields' in parseImageOnlyQuery({ query: 'x' }, NONE).query, false)
  refusal({ query: 'x', searchFields: 'name' }, NONE, 400, 'image_only_filter_invalid', 'searchFields')
})

check('an ungranted user may send no filter at all, and all/empty values are the unfiltered state', () => {
  assert.deepStrictEqual(parseImageOnlyQuery({}, NONE).query, {})
  assert.deepStrictEqual(parseImageOnlyQuery({ category: 'all', brand: 'ALL', stockState: 'all', startDate: '', endDate: ' ' }, NONE).query, {})
  assert.deepStrictEqual(parseImageOnlyQuery({}, NONE).received, { receivedFrom: null, receivedTo: null })
})

check('each filter needs its own grant (403 image_only_filter_hidden, parameter named)', () => {
  const table = [
    ['category', 'Skin', 'products_image_only_show_category'], ['brand', 'Acme', 'products_image_only_show_brand'],
    ['stockState', 'out', 'products_image_only_show_stock'], ['startDate', '2026-10-01', 'products_image_only_show_batches'],
    ['endDate', '2026-10-01', 'products_image_only_show_batches'],
  ]
  for (const [key, value, grant] of table) {
    refusal({ [key]: value }, NONE, 403, 'image_only_filter_hidden', key)
    // A different grant never opens it.
    const others = { ...ALL, [grant]: false }
    refusal({ [key]: value }, others, 403, 'image_only_filter_hidden', key)
    assert.doesNotThrow(() => parseImageOnlyQuery({ [key]: value }, { ...NONE, [grant]: true }), `${key} with its grant`)
  }
  // The hidden check precedes the value check: an invalid value must not reveal anything about a hidden field.
  refusal({ stockState: 'bogus' }, NONE, 403, 'image_only_filter_hidden', 'stockState')
  refusal({ startDate: 'garbage' }, NONE, 403, 'image_only_filter_hidden', 'startDate')
})

check('unknown or never-allowed keys are a 400, even beside valid ones', () => {
  for (const key of ['supplier', 'branchId', 'branch_id', 'promo', 'issueState', 'issue_state', 'rankIds', 'rankTiers', 'ids', 'id', 'tag_label',
    'unit', 'initial', 'groupState', 'group_state', 'merged', 'stock_state', 'searchMode', 'money_precision_version', 'include', 'metadata', 'nonce']) {
    refusal({ [key]: '1' }, ALL, 400, 'image_only_filter_invalid', key)
    refusal({ stockState: 'low', [key]: '1' }, ALL, 400, 'image_only_filter_invalid', key)
  }
  // A sibling route may declare its own transport keys; they are dropped from the rebuilt query.
  const parsed = parseImageOnlyQuery({ metadata: '0', query: 'a' }, NONE, ['metadata'])
  assert.deepStrictEqual(parsed.query, { query: 'a' })
  refusal({ metadata: '0', ids: '1' }, NONE, 400, 'image_only_filter_invalid', 'ids', ['metadata'])
})

check('value validation: stock states, sort, page, pageSize', () => {
  for (const state of ['in_stock', 'low', 'out', 'healthy']) assert.strictEqual(parseImageOnlyQuery({ stockState: state }, ALL).query.stockState, state)
  for (const state of ['positive', 'in-stock', 'none', 'low,out']) refusal({ stockState: state }, ALL, 400, 'image_only_filter_invalid', 'stockState')
  assert.strictEqual(parseImageOnlyQuery({ sort: 'name_asc' }, NONE).query.sort, 'name_asc')
  for (const sort of ['created_desc', 'created_asc', 'name', 'relevance']) refusal({ sort }, NONE, 400, 'image_only_filter_invalid', 'sort')
  for (const [key, value] of [['page', 'abc'], ['page', '-1'], ['page', '1.5'], ['pageSize', 'x'], ['pageSize', '-5'], ['pageSize', '99999999999999999999']]) {
    refusal({ [key]: value }, NONE, 400, 'image_only_filter_invalid', key)
  }
})

check('dates: ISO calendar days only, inclusive range, inverted is invalid', () => {
  const good = (raw) => parseImageOnlyQuery(raw, ALL).received
  assert.deepStrictEqual(good({ startDate: '2026-02-28' }), { receivedFrom: '2026-02-28', receivedTo: null })
  assert.deepStrictEqual(good({ endDate: '2024-02-29' }), { receivedFrom: null, receivedTo: '2024-02-29' }, 'leap day')
  assert.deepStrictEqual(good({ startDate: '2026-10-10', endDate: '2026-10-10' }), { receivedFrom: '2026-10-10', receivedTo: '2026-10-10' }, 'one day')
  for (const bad of ['2026-13-01', '2026-02-30', '2026-2-3', '10/10/2026', '2026-10-10T00:00:00Z', '20261010', 'today', '2026-10-10 ']) {
    if (bad.trim() !== bad) continue // surrounding whitespace is trimmed, not an error
    refusal({ startDate: bad }, ALL, 400, 'image_only_filter_invalid', 'startDate')
    refusal({ endDate: bad }, ALL, 400, 'image_only_filter_invalid', 'endDate')
  }
  assert.deepStrictEqual(good({ startDate: ' 2026-10-10 ' }), { receivedFrom: '2026-10-10', receivedTo: null })
  refusal({ startDate: '2026-10-11', endDate: '2026-10-10' }, ALL, 400, 'image_only_filter_invalid', 'endDate')
})

check('the received predicate: EXISTS on the lot day, sargable text bounds, no timezone shift, none without bounds', () => {
  const none = { where: ['base'], params: {} }
  pushReceivedWindow(none.where, none.params, { receivedFrom: null, receivedTo: null })
  assert.deepStrictEqual(none, { where: ['base'], params: {} }, 'no bounds -> no predicate, no params')
  const bounded = { where: ['base'], params: {} }
  pushReceivedWindow(bounded.where, bounded.params, { receivedFrom: '2026-10-01', receivedTo: null })
  assert.strictEqual(bounded.where.length, 2)
  assert.deepStrictEqual(bounded.params, { receivedFrom: '2026-10-01', receivedBefore: null })
  const sql = bounded.where[1]
  assert.match(sql, /^EXISTS \(SELECT 1 FROM product_batches receipt WHERE receipt\.variant_product_id = p\.id/)
  assert.match(sql, /receipt\.received_at GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]\*'/, 'only values that start with a day are comparable')
  assert.match(sql, /\(@receivedFrom IS NULL OR receipt\.received_at >= @receivedFrom\)/)
  assert.match(sql, /\(@receivedBefore IS NULL OR receipt\.received_at < @receivedBefore\)/)
  assert.doesNotMatch(sql, /date\(|datetime\(|\+7|localtime|modifier/i, 'received_at is compared as written: no wrap, never shifted')
  // The last day is inclusive: the exclusive bound is the next calendar day (month, year and leap-day rollovers).
  for (const [to, before] of [['2026-10-10', '2026-10-11'], ['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01'], ['2024-02-28', '2024-02-29'], ['2024-02-29', '2024-03-01'], ['2026-02-28', '2026-03-01']]) {
    const closed = { where: [], params: {} }
    pushReceivedWindow(closed.where, closed.params, { receivedFrom: null, receivedTo: to })
    assert.deepStrictEqual(closed.params, { receivedFrom: null, receivedBefore: before }, to)
  }
})

check('source locks: the window is not in the shared filter builder, and image-only never reads the shared cache', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
  const builder = routes.match(/function buildSearchFilters\([\s\S]*?\r?\n\}\r?\n/)[0]
  assert.doesNotMatch(builder, /pushReceivedWindow|receivedFrom|product_batches/, 'buildSearchFilters stays all-time for every reader')
  const search = routes.match(/app\.get\('\/search', async \(c\) => \{([\s\S]*?)\r?\n\}\)/)[1]
  assert.ok(search.indexOf('isImageOnlyRead(user, surface)') > -1 && search.indexOf('isImageOnlyRead(user, surface)') < search.indexOf('cachedJsonResponse'),
    'the image-only branch precedes the shared cache')
  assert.match(search, /Cache-Control', 'private, no-store'/)
})

if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('test-products-image-only-filters-pure: ok')
