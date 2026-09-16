// p6/efficiency-3 step 1: pins the sequential-D1-round-trip reductions made
// to routes/inventory.ts's GET /movements and GET /reasons/impact.
// Source-pin style, like test-worker-perf-2-round-trips-pure.cjs -- this
// asserts the SHAPE of the fix in the committed source (db.batch() fan-out
// instead of two sequential prepare().get()/prepare().all() calls), not
// runtime timing, which is not measurable from a pure Node process against
// no live D1.
//
// Run (from cloudflare/): node scripts/test-inventory-list-batch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const inventorySource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'inventory.ts'), 'utf8')

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

// Before: `await db.prepare(count sql).get(params)` then
// `await db.prepare(page sql).all(params)` -- two sequential round trips with
// no data dependency on each other.
// After: one db.batch([count, page]) round trip, same shape as
// familyPagination.ts's paginateProductFamilies.
check('inventory.ts GET /movements: COUNT + page SELECT go over one db.batch()', () => {
  const block = sliceBetween(inventorySource, "app.get('/movements'", "app.get('/reasons'", 'inventory.ts GET /movements')
  assert.match(
    block,
    /const \[totalResult, itemsResult\] = await db\.batch\(\[/,
    'COUNT and page SELECT must be fanned out in one db.batch() call, not two sequential prepare().get()/.all() calls',
  )
  assert.doesNotMatch(
    block,
    /await db\.prepare\(`SELECT COUNT\(\*\) AS count FROM inventory_movements/,
    'must not regress to a standalone awaited COUNT prepare()',
  )
})

check('inventory.ts GET /reasons/impact: settings row + linked-count go over one db.batch()', () => {
  const block = sliceBetween(inventorySource, "app.get('/reasons/impact'", "app.post('/reasons/replace'", 'inventory.ts GET /reasons/impact')
  assert.match(
    block,
    /const \[settingsResult, countResult\] = await db\.batch\(\[/,
    'the saved-reasons settings row and the linked-movement COUNT must be fanned out in one db.batch() call',
  )
})

console.log(`\n${passed} checks passed`)
