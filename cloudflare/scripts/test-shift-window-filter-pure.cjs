// S4-7. The shift window is a MOMENT range, not a day range -- this pins the
// two things that make it correct, with no D1 and no network.
//
//   1. shiftWindowBound() converts a shift timestamp into the shape
//      sales.created_at is actually stored in. This is the whole bug class:
//      routes/shifts.ts writes opened_at as `new Date().toISOString()`
//      ('2026-09-04T01:15:00.000Z') while sales.created_at is SQLite's
//      CURRENT_TIMESTAMP shape ('2026-09-04 01:15:00'). At index 10 'T'
//      (0x54) sorts AFTER ' ' (0x20), so `created_at >= '<iso>'` drops every
//      sale in the same day whose timestamp uses a space -- which is all of
//      them. The failure is silent: the report renders, the arithmetic is
//      self-consistent, and the shift simply reports $0.00. So the converter
//      gets a test that asserts the naive comparison IS wrong, not merely
//      that the converted one is right -- otherwise a later "simplification"
//      back to the raw ISO string would look harmless.
//
//   2. The filter reaches the SQL as a HALF-OPEN window plus a cashier_id
//      equality, and every pre-existing caller (no createdFrom/createdTo/
//      cashierId) emits byte-for-byte the SQL it emitted before.
//
// Run (from cloudflare/): node scripts/test-shift-window-filter-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

// Records every statement the kernel prepares, and answers each with zeros so
// deriveTotals still runs end to end.
const captured = []
const fakeDb = {
  prepare(sql) {
    const statement = { sql, params: null }
    captured.push(statement)
    return {
      get(params) { statement.params = params; return {} },
      all(params) { statement.params = params; return [] },
    }
  },
}
const analytics = loadReal('lib/salesAnalytics.ts', {
  './db': { getDb: () => fakeDb },
  './businessDateWindow': loadReal('lib/businessDateWindow.ts'),
})

// --- 1. the bound converter -------------------------------------------------

const ISO = '2026-09-04T01:15:00.000Z'
const SQLITE = '2026-09-04 01:15:00'
assert.equal(analytics.shiftWindowBound(ISO), SQLITE)
assert.equal(analytics.shiftWindowBound('2026-09-04T01:15:00Z'), SQLITE)
// An already-normalised value is idempotent -- a caller that passes a
// created_at straight back in must not have it shifted.
assert.equal(analytics.shiftWindowBound(SQLITE), SQLITE)
// A bound with a real offset is converted to UTC, not truncated: 08:15 in
// Cambodia is 01:15Z, the same instant as the ISO above.
assert.equal(analytics.shiftWindowBound('2026-09-04T08:15:00+07:00'), SQLITE)
for (const bad of [null, undefined, '', '   ', 'not a date', 42, {}]) {
  assert.equal(analytics.shiftWindowBound(bad), null, `unparseable bound must be null, got a value for ${JSON.stringify(bad)}`)
}

// The bug this converter exists to stop. A sale made one minute INTO the
// shift must be inside the window; against the raw ISO bound it is not.
const saleInsideShift = '2026-09-04 01:16:00'
assert.ok(saleInsideShift >= SQLITE, 'converted bound must admit a sale made after the shift opened')
assert.ok(!(saleInsideShift >= ISO), 'the raw ISO bound is expected to WRONGLY exclude this sale -- if this assertion fails the trap is gone and the comment above is stale')
console.log('PASS bound: ISO shift timestamps normalise to created_at shape; the naive comparison is proven wrong')

// --- 2. the filter reaches the SQL ------------------------------------------

const findClause = (needle) => captured.filter((s) => s.sql.includes(needle))

captured.length = 0
analytics.getSalesTotals({}, {
  createdFrom: ISO,
  createdTo: '2026-09-04T11:00:00.000Z',
  cashierId: 7,
})
assert.ok(captured.length >= 2, `expected the header aggregate and the cost query, got ${captured.length}`)
for (const statement of captured) {
  assert.match(statement.sql, /datetime\([^)]*created_at\) >= @createdFrom/, 'lower bound must normalize stored SQLite/ISO timestamps')
  assert.match(statement.sql, /datetime\([^)]*created_at\) < @createdTo/, 'upper bound must be normalized and EXCLUSIVE, or a boundary sale lands on two shifts')
  assert.ok(!statement.sql.includes('created_at <= @createdTo'), 'upper bound must not be inclusive')
  assert.ok(statement.sql.includes('cashier_id = @cashierId'), 'cashier scope missing from a shift-window query')
  assert.equal(statement.params.createdFrom, SQLITE, 'the bound must be normalised before binding, not passed through as ISO')
  assert.equal(statement.params.createdTo, '2026-09-04 11:00:00')
  assert.equal(statement.params.cashierId, 7)
}
// The window is bound, never interpolated.
for (const statement of captured) {
  assert.ok(!statement.sql.includes('2026-09-04'), 'a timestamp was interpolated into the SQL instead of bound')
}
console.log(`PASS filter: ${captured.length} shift-window statements carry a half-open bound pair and a bound cashier id`)

// A cashier id given as a string (a query parameter) still binds as a number,
// so it matches an INTEGER column rather than never matching.
captured.length = 0
analytics.getSalesTotals({}, { cashierId: '7' })
assert.strictEqual(captured[0].params.cashierId, 7)
// Blank/absent scope must not emit the clause at all.
for (const empty of [null, undefined, '']) {
  captured.length = 0
  analytics.getSalesTotals({}, { cashierId: empty })
  assert.ok(!captured[0].sql.includes('cashier_id'), `cashierId ${JSON.stringify(empty)} must not narrow the query`)
}
console.log('PASS scope: a string cashier id binds as a number; an absent one adds no clause')

// --- 3. existing callers are byte-for-byte unchanged ------------------------
// The kernel is shared with the Dashboard, /api/sales/stats and the Reports
// hub. The proof that this addition is additive is that a day-ranged call
// emits exactly the SQL it emitted before -- so the SQL is compared against
// the same call made through the plain day filter, with no shift keys.

captured.length = 0
analytics.getSalesTotals({}, { startDate: '2026-09-04', endDate: '2026-09-04', branchId: 2 })
const dayOnly = captured.map((s) => s.sql)
const dayOnlyParams = captured.map((s) => s.params)

captured.length = 0
analytics.getSalesTotals({}, {
  startDate: '2026-09-04', endDate: '2026-09-04', branchId: 2,
  createdFrom: null, createdTo: undefined, cashierId: '',
})
assert.deepEqual(captured.map((s) => s.sql), dayOnly, 'null/absent shift keys changed an existing query')
assert.deepEqual(captured.map((s) => s.params), dayOnlyParams, 'null/absent shift keys added a bound parameter')
for (const sql of dayOnly) {
  assert.ok(!sql.includes('@createdFrom') && !sql.includes('@createdTo') && !sql.includes('@cashierId'), 'a day-ranged query grew a shift clause')
}
console.log(`PASS additive: ${dayOnly.length} day-ranged statements are unchanged when the shift keys are absent or null`)

console.log('OK test-shift-window-filter-pure')
