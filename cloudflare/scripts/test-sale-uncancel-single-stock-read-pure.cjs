'use strict'
// Lane P1.2 (S4): PATCH /api/sales/:id/status, Cancelled -> Completed. The pre-flight availability check read branch_stock
// once per deducted line, so a 36+ line sale passed the Free plan's 50 D1 calls (58 calls at 40 lines, 114 at the 86-line
// production maximum) and answered 500. It is now ONE json_each read for every (product, branch) pair the plan takes.
//
// Source pins for the shape (the behaviour, the refusal text and the ledgers are pinned end to end by
// test-free-call-budget-ops-native.cjs, which compares them with the base commit's output):
//   - one statement, joined to branch_stock on BOTH halves of the pair, named parameter;
//   - the per-deduction loop awaits nothing, keeps plan order, and names the first short line with the same text;
//   - the CHECK(quantity >= 0) race guard still rides in the one atomic batch (the read is advisory, as it always was).
// P12_SRC=<dir> runs the pins against another src tree (the base commit via git archive): they are RED there.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = process.env.P12_SRC ? path.resolve(process.env.P12_SRC) : path.join(__dirname, '..', 'src')
const text = fs.readFileSync(path.join(SRC, 'routes', 'sales.ts'), 'utf8').replace(/\r\n/g, '\n')
const start = text.indexOf('// Pre-flight availability for anything the plan TAKES')
const end = text.indexOf('const mutationStamp = new Date().toISOString()', start)
assert.ok(start > 0 && end > start, 'the pre-flight block exists')
const block = text.slice(start, end)
const loop = block.slice(block.indexOf('for (const deduction of plan.deductions)'))

const tests = [
  ['one read for the whole transition', () => {
    assert.equal((block.match(/db\.prepare\(/g) || []).length, 1)
    assert.match(block, /FROM json_each\(@pairs\) j\s+JOIN branch_stock bs ON bs\.product_id = json_extract\(j\.value, '\$\[0\]'\) AND bs\.branch_id = json_extract\(j\.value, '\$\[1\]'\)/)
    assert.doesNotMatch(block, /WHERE product_id = \? AND branch_id = \?/, 'the per-line statement is gone')
  }],
  ['the pairs sent are the plan\'s own deductions, de-duplicated, product first then branch', () => {
    assert.match(block, /new Map\(plan\.deductions\.map\(\(entry\) => \[`\$\{entry\.product_id\}:\$\{entry\.branch_id\}`, \[entry\.product_id, entry\.branch_id\]\]\)\)/)
    assert.match(block, /JSON\.stringify\(\[\.\.\.deductionPairs\.values\(\)\]\)/)
  }],
  ['the loop awaits nothing, checks each deduction against the quantity read for its own pair, and keeps the refusal text', () => {
    assert.doesNotMatch(loop, /await /)
    assert.match(loop, /stockByPair\.get\(`\$\{deduction\.product_id\}:\$\{deduction\.branch_id\}`\) \|\| 0/)
    assert.match(loop, /if \(deduction\.quantity > available\) \{/)
    assert.match(loop, /Insufficient stock for \$\{name\}: requested \$\{deduction\.quantity\}, available \$\{available\}/)
    assert.match(loop, /\}, 409\)/)
  }],
  ['an empty plan sends no read at all', () => {
    assert.match(block, /deductionPairs\.size\s*\? await db\.prepare/)
    assert.match(block, /: \[\]\s*const stockByPair/)
  }],
  ['the write still rides in the atomic stock transaction with the CHECK-constraint refusal mapped to a 409', () => {
    const route = text.slice(end, text.indexOf("app.patch('/:id/customer'", end))
    assert.match(route, /executeStockTransaction\(db, statements, 'retry'\)/)
    assert.match(route, /CHECK constraint\|constraint failed/)
    assert.match(route, /code: 'stock_conflict'/)
  }],
]

let passed = 0
for (const [name, fn] of tests) {
  try { fn(); passed += 1; console.log('PASS', name) } catch (error) {
    console.log('FAIL', name, '-', String(error && error.message || error).split('\n').slice(0, 3).join(' | ')); process.exitCode = 1
  }
}
console.log(`\n${passed} of ${tests.length} checks passed.`)
