'use strict'
// M15 (round-2 review): the per-folded-lot statement estimate (the old "+ 7 per lot") could be changed by 5 and every test stayed green, because
// nothing compared the estimate with the statements the fold really builds. The fold is set-based now (one statement per kind, whatever the lot
// count), and the admission estimates (selectedConflictStatementEstimate, selectedConflictLightStatementEstimate) both call
// mergeFoldStatementCount, which this test pins to the real builder, mergeFoldStatements, for every shape, and to the lot-count independence the
// 77-lot merge needs: an estimate that grows per lot would refuse it at preflight (estimate over 100) although it writes about 40 statements.
// Run (from cloudflare/): node scripts/test-merge-fold-estimate-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }

const h = createProductsRouteHarness()
const { mergeFoldStatements, mergeFoldStatementCount } = h.load('routes/products.ts')

function shape(lots, stockPerLot, keptLots) {
  const lotRows = Array.from({ length: lots }, (_, i) => ({ dup: 2000 + i, target: 1000 + (i % Math.max(1, keptLots)) }))
  const stockRows = lotRows.flatMap((lot) => Array.from({ length: stockPerLot }, (_, b) => ({ target: lot.target, branch: b + 1, qty: 1 + b })))
  const metaRows = Array.from({ length: keptLots }, (_, i) => ({ id: 1000 + i, cost: 1.5, expiry: '2027-01-01' }))
  return { lotRows, stockRows, metaRows }
}

check('the estimate equals the number of statements the fold builds, for every shape (1 to 1000 lots, 0 to 3 branches, chunk edges)', () => {
  for (const lots of [1, 2, 10, 30, 77, 199, 200, 201, 400, 401, 1000]) {
    for (const stockPerLot of [0, 1, 2, 3]) {
      for (const keptLots of [0, 1, 5, 77, 200, 201]) {
        const { lotRows, stockRows, metaRows } = shape(lots, stockPerLot, keptLots)
        const built = mergeFoldStatements(lotRows, stockRows, metaRows).length
        assert.equal(mergeFoldStatementCount(lotRows.length, stockRows.length, metaRows.length), built, `${lots} lots, ${stockPerLot} branches, ${keptLots} kept lots`)
      }
    }
  }
  assert.equal(mergeFoldStatementCount(0, 5, 5), 0, 'no folded lot builds nothing')
  assert.deepEqual(mergeFoldStatements([], [], []), [])
})

check('the count does not grow with the lot count: 1, 10, 30 and 77 lots cost the same statements (the old estimate was 7 or more per lot)', () => {
  const counts = [1, 10, 30, 77].map((lots) => {
    const { lotRows, stockRows, metaRows } = shape(lots, 2, 3)
    return mergeFoldStatementCount(lotRows.length, stockRows.length, metaRows.length)
  })
  assert.equal(new Set(counts).size, 1, `counts ${counts}`)
  assert.ok(counts[3] <= 10, `a 77-lot fold is ${counts[3]} statements, about 8 plus the cost write`)
})

check('every statement binds one JSON parameter (far under D1\'s 100 bindings) and the JSON stays small per chunk', () => {
  const { lotRows, stockRows, metaRows } = shape(77, 3, 77)
  for (const statement of mergeFoldStatements(lotRows, stockRows, metaRows)) {
    assert.equal(Object.keys(statement.params).length, 1)
    assert.ok(Buffer.byteLength(Object.values(statement.params)[0]) < 30_000)
  }
})

check('both admission estimates in routes/products.ts call the shared counter (no per-lot term was reintroduced)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.equal((source.match(/mergeFoldStatementCount\(foldedLots, foldStockEntries, new Set\(lotMatches\.values\(\)\)\.size\)/g) || []).length, 2, 'the selected-conflict estimate and its light twin')
  assert.doesNotMatch(source, /\.length \|\| 0\) \+ 7/, 'the old "+ 7 per folded lot" is gone')
  assert.doesNotMatch(source, /Number\(row\.quantity\)\)\.length \+ 7/, 'and its twin')
})

console.log(`${passed} passed, 0 failed`)
